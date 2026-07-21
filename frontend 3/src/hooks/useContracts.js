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

const safeRead = async (fn, fallback) => {
  try {
    return await retryCall(fn);
  } catch (err) {
    console.warn('Contract read failed, using fallback:', err);
    return fallback;
  }
};

const fetchStakingSnapshot = async (account, refresh = false) => {
  const params = new URLSearchParams();
  if (account) params.set('account', account);
  if (refresh) params.set('refresh', '1');
  const query = params.toString();
  const response = await fetch(`/api/staking${query ? `?${query}` : ''}`, {
    cache: 'no-store',
    headers: { Accept: 'application/json' },
  });
  const payload = await response.json();
  if (!response.ok || !payload?.ok || !payload?.data) {
    throw new Error(payload?.message || payload?.error || 'Staking cache API unavailable');
  }
  return payload.data;
};

const applyStakingSnapshot = (prev, snapshot) => ({
  ...prev,
  userInfo: snapshot.userInfo ?? null,
  referrals: snapshot.referrals ?? [],
  referralsTotal: snapshot.referralsTotal ?? 0,
  saleStatus: snapshot.saleStatus ?? prev.saleStatus,
  saleTokenAddress: snapshot.saleTokenAddress || prev.saleTokenAddress,
  paymentTokenAddress: snapshot.paymentTokenAddress || prev.paymentTokenAddress,
  tokenPrice: snapshot.tokenPrice || prev.tokenPrice,
  owner: snapshot.owner || prev.owner,
  teamWallet: snapshot.teamWallet || prev.teamWallet,
  isPaused: typeof snapshot.isPaused === 'boolean' ? snapshot.isPaused : prev.isPaused,
  interestInfo: snapshot.interestInfo ?? prev.interestInfo,
  apiCache: snapshot.cache || null,
  loading: false,
});

export function useContracts(signer, provider) {
  const [contracts, setContracts] = useState({
    nbtToken: null,
    paymentToken: null,
    stakingBank: null,
    writeNbtToken: null,
    writePaymentToken: null,
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
    const paymentToken = CONTRACTS.PAYMENT_TOKEN
      ? new ethers.Contract(CONTRACTS.PAYMENT_TOKEN, ERC20_ABI, provider)
      : null;
    const writeNbtToken = CONTRACTS.NBT_TOKEN && signer
      ? new ethers.Contract(CONTRACTS.NBT_TOKEN, NBT_TOKEN_ABI, signer)
      : null;
    const writeStakingBank = CONTRACTS.STAKING_BANK && signer
      ? new ethers.Contract(CONTRACTS.STAKING_BANK, STAKING_BANK_ABI, signer)
      : null;
    const writePaymentToken = CONTRACTS.PAYMENT_TOKEN && signer
      ? new ethers.Contract(CONTRACTS.PAYMENT_TOKEN, ERC20_ABI, signer)
      : null;

    setContracts({
      nbtToken,
      paymentToken,
      stakingBank,
      writeNbtToken,
      writePaymentToken,
      writeStakingBank,
    });
  }, [signer, provider]);

  return contracts;
}

