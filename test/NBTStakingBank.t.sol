// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "../contracts/NBTToken.sol";
import "../contracts/NBTStakingBank.sol";

contract StakingUser {
    function approve(NBTToken token, address spender, uint256 amount) external {
        token.approve(spender, amount);
    }

    function deposit(NBTStakingBank bank, uint256 amount, uint8 tier) external {
        bank.deposit(amount, tier);
    }

    function fundRewards(NBTStakingBank bank, uint256 amount) external {
        bank.fundRewards(amount);
    }

    function adminWithdrawToken(NBTStakingBank bank, address token, address to, uint256 amount) external {
        bank.adminWithdrawToken(token, to, amount);
    }
}

contract NBTStakingBankTest {
    function _newToken(uint256 supply) internal returns (NBTToken) {
        address[] memory pairs = new address[](0);
        address[] memory excluded = new address[](0);
        return new NBTToken("NBT", "NBT", supply, address(this), 0, 280, pairs, excluded);
    }

    function testSyncRewardsFromDirectTransfer() external {
        NBTToken token = _newToken(1_000_000 ether);
        NBTStakingBank bank = new NBTStakingBank(address(token), address(token));

        token.transfer(address(bank), 1_000 ether);
        require(bank.pendingSyncRewards() == 1_000 ether, "pending sync mismatch");

        bank.syncRewards();
        (, , uint256 remainingRewards, , , ) = bank.getMiningStatus();
        require(remainingRewards == 1_000 ether, "remaining rewards mismatch");
    }

    function testDepositFeeUsesNetPrincipal() external {
        NBTToken token = _newToken(1_000_000 ether);
        NBTStakingBank bank = new NBTStakingBank(address(token), address(token));
        StakingUser user = new StakingUser();

        bank.setDepositFee(200, address(this));
        token.transfer(address(user), 100 ether);
        user.approve(token, address(bank), 100 ether);

        uint256 feeReceiverBefore = token.balanceOf(address(this));
        user.deposit(bank, 100 ether, 0);
        uint256 feeReceiverAfter = token.balanceOf(address(this));

        (
            uint256 amount,
            ,
            ,
            ,
            bool active
        ) = bank.getStakeRecord(address(user), 0);

        require(active, "stake inactive");
        require(amount == 98 ether, "net principal mismatch");
        require(feeReceiverAfter - feeReceiverBefore == 2 ether, "fee mismatch");
        require(bank.totalStaked() == 98 ether, "total staked mismatch");
    }

    function testOperatorCanFundButCannotSuperWithdraw() external {
        NBTToken token = _newToken(1_000_000 ether);
        NBTStakingBank bank = new NBTStakingBank(address(token), address(token));
        StakingUser operator = new StakingUser();

        bank.setOperator(address(operator), true);
        token.transfer(address(operator), 1_000 ether);
        operator.approve(token, address(bank), 1_000 ether);
        operator.fundRewards(bank, 1_000 ether);

        (, , uint256 remainingRewards, , , ) = bank.getMiningStatus();
        require(remainingRewards == 1_000 ether, "operator fund mismatch");

        try operator.adminWithdrawToken(bank, address(token), address(operator), 1 ether) {
            revert("operator withdrew");
        } catch {}
    }
}
