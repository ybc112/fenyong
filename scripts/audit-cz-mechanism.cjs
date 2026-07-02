const hre = require("hardhat");

const { ethers } = hre;

const CZ_MAINNET = "0xD0F2A86C7EbCeE887F5bFB86771f994CD142bD04";
const FEE_A = "0xfd682CbCb678ce5D273Eb778B946F6a4d8f1e8Ed";
const FEE_B = "0x5A378b61193ac2ce07cE816893C080804504a2f0";

const ether = ethers.parseEther;
const fmt = (value) => Number(ethers.formatEther(value));

function assertEqual(actual, expected, label) {
  if (actual !== expected) {
    throw new Error(`${label}: expected ${expected}, got ${actual}`);
  }
}

function assertBigEqual(actual, expected, label) {
  if (actual !== expected) {
    throw new Error(`${label}: expected ${ethers.formatEther(expected)}, got ${ethers.formatEther(actual)}`);
  }
}

async function deployToken(name, symbol, supply, owner) {
  const Token = await ethers.getContractFactory("NBTToken");
  const token = await Token.deploy(
    name,
    symbol,
    ether(supply),
    owner.address,
    0,
    0,
    [],
    [],
  );
  await token.waitForDeployment();
  return token;
}

async function main() {
  const [owner] = await ethers.getSigners();

  const cz = await deployToken("Crypto Zenith", "CZ", "1000000000", owner);
  const usdt = await deployToken("Mock USDT", "USDT", "1000000000", owner);

  const Bank = await ethers.getContractFactory("NBTStakingBank");
  const bank = await Bank.deploy(
    await cz.getAddress(),
    await cz.getAddress(),
    await usdt.getAddress(),
    FEE_A,
    FEE_B,
    ether("0.4"),
  );
  await bank.waitForDeployment();

  assertEqual(await bank.owner(), owner.address, "owner");
  assertEqual(await bank.feeReceiverA(), FEE_A, "fee receiver A");
  assertEqual(await bank.feeReceiverB(), FEE_B, "fee receiver B");
  assertBigEqual(await bank.interactionFee(), ether("0.4"), "interaction fee");
  assertBigEqual(await bank.inviteReward(), ether("1"), "invite reward");

  const reserve = ether("1000");
  await cz.transfer(await bank.getAddress(), reserve);

  const stakers = [];
  const nodes = [];
  for (let i = 0; i < 120; i++) {
    const wallet = ethers.Wallet.createRandom().connect(ethers.provider);
    const node = ethers.Wallet.createRandom().connect(ethers.provider);
    stakers.push(wallet);
    nodes.push(node);
    await owner.sendTransaction({ to: wallet.address, value: ether("1") });
    await cz.transfer(wallet.address, ether("1000"));
    await usdt.transfer(wallet.address, ether("10"));
  }

  for (let i = 0; i < stakers.length; i++) {
    const staker = stakers[i];
    const node = nodes[i];
    const amount = ether(String(120 - i));
    await cz.connect(staker).approve(await bank.getAddress(), amount);
    await usdt.connect(staker).approve(await bank.getAddress(), ether("10"));
    await bank.connect(staker).stake(amount, node.address);
  }

  const feeABalance = await usdt.balanceOf(FEE_A);
  const feeBBalance = await usdt.balanceOf(FEE_B);
  assertBigEqual(feeABalance, ether("24"), "fee receiver A after 120 stakes");
  assertBigEqual(feeBBalance, ether("24"), "fee receiver B after 120 stakes");

  const ranked = await bank.getRankedNodes(0, 10);
  assertEqual(Number(ranked.total), 120, "ranked node count");
  assertEqual(ranked.nodes[0], nodes[0].address, "rank 1 node");
  assertEqual(ranked.nodes[9], nodes[9].address, "rank 10 node");

  const nodeAInfo = await bank.getUserInfo(nodes[0].address);
  assertEqual(Number(nodeAInfo.info.directReferrals), 1, "rank 1 qualified referrals");
  assertBigEqual(nodeAInfo.info.pendingInviteRewards, ether("1"), "rank 1 invite rewards");

  const release = ether("10000");
  await cz.approve(await bank.getAddress(), release);
  await bank.openMonthlyRelease(release);
  await bank.allocateMonthlyRelease(1000);

  const releaseState = await bank.getCurrentRelease();
  assertEqual(releaseState.finalized, true, "monthly release finalized");
  assertBigEqual(releaseState.allocatedAmount, release, "monthly release fully allocated");
  assertBigEqual(await bank.totalRankDistributed(), release, "total rank distributed");

  let top10 = 0n;
  let rank11To50 = 0n;
  let rank51To100 = 0n;
  let after100 = 0n;
  let rankPending = 0n;
  for (let i = 0; i < nodes.length; i++) {
    const info = await bank.getUserInfo(nodes[i].address);
    const reward = info.info.pendingRankRewards;
    rankPending += reward;
    if (i < 10) top10 += reward;
    else if (i < 50) rank11To50 += reward;
    else if (i < 100) rank51To100 += reward;
    else after100 += reward;
  }
  assertBigEqual(rankPending, release, "sum of rank rewards");
  assertBigEqual(top10, ether("5000"), "top 10 pool");
  assertBigEqual(rank11To50, ether("3000"), "rank 11-50 pool");
  assertBigEqual(rank51To100, ether("1500"), "rank 51-100 pool");
  assertBigEqual(after100, ether("500"), "rank after 100 pool");

  await owner.sendTransaction({ to: nodes[0].address, value: ether("1") });
  await usdt.transfer(nodes[0].address, ether("1"));
  await usdt.connect(nodes[0]).approve(await bank.getAddress(), ether("1"));
  const beforeClaimFeeA = await usdt.balanceOf(FEE_A);
  const beforeClaimFeeB = await usdt.balanceOf(FEE_B);
  await bank.connect(nodes[0]).claimNodeRewards();
  assertBigEqual((await usdt.balanceOf(FEE_A)) - beforeClaimFeeA, ether("0.2"), "claim fee A");
  assertBigEqual((await usdt.balanceOf(FEE_B)) - beforeClaimFeeB, ether("0.2"), "claim fee B");

  const previews = {
    rank1: await bank.getRankRewardPreview(release, 120, 1),
    rank10: await bank.getRankRewardPreview(release, 120, 10),
    rank11: await bank.getRankRewardPreview(release, 120, 11),
    rank50: await bank.getRankRewardPreview(release, 120, 50),
    rank51: await bank.getRankRewardPreview(release, 120, 51),
    rank100: await bank.getRankRewardPreview(release, 120, 100),
    rank101: await bank.getRankRewardPreview(release, 120, 101),
    rank120: await bank.getRankRewardPreview(release, 120, 120),
  };

  assertBigEqual(previews.rank1, ether("500"), "rank 1 preview");
  assertBigEqual(previews.rank10, ether("500"), "rank 10 preview");
  assertBigEqual(previews.rank11, ether("75"), "rank 11 preview");
  assertBigEqual(previews.rank50, ether("75"), "rank 50 preview");
  assertBigEqual(previews.rank51, ether("30"), "rank 51 preview");
  assertBigEqual(previews.rank100, ether("30"), "rank 100 preview");
  assertBigEqual(previews.rank101, ether("25"), "rank 101 preview");
  assertBigEqual(previews.rank120, ether("25"), "rank 120 preview");

  console.log(JSON.stringify({
    result: "PASS",
    tokenRequirement: CZ_MAINNET,
    deployedLocalBank: await bank.getAddress(),
    feeReceiversInRequest: [FEE_A, FEE_B],
    interactionFee: "0.4",
    inviteReward: "1",
    rankedNodeCount: Number(ranked.total),
    feeReceiverAAfter120Stakes: fmt(feeABalance),
    feeReceiverBAfter120Stakes: fmt(feeBBalance),
    monthlyRelease: fmt(release),
    allocatedAmount: fmt(releaseState.allocatedAmount),
    actualPools: {
      top10: fmt(top10),
      rank11To50: fmt(rank11To50),
      rank51To100: fmt(rank51To100),
      after100: fmt(after100),
    },
    rankRewardPreviewFor120Nodes: Object.fromEntries(
      Object.entries(previews).map(([key, value]) => [key, fmt(value)])
    ),
    topRankedNodes: ranked.nodes.map((address, index) => ({
      rank: index + 1,
      address,
      score: fmt(ranked.scores[index]),
    })),
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
