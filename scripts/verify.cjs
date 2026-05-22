const hre = require("hardhat");

async function main() {
  const network = hre.network.name;
  console.log(`Verifying contracts on ${network}...`);

  // Contract addresses
  const nbtToken = "0xca2E64A3CDD445a9d45507c08B20Ba2Dc0594A68";
  const stakingBank = "0x9A99aD856d883dFd3EBC550b070468CA640edcF4";
  const deployer = "0xD09Dc26F1c20E85879863A7e932735749efC1835";

  // Verify NBTToken
  console.log("\nVerifying NBTToken...");
  try {
    await hre.run("verify:verify", {
      address: nbtToken,
      constructorArguments: [
        "NBT",
        "NBT",
        hre.ethers.parseEther("200000000"),
        deployer,
        0,
        280,
        [],
        [],
      ],
    });
    console.log("NBTToken verified successfully!");
  } catch (err) {
    if (err.message.includes("Already Verified")) {
      console.log("NBTToken already verified.");
    } else {
      console.error("NBTToken verification failed:", err.message);
    }
  }

  // Verify NBTStakingBank
  console.log("\nVerifying NBTStakingBank...");
  try {
    await hre.run("verify:verify", {
      address: stakingBank,
      constructorArguments: [nbtToken, nbtToken],
    });
    console.log("NBTStakingBank verified successfully!");
  } catch (err) {
    if (err.message.includes("Already Verified")) {
      console.log("NBTStakingBank already verified.");
    } else {
      console.error("NBTStakingBank verification failed:", err.message);
    }
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
