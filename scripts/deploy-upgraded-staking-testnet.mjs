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
    if (!process.env[key]) process.env[key] = value;
  }
}

function readEnvFile(filePath) {
  if (!existsSync(filePath)) return {};
  const result = {};
  for (const rawLine of readFileSync(filePath, 'utf8').split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const index = line.indexOf('=');
    if (index === -1) continue;
    result[line.slice(0, index).trim()] = line.slice(index + 1).trim();
  }
  return result;
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
  const artifactPath = path.join(rootDir, 'artifacts', 'contracts', contractFile, `${contractName}.json`);
  if (!existsSync(artifactPath)) {
    throw new Error(`Missing artifact ${artifactPath}. Run hardhat compile first.`);
  }
  return JSON.parse(readFileSync(artifactPath, 'utf8'));
}

function writeFrontendEnv(filePath, values) {
  const envContent = [
    'VITE_CHAIN_ID=0x61',
    `VITE_NBT_TOKEN=${values.nbtToken}`,
    `VITE_STAKING_BANK=${values.stakingBank}`,
    `VITE_NBT_PAIR=${values.nbtPair || ''}`,
    `VITE_FEE_TOKEN=${values.feeToken || values.nbtToken}`,
    '',
  ].join('\n');
  writeFileSync(filePath, envContent);
}

function updateRenderYaml(filePath, values) {
  if (!existsSync(filePath)) return;
  let content = readFileSync(filePath, 'utf8');
  const replacements = {
    VITE_CHAIN_ID: '0x61',
    VITE_NBT_TOKEN: values.nbtToken,
    VITE_STAKING_BANK: values.stakingBank,
    VITE_NBT_PAIR: values.nbtPair || '""',
    VITE_FEE_TOKEN: values.feeToken || values.nbtToken,
  };

  for (const [key, value] of Object.entries(replacements)) {
    const pattern = new RegExp(`(key:\\s*${key}\\s*\\r?\\n\\s*value:\\s*)[^\\r\\n]*`, 'g');
    content = content.replace(pattern, `$1${value}`);
  }
  writeFileSync(filePath, content);
}

function writeDeploymentJson(dirPath, payload) {
  mkdirSync(dirPath, { recursive: true });
  const filePath = path.join(dirPath, `bsc-testnet-staking-upgrade-${payload.timestamp}.json`);
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

  const frontendEnvPath = path.resolve(rootDir, optionalEnv('FRONTEND_ENV_PATH', 'frontend 3/.env'));
  const frontendEnv = readEnvFile(frontendEnvPath);
  const rpcUrl = optionalEnv('BSC_TESTNET_RPC_URL', 'https://data-seed-prebsc-1-s1.binance.org:8545/');
  const privateKey = requireEnv('PRIVATE_KEY');
  const nbtToken = optionalEnv('EXISTING_NBT_TOKEN', frontendEnv.VITE_NBT_TOKEN);
  const nbtPair = optionalEnv('NBT_PAIR', frontendEnv.VITE_NBT_PAIR || '');
  const feeToken = optionalEnv('FEE_TOKEN', frontendEnv.VITE_FEE_TOKEN || nbtToken);
  const feeReceiverA = optionalEnv('FEE_RECEIVER_A', '0xfd682CbCb678ce5D273Eb778B946F6a4d8f1e8Ed');
  const feeReceiverB = optionalEnv('FEE_RECEIVER_B', '0x5A378b61193ac2ce07cE816893C080804504a2f0');
  const interactionFee = optionalEnv('INTERACTION_FEE', '0.4');
  const initialRewardFund = optionalEnv('INITIAL_REWARD_FUND', '0');
  const deploymentsDir = path.resolve(rootDir, optionalEnv('DEPLOYMENTS_DIR', 'deployments'));

  if (!ethers.isAddress(nbtToken)) throw new Error(`Invalid CZ token address: ${nbtToken}`);
  if (!ethers.isAddress(feeToken)) throw new Error(`Invalid fee token address: ${feeToken}`);
  if (!ethers.isAddress(feeReceiverA) || !ethers.isAddress(feeReceiverB)) {
    throw new Error('Invalid fee receiver address');
  }

  console.log('Building upgraded staking contract with Hardhat...');
  execFileSync('npx', ['hardhat', 'compile'], { cwd: rootDir, stdio: 'inherit', shell: true });

  const provider = new ethers.JsonRpcProvider(rpcUrl);
  const wallet = new ethers.Wallet(privateKey, provider);
  const network = await provider.getNetwork();
  if (Number(network.chainId) !== 97) {
    throw new Error(`Expected BSC Testnet chain id 97, got ${network.chainId}. Check BSC_TESTNET_RPC_URL.`);
  }

  const deployer = await wallet.getAddress();
  const nativeBalance = await provider.getBalance(deployer);
  console.log(`Deployer: ${deployer}`);
  console.log(`tBNB balance: ${ethers.formatEther(nativeBalance)}`);
  console.log(`Reusing CZ token: ${nbtToken}`);

  const stakingArtifact = artifact('NBTStakingBank.sol', 'NBTStakingBank');
  const stakingFactory = new ethers.ContractFactory(stakingArtifact.abi, stakingArtifact.bytecode, wallet);
  const staking = await stakingFactory.deploy(
    nbtToken,
    nbtToken,
    feeToken,
    feeReceiverA,
    feeReceiverB,
    ethers.parseEther(interactionFee),
  );
  await staking.waitForDeployment();
  const stakingBank = await staking.getAddress();
  console.log(`Upgraded NBTStakingBank deployed: ${stakingBank}`);

  const token = new ethers.Contract(nbtToken, artifact('NBTToken.sol', 'NBTToken').abi, wallet);
  const rewardFundWei = ethers.parseEther(initialRewardFund);
  if (rewardFundWei > 0n) {
    const deployerTokenBalance = await token.balanceOf(deployer);
    if (deployerTokenBalance < rewardFundWei) {
      throw new Error(`Insufficient CZ for reward fund. Need ${initialRewardFund}, have ${ethers.formatEther(deployerTokenBalance)}.`);
    }
    await wait(await token.transfer(stakingBank, rewardFundWei), 'Transfer initial rewards');
  }

  writeFrontendEnv(frontendEnvPath, { nbtToken, stakingBank, nbtPair, feeToken });
  updateRenderYaml(path.join(rootDir, 'render.yaml'), { nbtToken, stakingBank, nbtPair, feeToken });

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const deploymentPath = writeDeploymentJson(deploymentsDir, {
    network: 'bsc-testnet',
    chainId: Number(network.chainId),
    timestamp,
    deployer,
    nbtToken,
    stakingBank,
    oldStakingBank: frontendEnv.VITE_STAKING_BANK || '',
    nbtPair,
    feeToken,
    interactionFee,
    feeReceiverA,
    feeReceiverB,
    initialRewardFund,
    frontendEnvPath,
  });

  console.log('');
  console.log('Staking upgrade deployment complete.');
  console.log(`Frontend env written: ${frontendEnvPath}`);
  console.log(`Deployment record: ${deploymentPath}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
