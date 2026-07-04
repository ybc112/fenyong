import { useState, useEffect, useCallback } from 'react';
import { ethers } from 'ethers';
import { CONTRACTS } from '../utils/constants';
import { ERC20_ABI, NBT_TOKEN_ABI, STAKING_BANK_ABI } from '../abi';

const retryCall = async (fn, retries = 3, delay = 1000) => {
  for (let i = 0; i < retries; i++) {
    try {
      return await fn();
    } catch (err) {
      if (i === retries - 1) throw err;
      await new Promise(resolve => setTimeout(resolve, delay * (i + 1)));
    }
  }
};

export function useContracts(signer, provider) {
  const [contracts, setContracts] = useState({
    nbtToken: null,
    feeToken: null,
    stakingBank: null,
    writeNbtToken: null,
    writeFeeToken: null,
    writeStakingBank: null,
  });

  useEffect(() => {
    if (!provider) return;

    const nbtToken = CONTRACTS.NBT_TOKEN
      ? new ethers.Contract(CONTRACTS.NBT_TOKEN, NBT_TOKEN_ABI, provider)
      : null;
    const stakingBank = CONTRACTS.STAKING_BANK
      ? new ethers.Contract(CONTRACTS.STAKING_BANK, STAKING_BANK_ABI, provider)
      : null;
    const feeToken = CONTRACTS.FEE_TOKEN
      ? new ethers.Contract(CONTRACTS.FEE_TOKEN, ERC20_ABI, provider)
      : null;
    const writeNbtToken = CONTRACTS.NBT_TOKEN && signer
      ? new ethers.Contract(CONTRACTS.NBT_TOKEN, NBT_TOKEN_ABI, signer)
      : null;
    const writeStakingBank = CONTRACTS.STAKING_BANK && signer
      ? new ethers.Contract(CONTRACTS.STAKING_BANK, STAKING_BANK_ABI, signer)
      : null;
    const writeFeeToken = CONTRACTS.FEE_TOKEN && signer
      ? new ethers.Contract(CONTRACTS.FEE_TOKEN, ERC20_ABI, signer)
      : null;

    setContracts({
      nbtToken,
      feeToken,
      stakingBank,
      writeNbtToken,
      writeFeeToken,
      writeStakingBank,
    });
  }, [signer, provider]);

  return contracts;
}

export function useStakingBank(contract, account) {
  const [data, setData] = useState({
    userInfo: null,
    stakes: [],
    miningStatus: null,
    pendingRewardAll: '0',
    referrals: [],
    referralsTotal: 0,
    rankedNodes: [],
    rankedNodesTotal: 0,
    currentRelease: null,
    interactionFeeConfig: null,
    stakingTokenAddress: null,
    rewardTokenAddress: null,
    inviteReward: '100000000',
    stakeValueRate: '1',
    isPaused: false,
    loading: true,
  });

  const fetchData = useCallback(async () => {
    if (!contract) {
      setData(prev => ({ ...prev, loading: false }));
      return;
    }

    try {
      const [
        miningStatus,
        isPaused,
        currentRelease,
        interactionFeeConfig,
        stakingTokenAddress,
        rewardTokenAddress,
        inviteReward,
        stakeValueRate,
        rankedData,
      ] = await retryCall(() =>
        Promise.all([
          contract.getMiningStatus(),
          contract.paused ? contract.paused().catch(() => false) : Promise.resolve(false),
          contract.getCurrentRelease().catch(() => null),
          contract.getInteractionFeeConfig().catch(() => null),
          contract.stakingToken().catch(() => ''),
          contract.rewardToken().catch(() => ''),
          contract.inviteReward().catch(() => ethers.parseEther('100000000')),
          contract.stakeValueRate().catch(() => ethers.parseEther('1')),
          contract.getRankedNodes(0, 100).catch(() => ({ nodes: [], scores: [], total: 0n })),
        ])
      );

      let userInfo = null;
      let stakes = [];
      let pendingRewardAll = BigInt(0);
      let referrals = [];
      let referralsTotal = 0;

      if (account) {
        userInfo = await retryCall(() => contract.getUserInfo(account));
        pendingRewardAll = await retryCall(() => contract.pendingRewardAll(account));

        try {
          const userStakes = await retryCall(() => contract.getUserStakes(account));
          stakes = userStakes.stakeIds.map((id, index) => ({
            stakeId: Number(id),
            amount: ethers.formatEther(userStakes.amounts[index]),
            scoreValue: ethers.formatEther(userStakes.scoreValues?.[index] ?? 0n),
            startTime: Number(userStakes.startTimes[index]),
            active: userStakes.actives[index],
          })).filter(stake => stake.active);
        } catch {
          stakes = [];
        }

        try {
          const refData = await retryCall(() => contract.getReferralsPaginated(account, 0, 10));
          referrals = refData.result;
          referralsTotal = Number(refData.total);
        } catch {
          referrals = [];
          referralsTotal = 0;
        }
      }

      const info = userInfo?.info || userInfo?.[0];
      const rankedNodes = Array.from(rankedData.nodes || rankedData[0] || []).map((node, index) => ({
        address: node,
        score: ethers.formatEther((rankedData.scores || rankedData[1])[index]),
        rank: index + 1,
      }));
      const rankedNodesTotal = Number(rankedData.total || rankedData[2] || 0);

      setData({
        userInfo: info ? {
          totalStaked: ethers.formatEther(info.totalStaked ?? info[0]),
          totalWithdrawn: ethers.formatEther(info.totalWithdrawn ?? info[1]),
          stakeCount: Number(info.stakeCount ?? info[2]),
          activeStakeCount: Number(info.activeStakeCount ?? info[3]),
          referrer: info.referrer ?? info[4],
          directReferrals: Number(info.directReferrals ?? info[5]),
          referralStakeVolume: ethers.formatEther(info.referralStakeVolume ?? info[6]),
          pendingInviteRewards: ethers.formatEther(info.pendingInviteRewards ?? info[7]),
          totalInviteClaimed: ethers.formatEther(info.totalInviteClaimed ?? info[8]),
          pendingRankRewards: ethers.formatEther(info.pendingRankRewards ?? info[9]),
          totalRankClaimed: ethers.formatEther(info.totalRankClaimed ?? info[10]),
          pendingRewards: ethers.formatEther(userInfo.pendingRewards ?? userInfo[1]),
          totalClaimed: ethers.formatEther(userInfo.totalClaimed ?? userInfo[2]),
          rank: Number(userInfo.rank ?? userInfo[3]),
        } : null,
        stakes,
        miningStatus: {
          totalStaked: ethers.formatEther(miningStatus._totalStaked),
          totalDistributed: ethers.formatEther(miningStatus._totalDistributed),
          claimableRewards: ethers.formatEther(miningStatus._claimableRewards),
          releaseInProgress: miningStatus._releaseInProgress,
          startTime: Number(miningStatus._startTime),
          rankedNodeCount: Number(miningStatus._rankedNodeCount),
        },
        pendingRewardAll: ethers.formatEther(pendingRewardAll),
        referrals,
        referralsTotal,
        rankedNodes,
        rankedNodesTotal,
        currentRelease: currentRelease ? {
          epochId: Number(currentRelease.epochId ?? currentRelease[0]),
          amount: ethers.formatEther(currentRelease.amount ?? currentRelease[1]),
          totalNodes: Number(currentRelease.totalNodes ?? currentRelease[2]),
          nextRank: Number(currentRelease.nextRank ?? currentRelease[3]),
          allocatedAmount: ethers.formatEther(currentRelease.allocatedAmount ?? currentRelease[4]),
          finalized: currentRelease.finalized ?? currentRelease[5],
        } : null,
        interactionFeeConfig: interactionFeeConfig ? {
          feeToken: interactionFeeConfig.feeToken ?? interactionFeeConfig[0],
          fee: ethers.formatEther(interactionFeeConfig.fee ?? interactionFeeConfig[1]),
          receiverA: interactionFeeConfig.receiverA ?? interactionFeeConfig[2],
          receiverB: interactionFeeConfig.receiverB ?? interactionFeeConfig[3],
        } : null,
        stakingTokenAddress,
        rewardTokenAddress,
        inviteReward: ethers.formatEther(inviteReward),
        stakeValueRate: ethers.formatEther(stakeValueRate),
        isPaused,
        loading: false,
      });
    } catch (err) {
      console.error('Fetch staking bank data error:', err);
      setData(prev => ({ ...prev, loading: false }));
    }
  }, [contract, account]);

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 15000);
    return () => clearInterval(interval);
  }, [fetchData]);

  return { ...data, refetch: fetchData };
}

