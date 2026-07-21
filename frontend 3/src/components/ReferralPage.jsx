import { useCallback, useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { ethers } from 'ethers';
import toast from 'react-hot-toast';
import { FiAward, FiCheck, FiCopy, FiExternalLink, FiGift, FiRefreshCw, FiShare2, FiTrendingUp, FiUserPlus, FiUsers } from 'react-icons/fi';
import { CONTRACTS, formatAddress, formatNumber, getExplorerAddressUrl, parseContractError } from '../utils/constants';
import { useLanguage } from '../contexts/LanguageContext';

const PAGE_SIZE = 20;

export default function ReferralPage({
  account,
  stakingData,
  contracts,
  onRefresh,
}) {
  const { t } = useLanguage();
  const userInfo = stakingData?.userInfo;
  const [copied, setCopied] = useState(false);
  const [referrals, setReferrals] = useState([]);
  const [offset, setOffset] = useState(0);
  const [total, setTotal] = useState(0);
  const [loadingReferrals, setLoadingReferrals] = useState(false);
  const [isClaiming, setIsClaiming] = useState(false);
  const [isClaimingInterest, setIsClaimingInterest] = useState(false);
  const [manualCopyLink, setManualCopyLink] = useState(null);

  const stakingContract = contracts?.stakingBank;

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
    const link = `${window.location.origin}?ref=${account}`;

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

  const claimRewards = async () => {
    if (!contracts?.writeStakingBank) return;
    setIsClaiming(true);
    try {
      const tx = await contracts.writeStakingBank.claimRewards();
      toast.loading(t('cz.toast.claiming'), { id: 'claimRefPage' });
      await tx.wait();
      toast.success(t('cz.toast.claimSuccess'), { id: 'claimRefPage' });
      onRefresh?.();
    } catch (err) {
      toast.error(parseContractError(err), { id: 'claimRefPage' });
    } finally {
      setIsClaiming(false);
    }
  };

  const claimInterest = async () => {
    if (!contracts?.writeStakingBank) return;
    setIsClaimingInterest(true);
    try {
      const tx = await contracts.writeStakingBank.claimInterest();
      toast.loading(t('cz.toast.claimingInterest'), { id: 'claimInterestRefPage' });
      await tx.wait();
      toast.success(t('cz.toast.claimInterestSuccess'), { id: 'claimInterestRefPage' });
      onRefresh?.();
    } catch (err) {
      toast.error(parseContractError(err), { id: 'claimInterestRefPage' });
    } finally {
      setIsClaimingInterest(false);
    }
  };

  const loadReferrals = useCallback(async (reset = false) => {
    if (!stakingContract || !account) return;
    setLoadingReferrals(true);
    try {
      const nextOffset = reset ? 0 : offset;
      const result = await stakingContract.getReferralsPaginated(account, nextOffset, PAGE_SIZE);
      const nextItems = Array.from(result.result);
      setReferrals(prev => reset ? nextItems : [...prev, ...nextItems]);
      setOffset(nextOffset + nextItems.length);
      setTotal(Number(result.total));
    } catch (err) {
      console.error('Fetch referrals error:', err);
    } finally {
      setLoadingReferrals(false);
    }
  }, [stakingContract, account, offset]);

  useEffect(() => {
    setReferrals(stakingData?.referrals || []);
    setTotal(stakingData?.referralsTotal || 0);
    setOffset((stakingData?.referrals || []).length);
  }, [stakingData?.referrals, stakingData?.referralsTotal]);

  return (
    <div className="space-y-8">
      {/* 邀请奖励说明 */}
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

      {/* 顶部操作区 */}
      <section className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold text-white flex items-center gap-3">
            <FiUsers className="text-[#FFB800]" />
            {t('cz.referral.title')}
          </h1>
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
      </section>

      {/* 核心数据卡片 */}
      <section className="grid grid-cols-2 lg:grid-cols-6 gap-4">
        {[
          { label: t('cz.referral.inviteRank'), value: '-', suffix: '', icon: <FiAward /> },
          { label: t('cz.referral.directInvites'), value: userInfo?.referralCount || 0, suffix: t('cz.common.person'), icon: <FiUserPlus /> },
          { label: t('cz.referral.teamEarnings'), value: userInfo?.purchased || 0, suffix: 'USDT', icon: <FiTrendingUp /> },
          { label: t('cz.referral.pendingRewards'), value: userInfo?.pendingRewards || 0, suffix: 'USDT', icon: <FiGift /> },
          { label: t('cz.referral.totalClaimed'), value: userInfo?.claimed || 0, suffix: 'USDT', icon: <FiShare2 /> },
          { label: t('cz.referral.holdingInterest'), value: userInfo?.pendingInterest || 0, suffix: t('cz.common.tokenSymbol'), icon: <FiTrendingUp /> },
        ].map((stat) => (
          <div key={stat.label} className="stat-card-premium">
            <div className="flex items-center gap-2 text-[#FFB800] mb-3">
              {stat.icon}
              <span className="text-white/45 text-sm">{stat.label}</span>
            </div>
            <div className="text-xl sm:text-2xl font-bold text-white">
              {typeof stat.value === 'string' && stat.value.startsWith('#') ? stat.value : formatNumber(stat.value, 4)}
              {stat.suffix && <span className="text-white/40 text-sm ml-1">{stat.suffix}</span>}
            </div>
          </div>
        ))}
      </section>

      {/* 收益明细 + 邀请列表 */}
      <section className="grid lg:grid-cols-[0.9fr_1.1fr] gap-6">
        <motion.div initial={{ opacity: 0, x: -20 }} animate={{ opacity: 1, x: 0 }} className="neon-card">
          <div className="neon-card-inner">
            <h2 className="text-xl font-bold mb-5 flex items-center gap-2 text-white">
              <FiShare2 className="text-[#00D9A5]" />
              {t('cz.referral.rewardDetails')}
            </h2>

            <div className="space-y-3 mb-5">
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

            <button
              onClick={claimRewards}
              disabled={!account || isClaiming || parseFloat(userInfo?.pendingRewards || '0') <= 0}
              className="w-full btn-premium disabled:opacity-50"
            >
              <span>{isClaiming ? t('cz.referral.claiming') : t('cz.referral.claimRewards')}</span>
            </button>

            <div className="mt-4 pt-4 border-t border-white/10">
              <div className="flex justify-between items-center mb-3">
                <span className="text-white/50">{t('cz.referral.holdingInterestPending')}</span>
                <span className="text-[#00D9A5] font-bold">
                  {formatNumber(userInfo?.pendingInterest || 0, 4)} {t('cz.common.tokenSymbol')}
                </span>
              </div>
              <button
                onClick={claimInterest}
                disabled={!account || isClaimingInterest || parseFloat(userInfo?.pendingInterest || '0') <= 0}
                className="w-full btn-premium disabled:opacity-50"
              >
                <span>{isClaimingInterest ? t('cz.referral.claimingInterest') : t('cz.referral.claimInterest')}</span>
              </button>
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
