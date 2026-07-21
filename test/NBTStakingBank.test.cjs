const { expect } = require("chai");
const hre = require("hardhat");
const { time } = require("@nomicfoundation/hardhat-toolbox/network-helpers");

const { ethers } = hre;

describe("NBTStakingBank", function () {
  async function deployFixture() {
    const [owner, teamWallet, userA, userB, userC] = await ethers.getSigners();

    const MockToken = await ethers.getContractFactory("NBTToken");
    const saleToken = await MockToken.deploy(
      "Sale Token", "SALE", ethers.parseEther("1000000"),
      owner.address, 0, 0, [], []
    );
    const paymentToken = await ethers.getContractFactory("NBTToken");
    const usdt = await paymentToken.deploy(
      "USDT", "USDT", ethers.parseEther("1000000"),
      owner.address, 0, 0, [], []
    );

    const NBTStakingBank = await ethers.getContractFactory("NBTStakingBank");
    const bank = await NBTStakingBank.deploy(
      await saleToken.getAddress(),
      await usdt.getAddress(),
      teamWallet.address,
      ethers.parseEther("1")
    );

    // Fund bank with sale tokens, keep some for owner to fund interest pool
    await saleToken.transfer(await bank.getAddress(), ethers.parseEther("900000"));

    // Fund users with USDT
    await usdt.transfer(userA.address, ethers.parseEther("10000"));
    await usdt.transfer(userB.address, ethers.parseEther("10000"));
    await usdt.transfer(userC.address, ethers.parseEther("10000"));

    // Approve bank to spend USDT
    await usdt.connect(userA).approve(await bank.getAddress(), ethers.MaxUint256);
    await usdt.connect(userB).approve(await bank.getAddress(), ethers.MaxUint256);
    await usdt.connect(userC).approve(await bank.getAddress(), ethers.MaxUint256);

    return { bank, saleToken, usdt, owner, teamWallet, userA, userB, userC };
  }

  describe("Buy and rewards", function () {
    it("Should sell tokens and distribute direct/indirect rewards", async function () {
      const { bank, usdt, userA, userB, userC } = await deployFixture();

      // userA buys 1000 USDT with no referrer
      await bank.connect(userA).buy(ethers.parseEther("1000"), ethers.ZeroAddress);

      expect(await bank.totalSold()).to.equal(ethers.parseEther("1000"));
      expect(await bank.totalUSDTReceived()).to.equal(ethers.parseEther("1000"));
      expect(await bank.totalPurchased(userA.address)).to.equal(ethers.parseEther("1000"));

      // userB buys 1000 USDT with userA as referrer
      await bank.connect(userB).buy(ethers.parseEther("1000"), userA.address);

      // userA direct reward = 20% of 1000 = 200 USDT
      expect(await bank.directRewards(userA.address)).to.equal(ethers.parseEther("200"));
      const userAInfo = await bank.getUserInfo(userA.address);
      expect(userAInfo.referralCount).to.equal(1);

      // userC buys 1000 USDT with userB as referrer
      await bank.connect(userC).buy(ethers.parseEther("1000"), userB.address);

      // userB direct reward = 200 USDT
      expect(await bank.directRewards(userB.address)).to.equal(ethers.parseEther("200"));
      // userA indirect reward = 10% of 1000 = 100 USDT
      expect(await bank.indirectRewards(userA.address)).to.equal(ethers.parseEther("100"));

      // userA claims rewards: 200 direct + 100 indirect + 50 team = 350 USDT
      const balanceBefore = await usdt.balanceOf(userA.address);
      await bank.connect(userA).claimRewards();
      const balanceAfter = await usdt.balanceOf(userA.address);
      expect(balanceAfter - balanceBefore).to.equal(ethers.parseEther("350"));
      expect(await bank.pendingRewards(userA.address)).to.equal(0);
    });
  });

  describe("Team reward", function () {
    it("Should allocate 5% team reward to team wallet when no referrer", async function () {
      const { bank, teamWallet, userA } = await deployFixture();

      // userA buys without referrer, team reward goes to teamWallet
      await bank.connect(userA).buy(ethers.parseEther("1000"), ethers.ZeroAddress);

      // team wallet gets 5% = 50 USDT
      expect(await bank.teamRewards(teamWallet.address)).to.equal(ethers.parseEther("50"));
    });

    it("Should allocate 5% team reward to direct referrer when exists", async function () {
      const { bank, teamWallet, userA, userB } = await deployFixture();

      await bank.connect(userB).setReferrer(userA.address);
      await bank.connect(userB).buy(ethers.parseEther("1000"), userA.address);

      // team reward goes to direct referrer userA, not teamWallet
      expect(await bank.teamRewards(userA.address)).to.equal(ethers.parseEther("50"));
      expect(await bank.teamRewards(teamWallet.address)).to.equal(0);
    });
  });

  describe("Holding interest", function () {
    it("Should accrue and claim daily interest", async function () {
      const { bank, saleToken, owner, userA } = await deployFixture();

      // Owner funds interest pool
      await saleToken.connect(owner).approve(await bank.getAddress(), ethers.parseEther("1000"));
      await bank.connect(owner).fundInterestPool(ethers.parseEther("1000"));

      // userA buys 1000 tokens
      await bank.connect(userA).buy(ethers.parseEther("1000"), ethers.ZeroAddress);

      // Fast forward 1 day
      await time.increase(24 * 60 * 60);

      const pending = await bank.pendingInterest(userA.address);
      // 1000 * 1% ≈ 10 tokens (allow tiny drift from block timestamp)
      const expectedInterest = ethers.parseEther("10");
      const drift = pending - expectedInterest;
      expect(drift).to.be.gte(0);
      expect(drift).to.be.lte(ethers.parseEther("0.001"));

      // userA claims interest
      const balanceBefore = await saleToken.balanceOf(userA.address);
      await bank.connect(userA).claimInterest();
      const balanceAfter = await saleToken.balanceOf(userA.address);
      const claimed = balanceAfter - balanceBefore;
      const claimedDrift = claimed - expectedInterest;
      expect(claimedDrift).to.be.gte(0);
      expect(claimedDrift).to.be.lte(ethers.parseEther("0.002"));
    });
  });

  describe("Pause", function () {
    it("Should pause and unpause purchases", async function () {
      const { bank, owner, userA } = await deployFixture();

      await bank.connect(owner).pause();
      expect(await bank.paused()).to.equal(true);

      await expect(
        bank.connect(userA).buy(ethers.parseEther("100"), ethers.ZeroAddress)
      ).to.be.reverted;

      await bank.connect(owner).unpause();
      expect(await bank.paused()).to.equal(false);
    });
  });

  describe("Withdraw USDT", function () {
    it("Should allow owner to withdraw USDT", async function () {
      const { bank, usdt, owner, userA } = await deployFixture();

      await bank.connect(userA).buy(ethers.parseEther("1000"), ethers.ZeroAddress);

      const balanceBefore = await usdt.balanceOf(owner.address);
      await bank.connect(owner).withdrawUSDT(ethers.parseEther("500"));
      const balanceAfter = await usdt.balanceOf(owner.address);
      expect(balanceAfter - balanceBefore).to.equal(ethers.parseEther("500"));
    });
  });

  describe("Token price", function () {
    it("Should update token price", async function () {
      const { bank, owner, userA } = await deployFixture();

      await bank.connect(owner).setTokenPrice(ethers.parseEther("2"));
      expect(await bank.tokenPrice()).to.equal(ethers.parseEther("2"));

      // userA buys 100 USDT at price 2, should get 200 tokens
      await bank.connect(userA).buy(ethers.parseEther("100"), ethers.ZeroAddress);
      expect(await bank.totalPurchased(userA.address)).to.equal(ethers.parseEther("200"));
    });
  });
});
