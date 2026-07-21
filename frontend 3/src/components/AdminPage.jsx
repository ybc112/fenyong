import { useState, useEffect, useCallback } from 'react';
import { ethers } from 'ethers';
import toast from 'react-hot-toast';
import {
  FiAlertTriangle,
  FiCopy,
  FiDollarSign,
  FiKey,
  FiPause,
  FiPlay,
  FiRefreshCw,
  FiShield,
  FiTag,
  FiTrendingUp,
  FiUploadCloud,
  FiUser,
} from 'react-icons/fi';
import { CONTRACTS, formatAddress, formatNumber, parseContractError } from '../utils/constants';
import { useLanguage } from '../contexts/LanguageContext';

const ZERO = ethers.ZeroAddress;

export default function AdminPage({ account, contracts, stakingData, onRefresh }) {
  const { t } = useLanguage();

  const [isOwner, setIsOwner] = useState(false);
  const [isChecking, setIsChecking] = useState(true);
  const [pendingOwner, setPendingOwner] = useState('');

  const [saleTokenBalance, setSaleTokenBalance] = useState('0');
  const [usdtBalance, setUsdtBalance] = useState('0');
  const [bnbBalance, setBnbBalance] = useState('0');
  const [loadingBalances, setLoadingBalances] = useState(false);

  const [tokenPrice, setTokenPrice] = useState('');
  const [teamWallet, setTeamWallet] = useState('');
  const [interestRateBps, setInterestRateBps] = useState('');
  const [interestFundAmount, setInterestFundAmount] = useState('');
  const [withdrawAmount, setWithdrawAmount] = useState('');
  const [newOwnerAddress, setNewOwnerAddress] = useState('');

  const [isWorking, setIsWorking] = useState(false);

  const isReady = account && contracts?.writeStakingBank;
  const saleStatus = stakingData?.saleStatus;
  const interestInfo = stakingData?.interestInfo;

  const checkAdmin = useCallback(async () => {
    setIsChecking(true);
    try {
      if (!account || !contracts?.stakingBank) {
        setIsOwner(false);
        return;
      }
      const [owner, pending] = await Promise.all([
        contracts.stakingBank.owner().catch(() => ZERO),
        contracts.stakingBank.pendingOwner ? contracts.stakingBank.pendingOwner().catch(() => ZERO) : Promise.resolve(ZERO),
      ]);
      setIsOwner(owner.toLowerCase() === account.toLowerCase());
      setPendingOwner(pending && pending !== ZERO ? pending : '');
    } catch (err) {
      console.error('Admin check error:', err);
      setIsOwner(false);
    } finally {
      setIsChecking(false);
    }
  }, [account, contracts]);

  const fetchBalances = useCallback(async () => {
    if (!CONTRACTS.STAKING_BANK || !contracts?.stakingBank?.runner) return;
    setLoadingBalances(true);
    try {
      const provider = contracts.stakingBank.runner?.provider ?? contracts.stakingBank.runner;
      const [saleBal, usdtBal, bnbBal] = await Promise.all([
        contracts.nbtToken ? contracts.nbtToken.balanceOf(CONTRACTS.STAKING_BANK).catch(() => 0n) : 0n,
        contracts.paymentToken ? contracts.paymentToken.balanceOf(CONTRACTS.STAKING_BANK).catch(() => 0n) : 0n,
        provider ? provider.getBalance(CONTRACTS.STAKING_BANK).catch(() => 0n) : 0n,
      ]);
      setSaleTokenBalance(ethers.formatEther(saleBal));
      setUsdtBalance(ethers.formatEther(usdtBal));
      setBnbBalance(ethers.formatEther(bnbBal));
    } catch (err) {
      console.error('Fetch balances error:', err);
    } finally {
      setLoadingBalances(false);
    }
  }, [contracts]);

  useEffect(() => {
    checkAdmin();
    fetchBalances();
  }, [checkAdmin, fetchBalances]);

  const runTx = async (fn, loadingMsg, successMsg, toastId) => {
    setIsWorking(true);
    try {
      toast.loading(loadingMsg, { id: toastId });
      const tx = await fn();
      await tx.wait();
      toast.success(successMsg, { id: toastId });
      onRefresh?.();
      await checkAdmin();
      await fetchBalances();
      return true;
    } catch (err) {
      toast.error(parseContractError(err), { id: toastId });
      return false;
    } finally {
      setIsWorking(false);
    }
  };

  const copyAddress = async (address) => {
    try {
      await navigator.clipboard.writeText(address);
      toast.success(t('cz.common.copied'));
    } catch {
      toast.error(address);
    }
  };

  const updateTokenPrice = async () => {
    if (!isReady || tokenPrice === '') return;
    const ok = await runTx(
      () => contracts.writeStakingBank.setTokenPrice(ethers.parseEther(tokenPrice)),
      t('cz.toast.updatingTokenPrice'),
      t('cz.toast.tokenPriceUpdated'),
      'tokenPrice'
    );
    if (ok) setTokenPrice('');
  };

  const updateTeamWallet = async () => {
    if (!isReady || !teamWallet) return;
    if (!ethers.isAddress(teamWallet)) {
      toast.error(t('cz.toast.invalidAddress'));
      return;
    }
    const ok = await runTx(
      () => contracts.writeStakingBank.setTeamWallet(teamWallet),
      t('cz.toast.updatingTeamWallet'),
      t('cz.toast.teamWalletUpdated'),
      'teamWallet'
    );
    if (ok) setTeamWallet('');
  };

  const updateInterestRate = async () => {
    if (!isReady || interestRateBps === '') return;
    const bps = Math.round(parseFloat(interestRateBps) * 100);
    if (bps < 0 || bps > 10000) {
      toast.error(t('cz.toast.invalidInterestRate'));
      return;
    }
    const ok = await runTx(
      () => contracts.writeStakingBank.setDailyInterestRateBps(bps),
      t('cz.toast.updatingInterestRate'),
      t('cz.toast.interestRateUpdated'),
      'interestRate'
    );
    if (ok) setInterestRateBps('');
  };

  const approveAndFundInterestPool = async () => {
    if (!isReady || interestFundAmount === '') return;
    const amount = ethers.parseEther(interestFundAmount);
    const token = contracts.writeNbtToken;
    if (!token) return;

    setIsWorking(true);
    try {
      const allowance = await contracts.nbtToken.allowance(account, CONTRACTS.STAKING_BANK);
      if (allowance < amount) {
        toast.loading(t('cz.toast.approveFund'), { id: 'approveFund' });
        const approveTx = await token.approve(CONTRACTS.STAKING_BANK, ethers.MaxUint256);
        await approveTx.wait();
        toast.success(t('cz.toast.approveFundSuccess'), { id: 'approveFund' });
      }

      const ok = await runTx(
        () => contracts.writeStakingBank.fundInterestPool(amount),
        t('cz.toast.fundingInterest'),
        t('cz.toast.interestFunded'),
        'fundInterest'
      );
      if (ok) setInterestFundAmount('');
    } catch (err) {
      toast.error(parseContractError(err));
    } finally {
      setIsWorking(false);
    }
  };

  const withdrawUSDT = async () => {
    if (!isReady || withdrawAmount === '') return;
    const ok = await runTx(
      () => contracts.writeStakingBank.withdrawUSDT(ethers.parseEther(withdrawAmount)),
      t('cz.toast.withdrawingUSDT'),
      t('cz.toast.usdtWithdrawn'),
      'withdrawUSDT'
    );
    if (ok) setWithdrawAmount('');
  };

  const transferOwnership = async () => {
    if (!isReady || !newOwnerAddress) return;
    if (!ethers.isAddress(newOwnerAddress)) {
      toast.error(t('cz.toast.invalidAddress'));
      return;
    }
    const ok = await runTx(
      () => contracts.writeStakingBank.transferOwnership(newOwnerAddress),
      t('cz.toast.transferringOwnership'),
      t('cz.toast.ownershipTransferred'),
      'transferOwnership'
    );
    if (ok) setNewOwnerAddress('');
  };

  const acceptOwnership = async () => {
    if (!isReady) return;
    await runTx(
      () => contracts.writeStakingBank.acceptOwnership(),
      t('cz.toast.acceptingOwnership'),
      t('cz.toast.ownershipAccepted'),
      'acceptOwnership'
    );
  };

  const setPaused = async (paused) => {
    if (!isReady) return;
    await runTx(
      () => paused ? contracts.writeStakingBank.pause() : contracts.writeStakingBank.unpause(),
      paused ? t('cz.toast.pausing') : t('cz.toast.resuming'),
      paused ? t('cz.toast.paused') : t('cz.toast.resumed'),
      'pause'
    );
  };

  if (!account || isChecking) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] text-white/70">
        <FiShield className="w-16 h-16 mb-4 text-[#FFB800]" />
        <p>{t('cz.admin.verifyingAdmin')}</p>
      </div>
    );
  }

  if (!isOwner) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] text-white/70">
        <FiAlertTriangle className="w-16 h-16 mb-4 text-[#FF6B6B]" />
        <h2 className="text-xl font-bold text-white mb-2">{t('cz.admin.noAccess')}</h2>
        <p>{t('cz.admin.notOwner')}</p>
      </div>
    );
  }

  const SectionCard = ({ icon: Icon, title, children, className = '' }) => (
    <div className={`neon-card ${className}`}>
      <div className="neon-card-inner">
        <h2 className="text-xl font-bold text-white mb-5 flex items-center gap-2">
          <Icon className="text-[#FFB800]" />
          {title}
        </h2>
        {children}
      </div>
    </div>
  );

  return (
    <div className="space-y-8">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl md:text-3xl font-bold text-white flex items-center gap-3">
            <FiShield className="text-[#FFB800]" />
            {t('cz.admin.title')}
          </h1>
          <p className="text-white/50 mt-1">{t('cz.admin.subtitle')}</p>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={() => { onRefresh?.(); fetchBalances(); checkAdmin(); }}
            disabled={loadingBalances}
            className="flex items-center gap-2 px-4 py-2 rounded-xl bg-white/10 text-white/70 hover:bg-white/20 disabled:opacity-50"
          >
            <FiRefreshCw className={`w-4 h-4 ${loadingBalances ? 'animate-spin' : ''}`} />
            {t('cz.admin.refreshData')}
          </button>
          <div className="badge-glow">
            {t('cz.admin.owner')}: {formatAddress(account)}
          </div>
        </div>
      </div>

      <div className="p-4 rounded-xl bg-[#FFB800]/10 border border-[#FFB800]/25 text-sm text-white/70 flex items-start gap-3">
        <FiAlertTriangle className="w-5 h-5 text-[#FFB800] shrink-0 mt-0.5" />
        <div>
          <div className="font-bold text-[#FFB800] mb-1">{t('cz.admin.warning')}</div>
          <div>{t('cz.admin.warningDesc')}</div>
        </div>
      </div>

      <section className="grid lg:grid-cols-4 gap-4">
        {[
          { label: t('cz.admin.totalSold'), value: saleStatus?.totalSold || '0', suffix: t('cz.common.tokenSymbol'), icon: FiTag },
          { label: t('cz.admin.totalUSDTReceived'), value: saleStatus?.totalUSDTReceived || '0', suffix: 'USDT', icon: FiDollarSign },
          { label: t('cz.admin.totalRewardsDistributed'), value: saleStatus?.totalRewardsDistributed || '0', suffix: 'USDT', icon: FiTrendingUp },
          { label: t('cz.admin.contractBalance'), value: usdtBalance, suffix: 'USDT', icon: FiDollarSign },
        ].map((item) => (
          <div key={item.label} className="stat-card-premium">
            <div className="text-white/45 text-sm mb-2 flex items-center gap-2">
              <item.icon className="w-4 h-4 text-[#FFB800]" />
              {item.label}
            </div>
            <div className="text-2xl font-bold text-white">
              {formatNumber(item.value, 4)} <span className="text-sm text-white/40">{item.suffix}</span>
            </div>
          </div>
        ))}
      </section>

      <section className="grid lg:grid-cols-3 gap-4">
        <div className="glass-premium p-4 rounded-xl">
          <div className="text-white/45 text-sm mb-2">{t('cz.admin.contractAddress')}</div>
          <button
            onClick={() => copyAddress(CONTRACTS.STAKING_BANK)}
            className="w-full flex items-center justify-between gap-2 font-mono text-sm text-white/80 hover:text-[#00D9A5]"
          >
            <span className="truncate">{CONTRACTS.STAKING_BANK}</span>
            <FiCopy className="shrink-0" />
          </button>
        </div>
        <div className="glass-premium p-4 rounded-xl">
          <div className="text-white/45 text-sm mb-2">{t('cz.admin.ownerAddress')}</div>
          <div className="font-mono text-sm text-white/80 truncate">
            {stakingData?.owner || t('cz.admin.notLoaded')}
          </div>
        </div>
        <div className="glass-premium p-4 rounded-xl">
          <div className="text-white/45 text-sm mb-2">{t('cz.admin.teamWallet')}</div>
          <div className="font-mono text-sm text-white/80 truncate">
            {stakingData?.teamWallet || t('cz.admin.notLoaded')}
          </div>
        </div>
      </section>

      <section className="grid lg:grid-cols-2 gap-6">
        <SectionCard icon={FiTag} title={t('cz.admin.tokenPriceSetting')}>
          <div className="text-sm text-white/45 mb-3">
            {t('cz.admin.currentTokenPrice')}: {formatNumber(stakingData?.tokenPrice || '1', 4)} {t('cz.common.tokenSymbol')} / USDT
          </div>
          <input
            className="input-premium mb-3"
            value={tokenPrice}
            onChange={(e) => setTokenPrice(e.target.value)}
            placeholder={t('cz.admin.tokenPricePlaceholder')}
          />
          <button
            onClick={updateTokenPrice}
            disabled={isWorking || tokenPrice === ''}
            className="w-full btn-premium disabled:opacity-50"
          >
            <span>{t('cz.admin.saveTokenPrice')}</span>
          </button>
        </SectionCard>

        <SectionCard icon={FiUser} title={t('cz.admin.teamWalletSetting')}>
          <div className="text-sm text-white/45 mb-3">
            {t('cz.admin.currentTeamWallet')}: {formatAddress(stakingData?.teamWallet)}
          </div>
          <input
            className="input-premium mb-3"
            value={teamWallet}
            onChange={(e) => setTeamWallet(e.target.value)}
            placeholder={t('cz.admin.teamWalletPlaceholder')}
          />
          <button
            onClick={updateTeamWallet}
            disabled={isWorking || teamWallet === ''}
            className="w-full btn-premium disabled:opacity-50"
          >
            <span>{t('cz.admin.saveTeamWallet')}</span>
          </button>
        </SectionCard>
      </section>

      <section className="grid lg:grid-cols-2 gap-6">
        <SectionCard icon={FiTrendingUp} title={t('cz.admin.holdingInterest')}>
          <div className="text-sm text-white/45 mb-3">
            {t('cz.admin.currentInterestRate')}: {interestInfo?.rateBps ? (interestInfo.rateBps / 100).toFixed(2) : '1.00'}%
          </div>
          <input
            className="input-premium mb-3"
            value={interestRateBps}
            onChange={(e) => setInterestRateBps(e.target.value)}
            placeholder={t('cz.admin.interestRatePlaceholder')}
          />
          <button
            onClick={updateInterestRate}
            disabled={isWorking || interestRateBps === ''}
            className="w-full btn-premium disabled:opacity-50"
          >
            <span>{t('cz.admin.saveInterestRate')}</span>
          </button>
        </SectionCard>

        <SectionCard icon={FiUploadCloud} title={t('cz.admin.interestPool')}>
          <div className="text-sm text-white/45 mb-3">
            {t('cz.admin.currentInterestPool')}: {formatNumber(interestInfo?.poolBalance || '0', 4)} {t('cz.common.tokenSymbol')}
          </div>
          <input
            className="input-premium mb-3"
            value={interestFundAmount}
            onChange={(e) => setInterestFundAmount(e.target.value)}
            placeholder={t('cz.admin.interestFundAmountPlaceholder')}
          />
          <button
            onClick={approveAndFundInterestPool}
            disabled={isWorking || interestFundAmount === ''}
            className="w-full btn-premium disabled:opacity-50"
          >
            <span>{t('cz.admin.fundInterestPool')}</span>
          </button>
        </SectionCard>
      </section>

      <section className="grid lg:grid-cols-2 gap-6">
        <SectionCard icon={FiDollarSign} title={t('cz.admin.withdrawUSDT')}>
          <div className="text-sm text-white/45 mb-3">
            {t('cz.admin.contractUSDTBalance')}: {formatNumber(usdtBalance, 4)} USDT
          </div>
          <input
            className="input-premium mb-3"
            value={withdrawAmount}
            onChange={(e) => setWithdrawAmount(e.target.value)}
            placeholder={t('cz.admin.withdrawAmountPlaceholder')}
          />
          <button
            onClick={withdrawUSDT}
            disabled={isWorking || withdrawAmount === ''}
            className="w-full btn-premium disabled:opacity-50"
          >
            <span>{t('cz.admin.withdrawUSDT')}</span>
          </button>
        </SectionCard>

        <div className="glass-premium p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-bold text-white flex items-center gap-2">
              <FiPause className="text-[#FFB800]" />
              {t('cz.admin.pauseTitle')}
            </h2>
            <p className="text-white/45 text-sm">{t('cz.admin.pauseDesc')}</p>
          </div>
          <div className="flex gap-3">
            <button onClick={() => setPaused(true)} disabled={isWorking || stakingData?.isPaused} className="px-4 py-2 rounded-lg bg-[#FFB800]/20 text-[#FFB800] disabled:opacity-50 flex items-center gap-2">
              <FiPause /> {t('cz.admin.pause')}
            </button>
            <button onClick={() => setPaused(false)} disabled={isWorking || !stakingData?.isPaused} className="px-4 py-2 rounded-lg bg-[#00D9A5]/20 text-[#00D9A5] disabled:opacity-50 flex items-center gap-2">
              <FiPlay /> {t('cz.admin.resume')}
            </button>
          </div>
        </div>
      </section>

      <section className="grid lg:grid-cols-2 gap-6">
        <SectionCard icon={FiKey} title={t('cz.admin.ownershipTransfer')}>
          <div className="text-sm text-white/55 mb-4">
            {t('cz.admin.ownershipTransferDesc')}
          </div>
          {pendingOwner && (
            <div className="p-3 rounded-xl bg-[#FFB800]/10 border border-[#FFB800]/25 text-sm mb-3">
              <div className="text-white/60">{t('cz.admin.pendingOwner')}</div>
              <div className="font-mono text-white break-all">{pendingOwner}</div>
            </div>
          )}
          <input className="input-premium mb-3" value={newOwnerAddress} onChange={(e) => setNewOwnerAddress(e.target.value)} placeholder={t('cz.admin.newOwnerAddressPlaceholder')} />
          <div className="grid grid-cols-2 gap-3">
            <button onClick={transferOwnership} disabled={isWorking || !newOwnerAddress} className="btn-premium disabled:opacity-50">
              <span>{t('cz.admin.transferOwnership')}</span>
            </button>
            <button onClick={acceptOwnership} disabled={isWorking || !pendingOwner || account?.toLowerCase() !== pendingOwner?.toLowerCase()} className="btn-ghost disabled:opacity-50">
              <span>{t('cz.admin.acceptOwnership')}</span>
            </button>
          </div>
        </SectionCard>
      </section>
    </div>
  );
}
