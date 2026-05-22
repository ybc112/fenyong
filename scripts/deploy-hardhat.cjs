const hre = require("hardhat");
const fs = require("fs");
const path = require("path");

async function main() {
  const network = hre.network.name;
  const isMainnet = network === "bscMainnet";
  const chainId = isMainnet ? 56 : 97;

  console.log(`Deploying to ${network} (Chain ID: ${chainId})...`);

  const [deployer] = await hre.ethers.getSigners();
  const deployerAddress = await deployer.getAddress();
  const balance = await hre.ethers.provider.getBalance(deployerAddress);

  console.log(`Deployer: ${deployerAddress}`);
  console.log(`Balance: ${hre.ethers.formatEther(balance)} BNB`);

  // Token parameters
  const tokenName = process.env.TOKEN_NAME || "NBT";
  const tokenSymbol = process.env.TOKEN_SYMBOL || "NBT";
  const initialSupply = process.env.INITIAL_SUPPLY || "200000000";
  const initialSupplyWei = hre.ethers.parseEther(initialSupply);
  const buyFee = Number(process.env.BUY_FEE || "0");
  const sellFee = Number(process.env.SELL_FEE || "280");
  const initialRewardFund = process.env.INITIAL_REWARD_FUND || "0";
  const rewardFundWei = hre.ethers.parseEther(initialRewardFund);

  // Fee receiver (default to deployer)
  const feeReceiver = process.env.FEE_RECEIVER || deployerAddress;
  const nbtPair = process.env.NBT_PAIR || "";
  const initialPairs = nbtPair ? [nbtPair] : [];
  const initialExcluded = [];

  console.log("\n========== DEPLOYMENT CONFIG ==========");
  console.log(`Token Name: ${tokenName}`);
  console.log(`Token Symbol: ${tokenSymbol}`);
  console.log(`Initial Supply: ${initialSupply}`);
  console.log(`Buy Fee: ${buyFee / 100}%`);
  console.log(`Sell Fee: ${sellFee / 100}%`);
  console.log(`Fee Receiver: ${feeReceiver}`);
  console.log(`NBT Pair: ${nbtPair || "(none)"}`);
  console.log(`Initial Reward Fund: ${initialRewardFund}`);
  console.log("=======================================\n");

  // Deploy NBTToken
  console.log("Deploying NBTToken...");
  const NBTToken = await hre.ethers.getContractFactory("NBTToken");
  const token = await NBTToken.deploy(
    tokenName,
    tokenSymbol,
    initialSupplyWei,
    feeReceiver,
    buyFee,
    sellFee,
    initialPairs,
    initialExcluded
  );
  await token.waitForDeployment();
  const nbtTokenAddress = await token.getAddress();
  console.log(`NBTToken deployed: ${nbtTokenAddress}`);

  // Deploy NBTStakingBank
  console.log("\nDeploying NBTStakingBank...");
  const NBTStakingBank = await hre.ethers.getContractFactory("NBTStakingBank");
  const stakingBank = await NBTStakingBank.deploy(nbtTokenAddress, nbtTokenAddress);
  await stakingBank.waitForDeployment();
  const stakingBankAddress = await stakingBank.getAddress();
  console.log(`NBTStakingBank deployed: ${stakingBankAddress}`);

  // Fund initial rewards if specified
  if (rewardFundWei > 0n) {
    console.log("\nFunding initial rewards...");
    const approveTx = await token.approve(stakingBankAddress, rewardFundWei);
    await approveTx.wait();
    console.log(`Approved ${initialRewardFund} NBT for staking bank`);

    const fundTx = await stakingBank.fundRewards(rewardFundWei);
    await fundTx.wait();
    console.log(`Funded ${initialRewardFund} NBT as initial rewards`);
  }

  // Write frontend env
  const frontendEnvPath = path.resolve(__dirname, "..", "frontend 3", ".env");
  const envContent = [
    `VITE_CHAIN_ID=${isMainnet ? "0x38" : "0x61"}`,
    `VITE_NBT_TOKEN=${nbtTokenAddress}`,
    `VITE_STAKING_BANK=${stakingBankAddress}`,
    `VITE_NBT_PAIR=${nbtPair}`,
    "",
  ].join("\n");
  fs.writeFileSync(frontendEnvPath, envContent);
  console.log(`\nFrontend env written: ${frontendEnvPath}`);

  // Write deployment record
  const deploymentsDir = path.resolve(__dirname, "..", "deployments");
  if (!fs.existsSync(deploymentsDir)) {
    fs.mkdirSync(deploymentsDir, { recursive: true });
  }
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const deploymentPath = path.join(deploymentsDir, `bsc-${isMainnet ? "mainnet" : "testnet"}-${timestamp}.json`);
  const deploymentRecord = {
    network: isMainnet ? "bsc-mainnet" : "bsc-testnet",
    chainId,
    timestamp,
    deployer: deployerAddress,
    nbtToken: nbtTokenAddress,
    stakingBank: stakingBankAddress,
    nbtPair,
    tokenName,
    tokenSymbol,
    initialSupply,
    feeReceiver,
    initialRewardFund,
  };
  fs.writeFileSync(deploymentPath, JSON.stringify(deploymentRecord, null, 2) + "\n");
  console.log(`Deployment record: ${deploymentPath}`);

  // Verify contracts on BscScan (if API key is set)
  if (process.env.BSCSCAN_API_KEY) {
    console.log("\nWaiting for block confirmations before verification...");
    await new Promise(resolve => setTimeout(resolve, 30000)); // Wait 30 seconds

    try {
      console.log("Verifying NBTToken...");
      await hre.run("verify:verify", {
        address: nbtTokenAddress,
        constructorArguments: [
          tokenName,
          tokenSymbol,
          initialSupplyWei,
          feeReceiver,
          buyFee,
          sellFee,
          initialPairs,
          initialExcluded,
        ],
      });
      console.log("NBTToken verified!");
    } catch (err) {
      console.log("NBTToken verification failed:", err.message);
    }

    try {
      console.log("Verifying NBTStakingBank...");
      await hre.run("verify:verify", {
        address: stakingBankAddress,
        constructorArguments: [nbtTokenAddress, nbtTokenAddress],
      });
      console.log("NBTStakingBank verified!");
    } catch (err) {
      console.log("NBTStakingBank verification failed:", err.message);
    }
  }

  console.log("\n========== DEPLOYMENT COMPLETE ==========");
  console.log(`Network: ${isMainnet ? "BSC Mainnet" : "BSC Testnet"}`);
  console.log(`NBTToken: ${nbtTokenAddress}`);
  console.log(`StakingBank: ${stakingBankAddress}`);
  console.log(`Deployer: ${deployerAddress}`);
  console.log("=========================================\n");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
