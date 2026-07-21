// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface IERC20 {
    function balanceOf(address account) external view returns (uint256);
    function allowance(address owner, address spender) external view returns (uint256);
    function transfer(address to, uint256 amount) external returns (bool);
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
}

contract NBTStakingBank {
    IERC20 public immutable saleToken;
    IERC20 public immutable paymentToken;

    uint256 public constant RATE_BASE = 10_000;
    uint256 public constant DIRECT_RATE_BPS = 2_000;   // 20%
    uint256 public constant INDIRECT_RATE_BPS = 1_000; // 10%
    uint256 public constant TEAM_RATE_BPS = 500;       // 5%

    uint256 public tokenPrice;
    uint256 public totalSold;
    uint256 public totalUSDTReceived;
    uint256 public totalRewardsDistributed;
    uint256 public totalInterestClaimed;
    uint256 public dailyInterestRateBps = 100; // 1%

    address public owner;
    address public pendingOwner;
    address public teamWallet;

    mapping(address => address) public referrerOf;
    mapping(address => address[]) private _referrals;
    mapping(address => uint256) public directRewards;
    mapping(address => uint256) public indirectRewards;
    mapping(address => uint256) public teamRewards;
    mapping(address => uint256) public totalPurchased;
    mapping(address => uint256) public totalClaimed;
    mapping(address => uint256) public lastInterestClaimTime;

    bool public paused;
    uint256 private _unlocked = 1;

    event Purchased(address indexed buyer, address indexed referrer, uint256 usdtAmount, uint256 tokenAmount);
    event ReferrerSet(address indexed user, address indexed referrer);
    event RewardsClaimed(address indexed user, uint256 directAmount, uint256 indirectAmount, uint256 teamAmount);
    event TokenPriceUpdated(uint256 price);
    event TeamWalletUpdated(address wallet);
    event Paused();
    event Unpaused();
    event USDTWithdrawn(address indexed to, uint256 amount);
    event InterestClaimed(address indexed user, uint256 amount);
    event InterestRateUpdated(uint256 bps);
    event InterestPoolFunded(address indexed funder, uint256 amount);
    event OwnershipTransferStarted(address indexed previousOwner, address indexed newOwner);
    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);

    modifier onlyOwner() {
        require(msg.sender == owner, "Ownable: caller is not the owner");
        _;
    }

    modifier nonReentrant() {
        require(_unlocked == 1, "ReentrancyGuard: reentrant call");
        _unlocked = 2;
        _;
        _unlocked = 1;
    }

    modifier whenNotPaused() {
        require(!paused, "Paused");
        _;
    }

    constructor(
        address saleToken_,
        address paymentToken_,
        address teamWallet_,
        uint256 tokenPrice_
    ) {
        require(saleToken_ != address(0) && paymentToken_ != address(0), "Invalid token");
        require(teamWallet_ != address(0), "Invalid team wallet");
        require(tokenPrice_ > 0, "Invalid price");
        saleToken = IERC20(saleToken_);
        paymentToken = IERC20(paymentToken_);
        teamWallet = teamWallet_;
        tokenPrice = tokenPrice_;
        owner = msg.sender;
        emit OwnershipTransferred(address(0), msg.sender);
    }

    function buy(uint256 usdtAmount, address referrer) external nonReentrant whenNotPaused {
        require(usdtAmount > 0, "Invalid amount");

        if (referrerOf[msg.sender] == address(0) && referrer != address(0)) {
            _setReferrer(msg.sender, referrer);
        } else if (referrer != address(0) && referrer != referrerOf[msg.sender]) {
            revert("Referrer mismatch");
        }

        uint256 beforeBalance = paymentToken.balanceOf(address(this));
        _safeTransferFrom(paymentToken, msg.sender, address(this), usdtAmount);
        uint256 received = paymentToken.balanceOf(address(this)) - beforeBalance;
        require(received > 0, "No payment received");

        uint256 tokenAmount = received * tokenPrice / 1 ether;
        require(tokenAmount > 0, "Token amount too small");
        require(saleToken.balanceOf(address(this)) >= tokenAmount, "Insufficient sale tokens");

        _safeTransfer(saleToken, msg.sender, tokenAmount);
        _distributeRewards(msg.sender, received);

        totalSold += tokenAmount;
        totalUSDTReceived += received;
        totalPurchased[msg.sender] += tokenAmount;
        if (lastInterestClaimTime[msg.sender] == 0) {
            lastInterestClaimTime[msg.sender] = block.timestamp;
        }

        emit Purchased(msg.sender, referrerOf[msg.sender], received, tokenAmount);
    }

    function claimRewards() external nonReentrant whenNotPaused {
        uint256 direct = directRewards[msg.sender];
        uint256 indirect = indirectRewards[msg.sender];
        uint256 team = teamRewards[msg.sender];
        uint256 total = direct + indirect + team;
        require(total > 0, "No rewards");

        directRewards[msg.sender] = 0;
        indirectRewards[msg.sender] = 0;
        teamRewards[msg.sender] = 0;
        totalClaimed[msg.sender] += total;

        _safeTransfer(paymentToken, msg.sender, total);
        emit RewardsClaimed(msg.sender, direct, indirect, team);
    }

    function setReferrer(address referrer) external whenNotPaused {
        require(referrerOf[msg.sender] == address(0), "Already has referrer");
        _setReferrer(msg.sender, referrer);
    }

    function pendingInterest(address user) public view returns (uint256) {
        uint256 lastClaim = lastInterestClaimTime[user];
        if (lastClaim == 0) return 0;
        uint256 balance = saleToken.balanceOf(user);
        uint256 elapsed = block.timestamp - lastClaim;
        return balance * dailyInterestRateBps * elapsed / (RATE_BASE * 1 days);
    }

    function claimInterest() external nonReentrant whenNotPaused {
        uint256 pending = pendingInterest(msg.sender);
        require(pending > 0, "No interest");
        require(saleToken.balanceOf(address(this)) >= pending, "Insufficient interest pool");

        lastInterestClaimTime[msg.sender] = block.timestamp;
        totalInterestClaimed += pending;
        _safeTransfer(saleToken, msg.sender, pending);
        emit InterestClaimed(msg.sender, pending);
    }

    function setDailyInterestRateBps(uint256 bps) external onlyOwner {
        require(bps <= RATE_BASE, "Invalid rate");
        dailyInterestRateBps = bps;
        emit InterestRateUpdated(bps);
    }

    function fundInterestPool(uint256 amount) external onlyOwner nonReentrant {
        require(amount > 0, "Invalid amount");
        _safeTransferFrom(saleToken, msg.sender, address(this), amount);
        emit InterestPoolFunded(msg.sender, amount);
    }

    function setTokenPrice(uint256 price) external onlyOwner {
        require(price > 0, "Invalid price");
        tokenPrice = price;
        emit TokenPriceUpdated(price);
    }

    function setTeamWallet(address wallet) external onlyOwner {
        require(wallet != address(0), "Invalid wallet");
        teamWallet = wallet;
        emit TeamWalletUpdated(wallet);
    }

    function withdrawUSDT(uint256 amount) external onlyOwner nonReentrant {
        require(amount > 0, "Invalid amount");
        require(paymentToken.balanceOf(address(this)) >= amount, "Insufficient balance");
        _safeTransfer(paymentToken, owner, amount);
        emit USDTWithdrawn(owner, amount);
    }

    function pause() external onlyOwner {
        paused = true;
        emit Paused();
    }

    function unpause() external onlyOwner {
        paused = false;
        emit Unpaused();
    }

    function transferOwnership(address newOwner) external onlyOwner {
        require(newOwner != address(0), "Invalid address");
        pendingOwner = newOwner;
        emit OwnershipTransferStarted(owner, newOwner);
    }

    function acceptOwnership() external {
        require(msg.sender == pendingOwner, "Ownable: caller is not the new owner");
        address oldOwner = owner;
        owner = pendingOwner;
        pendingOwner = address(0);
        emit OwnershipTransferred(oldOwner, owner);
    }

    function getUserInfo(address user) external view returns (
        address referrer,
        uint256 purchased,
        uint256 directReward,
        uint256 indirectReward,
        uint256 teamReward,
        uint256 claimed,
        uint256 referralCount
    ) {
        return (
            referrerOf[user],
            totalPurchased[user],
            directRewards[user],
            indirectRewards[user],
            teamRewards[user],
            totalClaimed[user],
            _referrals[user].length
        );
    }

    function getReferralsPaginated(address user, uint256 offset, uint256 limit) external view returns (address[] memory result, uint256 total) {
        address[] storage refs = _referrals[user];
        total = refs.length;
        if (offset >= total) {
            return (new address[](0), total);
        }
        uint256 end = offset + limit;
        if (end > total) end = total;
        result = new address[](end - offset);
        for (uint256 i = offset; i < end; i++) {
            result[i - offset] = refs[i];
        }
    }

    function getSaleStatus() external view returns (
        uint256 _totalSold,
        uint256 _totalUSDTReceived,
        uint256 _totalRewardsDistributed,
        uint256 _tokenPrice,
        bool _paused
    ) {
        return (totalSold, totalUSDTReceived, totalRewardsDistributed, tokenPrice, paused);
    }

    function pendingRewards(address user) external view returns (uint256) {
        return directRewards[user] + indirectRewards[user] + teamRewards[user];
    }

    function referrals(address user) external view returns (address[] memory) {
        return _referrals[user];
    }

    function _setReferrer(address user, address referrer) internal {
        require(referrer != address(0), "Invalid referrer");
        require(referrer != user, "Cannot refer self");
        referrerOf[user] = referrer;
        _referrals[referrer].push(user);
        emit ReferrerSet(user, referrer);
    }

    function _distributeRewards(address buyer, uint256 usdtAmount) internal {
        address direct = referrerOf[buyer];
        address indirect = direct != address(0) ? referrerOf[direct] : address(0);

        uint256 directReward = usdtAmount * DIRECT_RATE_BPS / RATE_BASE;
        uint256 indirectReward = indirect != address(0) ? usdtAmount * INDIRECT_RATE_BPS / RATE_BASE : 0;
        uint256 teamReward = usdtAmount * TEAM_RATE_BPS / RATE_BASE;

        if (direct != address(0)) {
            directRewards[direct] += directReward;
            teamRewards[direct] += teamReward;
        } else {
            teamRewards[teamWallet] += teamReward;
        }

        if (indirect != address(0)) {
            indirectRewards[indirect] += indirectReward;
        }

        totalRewardsDistributed += directReward + indirectReward + teamReward;
    }

    function _safeTransfer(IERC20 token, address to, uint256 amount) internal {
        require(token.transfer(to, amount), "Transfer failed");
    }

    function _safeTransferFrom(IERC20 token, address from, address to, uint256 amount) internal {
        require(token.transferFrom(from, to, amount), "TransferFrom failed");
    }
}
