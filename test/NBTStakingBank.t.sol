// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "../contracts/NBTToken.sol";
import "../contracts/NBTStakingBank.sol";

contract NodeUser {
    function approve(NBTToken token, address spender, uint256 amount) external {
        token.approve(spender, amount);
    }

    function stake(NBTStakingBank bank, uint256 amount, address referrer) external {
        bank.stake(amount, referrer);
    }

    function claim(NBTStakingBank bank) external {
        bank.claimNodeRewards();
    }
}

contract NBTStakingBankTest {
    function _newToken(uint256 supply) internal returns (NBTToken) {
        address[] memory pairs = new address[](0);
        address[] memory excluded = new address[](0);
        return new NBTToken("CZ", "CZ", supply, address(this), 0, 0, pairs, excluded);
    }

    function _newBank(NBTToken token) internal returns (NBTStakingBank) {
        return new NBTStakingBank(
            address(token),
            address(token),
            address(token),
            address(0xA),
            address(0xB),
            0.4 ether
        );
    }

    function testReferralStakeCreatesRankAndInviteReward() external {
        NBTToken token = _newToken(1_000_000 ether);
        NBTStakingBank bank = _newBank(token);
        NodeUser staker = new NodeUser();
        NodeUser inviter = new NodeUser();

        token.transfer(address(bank), 10 ether);
        token.transfer(address(staker), 100.4 ether);
        staker.approve(token, address(bank), 100.4 ether);
        staker.stake(bank, 100 ether, address(inviter));

        require(bank.getNodeRank(address(inviter)) == 1, "rank mismatch");

        (
            NBTStakingBank.UserInfo memory info,
            uint256 pendingRewards,
            uint256 totalClaimed,
            uint256 rank
        ) = bank.getUserInfo(address(inviter));

        require(rank == 1, "getter rank mismatch");
        require(totalClaimed == 0, "claimed mismatch");
        require(info.directReferrals == 1, "direct referrals mismatch");
        require(info.referralStakeVolume == 100 ether, "score mismatch");
        require(info.pendingInviteRewards == 1 ether, "invite reward mismatch");
        require(pendingRewards == 1 ether, "pending mismatch");
    }

    function testMonthlyReleaseAllocatesAllToOnlyRankedNode() external {
        NBTToken token = _newToken(1_000_000 ether);
        NBTStakingBank bank = _newBank(token);
        NodeUser staker = new NodeUser();
        NodeUser inviter = new NodeUser();

        token.transfer(address(bank), 10 ether);
        token.transfer(address(staker), 100.4 ether);
        staker.approve(token, address(bank), 100.4 ether);
        staker.stake(bank, 100 ether, address(inviter));

        token.approve(address(bank), 100 ether);
        bank.openMonthlyRelease(100 ether);
        bank.allocateMonthlyRelease(10);

        (
            NBTStakingBank.UserInfo memory info,
            uint256 pendingRewards,
            uint256 totalClaimed,
            uint256 rank
        ) = bank.getUserInfo(address(inviter));

        require(rank == 1, "rank mismatch");
        require(totalClaimed == 0, "claimed mismatch");
        require(info.pendingRankRewards == 100 ether, "rank reward mismatch");
        require(pendingRewards == 101 ether, "total pending mismatch");
        require(bank.totalRankDistributed() == 100 ether, "distributed mismatch");

        token.transfer(address(inviter), 0.4 ether);
        inviter.approve(token, address(bank), 0.4 ether);
        inviter.claim(bank);
        require(token.balanceOf(address(inviter)) == 101 ether, "claim mismatch");
    }
}
