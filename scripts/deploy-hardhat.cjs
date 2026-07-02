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
  const defaultCzToken = "0xD0F2A86C7EbCeE887F5bFB86771f994CD142bD04";
  const defaultBscUsdt = "0x55d398326f99059fF775485246999027B3197955";
  const defaultFeeReceiverA = "0xfd682CbCb678ce5D273Eb778B946F6a4d8f1e8Ed";
  const defaultFeeReceiverB = "0x5A378b61193ac2ce07cE816893C080804504a2f0";
  const existingTokenAddress = process.env.CZ_TOKEN_ADDRESS || process.env.NBT_TOKEN_ADDRESS || (isMainnet ? defaultCzToken : "");
  const tokenName = process.env.TOKEN_NAME || "NBT";
  const tokenSymbol = process.env.TOKEN_SYMBOL || "NBT";
  const initialSupply = process.env.INITIAL_SUPPLY || "200000000";
  const initialSupplyWei = hre.ethers.parseEther(initialSupply);
  const buyFee = Number(process.env.BUY_FEE || "0");
  const sellFee = Number(process.env.SELL_FEE || "280");
  const initialRewardFund = process.env.INITIAL_REWARD_FUND || "0";
  const rewardFundWei = hre.ethers.parseEther(initialRewardFund);
  const interactionFee = hre.ethers.parseEther(process.env.INTERACTION_FEE || "0.4");
  const feeTokenAddress = process.env.FEE_TOKEN || (isMainnet ? defaultBscUsdt : "");
  const feeReceiverA = process.env.FEE_RECEIVER_A || defaultFeeReceiverA;
  const feeReceiverB = process.env.FEE_RECEIVER_B || defaultFeeReceiverB;

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
  console.log(`CZ Token: ${existingTokenAddress || "(deploy new token)"}`);
  console.log(`Fee Token: ${feeTokenAddress || "(new token on local/test)"}`);
  console.log(`Interaction Fee: ${hre.ethers.formatEther(interactionFee)} U`);
  console.log(`Fee Receiver A: ${feeReceiverA}`);
  console.log(`Fee Receiver B: ${feeReceiverB}`);
  console.log(`Initial Reward Fund: ${initialRewardFund}`);
  console.log("=======================================\n");

  let token;
  let nbtTokenAddress = existingTokenAddress;
  if (nbtTokenAddress) {
    token = await hre.ethers.getContractAt("IERC20", nbtTokenAddress);
    console.log(`Using existing CZ token: ${nbtTokenAddress}`);
  } else {
    console.log("Deploying local/test token...");
    const NBTToken = await hre.ethers.getContractFactory("NBTToken");
    token = await NBTToken.deploy(
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
    nbtTokenAddress = await token.getAddress();
    console.log(`Local/test token deployed: ${nbtTokenAddress}`);
  }

  const resolvedFeeToken = feeTokenAddress || nbtTokenAddress;

  // Deploy NBTStakingBank
  console.log("\nDeploying NBTStakingBank...");
  const NBTStakingBank = await hre.ethers.getContractFactory("NBTStakingBank");
  const stakingBank = await NBTStakingBank.deploy(
    nbtTokenAddress,
    nbtTokenAddress,
    resolvedFeeToken,
    feeReceiverA,
    feeReceiverB,
    interactionFee
  );
  await stakingBank.waitForDeployment();
  const stakingBankAddress = await stakingBank.getAddress();
  console.log(`NBTStakingBank deployed: ${stakingBankAddress}`);

  // Fund initial rewards if specified
  if (rewardFundWei > 0n) {
    console.log("\nTransferring initial invite reward reserve...");
    const fundTx = await token.transfer(stakingBankAddress, rewardFundWei);
    await fundTx.wait();
    console.log(`Transferred ${initialRewardFund} CZ to staking bank`);
  }

  // Write frontend env
  const frontendEnvPath = path.resolve(__dirname, "..", "frontend 3", ".env");
  const envContent = [
    `VITE_CHAIN_ID=${isMainnet ? "0x38" : "0x61"}`,
    `VITE_NBT_TOKEN=${nbtTokenAddress}`,
    `VITE_STAKING_BANK=${stakingBankAddress}`,
    `VITE_NBT_PAIR=${nbtPair}`,
    `VITE_FEE_TOKEN=${resolvedFeeToken}`,
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
    feeToken: resolvedFeeToken,
    interactionFee: hre.ethers.formatEther(interactionFee),
    feeReceiverA,
    feeReceiverB,
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
      if (!existingTokenAddress) {
        console.log("Verifying local/test token...");
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
        console.log("Token verified!");
      }
    } catch (err) {
      console.log("Token verification failed:", err.message);
    }

    try {
      console.log("Verifying NBTStakingBank...");
      await hre.run("verify:verify", {
        address: stakingBankAddress,
        constructorArguments: [
          nbtTokenAddress,
          nbtTokenAddress,
          resolvedFeeToken,
          feeReceiverA,
          feeReceiverB,
          interactionFee,
        ],
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
  console.log(`FeeToken: ${resolvedFeeToken}`);
  console.log(`InteractionFee: ${hre.ethers.formatEther(interactionFee)} U`);
  console.log(`Deployer: ${deployerAddress}`);
  console.log("=========================================\n");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
