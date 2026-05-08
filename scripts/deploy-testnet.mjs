import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ethers } from 'ethers';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

function loadDotenv(filePath) {
  if (!existsSync(filePath)) return;
  const content = readFileSync(filePath, 'utf8');
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const index = line.indexOf('=');
    if (index === -1) continue;
    const key = line.slice(0, index).trim();
    let value = line.slice(index + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (!process.env[key]) {
      process.env[key] = value;
    }
  }
}

function requireEnv(name) {
  const value = process.env[name];
  if (!value || value.includes('YOUR_')) {
    throw new Error(`Missing ${name}. Copy .env.example to .env and fill ${name}.`);
  }
  return value;
}

function optionalEnv(name, fallback = '') {
  const value = process.env[name];
  return value === undefined ? fallback : value;
}

function artifact(contractFile, contractName) {
  const artifactPath = path.join(rootDir, 'out', contractFile, `${contractName}.json`);
  if (!existsSync(artifactPath)) {
    throw new Error(`Missing artifact ${artifactPath}. Run forge build first.`);
  }
  return JSON.parse(readFileSync(artifactPath, 'utf8'));
}

function writeFrontendEnv(filePath, values) {
  const envContent = [
    'VITE_CHAIN_ID=0x61',
    `VITE_NBT_TOKEN=${values.nbtToken}`,
    `VITE_STAKING_BANK=${values.stakingBank}`,
    `VITE_NBT_PAIR=${values.nbtPair || ''}`,
    '',
  ].join('\n');
  writeFileSync(filePath, envContent);
}

function writeDeploymentJson(dirPath, payload) {
  mkdirSync(dirPath, { recursive: true });
  const filePath = path.join(dirPath, `bsc-testnet-${payload.timestamp}.json`);
  writeFileSync(filePath, `${JSON.stringify(payload, null, 2)}\n`);
  return filePath;
}

async function wait(tx, label) {
  console.log(`${label}: ${tx.hash}`);
  const receipt = await tx.wait();
  console.log(`${label} confirmed in block ${receipt.blockNumber}`);
  return receipt;
}

async function main() {
  loadDotenv(path.join(rootDir, '.env'));

  const rpcUrl = optionalEnv('BSC_TESTNET_RPC_URL', 'https://data-seed-prebsc-1-s1.binance.org:8545/');
  const privateKey = requireEnv('PRIVATE_KEY');
  const tokenName = optionalEnv('TOKEN_NAME', 'NBT');
  const tokenSymbol = optionalEnv('TOKEN_SYMBOL', 'NBT');
  const initialSupply = optionalEnv('INITIAL_SUPPLY', '100000000');
  const initialRewardFund = optionalEnv('INITIAL_REWARD_FUND', '0');
  const deploymentsDir = path.resolve(rootDir, optionalEnv('DEPLOYMENTS_DIR', 'deployments'));
  const frontendEnvPath = path.resolve(rootDir, optionalEnv('FRONTEND_ENV_PATH', 'frontend 3/.env'));

  console.log('Building contracts with forge...');
  execFileSync('forge', ['build'], { cwd: rootDir, stdio: 'inherit' });

  const provider = new ethers.JsonRpcProvider(rpcUrl);
  const wallet = new ethers.Wallet(privateKey, provider);
  const network = await provider.getNetwork();
  if (Number(network.chainId) !== 97) {
    throw new Error(`Expected BSC Testnet chain id 97, got ${network.chainId}. Check BSC_TESTNET_RPC_URL.`);
  }

  const deployer = await wallet.getAddress();
  const feeReceiverInput = optionalEnv('FEE_RECEIVER', '');
  const feeReceiver = feeReceiverInput && ethers.isAddress(feeReceiverInput) ? feeReceiverInput : deployer;
  const pairInput = optionalEnv('NBT_PAIR', '');
  const nbtPair = pairInput && ethers.isAddress(pairInput) ? pairInput : '';

  const balance = await provider.getBalance(deployer);
  console.log(`Deployer: ${deployer}`);
  console.log(`tBNB balance: ${ethers.formatEther(balance)}`);

  const tokenArtifact = artifact('NBTToken.sol', 'NBTToken');
  const stakingArtifact = artifact('NBTStakingBank.sol', 'NBTStakingBank');

  const tokenFactory = new ethers.ContractFactory(tokenArtifact.abi, tokenArtifact.bytecode.object, wallet);
  const initialSupplyWei = ethers.parseEther(initialSupply);
  const token = await tokenFactory.deploy(tokenName, tokenSymbol, initialSupplyWei, feeReceiver);
  await token.waitForDeployment();
  const nbtToken = await token.getAddress();
  console.log(`NBTToken deployed: ${nbtToken}`);

  const stakingFactory = new ethers.ContractFactory(stakingArtifact.abi, stakingArtifact.bytecode.object, wallet);
  const staking = await stakingFactory.deploy(nbtToken, nbtToken);
  await staking.waitForDeployment();
  const stakingBank = await staking.getAddress();
  console.log(`NBTStakingBank deployed: ${stakingBank}`);

  await wait(await token.setExcludedFromFee(stakingBank, true), 'Whitelist staking bank');
  if (nbtPair) {
    await wait(await token.setPair(nbtPair, true), 'Set NBT pair');
  }

  const rewardFundWei = ethers.parseEther(initialRewardFund);
  if (rewardFundWei > 0n) {
    await wait(await token.approve(stakingBank, rewardFundWei), 'Approve initial rewards');
    await wait(await staking.fundRewards(rewardFundWei), 'Fund initial rewards');
  }

  writeFrontendEnv(frontendEnvPath, { nbtToken, stakingBank, nbtPair });

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const deploymentPath = writeDeploymentJson(deploymentsDir, {
    network: 'bsc-testnet',
    chainId: Number(network.chainId),
    timestamp,
    deployer,
    nbtToken,
    stakingBank,
    nbtPair,
    tokenName,
    tokenSymbol,
    initialSupply,
    feeReceiver,
    initialRewardFund,
    frontendEnvPath,
  });

  console.log('');
  console.log('Deployment complete.');
  console.log(`Frontend env written: ${frontendEnvPath}`);
  console.log(`Deployment record: ${deploymentPath}`);
  console.log('');
  console.log('Next commands:');
  console.log('  npm --prefix "frontend 3" run build');
  console.log('  npm --prefix "frontend 3" run dev');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
