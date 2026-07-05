const hre = require("hardhat");

const { ethers } = hre;

const CZ_MAINNET = "0xD0F2A86C7EbCeE887F5bFB86771f994CD142bD04";
const FEE_A = "0xfd682CbCb678ce5D273Eb778B946F6a4d8f1e8Ed";
const FEE_B = "0x5A378b61193ac2ce07cE816893C080804504a2f0";
const INVITE_REWARD_AMOUNT = "100000000";
const NATIVE_INTERACTION_FEE = "0.0005";

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
  const inviteReward = ether(INVITE_REWARD_AMOUNT);
  const nativeFee = ether(NATIVE_INTERACTION_FEE);
  const halfNativeFee = nativeFee / 2n;

  const cz = await deployToken("Crypto Zenith", "CZ", "20000000000", owner);

  const Bank = await ethers.getContractFactory("NBTStakingBank");
  const bank = await Bank.deploy(
    await cz.getAddress(),
    await cz.getAddress(),
    ethers.ZeroAddress,
    FEE_A,
    FEE_B,
    nativeFee,
  );
  await bank.waitForDeployment();
  await bank.setInviteReward(inviteReward);

  assertEqual(await bank.owner(), owner.address, "owner");
  assertEqual(await bank.feeReceiverA(), FEE_A, "fee receiver A");
  assertEqual(await bank.feeReceiverB(), FEE_B, "fee receiver B");
  assertBigEqual(await bank.interactionFee(), nativeFee, "interaction fee");
  assertBigEqual(await bank.inviteReward(), inviteReward, "invite reward");

  const reserve = inviteReward * 120n + ether("100000");
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
  }

  const beforeStakeFeeA = await ethers.provider.getBalance(FEE_A);
  const beforeStakeFeeB = await ethers.provider.getBalance(FEE_B);
  for (let i = 0; i < stakers.length; i++) {
    const staker = stakers[i];
    const node = nodes[i];
    const amount = ether(String(120 - i));
    await cz.connect(staker).approve(await bank.getAddress(), amount);
    await bank.connect(staker).stake(amount, node.address, { value: nativeFee });
  }

  const feeABalance = await ethers.provider.getBalance(FEE_A);
  const feeBBalance = await ethers.provider.getBalance(FEE_B);
  assertBigEqual(feeABalance - beforeStakeFeeA, halfNativeFee * 120n, "fee receiver A after 120 stakes");
  assertBigEqual(feeBBalance - beforeStakeFeeB, halfNativeFee * 120n, "fee receiver B after 120 stakes");

  const ranked = await bank.getRankedNodes(0, 10);
  assertEqual(Number(ranked.total), 120, "ranked node count");
  assertEqual(ranked.nodes[0], nodes[0].address, "rank 1 node");
  assertEqual(ranked.nodes[9], nodes[9].address, "rank 10 node");

  const nodeAInfo = await bank.getUserInfo(nodes[0].address);
  assertEqual(Number(nodeAInfo.info.directReferrals), 1, "rank 1 qualified referrals");
  assertBigEqual(nodeAInfo.info.pendingInviteRewards, inviteReward, "rank 1 invite rewards");

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
  const beforeClaimFeeA = await ethers.provider.getBalance(FEE_A);
  const beforeClaimFeeB = await ethers.provider.getBalance(FEE_B);
  await bank.connect(nodes[0]).claimNodeRewards({ value: nativeFee });
  assertBigEqual((await ethers.provider.getBalance(FEE_A)) - beforeClaimFeeA, halfNativeFee, "claim fee A");
  assertBigEqual((await ethers.provider.getBalance(FEE_B)) - beforeClaimFeeB, halfNativeFee, "claim fee B");

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

  await owner.sendTransaction({ to: nodes[1].address, value: ether("1") });
  const beforeCompoundFeeA = await ethers.provider.getBalance(FEE_A);
  const beforeCompoundFeeB = await ethers.provider.getBalance(FEE_B);
  const beforeCompoundTotalStaked = await bank.totalStaked();
  const beforeCompoundInfo = await bank.getUserInfo(nodes[1].address);
  const compoundAmount = beforeCompoundInfo.pendingRewards;
  await bank.connect(nodes[1]).compoundNodeRewards(ethers.ZeroAddress, { value: nativeFee });
  const afterCompoundInfo = await bank.getUserInfo(nodes[1].address);
  assertBigEqual(afterCompoundInfo.pendingRewards, 0n, "compound clears pending rewards");
  assertBigEqual(afterCompoundInfo.totalClaimed - beforeCompoundInfo.totalClaimed, compoundAmount, "compound claimed accounting");
  assertBigEqual(afterCompoundInfo.info.totalStaked, compoundAmount, "compound creates stake");
  assertEqual(Number(afterCompoundInfo.info.activeStakeCount), 1, "compound active stake count");
  assertBigEqual((await bank.totalStaked()) - beforeCompoundTotalStaked, compoundAmount, "compound increases total staked");
  assertBigEqual((await ethers.provider.getBalance(FEE_A)) - beforeCompoundFeeA, halfNativeFee, "compound fee A");
  assertBigEqual((await ethers.provider.getBalance(FEE_B)) - beforeCompoundFeeB, halfNativeFee, "compound fee B");

  console.log(JSON.stringify({
    result: "PASS",
    tokenRequirement: CZ_MAINNET,
    deployedLocalBank: await bank.getAddress(),
    feeReceiversInRequest: [FEE_A, FEE_B],
    interactionFeeToken: "BNB",
    interactionFee: NATIVE_INTERACTION_FEE,
    inviteReward: INVITE_REWARD_AMOUNT,
    rankedNodeCount: Number(ranked.total),
    feeReceiverAAfter120Stakes: fmt(feeABalance - beforeStakeFeeA),
    feeReceiverBAfter120Stakes: fmt(feeBBalance - beforeStakeFeeB),
    monthlyRelease: fmt(release),
    allocatedAmount: fmt(releaseState.allocatedAmount),
    compoundAmount: fmt(compoundAmount),
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
