import { useState, useEffect, useMemo, useCallback } from 'react';
import { motion } from 'framer-motion';
import { ethers } from 'ethers';
import toast from 'react-hot-toast';
import { FiAward, FiCheck, FiCopy, FiCreditCard, FiDollarSign, FiExternalLink, FiGift, FiRefreshCw, FiShare2, FiShoppingCart, FiTrendingUp, FiUserPlus, FiUsers } from 'react-icons/fi';
import { QRCodeSVG } from 'qrcode.react';
import { CONTRACTS, DEFAULT_TOKEN_PRICE, formatAddress, formatNumber, getExplorerAddressUrl, parseContractError, TOKEN_SYMBOL } from '../utils/constants';
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
  const [copied, setCopied] = useState(false);
  const [manualCopyLink, setManualCopyLink] = useState(null);
  const [referrals, setReferrals] = useState([]);
  const [offset, setOffset] = useState(0);
  const [total, setTotal] = useState(0);
  const [loadingReferrals, setLoadingReferrals] = useState(false);

  const saleStatus = stakingData?.saleStatus;
  const userInfo = stakingData?.userInfo;
  const tokenPrice = parseFloat(stakingData?.tokenPrice || DEFAULT_TOKEN_PRICE);
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

  const referralLink = useMemo(() => {
    return account ? `${window.location.origin}?ref=${account}` : '';
  }, [account]);

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

  const fallbackCopy = (text) => {
    try {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.setAttribute('readonly', '');
      ta.style.position = 'fixed';
      ta.style.top = '0';
      ta.style.left = '0';
      ta.style.width = '1px';
      ta.style.height = '1px';
      ta.style.opacity = '0';
      ta.style.pointerEvents = 'none';
      document.body.appendChild(ta);
      ta.focus();
      ta.select();
      ta.setSelectionRange(0, ta.value.length);
      const ok = document.execCommand('copy');
      document.body.removeChild(ta);
      return ok;
    } catch {
      return false;
    }
  };

  const copyReferralLink = async () => {
    if (!account) return;
    const link = referralLink;

    let success = false;
    if (navigator.clipboard && window.isSecureContext) {
      try {
        await navigator.clipboard.writeText(link);
        success = true;
      } catch {
        success = false;
      }
    }
    if (!success) {
      success = fallbackCopy(link);
    }

    if (success) {
      setCopied(true);
      toast.success(t('cz.toast.linkCopied'));
      setTimeout(() => setCopied(false), 2000);
      return;
    }
    setManualCopyLink(link);
  };

  const loadReferrals = useCallback(async (reset = false) => {
    if (!contracts?.stakingBank || !account) return;
    setLoadingReferrals(true);
    try {
      const nextOffset = reset ? 0 : offset;
      const result = await contracts.stakingBank.getReferralsPaginated(account, nextOffset, 20);
      const nextItems = Array.from(result.result);
      setReferrals(prev => reset ? nextItems : [...prev, ...nextItems]);
      setOffset(nextOffset + nextItems.length);
      setTotal(Number(result.total));
    } catch (err) {
      console.error('Fetch referrals error:', err);
    } finally {
      setLoadingReferrals(false);
    }
  }, [contracts?.stakingBank, account, offset]);

  useEffect(() => {
    setReferrals(stakingData?.referrals || []);
    setTotal(stakingData?.referralsTotal || 0);
    setOffset((stakingData?.referrals || []).length);
  }, [stakingData?.referrals, stakingData?.referralsTotal]);

  return (
    <div className="space-y-6">
      <section>
        <h1 className="text-2xl sm:text-3xl font-bold text-white flex items-center gap-3 mb-2">
          <FiShoppingCart className="text-[#FFB800]" />
          {t('cz.buy.title')}
        </h1>
        <p className="text-white/50">{t('cz.buy.subtitle')}</p>
      </section>

      <section>
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="space-y-4">
          <div className="stat-card-premium">
            <div className="flex items-center gap-2 text-[#FFB800] mb-3">
              <FiCreditCard />
              <span className="text-white/45 text-sm">{t('cz.buy.tokenBalance')}</span>
            </div>
            <div className="text-xl font-bold text-white">{formatNumber(tokenBalance, 2)} {TOKEN_SYMBOL}</div>
          </div>

          <div className="stat-card-premium">
            <div className="flex items-center gap-2 text-[#FFB800] mb-3">
              <FiTrendingUp />
              <span className="text-white/45 text-sm">{t('cz.buy.purchased')}</span>
            </div>
            <div className="text-xl font-bold text-white">{formatNumber(userInfo?.purchased, 2)} {TOKEN_SYMBOL}</div>
          </div>

          <div className="stat-card-premium">
            <div className="flex items-center gap-2 text-[#FFB800] mb-3">
              <FiTrendingUp />
              <span className="text-white/45 text-sm">{t('cz.buy.holdingInterest')}</span>
            </div>
            <div className="text-xl font-bold text-white">{formatNumber(pendingInterest, 2)} {TOKEN_SYMBOL}</div>
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

      {/* 推荐奖励说明 */}
      <section className="grid md:grid-cols-3 gap-4">
        {[
          { icon: <FiUserPlus />, title: t('cz.referral.directRewardTitle'), desc: t('cz.referral.directRewardDesc') },
          { icon: <FiUsers />, title: t('cz.referral.indirectRewardTitle'), desc: t('cz.referral.indirectRewardDesc') },
          { icon: <FiAward />, title: t('cz.referral.teamRewardTitle'), desc: t('cz.referral.teamRewardDesc') },
        ].map((card) => (
          <div key={card.title} className="stat-card-premium">
            <div className="flex items-center gap-2 text-[#FFB800] mb-3">
              {card.icon}
              <span className="text-white font-medium">{card.title}</span>
            </div>
            <p className="text-sm text-white/50 leading-relaxed">{card.desc}</p>
          </div>
        ))}
      </section>

      {/* 分享链接 */}
      <section>
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-4">
          <div>
            <h2 className="text-xl sm:text-2xl font-bold text-white flex items-center gap-3">
              <FiUsers className="text-[#FFB800]" />
              {t('cz.referral.title')}
            </h2>
            <p className="text-white/50 mt-1">{t('cz.referral.subtitle')}</p>
          </div>
          <button
            onClick={copyReferralLink}
            disabled={!account}
            className="btn-premium flex items-center justify-center gap-2 disabled:opacity-50 whitespace-nowrap"
          >
            {copied ? <FiCheck className="w-5 h-5" /> : <FiCopy className="w-5 h-5" />}
            <span>{copied ? t('cz.common.copied') : t('cz.common.copyExclusiveLink')}</span>
          </button>
        </div>

        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="glass-premium p-5 sm:p-6">
          <div className="flex flex-col lg:flex-row gap-6 items-start">
            <div className="flex-1 w-full space-y-4">
              <label className="block text-sm text-white/50">{t('cz.referral.myReferralLink')}</label>
              <div className="flex items-center gap-2 p-3 rounded-xl bg-white/5 border border-white/10 break-all text-white font-mono text-sm">
                {referralLink || t('header.connectWallet')}
              </div>
              <button
                onClick={copyReferralLink}
                disabled={!account}
                className="w-full btn-premium flex items-center justify-center gap-2 disabled:opacity-50"
              >
                {copied ? <FiCheck className="w-5 h-5" /> : <FiCopy className="w-5 h-5" />}
                <span>{copied ? t('cz.common.copied') : t('cz.common.copyExclusiveLink')}</span>
              </button>
            </div>
            <div className="mx-auto lg:mx-0 p-4 rounded-xl bg-white border border-white/10 min-w-[176px] min-h-[176px] flex items-center justify-center">
              {account ? (
                <QRCodeSVG value={referralLink} size={160} level="M" includeMargin />
              ) : (
                <div className="text-center text-black/50 text-sm px-4">{t('header.connectWallet')}<br />{t('cz.common.generateQR')}</div>
              )}
            </div>
          </div>
        </motion.div>
      </section>

      {/* 收益明细 + 团队列表 */}
      <section className="grid lg:grid-cols-[0.9fr_1.1fr] gap-6">
        <motion.div initial={{ opacity: 0, x: -20 }} animate={{ opacity: 1, x: 0 }} className="glass-premium p-5 sm:p-6">
          <h2 className="text-xl font-bold mb-5 flex items-center gap-2 text-white">
            <FiShare2 className="text-[#00D9A5]" />
            {t('cz.referral.rewardDetails')}
          </h2>
          <div className="space-y-3">
            <div className="p-4 rounded-xl bg-white/5 border border-white/5 flex justify-between">
              <span className="text-white/50">{t('cz.referral.directPending')}</span>
              <span className="text-[#00D9A5] font-bold">{formatNumber(userInfo?.directReward, 4)} USDT</span>
            </div>
            <div className="p-4 rounded-xl bg-white/5 border border-white/5 flex justify-between">
              <span className="text-white/50">{t('cz.referral.indirectPending')}</span>
              <span className="text-[#FFB800] font-bold">{formatNumber(userInfo?.indirectReward, 4)} USDT</span>
            </div>
            <div className="p-4 rounded-xl bg-white/5 border border-white/5 flex justify-between">
              <span className="text-white/50">{t('cz.referral.teamPending')}</span>
              <span className="text-[#00A3FF] font-bold">{formatNumber(userInfo?.teamReward, 4)} USDT</span>
            </div>
          </div>
        </motion.div>

        <motion.div initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} className="glass-premium p-4 sm:p-6">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-5">
            <h2 className="text-xl font-bold flex items-center gap-2 text-white">
              <FiUsers className="text-[#00D9A5]" />
              {t('cz.referral.myInvites')}
              <span className="text-sm font-normal text-white/40">{t('cz.referral.totalPrefix')} {total} {t('cz.common.person')}</span>
            </h2>
            <button
              onClick={() => {
                loadReferrals(true);
                onRefresh?.();
              }}
              disabled={loadingReferrals}
              className="flex items-center gap-2 px-4 py-2 rounded-lg bg-white/10 text-white/70 hover:bg-white/20 disabled:opacity-50"
            >
              <FiRefreshCw className={`w-4 h-4 ${loadingReferrals ? 'animate-spin' : ''}`} />
              {t('cz.common.refresh')}
            </button>
          </div>

          {referrals.length === 0 ? (
            <div className="text-center py-12 text-white/40">{t('cz.referral.noInvites')}</div>
          ) : (
            <div className="space-y-2">
              {referrals.map((address, index) => (
                <div key={`${address}-${index}`} className="flex items-center justify-between p-4 rounded-xl bg-white/5 border border-white/5">
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="w-8 h-8 rounded-full bg-[#FFB800] flex items-center justify-center text-black text-xs font-bold flex-shrink-0">
                      {index + 1}
                    </div>
                    <span className="font-mono text-white truncate">{formatAddress(address)}</span>
                  </div>
                  <a href={getExplorerAddressUrl(address)} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1 text-[#00D9A5] flex-shrink-0">
                    <span className="text-sm hidden sm:inline">{t('cz.common.view')}</span>
                    <FiExternalLink className="w-4 h-4" />
                  </a>
                </div>
              ))}
            </div>
          )}

          {referrals.length < total && (
            <button onClick={() => loadReferrals(false)} disabled={loadingReferrals} className="w-full mt-4 py-3 rounded-xl bg-white/5 text-white/60 hover:bg-white/10 disabled:opacity-50">
              {loadingReferrals ? t('cz.common.loadingMore') : t('cz.common.loadMore')}
            </button>
          )}
        </motion.div>
      </section>

      {manualCopyLink && (
        <div
          className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/70 backdrop-blur-sm p-4"
          onClick={() => setManualCopyLink(null)}
        >
          <div
            className="w-full max-w-md rounded-2xl bg-[#111827] border border-white/10 p-5 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-lg font-bold text-white mb-1">{t('cz.toast.manualCopyTitle')}</h3>
            <p className="text-sm text-white/55 mb-4">{t('cz.toast.manualCopyHint')}</p>
            <div
              className="break-all rounded-xl bg-white/5 border border-white/10 p-3 text-[#00D9A5] text-sm font-mono select-all"
              style={{ WebkitUserSelect: 'all', userSelect: 'all' }}
            >
              {manualCopyLink}
            </div>
            <div className="mt-4 flex justify-end gap-2">
              <button
                onClick={() => setManualCopyLink(null)}
                className="px-4 py-2 rounded-lg bg-white/10 text-white hover:bg-white/20"
              >
                {t('cz.toast.manualCopyClose')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
