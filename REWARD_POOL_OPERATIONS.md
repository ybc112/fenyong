# NoveBank 奖励池与质押操作说明

## 1. 结论

正式版本建议采用以下规则：

- 用户质押必须通过 DApp 操作。
- 管理员给奖励池充值，推荐通过 DApp 管理页操作。
- 管理员也可以在区块链浏览器上调用合约函数充值奖励池。
- 不建议任何用户直接把 NBT 转账到矿池合约地址。
- 当前合约不支持“直接转账自动质押”。
- 当前合约不支持“直接转账自动增加奖励池账面额度”。

当前合约的正确操作方式是：

- 用户质押：调用 `deposit(amount, tier)`。
- 管理员充值奖励池：调用 `fundRewards(amount)`。
- 用户领取收益：调用 `claim(stakeId)` 或 `claimAll()`。
- 用户提取本金：调用 `withdraw(stakeId)`。

简单理解：

```text
用户质押 = DApp 操作 deposit()
奖励池充值 = 管理页或区块链浏览器调用 fundRewards()
直接转账到矿池地址 != 质押
直接转账到矿池地址 != 奖励池充值
```

## 2. 用户质押能不能直接转账到矿池地址？

不能。

用户不能只通过钱包直接转账 NBT 到矿池合约地址来完成质押。

原因是质押不是普通转账。质押需要合约记录以下信息：

- 用户地址
- 质押数量
- 质押档位
- 质押开始时间
- 收益更新时间
- 解锁时间
- 用户 stakeId
- 用户当前总质押量
- 用户当前活跃质押数量

当前质押函数是：

```solidity
function deposit(uint256 amount, uint8 tier) external
```

这个函数除了把用户的 NBT 转入合约，还会创建质押记录：

```solidity
stakeRecords[msg.sender][stakeId] = StakeRecord({
    amount: amount,
    lastUpdateTime: block.timestamp,
    pendingRewards: 0,
    unlockTime: block.timestamp + config.duration,
    tier: tier,
    active: true
});
```

如果用户只是直接转账到矿池合约地址，合约不会执行 `deposit()`，也不会生成质押记录。

所以正式版必须明确提示：

```text
请勿直接转账到矿池合约地址。
直接转账不会产生质押记录，也不会获得质押收益。
```

## 3. 用户正确质押流程

用户应该通过 DApp 操作。

流程：

1. 打开 NoveBank DApp。
2. 连接 MetaMask 钱包。
3. 切换到正确网络，例如 BSC Testnet 或 BSC Mainnet。
4. 确认钱包里有 NBT。
5. 选择质押档位。
6. 输入质押数量。
7. 第一次操作需要点击“授权 NBT 代币”。
8. 在 MetaMask 里确认授权交易。
9. 授权成功后，再点击“质押”。
10. 在 MetaMask 里确认质押交易。
11. 交易上链后，DApp 会显示用户的质押记录。

用户质押通常涉及两笔交易。

第一笔是授权：

```solidity
approve(stakingBankAddress, amount)
```

或者授权最大额度：

```solidity
approve(stakingBankAddress, type(uint256).max)
```

第二笔是正式质押：

```solidity
deposit(amount, tier)
```

只有 `deposit()` 成功后，才算真正质押成功。

## 4. 管理员给奖励池充值能不能直接转账？

当前合约下，不建议直接转账。

当前奖励池充值函数是：

```solidity
function fundRewards(uint256 amount) external onlyOwner
```

这个函数会做两件事：

1. 把管理员钱包里的 NBT 转入矿池合约。
2. 增加合约里的 `totalRewards` 账面额度。

代码逻辑类似：

```solidity
_safeTransferFrom(rewardToken, msg.sender, address(this), amount);
totalRewards += amount;
emit RewardsFunded(msg.sender, amount);
```

奖励池剩余额度不是单纯看合约余额，而是看合约内部记账：

```solidity
_remainingRewards()
```

内部逻辑是：

```solidity
uint256 used = totalMiningDistributed + totalReferralAccrued;
if (used >= totalRewards) return 0;
return totalRewards - used;
```

如果管理员只是直接把 NBT 转到矿池合约地址：

```text
管理员钱包 -> 矿池合约地址
```

那么合约余额会增加，但是 `totalRewards` 不会增加。

结果：

- 合约地址里确实多了 NBT。
- DApp 显示的奖励池不会增加。
- 用户可领取奖励额度不会增加。
- 这笔钱会变成合约里的额外余额。

所以当前合约下，管理员也不应该直接转账作为奖励池充值。

正确做法是调用：

```solidity
fundRewards(amount)
```

## 5. 管理员推荐充值方式：DApp 管理页

这是最推荐的方式。

流程：

1. 管理员打开 DApp。
2. 连接管理员钱包。
3. 确认钱包是 StakingBank 合约 owner。
4. 进入管理页面。
5. 输入要充值的奖励数量，例如 `40000000`。
6. 点击“注入奖励池”。
7. 如果还没有授权，页面会先让管理员授权 NBT。
8. MetaMask 确认授权。
9. 页面继续调用 `fundRewards()`。
10. MetaMask 确认充值交易。
11. 交易成功后，奖励池余额增加。

这种方式最适合正式运营，因为：

- 操作简单。
- 不容易填错函数参数。
- 前端可以自动处理授权。
- 前端可以显示交易状态。
- 前端可以刷新奖励池余额。
- 不容易把直接转账误认为奖励池充值。

## 6. 管理员能不能在区块链浏览器上操作？

可以。

如果管理员不通过 DApp，也可以在区块链浏览器上操作。

测试网：

```text
https://testnet.bscscan.com
```

正式网：

```text
https://bscscan.com
```

区块链浏览器操作分两步：