export function useStakingBank(contract, account) {
  const [data, setData] = useState({
    userInfo: null,
    referrals: [],
    referralsTotal: 0,
    saleStatus: null,
    saleTokenAddress: null,
    paymentTokenAddress: null,
    tokenPrice: '1',
    owner: null,
    teamWallet: null,
    isPaused: false,
    interestInfo: { rateBps: 100, pendingInterest: '0', poolBalance: '0' },
    loading: true,
  });

  const fetchData = useCallback(async (forceRefresh = false) => {
    setData(prev => ({ ...prev, loading: true }));

    try {
      const snapshot = await fetchStakingSnapshot(account, forceRefresh);
      setData(prev => applyStakingSnapshot(prev, snapshot));
      return;
    } catch (apiError) {
      console.warn('Staking cache API failed, falling back to direct contract reads:', apiError);
    }

    if (!contract) {
      setData(prev => ({ ...prev, loading: false }));
      return;
    }

    try {
      const [saleStatus, isPaused, saleTokenAddress, paymentTokenAddress, tokenPrice, owner, teamWallet, dailyInterestRateBps] = await safeRead(() =>
        Promise.all([
          contract.getSaleStatus(),
          contract.paused ? contract.paused().catch(() => false) : Promise.resolve(false),
          contract.saleToken().catch(() => ''),
          contract.paymentToken().catch(() => ''),
          contract.tokenPrice().catch(() => ethers.parseEther('1')),
          contract.owner().catch(() => ''),
          contract.teamWallet().catch(() => ''),
          contract.dailyInterestRateBps().catch(() => 100n),
        ]), null);

      if (!saleStatus) {
        setData(prev => ({ ...prev, loading: false }));
        return;
      }

      let userInfo = null;
      let pendingRewards = 0n;
      let pendingInterest = 0n;
      let referrals = [];
      let referralsTotal = 0;

      if (account) {
        userInfo = await safeRead(() => contract.getUserInfo(account), null);
        pendingRewards = await safeRead(() => contract.pendingRewards(account), BigInt(0));
        pendingInterest = await safeRead(() => contract.pendingInterest(account), BigInt(0));
        const refData = await safeRead(() => contract.getReferralsPaginated(account, 0, 20), null);
        if (refData) {
          referrals = refData.result;
          referralsTotal = Number(refData.total);
        }
      }

      const interestPoolBalance = await safeRead(() =>
        contract.saleToken().then(addr =>
          new ethers.Contract(addr, ERC20_ABI, contract.runner).balanceOf(contract.target)
        ), 0n);

      const info = userInfo?.[0] ? userInfo : null;

      setData(prev => ({
        ...prev,
        userInfo: info ? {
          referrer: info.referrer ?? info[0],
          purchased: ethers.formatEther(info.purchased ?? info[1]),
          directReward: ethers.formatEther(info.directReward ?? info[2]),
          indirectReward: ethers.formatEther(info.indirectReward ?? info[3]),
          teamReward: ethers.formatEther(info.teamReward ?? info[4]),
          claimed: ethers.formatEther(info.claimed ?? info[5]),
          referralCount: Number(info.referralCount ?? info[6]),
          pendingRewards: ethers.formatEther(pendingRewards),
          pendingInterest: ethers.formatEther(pendingInterest),
        } : prev.userInfo,
        referrals: referrals.length > 0 ? referrals : prev.referrals,
        referralsTotal: referralsTotal > 0 ? referralsTotal : prev.referralsTotal,
        saleStatus: {
          totalSold: ethers.formatEther(saleStatus._totalSold),
          totalUSDTReceived: ethers.formatEther(saleStatus._totalUSDTReceived),
          totalRewardsDistributed: ethers.formatEther(saleStatus._totalRewardsDistributed),
          tokenPrice: ethers.formatEther(saleStatus._tokenPrice),
          paused: saleStatus._paused,
        },
        saleTokenAddress: saleTokenAddress || prev.saleTokenAddress,
        paymentTokenAddress: paymentTokenAddress || prev.paymentTokenAddress,
        tokenPrice: ethers.formatEther(tokenPrice ?? ethers.parseEther(prev.tokenPrice || '1')),
        owner: owner || prev.owner,
        teamWallet: teamWallet || prev.teamWallet,
        isPaused: typeof isPaused === 'boolean' ? isPaused : prev.isPaused,
        interestInfo: {
          rateBps: Number(dailyInterestRateBps ?? 100n),
          pendingInterest: ethers.formatEther(pendingInterest),
          poolBalance: ethers.formatEther(interestPoolBalance),
        },
        loading: false,
      }));
    } catch (err) {
      console.error('Fetch staking bank data error:', err);
      setData(prev => ({ ...prev, loading: false }));
    }
  }, [contract, account]);

  useEffect(() => {
    fetchData(false);
    const interval = setInterval(() => fetchData(false), 15000);
    return () => clearInterval(interval);
  }, [fetchData]);

  return { ...data, refetch: () => fetchData(true) };
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

    const bal = await safeRead(() => tokenContract.balanceOf(account), null);
    if (bal !== null) {
      setBalance(ethers.formatEther(bal));
    }
    setLoading(false);
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

    const allow = await safeRead(() => tokenContract.allowance(owner, spender), null);
    if (allow !== null) {
      setAllowance(ethers.formatEther(allow));
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

    setData(prev => ({ ...prev, loading: true }));

    const feeConfig = await safeRead(() => tokenContract.getFeeConfig(), null);
    let isExcluded = null;
    if (account) {
      isExcluded = await safeRead(() => tokenContract.isExcludedFromFee(account), null);
    }

    if (!feeConfig) {
      setData(prev => ({ ...prev, loading: false }));
      return;
    }

    setData(prev => ({
      feeConfig: {
        buyFee: Number(feeConfig._buyFee) / 100,
        sellFee: Number(feeConfig._sellFee) / 100,
        feeReceiver: feeConfig._feeReceiver,
      },
      isExcluded: typeof isExcluded === 'boolean' ? isExcluded : prev.isExcluded,
      loading: false,
    }));
  }, [tokenContract, account]);

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 15000);
    return () => clearInterval(interval);
  }, [fetchData]);

  return { ...data, refetch: fetchData };
}

export { ERC20_ABI };
