// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface IERC20 {
    function balanceOf(address account) external view returns (uint256);
    function allowance(address owner, address spender) external view returns (uint256);
    function transfer(address to, uint256 amount) external returns (bool);
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
}

contract NBTStakingBank {
    struct UserInfo {
        uint256 totalStaked;
        uint256 totalWithdrawn;
        uint256 stakeCount;
        uint256 activeStakeCount;
        address referrer;
        uint256 directReferrals;
        uint256 referralStakeVolume;
        uint256 pendingInviteRewards;
        uint256 totalInviteClaimed;
        uint256 pendingRankRewards;
        uint256 totalRankClaimed;
    }

    struct StakeRecord {
        uint256 amount;
        uint256 scoreValue;
        uint256 startTime;
        bool active;
    }

    struct MonthlyRelease {
        uint256 amount;
        uint256 totalNodes;
        uint256 openedAt;
        uint256 finishedAt;
        uint256 nextRank;
        uint256 allocatedAmount;
        bool finalized;
    }

    IERC20 public immutable stakingToken;
    IERC20 public immutable rewardToken;
    IERC20 public interactionFeeToken;

    uint256 public constant RATE_BASE = 10_000;
    uint256 public constant MAX_ACTIVE_STAKES = 50;
    uint256 public constant MAX_REFERRAL_DEPTH = 20;
    uint256 public constant DEFAULT_INVITE_REWARD = 1 ether;

    uint256 public totalStaked;
    uint256 public totalRankDistributed;
    uint256 public totalRankClaimed;
    uint256 public totalInviteRewardsAccrued;
    uint256 public totalInviteRewardsClaimed;
    uint256 public interactionFee;
    uint256 public inviteReward;
    uint256 public stakeValueRate;
    uint256 public startTime;
    uint256 public currentEpochId;
    bool public paused;

    address public owner;
    address public pendingOwner;
    address public feeReceiverA;
    address public feeReceiverB;
    uint256 private _unlocked = 1;

    mapping(address => UserInfo) public userInfo;
    mapping(address => mapping(uint256 => StakeRecord)) public stakeRecords;
    mapping(address => bool) public operators;
    mapping(address => address[]) private _referrals;
    mapping(address => mapping(address => bool)) public qualifiedReferral;
    mapping(uint256 => MonthlyRelease) public monthlyReleases;

    address[] private _rankedNodes;
    mapping(address => uint256) private _rankIndexPlusOne;

    event Deposit(address indexed user, address indexed referrer, uint256 indexed stakeId, uint256 amount);
    event Withdraw(address indexed user, uint256 indexed stakeId, uint256 amount);
    event ReferrerSet(address indexed user, address indexed referrer);
    event ReferralQualified(address indexed referrer, address indexed user, uint256 inviteReward);
    event NodeScoreUpdated(address indexed node, uint256 score, uint256 rank);
    event NodeRewardsClaimed(address indexed user, uint256 inviteReward, uint256 rankReward);
    event MonthlyReleaseOpened(uint256 indexed epochId, uint256 amount, uint256 totalNodes);
    event RankRewardAllocated(uint256 indexed epochId, address indexed node, uint256 rank, uint256 amount);
    event MonthlyReleaseFinalized(uint256 indexed epochId, uint256 amount);
    event InteractionFeePaid(address indexed user, address indexed token, uint256 totalFee, address receiverA, address receiverB);
    event InteractionFeeConfigUpdated(address indexed feeToken, uint256 fee, address indexed receiverA, address indexed receiverB);
    event InviteRewardUpdated(uint256 reward);
    event StakeValueRateUpdated(uint256 rate);
    event OperatorUpdated(address indexed operator, bool status);
    event Paused();
    event Unpaused();
    event OwnershipTransferStarted(address indexed previousOwner, address indexed newOwner);
    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);
    event WrongTokenRecovered(address indexed token, address indexed to, uint256 amount);

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

    modifier noActiveRelease() {
        require(!_hasActiveRelease(), "Monthly release in progress");
        _;
    }

    receive() external payable {}

    constructor(
        address stakingToken_,
        address rewardToken_,
        address interactionFeeToken_,
        address feeReceiverA_,
        address feeReceiverB_,
        uint256 interactionFee_
    ) {
        require(stakingToken_ != address(0) && rewardToken_ != address(0), "Invalid token");
        require(interactionFeeToken_ != address(0), "Invalid fee token");
        require(feeReceiverA_ != address(0) && feeReceiverB_ != address(0), "Invalid fee receiver");

        stakingToken = IERC20(stakingToken_);
        rewardToken = IERC20(rewardToken_);
        interactionFeeToken = IERC20(interactionFeeToken_);
        feeReceiverA = feeReceiverA_;
        feeReceiverB = feeReceiverB_;
        interactionFee = interactionFee_;
        inviteReward = DEFAULT_INVITE_REWARD;
        stakeValueRate = 1 ether;
        owner = msg.sender;
        startTime = block.timestamp;

        emit OwnershipTransferred(address(0), msg.sender);
        emit InteractionFeeConfigUpdated(interactionFeeToken_, interactionFee_, feeReceiverA_, feeReceiverB_);
    }

    function stake(uint256 amount, address referrer) external nonReentrant whenNotPaused noActiveRelease {
        require(amount > 0, "Invalid amount");
        UserInfo storage user = userInfo[msg.sender];
        require(user.activeStakeCount < MAX_ACTIVE_STAKES, "Too many active stakes");

        if (user.referrer == address(0) && referrer != address(0)) {
            _setReferrer(msg.sender, referrer);
        } else if (referrer != address(0) && referrer != user.referrer) {
            revert("Referrer mismatch");
        }

        _collectInteractionFee(msg.sender);

        uint256 beforeBalance = stakingToken.balanceOf(address(this));
        _safeTransferFrom(stakingToken, msg.sender, address(this), amount);
        uint256 received = stakingToken.balanceOf(address(this)) - beforeBalance;
        require(received > 0, "No tokens received");

        uint256 stakeId = user.stakeCount;
        uint256 scoreValue = _stakeValue(received);
        stakeRecords[msg.sender][stakeId] = StakeRecord({
            amount: received,
            scoreValue: scoreValue,
            startTime: block.timestamp,
            active: true
        });

        user.stakeCount += 1;
        user.activeStakeCount += 1;
        user.totalStaked += received;
        totalStaked += received;

        address boundReferrer = user.referrer;
        if (boundReferrer != address(0)) {
            _qualifyReferral(boundReferrer, msg.sender);
            _increaseNodeScore(boundReferrer, scoreValue);
        }

        emit Deposit(msg.sender, boundReferrer, stakeId, received);
    }

    function withdraw(uint256 stakeId) external nonReentrant whenNotPaused noActiveRelease {
        StakeRecord storage record = stakeRecords[msg.sender][stakeId];
        require(record.active, "Stake not active");

        _collectInteractionFee(msg.sender);

        uint256 amount = record.amount;
        uint256 scoreValue = record.scoreValue;
        record.active = false;
        record.amount = 0;
        record.scoreValue = 0;

        UserInfo storage user = userInfo[msg.sender];
        user.activeStakeCount -= 1;
        user.totalWithdrawn += amount;
        totalStaked -= amount;

        if (user.referrer != address(0)) {
            _decreaseNodeScore(user.referrer, scoreValue);
        }

        _safeTransfer(stakingToken, msg.sender, amount);
        emit Withdraw(msg.sender, stakeId, amount);
    }

    function setReferrer(address referrer) external nonReentrant whenNotPaused noActiveRelease {
        _collectInteractionFee(msg.sender);
        _setReferrer(msg.sender, referrer);
    }

    function claimNodeRewards() public nonReentrant whenNotPaused {
        _collectInteractionFee(msg.sender);
        _claimNodeRewards(msg.sender);
    }

    function claimReferralRewards() external {
        claimNodeRewards();
    }

    function claimAll() external {
        claimNodeRewards();
    }

    function openMonthlyRelease(uint256 amount) external onlyAdmin nonReentrant whenNotPaused {
        require(amount > 0, "Invalid amount");
        require(!_hasActiveRelease(), "Monthly release in progress");
        require(_rankedNodes.length > 0, "No ranked nodes");

        uint256 beforeBalance = rewardToken.balanceOf(address(this));
        _safeTransferFrom(rewardToken, msg.sender, address(this), amount);
        uint256 received = rewardToken.balanceOf(address(this)) - beforeBalance;
        require(received > 0, "No tokens received");

        currentEpochId += 1;
        monthlyReleases[currentEpochId] = MonthlyRelease({
            amount: received,
            totalNodes: _rankedNodes.length,
            openedAt: block.timestamp,
            finishedAt: 0,
            nextRank: 1,
            allocatedAmount: 0,
            finalized: false
        });

        emit MonthlyReleaseOpened(currentEpochId, received, _rankedNodes.length);
    }

    function allocateMonthlyRelease(uint256 maxCount) external onlyAdmin nonReentrant whenNotPaused {
        require(maxCount > 0, "Invalid count");
        MonthlyRelease storage release = monthlyReleases[currentEpochId];
        require(release.amount > 0 && !release.finalized, "No active release");

        uint256 processed;
        while (processed < maxCount && release.nextRank <= release.totalNodes) {
            uint256 rank = release.nextRank;
            address node = _rankedNodes[rank - 1];
            uint256 reward = rank == release.totalNodes
                ? release.amount - release.allocatedAmount
                : _rankReward(release.amount, release.totalNodes, rank);

            if (reward > 0) {
                userInfo[node].pendingRankRewards += reward;
                release.allocatedAmount += reward;
                totalRankDistributed += reward;
            }

            emit RankRewardAllocated(currentEpochId, node, rank, reward);
            release.nextRank += 1;
            processed += 1;
        }

        if (release.nextRank > release.totalNodes) {
            release.finalized = true;
            release.finishedAt = block.timestamp;
            emit MonthlyReleaseFinalized(currentEpochId, release.allocatedAmount);
        }
    }

    function setInteractionFeeConfig(
        address feeToken,
        uint256 fee,
        address receiverA,
        address receiverB
    ) external onlyOwner {
        require(feeToken != address(0), "Invalid fee token");
        require(receiverA != address(0) && receiverB != address(0), "Invalid fee receiver");
        interactionFeeToken = IERC20(feeToken);
        interactionFee = fee;
        feeReceiverA = receiverA;
        feeReceiverB = receiverB;
        emit InteractionFeeConfigUpdated(feeToken, fee, receiverA, receiverB);
    }

    function setInviteReward(uint256 reward) external onlyOwner {
        inviteReward = reward;
        emit InviteRewardUpdated(reward);
    }

    function setStakeValueRate(uint256 rate) external onlyOwner {
        require(rate > 0, "Invalid rate");
        stakeValueRate = rate;
        emit StakeValueRateUpdated(rate);
    }

    function setOperator(address operator, bool status) external onlyOwner {
        require(operator != address(0), "Invalid address");
        require(operator != owner, "Owner is super admin");
        operators[operator] = status;
        emit OperatorUpdated(operator, status);
    }

    function pause() external onlyAdmin {
        paused = true;
        emit Paused();
    }

    function unpause() external onlyAdmin {
        paused = false;
        emit Unpaused();
    }

    function recoverWrongToken(address token, address to, uint256 amount) external onlyOwner nonReentrant {
        require(token != address(0) && to != address(0), "Invalid address");
        require(token != address(stakingToken), "Cannot recover staking token");
        require(token != address(rewardToken), "Cannot recover reward token");
        require(token != address(interactionFeeToken), "Cannot recover fee token");
        require(amount > 0, "Invalid amount");
        _safeTransfer(IERC20(token), to, amount);
        emit WrongTokenRecovered(token, to, amount);
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
        UserInfo memory info,
        uint256 pendingRewards,
        uint256 totalClaimed,
        uint256 rank
    ) {
        return (
            userInfo[user],
            pendingRewardAll(user),
            userInfo[user].totalInviteClaimed + userInfo[user].totalRankClaimed,
            getNodeRank(user)
        );
    }

    function getUserStakes(address user) external view returns (
        uint256[] memory stakeIds,
        uint256[] memory amounts,
        uint256[] memory scoreValues,
        uint256[] memory startTimes,
        bool[] memory actives
    ) {
        uint256 count = userInfo[user].stakeCount;
        stakeIds = new uint256[](count);
        amounts = new uint256[](count);
        scoreValues = new uint256[](count);
        startTimes = new uint256[](count);
        actives = new bool[](count);

        for (uint256 i = 0; i < count; i++) {
            StakeRecord memory record = stakeRecords[user][i];
            stakeIds[i] = i;
            amounts[i] = record.amount;
            scoreValues[i] = record.scoreValue;
            startTimes[i] = record.startTime;
            actives[i] = record.active;
        }
    }

    function getStakeRecord(address user, uint256 stakeId) external view returns (
        uint256 amount,
        uint256 scoreValue,
        uint256 stakeStartTime,
        bool active
    ) {
        StakeRecord memory record = stakeRecords[user][stakeId];
        return (record.amount, record.scoreValue, record.startTime, record.active);
    }

    function pendingRewardAll(address user) public view returns (uint256) {
        return userInfo[user].pendingInviteRewards + userInfo[user].pendingRankRewards;
    }

    function getMiningStatus() external view returns (
        uint256 _totalStaked,
        uint256 _totalDistributed,
        uint256 _claimableRewards,
        bool _releaseInProgress,
        uint256 _startTime,
        uint256 _rankedNodeCount
    ) {
        return (
            totalStaked,
            totalRankDistributed + totalInviteRewardsAccrued,
            _totalPendingNodeRewards(),
            _hasActiveRelease(),
            startTime,
            _rankedNodes.length
        );
    }

    function getInteractionFeeConfig() external view returns (
        address feeToken,
        uint256 fee,
        address receiverA,
        address receiverB
    ) {
        return (address(interactionFeeToken), interactionFee, feeReceiverA, feeReceiverB);
    }

    function getCurrentRelease() external view returns (
        uint256 epochId,
        uint256 amount,
        uint256 totalNodes,
        uint256 nextRank,
        uint256 allocatedAmount,
        bool finalized
    ) {
        MonthlyRelease memory release = monthlyReleases[currentEpochId];
        return (
            currentEpochId,
            release.amount,
            release.totalNodes,
            release.nextRank,
            release.allocatedAmount,
            release.finalized
        );
    }

    function getNodeRank(address node) public view returns (uint256) {
        return _rankIndexPlusOne[node];
    }

    function getRankedNodeCount() external view returns (uint256) {
        return _rankedNodes.length;
    }

    function getRankedNodes(uint256 offset, uint256 limit) external view returns (
        address[] memory nodes,
        uint256[] memory scores,
        uint256 total
    ) {
        total = _rankedNodes.length;
        if (offset >= total) {
            return (new address[](0), new uint256[](0), total);
        }

        uint256 end = offset + limit;
        if (end > total) end = total;
        nodes = new address[](end - offset);
        scores = new uint256[](end - offset);

        for (uint256 i = offset; i < end; i++) {
            address node = _rankedNodes[i];
            nodes[i - offset] = node;
            scores[i - offset] = userInfo[node].referralStakeVolume;
        }
    }

    function getRankRewardPreview(uint256 amount, uint256 totalNodes, uint256 rank) external pure returns (uint256) {
        return _rankReward(amount, totalNodes, rank);
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

    function hasReferrer(address user) external view returns (bool) {
        return userInfo[user].referrer != address(0);
    }

    function _setReferrer(address user, address referrer) internal {
        require(referrer != address(0), "Invalid referrer");
        require(referrer != user, "Cannot refer self");
        require(userInfo[user].referrer == address(0), "Already has referrer");
        require(!_createsReferralCycle(user, referrer), "Circular referral not allowed");
        userInfo[user].referrer = referrer;
        _referrals[referrer].push(user);
        emit ReferrerSet(user, referrer);
    }

    function _qualifyReferral(address referrer, address user) internal {
        if (qualifiedReferral[referrer][user]) return;
        require(_rewardReserveAvailable() >= inviteReward, "Insufficient invite reward reserve");
        qualifiedReferral[referrer][user] = true;
        userInfo[referrer].directReferrals += 1;
        userInfo[referrer].pendingInviteRewards += inviteReward;
        totalInviteRewardsAccrued += inviteReward;
        emit ReferralQualified(referrer, user, inviteReward);
    }

    function _increaseNodeScore(address node, uint256 amount) internal {
        userInfo[node].referralStakeVolume += amount;
        _updateNodePosition(node);
    }

    function _decreaseNodeScore(address node, uint256 amount) internal {
        uint256 current = userInfo[node].referralStakeVolume;
        userInfo[node].referralStakeVolume = amount >= current ? 0 : current - amount;
        _updateNodePosition(node);
    }

    function _stakeValue(uint256 amount) internal view returns (uint256) {
        return amount * stakeValueRate / 1 ether;
    }

    function _updateNodePosition(address node) internal {
        uint256 score = userInfo[node].referralStakeVolume;
        uint256 indexPlusOne = _rankIndexPlusOne[node];

        if (score == 0) {
            if (indexPlusOne != 0) {
                _removeRankedNode(node);
            }
            emit NodeScoreUpdated(node, 0, 0);
            return;
        }

        if (indexPlusOne == 0) {
            _rankedNodes.push(node);
            _rankIndexPlusOne[node] = _rankedNodes.length;
        }

        _rebalanceNode(node);
        emit NodeScoreUpdated(node, score, _rankIndexPlusOne[node]);
    }

    function _removeRankedNode(address node) internal {
        uint256 index = _rankIndexPlusOne[node] - 1;
        uint256 last = _rankedNodes.length - 1;
        if (index != last) {
            address moved = _rankedNodes[last];
            _rankedNodes[index] = moved;
            _rankIndexPlusOne[moved] = index + 1;
        }
        _rankedNodes.pop();
        _rankIndexPlusOne[node] = 0;

        if (index < _rankedNodes.length) {
            _rebalanceNode(_rankedNodes[index]);
        }
    }

    function _rebalanceNode(address node) internal {
        uint256 index = _rankIndexPlusOne[node] - 1;

        while (index > 0 && _isHigherRank(node, _rankedNodes[index - 1])) {
            _swapRankedNodes(index, index - 1);
            index -= 1;
        }

        while (index + 1 < _rankedNodes.length && _isHigherRank(_rankedNodes[index + 1], node)) {
            _swapRankedNodes(index, index + 1);
            index += 1;
        }
    }

    function _swapRankedNodes(uint256 a, uint256 b) internal {
        address nodeA = _rankedNodes[a];
        address nodeB = _rankedNodes[b];
        _rankedNodes[a] = nodeB;
        _rankedNodes[b] = nodeA;
        _rankIndexPlusOne[nodeA] = b + 1;
        _rankIndexPlusOne[nodeB] = a + 1;
    }

    function _isHigherRank(address a, address b) internal view returns (bool) {
        uint256 scoreA = userInfo[a].referralStakeVolume;
        uint256 scoreB = userInfo[b].referralStakeVolume;
        if (scoreA != scoreB) return scoreA > scoreB;
        return uint160(a) < uint160(b);
    }

    function _claimNodeRewards(address user) internal {
        UserInfo storage info = userInfo[user];
        uint256 inviteAmount = info.pendingInviteRewards;
        uint256 rankAmount = info.pendingRankRewards;
        uint256 totalAmount = inviteAmount + rankAmount;
        require(totalAmount > 0, "No rewards");

        info.pendingInviteRewards = 0;
        info.pendingRankRewards = 0;
        info.totalInviteClaimed += inviteAmount;
        info.totalRankClaimed += rankAmount;
        totalInviteRewardsClaimed += inviteAmount;
        totalRankClaimed += rankAmount;

        _safeTransfer(rewardToken, user, totalAmount);
        emit NodeRewardsClaimed(user, inviteAmount, rankAmount);
    }

    function _collectInteractionFee(address user) internal {
        if (interactionFee == 0) return;
        uint256 half = interactionFee / 2;
        uint256 second = interactionFee - half;
        _safeTransferFrom(interactionFeeToken, user, feeReceiverA, half);
        _safeTransferFrom(interactionFeeToken, user, feeReceiverB, second);
        emit InteractionFeePaid(user, address(interactionFeeToken), interactionFee, feeReceiverA, feeReceiverB);
    }

    function _rankReward(uint256 amount, uint256 totalNodes, uint256 rank) internal pure returns (uint256) {
        require(rank > 0 && rank <= totalNodes, "Invalid rank");
        uint256[4] memory counts = _groupCounts(totalNodes);
        uint256[4] memory weights = [uint256(5_000), uint256(3_000), uint256(1_500), uint256(500)];

        uint256 activeWeight;
        for (uint256 i = 0; i < 4; i++) {
            if (counts[i] > 0) activeWeight += weights[i];
        }

        uint256 groupIndex = _rankGroup(rank);
        uint256 groupPool = amount * weights[groupIndex] / activeWeight;
        return groupPool / counts[groupIndex];
    }

    function _groupCounts(uint256 totalNodes) internal pure returns (uint256[4] memory counts) {
        if (totalNodes == 0) return counts;
        counts[0] = totalNodes > 10 ? 10 : totalNodes;
        if (totalNodes > 10) counts[1] = totalNodes > 50 ? 40 : totalNodes - 10;
        if (totalNodes > 50) counts[2] = totalNodes > 100 ? 50 : totalNodes - 50;
        if (totalNodes > 100) counts[3] = totalNodes - 100;
    }

    function _rankGroup(uint256 rank) internal pure returns (uint256) {
        if (rank <= 10) return 0;
        if (rank <= 50) return 1;
        if (rank <= 100) return 2;
        return 3;
    }

    function _rewardReserveAvailable() internal view returns (uint256) {
        uint256 balance = rewardToken.balanceOf(address(this));
        uint256 reserved = _totalPendingNodeRewards() + _activeReleaseUnallocated();
        if (address(stakingToken) == address(rewardToken)) {
            reserved += totalStaked;
        }
        return balance > reserved ? balance - reserved : 0;
    }

    function _totalPendingNodeRewards() internal view returns (uint256) {
        return (totalInviteRewardsAccrued - totalInviteRewardsClaimed) + (totalRankDistributed - totalRankClaimed);
    }

    function _activeReleaseUnallocated() internal view returns (uint256) {
        MonthlyRelease memory release = monthlyReleases[currentEpochId];
        if (release.finalized || release.amount == 0) return 0;
        return release.amount - release.allocatedAmount;
    }

    function _hasActiveRelease() internal view returns (bool) {
        MonthlyRelease memory release = monthlyReleases[currentEpochId];
        return release.amount > 0 && !release.finalized;
    }

    function _createsReferralCycle(address user, address referrer) internal view returns (bool) {
        address current = referrer;
        for (uint256 i = 0; i < MAX_REFERRAL_DEPTH && current != address(0); i++) {
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
