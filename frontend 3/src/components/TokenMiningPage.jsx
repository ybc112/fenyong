import { useState, useEffect, useMemo } from 'react';
import { motion } from 'framer-motion';
import { ethers } from 'ethers';
import toast from 'react-hot-toast';
import { FiCreditCard, FiDollarSign, FiGift, FiRefreshCw, FiShoppingCart, FiTrendingUp } from 'react-icons/fi';
import { CONTRACTS, formatNumber, parseContractError } from '../utils/constants';
import { useLanguage } from '../contexts/LanguageContext';

export default function TokenMiningPage({
  account,
  stakingData,
  tokenBalance,
  paymentBalance,
  paymentAllowance,
  contracts,
  isCorrectNetwork,
  onSwitchNetwork,
  onRefresh,
}) {
  const { t } = useLanguage();
  const [amount, setAmount] = useState('');
  const [isApproving, setIsApproving] = useState(false);
  const [isBuying, setIsBuying] = useState(false);
  const [isClaiming, setIsClaiming] = useState(false);
  const [isClaimingInterest, setIsClaimingInterest] = useState(false);

  const saleStatus = stakingData?.saleStatus;
  const userInfo = stakingData?.userInfo;
  const tokenPrice = parseFloat(stakingData?.tokenPrice || '1');
  const pendingRewards = parseFloat(userInfo?.pendingRewards || '0');
  const pendingInterest = parseFloat(userInfo?.pendingInterest || '0');

  const usdtAmount = parseFloat(amount || '0');
  const tokenAmount = usdtAmount * tokenPrice;

  const needsApproval = useMemo(() => {
    return parseFloat(paymentAllowance || '0') < usdtAmount;
  }, [paymentAllowance, usdtAmount]);

  const urlRef = useMemo(() => {
    const params = new URLSearchParams(window.location.search);
    return params.get('ref');
  }, []);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const ref = params.get('ref');
    if (ref && ethers.isAddress(ref)) {
      localStorage.setItem('referrer', ref);
    }
  }, []);

  const getReferrer = () => {
    if (userInfo?.referrer && userInfo.referrer !== ethers.ZeroAddress) {
      return userInfo.referrer;
    }
    const saved = localStorage.getItem('referrer');
    if (saved && ethers.isAddress(saved)) return saved;
    return urlRef && ethers.isAddress(urlRef) ? urlRef : ethers.ZeroAddress;
  };

  const approvePayment = async () => {
    if (!contracts?.writePaymentToken) return;
    setIsApproving(true);
    try {
      const tx = await contracts.writePaymentToken.approve(CONTRACTS.STAKING_BANK, ethers.MaxUint256);
      toast.loading(t('cz.toast.approving'), { id: 'approveBuy' });
      await tx.wait();
      toast.success(t('cz.toast.approveSuccess'), { id: 'approveBuy' });
      onRefresh?.();
    } catch (err) {
      toast.error(parseContractError(err), { id: 'approveBuy' });
    } finally {
      setIsApproving(false);
    }
  };

  const buyTokens = async () => {
    if (!contracts?.writeStakingBank || !account) return;
    if (usdtAmount <= 0) {
      toast.error(t('cz.toast.invalidAmount'));
      return;
    }
    if (parseFloat(paymentBalance || '0') < usdtAmount) {
      toast.error(t('cz.toast.insufficientPayment'));
      return;
    }

    setIsBuying(true);
    try {
      const referrer = getReferrer();
      const value = ethers.parseEther(amount);
      toast.loading(t('cz.toast.buying'), { id: 'buyTokens' });
      const tx = await contracts.writeStakingBank.buy(value, referrer);
      await tx.wait();
      toast.success(t('cz.toast.buySuccess'), { id: 'buyTokens' });
      setAmount('');
      onRefresh?.();
    } catch (err) {
      toast.error(parseContractError(err), { id: 'buyTokens' });
    } finally {
      setIsBuying(false);
    }
  };

  const claimRewards = async () => {
    if (!contracts?.writeStakingBank || pendingRewards <= 0) return;
    setIsClaiming(true);
    try {
      toast.loading(t('cz.toast.claiming'), { id: 'claimBuyRewards' });
      const tx = await contracts.writeStakingBank.claimRewards();
      await tx.wait();
      toast.success(t('cz.toast.claimSuccess'), { id: 'claimBuyRewards' });
      onRefresh?.();
    } catch (err) {
      toast.error(parseContractError(err), { id: 'claimBuyRewards' });
    } finally {
      setIsClaiming(false);
    }
  };

  const claimInterest = async () => {
    if (!contracts?.writeStakingBank || pendingInterest <= 0) return;
    setIsClaimingInterest(true);
    try {
      toast.loading(t('cz.toast.claimingInterest'), { id: 'claimBuyInterest' });
      const tx = await contracts.writeStakingBank.claimInterest();
      await tx.wait();
      toast.success(t('cz.toast.claimInterestSuccess'), { id: 'claimBuyInterest' });
      onRefresh?.();
    } catch (err) {
      toast.error(parseContractError(err), { id: 'claimBuyInterest' });
    } finally {
      setIsClaimingInterest(false);
    }
  };

  return (
    <div className="space-y-6">
      <section>
        <h1 className="text-2xl sm:text-3xl font-bold text-white flex items-center gap-3 mb-2">
          <FiShoppingCart className="text-[#FFB800]" />
          {t('cz.buy.title')}
        </h1>
        <p className="text-white/50">{t('cz.buy.subtitle')}</p>
      </section>

      <section className="grid lg:grid-cols-3 gap-6">
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="lg:col-span-2 glass-premium p-5 sm:p-6">
          <div className="flex items-center justify-between mb-5">
            <h2 className="text-lg font-bold text-white flex items-center gap-2">
              <FiDollarSign className="text-[#00D9A5]" />
              {t('cz.buy.buyTokens')}
            </h2>
            <div className="text-sm text-white/40">1 USDT = {formatNumber(tokenPrice, 4)} {t('cz.common.tokenSymbol')}</div>
          </div>

          <div className="space-y-4">
            <div>
              <label className="block text-sm text-white/50 mb-2">{t('cz.buy.usdtAmount')}</label>
              <div className="relative">
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  placeholder="0.00"
                  className="input-premium pr-20"
                  disabled={!account}
                />
                <span className="absolute right-4 top-1/2 -translate-y-1/2 text-white/40 text-sm">USDT</span>
              </div>
              <div className="flex justify-between text-xs text-white/40 mt-1">
                <span>{t('cz.buy.balance')}: {formatNumber(paymentBalance, 4)} USDT</span>
              </div>
            </div>

            <div className="p-4 rounded-xl bg-white/5 border border-white/5">
              <div className="text-sm text-white/50 mb-1">{t('cz.buy.youWillReceive')}</div>
              <div className="text-2xl font-bold text-[#00D9A5]">{formatNumber(tokenAmount, 4)} {t('cz.common.tokenSymbol')}</div>
            </div>

            {!account ? (
              <button onClick={onSwitchNetwork} className="w-full btn-premium">{t('header.connectWallet')}</button>
            ) : !isCorrectNetwork ? (
              <button onClick={onSwitchNetwork} className="w-full btn-premium">{t('header.switchNetwork')}</button>
            ) : needsApproval ? (
              <button onClick={approvePayment} disabled={isApproving} className="w-full btn-premium disabled:opacity-50">
                {isApproving ? t('cz.buy.approving') : t('cz.buy.approveUSDT')}
              </button>
            ) : (
              <button onClick={buyTokens} disabled={isBuying || usdtAmount <= 0} className="w-full btn-premium disabled:opacity-50">
                {isBuying ? t('cz.buy.buying') : t('cz.buy.buyNow')}
              </button>
            )}
          </div>
        </motion.div>

        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }} className="space-y-4">
          <div className="stat-card-premium">
            <div className="flex items-center gap-2 text-[#FFB800] mb-3">
              <FiCreditCard />
              <span className="text-white/45 text-sm">{t('cz.buy.tokenBalance')}</span>
            </div>
            <div className="text-xl font-bold text-white">{formatNumber(tokenBalance, 4)} {t('cz.common.tokenSymbol')}</div>
          </div>

          <div className="stat-card-premium">
            <div className="flex items-center gap-2 text-[#FFB800] mb-3">
              <FiTrendingUp />
              <span className="text-white/45 text-sm">{t('cz.buy.purchased')}</span>
            </div>
            <div className="text-xl font-bold text-white">{formatNumber(userInfo?.purchased, 4)} {t('cz.common.tokenSymbol')}</div>
          </div>

          <div className="stat-card-premium">
            <div className="flex items-center gap-2 text-[#FFB800] mb-3">
              <FiTrendingUp />
              <span className="text-white/45 text-sm">{t('cz.buy.holdingInterest')}</span>
            </div>
            <div className="text-xl font-bold text-white">{formatNumber(pendingInterest, 4)} {t('cz.common.tokenSymbol')}</div>
            <div className="text-xs text-white/40 mt-1">{t('cz.buy.dailyInterestRate', { rate: stakingData?.interestInfo?.rateBps ? (stakingData.interestInfo.rateBps / 100).toFixed(2) : '1.00' })}</div>
          </div>

          <div className="stat-card-premium">
            <div className="flex items-center gap-2 text-[#FFB800] mb-3">
              <FiGift />
              <span className="text-white/45 text-sm">{t('cz.buy.pendingRewards')}</span>
            </div>
            <div className="text-xl font-bold text-white">{formatNumber(pendingRewards, 4)} USDT</div>
          </div>

          <button
            onClick={claimInterest}
            disabled={!account || isClaimingInterest || pendingInterest <= 0}
            className="w-full btn-ghost disabled:opacity-50"
          >
            {isClaimingInterest ? t('cz.buy.claimingInterest') : t('cz.buy.claimInterest')}
          </button>

          <button
            onClick={claimRewards}
            disabled={!account || isClaiming || pendingRewards <= 0}
            className="w-full btn-ghost disabled:opacity-50"
          >
            {isClaiming ? t('cz.buy.claiming') : t('cz.buy.claimRewards')}
          </button>

          <button
            onClick={onRefresh}
            className="w-full py-2 rounded-xl bg-white/5 text-white/50 hover:bg-white/10 flex items-center justify-center gap-2"
          >
            <FiRefreshCw className="w-4 h-4" />
            {t('cz.common.refresh')}
          </button>
        </motion.div>
      </section>
    </div>
  );
}