export function useTokenBalance(tokenContract, account) {
  const [balance, setBalance] = useState('0');
  const [loading, setLoading] = useState(true);

  const fetchBalance = useCallback(async () => {
    if (!tokenContract || !account) {
      setBalance('0');
      setLoading(false);
      return;
    }

    try {
      const bal = await retryCall(() => tokenContract.balanceOf(account));
      setBalance(ethers.formatEther(bal));
    } catch (err) {
      console.error('Fetch balance error:', err);
      setBalance('0');
    } finally {
      setLoading(false);
    }
  }, [tokenContract, account]);

  useEffect(() => {
    fetchBalance();
    const interval = setInterval(fetchBalance, 10000);
    return () => clearInterval(interval);
  }, [fetchBalance]);

  return { balance, loading, refetch: fetchBalance };
}

export function useAllowance(tokenContract, owner, spender) {
  const [allowance, setAllowance] = useState('0');

  const fetchAllowance = useCallback(async () => {
    if (!tokenContract || !owner || !spender) {
      setAllowance('0');
      return;
    }

    try {
      const allow = await retryCall(() => tokenContract.allowance(owner, spender));
      setAllowance(ethers.formatEther(allow));
    } catch (err) {
      console.error('Fetch allowance error:', err);
      setAllowance('0');
    }
  }, [tokenContract, owner, spender]);

  useEffect(() => {
    fetchAllowance();
  }, [fetchAllowance]);

  return { allowance, refetch: fetchAllowance };
}

export function useTokenFeeConfig(tokenContract, account) {
  const [data, setData] = useState({
    feeConfig: null,
    isExcluded: false,
    loading: true,
  });

  const fetchData = useCallback(async () => {
    if (!tokenContract) {
      setData(prev => ({ ...prev, loading: false }));
      return;
    }

    try {
      const feeConfig = await retryCall(() => tokenContract.getFeeConfig());
      let isExcluded = false;
      if (account) {
        isExcluded = await retryCall(() => tokenContract.isExcludedFromFee(account));
      }

      setData({
        feeConfig: {
          buyFee: Number(feeConfig._buyFee) / 100,
          sellFee: Number(feeConfig._sellFee) / 100,
          feeReceiver: feeConfig._feeReceiver,
        },
        isExcluded,
        loading: false,
      });
    } catch (err) {
      console.error('Fetch token fee config error:', err);
      setData(prev => ({ ...prev, loading: false }));
    }
  }, [tokenContract, account]);

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 15000);
    return () => clearInterval(interval);
  }, [fetchData]);

  return { ...data, refetch: fetchData };
}

export { ERC20_ABI };
