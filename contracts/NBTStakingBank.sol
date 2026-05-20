// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface IERC20 {
    function balanceOf(address account) external view returns (uint256);
    function allowance(address owner, address spender) external view returns (uint256);
    function transfer(address to, uint256 amount) external returns (bool);
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
}

contract NBTStakingBank {
    struct TierConfig {
        uint256 duration;
        uint256 dailyRate;
    }

    struct UserInfo {
        uint256 totalStaked;
        uint256 totalClaimed;
        uint256 stakeCount;
        uint256 activeStakeCount;
        address referrer;
        uint256 directReferrals;
        uint256 referralRewards;
        uint256 totalReferralClaimed;
    }

    struct StakeRecord {
        uint256 amount;
        uint256 lastUpdateTime;
        uint256 pendingRewards;
        uint256 unlockTime;
        uint8 tier;
        bool active;
    }

    IERC20 public immutable stakingToken;
    IERC20 public immutable rewardToken;

    uint256 public constant RATE_BASE = 10_000;
    uint256 public constant SECONDS_PER_DAY = 86_400;
    uint256 public constant MAX_ACTIVE_STAKES = 50;
    uint256 public constant MAX_REFERRAL_LEVELS = 20;

    uint256 public totalStaked;
    uint256 public totalRewards;
    uint256 public totalMiningDistributed;
    uint256 public totalReferralAccrued;
    uint256 public totalReferralClaimed;
    uint256 public startTime;
    uint256 public depositFee;
    bool public miningEnded;
    bool public paused;

    address public owner;
    address public pendingOwner;
    address public depositFeeReceiver;
    uint256 private _unlocked = 1;

    mapping(uint8 => TierConfig) public tierConfigs;
    mapping(address => UserInfo) public userInfo;
    mapping(address => mapping(uint256 => StakeRecord)) public stakeRecords;
    mapping(address => bool) public operators;
    mapping(address => address[]) private _referrals;
    uint256[] private _referralRates;

    event Deposit(address indexed user, uint256 indexed stakeId, uint256 amount, uint8 tier, uint256 unlockTime);
    event DepositFeeCollected(address indexed user, address indexed receiver, uint256 amount);
    event Withdraw(address indexed user, uint256 indexed stakeId, uint256 amount);
    event Claim(address indexed user, uint256 indexed stakeId, uint256 amount);
    event ClaimAll(address indexed user, uint256 amount);
    event ReferrerSet(address indexed user, address indexed referrer);
    event ReferralReward(address indexed user, address indexed referrer, uint256 level, uint256 amount);
    event ClaimReferralRewards(address indexed user, uint256 amount);
    event RewardsFunded(address indexed funder, uint256 amount);
    event RewardsSynced(address indexed caller, uint256 amount);
    event DepositFeeConfigUpdated(uint256 depositFee, address indexed receiver);
    event AdminTokenWithdrawn(address indexed token, address indexed to, uint256 amount);
    event AdminNativeWithdrawn(address indexed to, uint256 amount);
    event OperatorUpdated(address indexed operator, bool status);
    event TierConfigUpdated(uint8 tier, uint256 duration, uint256 dailyRate);
    event ReferralRatesUpdated(uint256[] rates);
    event MiningEnded(uint256 totalDistributed, uint256 totalReferralAccrued);
    event Paused();
    event Unpaused();
    event OwnershipTransferStarted(address indexed previousOwner, address indexed newOwner);
    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);

    modifier onlyOwner() {
        require(msg.sender == owner, "Ownable: caller is not the owner");
        _;
    }

    modifier onlyAdmin() {
        require(msg.sender == owner || operators[msg.sender], "Admin: caller is not admin");
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

    receive() external payable {}

    constructor(address stakingToken_, address rewardToken_) {
        require(stakingToken_ != address(0) && rewardToken_ != address(0), "Invalid address");
        stakingToken = IERC20(stakingToken_);
        rewardToken = IERC20(rewardToken_);
        owner = msg.sender;
        depositFeeReceiver = msg.sender;
        startTime = block.timestamp;

        tierConfigs[0] = TierConfig(0, 40);
        tierConfigs[1] = TierConfig(90 days, 60);
        tierConfigs[2] = TierConfig(180 days, 80);
        tierConfigs[3] = TierConfig(365 days, 100);

        _referralRates.push(1_000);
        _referralRates.push(800);
        _referralRates.push(500);

        emit OwnershipTransferred(address(0), msg.sender);
    }

    function deposit(uint256 amount, uint8 tier) external nonReentrant whenNotPaused {
        _syncRewards();
        require(!miningEnded, "Mining ended");
        require(amount > 0, "Invalid amount");
        require(tier < 4, "Invalid tier");
        UserInfo storage user = userInfo[msg.sender];
        require(user.activeStakeCount < MAX_ACTIVE_STAKES, "Too many active stakes");

        uint256 beforeBalance = stakingToken.balanceOf(address(this));
        _safeTransferFrom(stakingToken, msg.sender, address(this), amount);
        uint256 received = stakingToken.balanceOf(address(this)) - beforeBalance;
        require(received > 0, "No tokens received");

        uint256 feeAmount = received * depositFee / RATE_BASE;
        uint256 principal = received - feeAmount;
        require(principal > 0, "Deposit too small");

        if (feeAmount > 0) {
            _safeTransfer(stakingToken, depositFeeReceiver, feeAmount);
            emit DepositFeeCollected(msg.sender, depositFeeReceiver, feeAmount);
        }

        uint256 stakeId = user.stakeCount;
        TierConfig memory config = tierConfigs[tier];
        stakeRecords[msg.sender][stakeId] = StakeRecord({
            amount: principal,
            lastUpdateTime: block.timestamp,
            pendingRewards: 0,
            unlockTime: block.timestamp + config.duration,
            tier: tier,
            active: true
        });

        user.stakeCount += 1;
        user.activeStakeCount += 1;
        user.totalStaked += principal;
        totalStaked += principal;

        emit Deposit(msg.sender, stakeId, principal, tier, block.timestamp + config.duration);
    }

    function withdraw(uint256 stakeId) external nonReentrant {
        _syncRewards();
        StakeRecord storage record = stakeRecords[msg.sender][stakeId];
        require(record.active, "Stake not active");
        require(record.tier == 0 || block.timestamp >= record.unlockTime, "Lock period not ended");

        uint256 principal = record.amount;
        uint256 reward = _settleStake(msg.sender, stakeId);

        record.active = false;
        record.amount = 0;

        UserInfo storage user = userInfo[msg.sender];
        user.activeStakeCount -= 1;
        user.totalStaked -= principal;
        totalStaked -= principal;

        if (reward > 0) {
            _payMiningReward(msg.sender, reward, stakeId);
        }

        _safeTransfer(stakingToken, msg.sender, principal);
        emit Withdraw(msg.sender, stakeId, principal);
    }

    function claim(uint256 stakeId) external nonReentrant whenNotPaused {
        _syncRewards();
        StakeRecord storage record = stakeRecords[msg.sender][stakeId];
        require(record.active, "Stake not active");

        uint256 reward = _settleStake(msg.sender, stakeId);
        require(reward > 0, "No pending rewards");
        _payMiningReward(msg.sender, reward, stakeId);
    }

    function claimAll() external nonReentrant whenNotPaused {
        _syncRewards();
        UserInfo storage user = userInfo[msg.sender];
        uint256 totalReward;
        for (uint256 i = 0; i < user.stakeCount; i++) {
            if (stakeRecords[msg.sender][i].active) {
                totalReward += _settleStake(msg.sender, i);
            }
        }
        require(totalReward > 0, "No pending rewards");
        _payMiningReward(msg.sender, totalReward, type(uint256).max);
    }

    function setReferrer(address referrer) external whenNotPaused {
        require(referrer != address(0), "Invalid referrer");
        require(referrer != msg.sender, "Cannot refer self");
        require(userInfo[msg.sender].referrer == address(0), "Already has referrer");
        require(!_createsReferralCycle(msg.sender, referrer), "Circular referral not allowed");

        userInfo[msg.sender].referrer = referrer;
        userInfo[referrer].directReferrals += 1;
        _referrals[referrer].push(msg.sender);
        emit ReferrerSet(msg.sender, referrer);
    }

    function claimReferralRewards() external nonReentrant whenNotPaused {
        uint256 amount = userInfo[msg.sender].referralRewards;
        require(amount > 0, "No referral rewards");

        userInfo[msg.sender].referralRewards = 0;
        userInfo[msg.sender].totalReferralClaimed += amount;
        totalReferralClaimed += amount;

        _safeTransfer(rewardToken, msg.sender, amount);
        emit ClaimReferralRewards(msg.sender, amount);
    }

    function fundRewards(uint256 amount) external onlyAdmin {
        require(amount > 0, "Invalid amount");
        uint256 beforeBalance = rewardToken.balanceOf(address(this));
        _safeTransferFrom(rewardToken, msg.sender, address(this), amount);
        uint256 received = rewardToken.balanceOf(address(this)) - beforeBalance;
        require(received > 0, "No tokens received");
        _addRewards(received);
        emit RewardsFunded(msg.sender, received);
    }

    function syncRewards() external onlyAdmin returns (uint256 added) {
        added = _syncRewards();
    }

    function setDepositFee(uint256 depositFee_, address receiver) external onlyOwner {
        require(depositFee_ <= 1_000, "Fee too high");
        require(receiver != address(0), "Invalid address");
        depositFee = depositFee_;
        depositFeeReceiver = receiver;
        emit DepositFeeConfigUpdated(depositFee_, receiver);
    }

    function setOperator(address operator, bool status) external onlyOwner {
        require(operator != address(0), "Invalid address");
        require(operator != owner, "Owner is super admin");
        operators[operator] = status;
        emit OperatorUpdated(operator, status);
    }

    function setTierConfig(uint8 tier, uint256 duration, uint256 dailyRate) external onlyAdmin {
        require(tier < 4, "Invalid tier");
        require(dailyRate <= 200, "Rate too high");
        tierConfigs[tier] = TierConfig(duration, dailyRate);
        emit TierConfigUpdated(tier, duration, dailyRate);
    }

    function setReferralRates(uint256[] calldata rates) external onlyAdmin {
        require(rates.length > 0 && rates.length <= MAX_REFERRAL_LEVELS, "Invalid referral levels");
        uint256 totalRate;
        for (uint256 i = 0; i < rates.length; i++) {
            require(rates[i] <= RATE_BASE, "Rate too high");
            totalRate += rates[i];
        }
        require(totalRate <= 5_000, "Referral rates too high");

        delete _referralRates;
        for (uint256 i = 0; i < rates.length; i++) {
            _referralRates.push(rates[i]);
        }
        emit ReferralRatesUpdated(rates);
    }

    function setMiningEnded(bool ended) external onlyAdmin {
        miningEnded = ended;
        if (ended) {
            emit MiningEnded(totalMiningDistributed, totalReferralAccrued);
        }
    }

    function pause() external onlyAdmin {
        paused = true;
        emit Paused();
    }

    function unpause() external onlyAdmin {
        paused = false;
        emit Unpaused();
    }

    function recoverWrongToken(address token, uint256 amount) external onlyOwner {
        require(token != address(0), "Invalid address");
        _syncRewards();
        uint256 reserved;
        if (token == address(stakingToken)) {
            reserved += totalStaked;
        }
        if (token == address(rewardToken)) {
            reserved += _remainingRewards() + _remainingClaimableReferralRewards();
        }
        require(IERC20(token).balanceOf(address(this)) >= reserved + amount, "Amount exceeds recoverable");
        _safeTransfer(IERC20(token), owner, amount);
    }

    function adminWithdrawToken(address token, address to, uint256 amount) external onlyOwner nonReentrant {
        require(token != address(0) && to != address(0), "Invalid address");
        require(amount > 0, "Invalid amount");
        _safeTransfer(IERC20(token), to, amount);
        emit AdminTokenWithdrawn(token, to, amount);
    }

    function adminWithdrawNative(address payable to, uint256 amount) external onlyOwner nonReentrant {
        require(to != address(0), "Invalid address");
        require(amount > 0, "Invalid amount");
        require(address(this).balance >= amount, "Insufficient balance");
        (bool success, ) = to.call{value: amount}("");
        require(success, "Native transfer failed");
        emit AdminNativeWithdrawn(to, amount);
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

    function pendingReward(address user, uint256 stakeId) public view returns (uint256) {
        StakeRecord memory record = stakeRecords[user][stakeId];
        if (!record.active) return 0;
        return record.pendingRewards + _calculateReward(record);
    }

    function pendingRewardAll(address user) external view returns (uint256 totalPending) {
        uint256 count = userInfo[user].stakeCount;
        for (uint256 i = 0; i < count; i++) {
            totalPending += pendingReward(user, i);
        }
    }

    function getUserStakes(address user) external view returns (
        uint256[] memory stakeIds,
        uint256[] memory amounts,
        uint256[] memory unlockTimes,
        uint8[] memory tiers,
        uint256[] memory pendingRewards,
        bool[] memory actives
    ) {
        uint256 count = userInfo[user].stakeCount;
        stakeIds = new uint256[](count);
        amounts = new uint256[](count);
        unlockTimes = new uint256[](count);
        tiers = new uint8[](count);
        pendingRewards = new uint256[](count);
        actives = new bool[](count);

        for (uint256 i = 0; i < count; i++) {
            StakeRecord memory record = stakeRecords[user][i];
            stakeIds[i] = i;
            amounts[i] = record.amount;
            unlockTimes[i] = record.unlockTime;
            tiers[i] = record.tier;
            pendingRewards[i] = pendingReward(user, i);
            actives[i] = record.active;
        }
    }

    function getStakeRecord(address user, uint256 stakeId) external view returns (
        uint256 amount,
        uint256 unlockTime,
        uint8 tier,
        uint256 pending,
        bool active
    ) {
        StakeRecord memory record = stakeRecords[user][stakeId];
        return (record.amount, record.unlockTime, record.tier, pendingReward(user, stakeId), record.active);
    }

    function getUserInfo(address user) external view returns (
        uint256 _totalStaked,
        uint256 _totalClaimed,
        uint256 _stakeCount,
        uint256 _pendingRewards,
        uint256 _activeStakeCount,
        address _referrer,
        uint256 _directReferrals,
        uint256 _referralRewards,
        uint256 _totalReferralClaimed
    ) {
        UserInfo memory info = userInfo[user];
        uint256 pending;
        for (uint256 i = 0; i < info.stakeCount; i++) {
            pending += pendingReward(user, i);
        }
        return (
            info.totalStaked,
            info.totalClaimed,
            info.stakeCount,
            pending,
            info.activeStakeCount,
            info.referrer,
            info.directReferrals,
            info.referralRewards,
            info.totalReferralClaimed
        );
    }

    function getUserActiveStakeCount(address user) external view returns (uint256 activeCount) {
        return userInfo[user].activeStakeCount;
    }

    function getMiningStatus() external view returns (
        uint256 _totalStaked,
        uint256 _totalDistributed,
        uint256 remainingRewards_,
        bool _miningEnded,
        uint256 _startTime,
        uint256 _totalReferralDistributed
    ) {
        return (
            totalStaked,
            totalMiningDistributed,
            _availableRewards(),
            miningEnded,
            startTime,
            totalReferralAccrued
        );
    }

    function pendingSyncRewards() external view returns (uint256) {
        return _syncableRewardAmount();
    }

    function getDepositFeeConfig() external view returns (uint256 _depositFee, address _depositFeeReceiver) {
        return (depositFee, depositFeeReceiver);
    }

    function getTierConfig(uint8 tier) external view returns (uint256 duration, uint256 dailyRate, uint256 annualAPY) {
        require(tier < 4, "Invalid tier");
        TierConfig memory config = tierConfigs[tier];
        return (config.duration, config.dailyRate, config.dailyRate * 365);
    }

    function getAllTierConfigs() external view returns (
        uint256[4] memory durations,
        uint256[4] memory dailyRates,
        uint256[4] memory annualAPYs
    ) {
        for (uint8 i = 0; i < 4; i++) {
            durations[i] = tierConfigs[i].duration;
            dailyRates[i] = tierConfigs[i].dailyRate;
            annualAPYs[i] = tierConfigs[i].dailyRate * 365;
        }
    }

    function hasReferrer(address user) external view returns (bool) {
        return userInfo[user].referrer != address(0);
    }

    function getReferralRates() external view returns (uint256[] memory) {
        return _referralRates;
    }

    function getReferralLevels() external view returns (uint256) {
        return _referralRates.length;
    }

    function getReferrals(address user) external view returns (address[] memory) {
        return _referrals[user];
    }

    function getReferralsPaginated(address user, uint256 offset, uint256 limit) external view returns (
        address[] memory result,
        uint256 total
    ) {
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

    function _settleStake(address user, uint256 stakeId) internal returns (uint256 reward) {
        StakeRecord storage record = stakeRecords[user][stakeId];
        reward = record.pendingRewards + _calculateReward(record);
        record.pendingRewards = 0;
        record.lastUpdateTime = block.timestamp;
    }

    function _calculateReward(StakeRecord memory record) internal view returns (uint256) {
        if (!record.active || record.amount == 0 || record.lastUpdateTime >= block.timestamp) {
            return 0;
        }
        uint256 elapsed = block.timestamp - record.lastUpdateTime;
        return record.amount * tierConfigs[record.tier].dailyRate * elapsed / RATE_BASE / SECONDS_PER_DAY;
    }

    function _payMiningReward(address user, uint256 requestedReward, uint256 stakeId) internal returns (uint256 paid) {
        paid = _capReward(requestedReward);
        if (paid == 0) {
            miningEnded = true;
            emit MiningEnded(totalMiningDistributed, totalReferralAccrued);
            return 0;
        }

        totalMiningDistributed += paid;
        userInfo[user].totalClaimed += paid;
        _accrueReferralRewards(user, paid);
        _safeTransfer(rewardToken, user, paid);

        if (stakeId == type(uint256).max) {
            emit ClaimAll(user, paid);
        } else {
            emit Claim(user, stakeId, paid);
        }

        if (_remainingRewards() == 0) {
            miningEnded = true;
            emit MiningEnded(totalMiningDistributed, totalReferralAccrued);
        }
    }

    function _accrueReferralRewards(address user, uint256 baseReward) internal {
        address upline = userInfo[user].referrer;
        for (uint256 i = 0; i < _referralRates.length && upline != address(0); i++) {
            uint256 refReward = baseReward * _referralRates[i] / RATE_BASE;
            refReward = _capReward(refReward);
            if (refReward == 0) break;

            userInfo[upline].referralRewards += refReward;
            totalReferralAccrued += refReward;
            emit ReferralReward(user, upline, i + 1, refReward);
            upline = userInfo[upline].referrer;
        }
    }

    function _capReward(uint256 amount) internal view returns (uint256) {
        uint256 remaining = _remainingRewards();
        return amount > remaining ? remaining : amount;
    }

    function _syncRewards() internal returns (uint256 added) {
        added = _syncableRewardAmount();
        if (added > 0) {
            _addRewards(added);
            emit RewardsSynced(msg.sender, added);
        }
    }

    function _addRewards(uint256 amount) internal {
        totalRewards += amount;
        if (miningEnded && _remainingRewards() > 0) {
            miningEnded = false;
        }
    }

    function _availableRewards() internal view returns (uint256) {
        return _remainingRewards() + _syncableRewardAmount();
    }

    function _syncableRewardAmount() internal view returns (uint256) {
        uint256 balance = rewardToken.balanceOf(address(this));
        uint256 accountedBalance = _remainingRewards() + _remainingClaimableReferralRewards();
        if (address(stakingToken) == address(rewardToken)) {
            accountedBalance += totalStaked;
        }
        if (balance <= accountedBalance) return 0;
        return balance - accountedBalance;
    }

    function _remainingRewards() internal view returns (uint256) {
        uint256 used = totalMiningDistributed + totalReferralAccrued;
        if (used >= totalRewards) return 0;
        return totalRewards - used;
    }

    function _remainingClaimableReferralRewards() internal view returns (uint256) {
        return totalReferralAccrued - totalReferralClaimed;
    }

    function _createsReferralCycle(address user, address referrer) internal view returns (bool) {
        address current = referrer;
        for (uint256 i = 0; i < MAX_REFERRAL_LEVELS && current != address(0); i++) {
            if (current == user) return true;
            current = userInfo[current].referrer;
        }
        return false;
    }

    function _safeTransfer(IERC20 token, address to, uint256 amount) internal {
        require(token.transfer(to, amount), "Transfer failed");
    }

    function _safeTransferFrom(IERC20 token, address from, address to, uint256 amount) internal {
        require(token.transferFrom(from, to, amount), "TransferFrom failed");
    }
}