1. 在 NBT Token 合约上授权矿池使用 NBT。
2. 在 StakingBank 矿池合约上调用 `fundRewards()`。

## 7. 区块链浏览器操作步骤：授权 NBT

先打开 NBT Token 合约页面。

进入：

```text
Contract -> Write Contract
```

连接管理员钱包。

调用 ERC20 的 `approve` 函数：

```solidity
approve(address spender, uint256 amount)
```

参数：

```text
spender = 矿池合约地址
amount = 充值数量，按 18 位精度填写
```

例如要充值 `40,000,000 NBT`，因为 NBT 是 18 位精度，所以链上实际 `amount` 要填：

```text
40000000000000000000000000
```

也就是：

```text
40,000,000 * 10^18
```

提交交易并等待上链。

## 8. 区块链浏览器操作步骤：调用 fundRewards

授权完成后，打开 StakingBank 矿池合约页面。

进入：

```text
Contract -> Write Contract
```

连接管理员钱包。

调用：

```solidity
fundRewards(uint256 amount)
```

参数同样填 18 位精度后的数量。

例如充值 `40,000,000 NBT`：

```text
40000000000000000000000000
```

提交交易并等待上链。

交易成功后，合约里的 `totalRewards` 会增加。

前端奖励池也会显示增加。

## 9. 常用金额换算

NBT 是 18 位小数。

所以链上填写数量时，需要乘以：

```text
10^18
```

常见换算：

```text
1 NBT = 1000000000000000000
100 NBT = 100000000000000000000
1,000 NBT = 1000000000000000000000
10,000 NBT = 10000000000000000000000
1,000,000 NBT = 1000000000000000000000000
10,000,000 NBT = 10000000000000000000000000
40,000,000 NBT = 40000000000000000000000000
```

## 10. 直接转账到矿池地址会怎样？

### 10.1 用户直接转账

用户直接转账不会产生质押记录。

后果：

- 用户页面不会显示质押。
- 用户不会获得质押收益。
- 用户不能通过正常 `withdraw()` 提取这笔“质押”。
- 这笔 NBT 会停留在合约余额里。

所以不允许用户这样操作。

### 10.2 管理员直接转账

管理员直接转账也不会自动增加奖励池账面额度。

后果：

- 合约余额增加。
- `totalRewards` 不增加。
- 前端奖励池显示不变。
- 用户可领取奖励额度不变。

所以当前合约下，管理员也不应该直接转账作为奖励池充值。

## 11. 能不能实现“管理员直接转账，然后奖励池增加”？

可以实现，但当前合约还没有这个功能。

普通 ERC20 标准下，转账不会自动通知接收方合约。

也就是说：

```text
NBT Token 合约知道发生了转账
StakingBank 合约不知道有人给它转了钱
```

所以矿池合约无法在收到普通 ERC20 时自动执行逻辑。

如果想支持“管理员先直接转账，再让奖励池增加”，可以加一个同步函数。

示例：

```solidity
function syncRewardBalance() external onlyOwner {
    require(address(stakingToken) == address(rewardToken), "Only same token mode");

    uint256 balance = rewardToken.balanceOf(address(this));
    uint256 reservedPrincipal = totalStaked;
    uint256 remainingRewards = _remainingRewards();

    require(balance > reservedPrincipal + remainingRewards, "No new rewards");

    uint256 newRewards = balance - reservedPrincipal - remainingRewards;
    totalRewards += newRewards;

    if (miningEnded && _remainingRewards() > 0) {
        miningEnded = false;
    }

    emit RewardsFunded(msg.sender, newRewards);
}
```

这种方案的操作流程是：

1. 管理员直接把 NBT 转到矿池合约地址。
2. 管理员再调用 `syncRewardBalance()`。
3. 合约把多出来的余额计入奖励池。

注意：这不是完全自动，仍然需要管理员再调用一次同步函数。

## 12. 能不能实现“用户直接转账就自动质押”？

不建议。

理论上可以用特殊方案实现，但不适合当前项目正式版。

原因：

- 普通 ERC20 转账不能携带质押档位参数。
- 用户直接转账时无法选择 3个月、6个月、12个月。
- 合约无法知道这笔转账是不是质押。
- 合约无法自动创建完整 stake 记录。
- 如果用链下监听器补记录，会引入中心化信任风险。
- 如果用特殊 token 标准，例如 ERC777、ERC1363，会增加复杂度和安全风险。

当前项目最稳的方式仍然是：

```text
用户通过 DApp 调用 deposit()
```

## 13. 正式版推荐规则

### 用户侧

用户只能通过 DApp 质押。

用户不能直接转账到矿池合约地址作为质押。

页面需要明确提示：

```text
请勿直接转账到矿池合约地址。
直接转账不会产生质押记录，也不会获得收益。
```

### 管理员侧

管理员推荐通过 DApp 管理页充值奖励池。

管理员也可以通过区块链浏览器调用：

```solidity
approve()
fundRewards()
```

不建议管理员直接转账到矿池地址。

如果管理员误转，可以后续增加 `syncRewardBalance()`，或者由 owner 使用已有的 recover 逻辑处理可回收余额。

## 14. 最终建议

NoveBank 正式版建议采用：

```text
用户质押：DApp -> 授权 -> deposit()
管理员充值：DApp 管理页 -> 授权 -> fundRewards()
浏览器备用操作：Token approve -> StakingBank fundRewards
```

不要采用：

```text
用户直接转账到矿池地址作为质押
管理员直接转账到矿池地址作为奖励池充值
```

一句话说明：

```text
用户质押必须走 DApp，因为合约需要创建质押记录。
管理员充值奖励池可以走 DApp，也可以在区块链浏览器调用 approve() 和 fundRewards()。
当前合约不支持直接转账自动质押，也不支持直接转账自动增加奖励池。
```
