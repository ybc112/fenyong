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
    throw new Error(`Missing ${name}. Copy .env.mainnet to .env and fill ${name}.`);
  }
  return value;
}

function optionalEnv(name, fallback = '') {
  const value = process.env[name];
  return value === undefined ? fallback : value;
}

function artifact(contractFile, contractName) {
  const artifactPath = path.join(rootDir, 'artifacts', 'contracts', contractFile, `${contractName}.json`);
  if (!existsSync(artifactPath)) {
    throw new Error(`Missing artifact ${artifactPath}. Run hardhat compile first.`);
  }
  return JSON.parse(readFileSync(artifactPath, 'utf8'));
}

function writeFrontendEnv(filePath, values) {
  const envContent = [
    'VITE_CHAIN_ID=0x38',
    `VITE_NBT_TOKEN=${values.nbtToken}`,
    `VITE_STAKING_BANK=${values.stakingBank}`,
    `VITE_NBT_PAIR=${values.nbtPair || ''}`,
    `VITE_FEE_TOKEN=${values.feeToken || ''}`,
    '',
  ].join('\n');
  writeFileSync(filePath, envContent);
}

function writeDeploymentJson(dirPath, payload) {
  mkdirSync(dirPath, { recursive: true });
  const filePath = path.join(dirPath, `bsc-mainnet-${payload.timestamp}.json`);
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
  loadDotenv(path.join(rootDir, '.env.mainnet'));

  const rpcUrl = optionalEnv('BSC_MAINNET_RPC_URL', 'https://bsc-dataseed.binance.org/');
  const privateKey = requireEnv('PRIVATE_KEY');
  const tokenName = optionalEnv('TOKEN_NAME', 'NBT');
  const tokenSymbol = optionalEnv('TOKEN_SYMBOL', 'NBT');
  const initialSupply = optionalEnv('INITIAL_SUPPLY', '200000000');
  const initialRewardFund = optionalEnv('INITIAL_REWARD_FUND', '0');
  const existingTokenAddress = optionalEnv('CZ_TOKEN_ADDRESS', '0xD0F2A86C7EbCeE887F5bFB86771f994CD142bD04');
  const feeTokenAddress = optionalEnv('FEE_TOKEN', '0x55d398326f99059fF775485246999027B3197955');
  const feeReceiverA = optionalEnv('FEE_RECEIVER_A', '0xfd682CbCb678ce5D273Eb778B946F6a4d8f1e8Ed');
  const feeReceiverB = optionalEnv('FEE_RECEIVER_B', '0x5A378b61193ac2ce07cE816893C080804504a2f0');
  const interactionFee = optionalEnv('INTERACTION_FEE', '0.4');
  const deploymentsDir = path.resolve(rootDir, optionalEnv('DEPLOYMENTS_DIR', 'deployments'));
  const frontendEnvPath = path.resolve(rootDir, optionalEnv('FRONTEND_ENV_PATH', 'frontend 3/.env'));

  console.log('Building contracts with Hardhat...');
  execFileSync('npx', ['hardhat', 'compile'], { cwd: rootDir, stdio: 'inherit', shell: true });

  const provider = new ethers.JsonRpcProvider(rpcUrl);
  const wallet = new ethers.Wallet(privateKey, provider);
  const network = await provider.getNetwork();
  if (Number(network.chainId) !== 56) {
    throw new Error(`Expected BSC Mainnet chain id 56, got ${network.chainId}. Check BSC_MAINNET_RPC_URL.`);
  }

  const deployer = await wallet.getAddress();
  const feeReceiverInput = optionalEnv('FEE_RECEIVER', '');
  const feeReceiver = feeReceiverInput && ethers.isAddress(feeReceiverInput) ? feeReceiverInput : deployer;
  const pairInput = optionalEnv('NBT_PAIR', '');
  const nbtPair = pairInput && ethers.isAddress(pairInput) ? pairInput : '';

  const balance = await provider.getBalance(deployer);
  console.log(`Deployer: ${deployer}`);
  console.log(`BNB balance: ${ethers.formatEther(balance)}`);

  if (balance < ethers.parseEther('0.01')) {
    console.warn('WARNING: BNB balance is very low. Deployment may fail due to insufficient gas.');
  }

  const stakingArtifact = artifact('NBTStakingBank.sol', 'NBTStakingBank');
  const token = new ethers.Contract(existingTokenAddress, [
    'function transfer(address to, uint256 amount) returns (bool)',
  ], wallet);

  console.log('\n========== DEPLOYMENT CONFIG ==========');
  console.log(`Network: BSC Mainnet (Chain ID: 56)`);
  console.log(`CZ Token: ${existingTokenAddress}`);
  console.log(`NBT Pair: ${nbtPair || '(none)'}`);
  console.log(`Fee Token: ${feeTokenAddress}`);
  console.log(`Interaction Fee: ${interactionFee} U`);
  console.log(`Fee Receiver A: ${feeReceiverA}`);
  console.log(`Fee Receiver B: ${feeReceiverB}`);
  console.log(`Initial Reward Fund: ${initialRewardFund}`);
  console.log('=======================================\n');

  console.log('\nDeploying NBTStakingBank...');
  const stakingFactory = new ethers.ContractFactory(stakingArtifact.abi, stakingArtifact.bytecode, wallet);
  const staking = await stakingFactory.deploy(
    existingTokenAddress,
    existingTokenAddress,
    feeTokenAddress,
    feeReceiverA,
    feeReceiverB,
    ethers.parseEther(interactionFee),
  );
  await staking.waitForDeployment();
  const stakingBank = await staking.getAddress();
  console.log(`NBTStakingBank deployed: ${stakingBank}`);

  const rewardFundWei = ethers.parseEther(initialRewardFund);
  if (rewardFundWei > 0n) {
    console.log('\nTransferring initial invite reward reserve...');
    await wait(await token.transfer(stakingBank, rewardFundWei), 'Transfer initial rewards');
  }

  writeFrontendEnv(frontendEnvPath, { nbtToken: existingTokenAddress, stakingBank, nbtPair, feeToken: feeTokenAddress });

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const deploymentPath = writeDeploymentJson(deploymentsDir, {
    network: 'bsc-mainnet',
    chainId: Number(network.chainId),
    timestamp,
    deployer,
    nbtToken: existingTokenAddress,
    stakingBank,
    nbtPair,
    feeToken: feeTokenAddress,
    interactionFee,
    feeReceiverA,
    feeReceiverB,
    tokenName,
    tokenSymbol,
    initialSupply,
    initialRewardFund,
    frontendEnvPath,
  });

  console.log('\n========== DEPLOYMENT COMPLETE ==========');
  console.log(`Network: BSC Mainnet`);
  console.log(`CZToken: ${existingTokenAddress}`);
  console.log(`StakingBank: ${stakingBank}`);
  console.log(`Deployer: ${deployer}`);
  console.log(`Frontend env written: ${frontendEnvPath}`);
  console.log(`Deployment record: ${deploymentPath}`);
  console.log('\nIMPORTANT: Save these addresses! They cannot be changed.');
  console.log('=========================================\n');
  console.log('Next commands:');
  console.log('  npm --prefix "frontend 3" run build');
  console.log('  npm --prefix "frontend 3" run dev');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
