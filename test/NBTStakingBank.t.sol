// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../contracts/NBTStakingBank.sol";

contract MockERC20 is IERC20 {
    string public name = "Mock Token";
    string public symbol = "MOCK";
    uint8 public decimals = 18;
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;
    uint256 public totalSupply;

    function mint(address to, uint256 amount) external {
        totalSupply += amount;
        balanceOf[to] += amount;
        emit Transfer(address(0), to, amount);
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        require(balanceOf[msg.sender] >= amount, "Insufficient");
        balanceOf[msg.sender] -= amount;
        balanceOf[to] += amount;
        emit Transfer(msg.sender, to, amount);
        return true;
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        emit Approval(msg.sender, spender, amount);
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        require(balanceOf[from] >= amount, "Insufficient");
        require(allowance[from][msg.sender] >= amount, "Allowance");
        allowance[from][msg.sender] -= amount;
        balanceOf[from] -= amount;
        balanceOf[to] += amount;
        emit Transfer(from, to, amount);
        return true;
    }

    event Transfer(address indexed from, address indexed to, uint256 value);
    event Approval(address indexed owner, address indexed spender, uint256 value);
}

contract NBTStakingBankTest is Test {
    NBTStakingBank public bank;
    MockERC20 public usdt;
    MockERC20 public saleToken;

    address public owner = address(1);
    address public teamWallet = address(2);
    address public userA = address(3);
    address public userB = address(4);
    address public userC = address(5);

    function setUp() public {
        vm.startPrank(owner);
        usdt = new MockERC20();
        saleToken = new MockERC20();
        bank = new NBTStakingBank(address(saleToken), address(usdt), teamWallet);

        saleToken.mint(address(bank), 1_000_000 ether);
        usdt.mint(userA, 10_000 ether);
        usdt.mint(userB, 10_000 ether);
        usdt.mint(userC, 10_000 ether);
        saleToken.mint(owner, 100_000 ether);
        vm.stopPrank();

        vm.prank(userA);
        usdt.approve(address(bank), type(uint256).max);
        vm.prank(userB);
        usdt.approve(address(bank), type(uint256).max);
        vm.prank(userC);
        usdt.approve(address(bank), type(uint256).max);
    }

    function test_BuyAndRewards() public {
        // userA buys 1000 USDT, no referrer
        vm.prank(userA);
        bank.buy(1000 ether, address(0));

        assertEq(bank.totalSold(), 1000 ether);
        assertEq(bank.totalUSDTReceived(), 1000 ether);
        assertEq(bank.totalPurchased(userA), 1000 ether);

        // userB buys 1000 USDT with userA as referrer
        vm.prank(userB);
        bank.buy(1000 ether, userA);

        // userA direct reward = 20% of 1000 = 200 USDT
        assertEq(bank.directRewards(userA), 200 ether);
        (, , , , , , uint256 refCount) = bank.getUserInfo(userA);
        assertEq(refCount, 1);

        // userC buys 1000 USDT with userB as referrer
        vm.prank(userC);
        bank.buy(1000 ether, userB);

        // userB direct reward = 200 USDT
        assertEq(bank.directRewards(userB), 200 ether);
        // userA indirect reward = 10% of 1000 = 100 USDT
        assertEq(bank.indirectRewards(userA), 100 ether);

        // userA claims rewards
        uint256 balanceBefore = usdt.balanceOf(userA);
        vm.prank(userA);
        bank.claimRewards();
        uint256 balanceAfter = usdt.balanceOf(userA);
        assertEq(balanceAfter - balanceBefore, 300 ether);
        assertEq(bank.pendingRewards(userA), 0);
    }

    function test_TeamReward() public {
        // userA -> userB -> userC
        vm.prank(userB);
        bank.setReferrer(userA);
        vm.prank(userC);
        bank.setReferrer(userB);

        vm.prank(userC);
        bank.buy(1000 ether, userB);

        // team wallet gets 5% = 50 USDT
        assertEq(bank.teamRewards(teamWallet), 50 ether);
    }

    function test_HoldingInterest() public {
        // Owner funds interest pool
        vm.startPrank(owner);
        saleToken.approve(address(bank), 1000 ether);
        bank.fundInterestPool(1000 ether);
        vm.stopPrank();

        // userA buys 1000 tokens
        vm.prank(userA);
        bank.buy(1000 ether, address(0));

        // fast forward 1 day
        vm.warp(block.timestamp + 1 days);

        uint256 pending = bank.pendingInterest(userA);
        // 1000 * 1% = 10 tokens
        assertEq(pending, 10 ether);

        // userA claims interest
        uint256 balanceBefore = saleToken.balanceOf(userA);
        vm.prank(userA);
        bank.claimInterest();
        uint256 balanceAfter = saleToken.balanceOf(userA);
        assertEq(balanceAfter - balanceBefore, 10 ether);
    }

    function test_Pause() public {
        vm.prank(owner);
        bank.pause();
        assertTrue(bank.paused());

        vm.prank(userA);
        vm.expectRevert();
        bank.buy(100 ether, address(0));

        vm.prank(owner);
        bank.unpause();
        assertFalse(bank.paused());
    }

    function test_WithdrawUSDT() public {
        vm.prank(userA);
        bank.buy(1000 ether, address(0));

        uint256 balanceBefore = usdt.balanceOf(owner);
        vm.prank(owner);
        bank.withdrawUSDT(500 ether);
        uint256 balanceAfter = usdt.balanceOf(owner);
        assertEq(balanceAfter - balanceBefore, 500 ether);
    }

    function test_SetTokenPrice() public {
        vm.prank(owner);
        bank.setTokenPrice(2 ether);
        assertEq(bank.tokenPrice(), 2 ether);

        // userA buys 100 USDT at price 2, should get 200 tokens
        vm.prank(userA);
        bank.buy(100 ether, address(0));
        assertEq(bank.totalPurchased(userA), 200 ether);
    }
}
