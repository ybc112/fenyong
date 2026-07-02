import { useState } from 'react';
import { ethers } from 'ethers';
import toast from 'react-hot-toast';
import { FiAward, FiPause, FiPlay, FiSettings, FiShield, FiUploadCloud } from 'react-icons/fi';
import { CONTRACTS, formatAddress, formatNumber, parseContractError } from '../utils/constants';

export default function AdminPage({ account, contracts, stakingData, onRefresh }) {
  const [releaseAmount, setReleaseAmount] = useState('');
  const [allocateCount, setAllocateCount] = useState('100');
  const [inviteReward, setInviteReward] = useState('');
  const [feeConfig, setFeeConfig] = useState({
    feeToken: CONTRACTS.FEE_TOKEN,
    fee: '0.4',
    receiverA: '0xfd682CbCb678ce5D273Eb778B946F6a4d8f1e8Ed',
    receiverB: '0x5A378b61193ac2ce07cE816893C080804504a2f0',
  });
  const [isWorking, setIsWorking] = useState(false);

  const owner = null;
  const isReady = account && contracts?.writeStakingBank;
  const currentRelease = stakingData?.currentRelease;
  const fee = stakingData?.interactionFeeConfig;

  const approveRewardToken = async () => {
    if (!contracts?.writeNbtToken || !CONTRACTS.STAKING_BANK || !releaseAmount) return;
    setIsWorking(true);
    try {
      const tx = await contracts.writeNbtToken.approve(CONTRACTS.STAKING_BANK, ethers.parseEther(releaseAmount));
      toast.loading('正在授权月度释放 CZ...', { id: 'approveRelease' });
      await tx.wait();
      toast.success('授权成功', { id: 'approveRelease' });
      onRefresh?.();
    } catch (err) {
      toast.error(parseContractError(err), { id: 'approveRelease' });
    } finally {
      setIsWorking(false);
    }
  };

  const openRelease = async () => {
    if (!isReady || !releaseAmount) return;
    setIsWorking(true);
    try {
      const tx = await contracts.writeStakingBank.openMonthlyRelease(ethers.parseEther(releaseAmount));
      toast.loading('正在开启月度释放...', { id: 'openRelease' });
      await tx.wait();
      toast.success('月度释放已开启', { id: 'openRelease' });
      setReleaseAmount('');
      onRefresh?.();
    } catch (err) {
      toast.error(parseContractError(err), { id: 'openRelease' });
    } finally {
      setIsWorking(false);
    }
  };

  const allocateRelease = async () => {
    if (!isReady) return;
    setIsWorking(true);
    try {
      const tx = await contracts.writeStakingBank.allocateMonthlyRelease(Number(allocateCount || 100));
      toast.loading('正在分配排名奖励...', { id: 'allocateRelease' });
      await tx.wait();
      toast.success('本批排名奖励已入账', { id: 'allocateRelease' });
      onRefresh?.();
    } catch (err) {
      toast.error(parseContractError(err), { id: 'allocateRelease' });
    } finally {
      setIsWorking(false);
    }
  };

  const updateFeeConfig = async () => {
    if (!isReady) return;
    if (!ethers.isAddress(feeConfig.feeToken) || !ethers.isAddress(feeConfig.receiverA) || !ethers.isAddress(feeConfig.receiverB)) {
      toast.error('请填写有效地址');
      return;
    }
    setIsWorking(true);
    try {
      const tx = await contracts.writeStakingBank.setInteractionFeeConfig(
        feeConfig.feeToken,
        ethers.parseEther(feeConfig.fee || '0'),
        feeConfig.receiverA,
        feeConfig.receiverB,
      );
      toast.loading('正在更新交互费配置...', { id: 'feeConfig' });
      await tx.wait();
      toast.success('交互费配置已更新', { id: 'feeConfig' });
      onRefresh?.();
    } catch (err) {
      toast.error(parseContractError(err), { id: 'feeConfig' });
    } finally {
      setIsWorking(false);
    }
  };

  const updateInviteReward = async () => {
    if (!isReady || inviteReward === '') return;
    setIsWorking(true);
    try {
      const tx = await contracts.writeStakingBank.setInviteReward(ethers.parseEther(inviteReward));
      toast.loading('正在更新邀请奖励...', { id: 'inviteReward' });
      await tx.wait();
      toast.success('邀请奖励已更新', { id: 'inviteReward' });
      setInviteReward('');
      onRefresh?.();
    } catch (err) {
      toast.error(parseContractError(err), { id: 'inviteReward' });
    } finally {
      setIsWorking(false);
    }
  };

  const setPaused = async (paused) => {
    if (!isReady) return;
    setIsWorking(true);
    try {
      const tx = paused ? await contracts.writeStakingBank.pause() : await contracts.writeStakingBank.unpause();
      toast.loading(paused ? '正在暂停...' : '正在恢复...', { id: 'pause' });
      await tx.wait();
      toast.success(paused ? '合约已暂停' : '合约已恢复', { id: 'pause' });
      onRefresh?.();
    } catch (err) {
      toast.error(parseContractError(err), { id: 'pause' });
    } finally {
      setIsWorking(false);
    }
  };

  return (
    <div className="space-y-8">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl md:text-3xl font-bold text-white flex items-center gap-3">
            <FiShield className="text-[#FFB800]" />
            CZ 节点管理台
          </h1>
          <p className="text-white/50 mt-1">月度释放、排名分配、交互费与邀请奖励配置</p>
        </div>
        <div className="badge-glow">当前钱包 {formatAddress(account || owner)}</div>
      </div>

      <section className="grid lg:grid-cols-3 gap-4">
        {[
          { label: '全网质押', value: stakingData?.miningStatus?.totalStaked || '0', suffix: 'CZ' },
          { label: '节点数', value: stakingData?.miningStatus?.rankedNodeCount || 0, suffix: '个' },
          { label: '待领取奖励', value: stakingData?.miningStatus?.claimableRewards || '0', suffix: 'CZ' },
        ].map((item) => (
          <div key={item.label} className="stat-card-premium">
            <div className="text-white/45 text-sm mb-2">{item.label}</div>
            <div className="text-2xl font-bold text-white">{formatNumber(item.value, 4)} <span className="text-sm text-white/40">{item.suffix}</span></div>
          </div>
        ))}
      </section>

      <section className="grid lg:grid-cols-2 gap-6">
        <div className="neon-card">
          <div className="neon-card-inner">
            <h2 className="text-xl font-bold text-white mb-5 flex items-center gap-2">
              <FiUploadCloud className="text-[#FFB800]" />
              月度释放
            </h2>
            <div className="grid sm:grid-cols-2 gap-3 mb-4">
              <input className="input-premium" value={releaseAmount} onChange={(e) => setReleaseAmount(e.target.value)} placeholder="释放 CZ 数量" />
              <input className="input-premium" value={allocateCount} onChange={(e) => setAllocateCount(e.target.value)} placeholder="每批分配节点数" />
            </div>
            <div className="grid sm:grid-cols-2 gap-3">
              <button onClick={approveRewardToken} disabled={isWorking || !releaseAmount} className="btn-ghost disabled:opacity-50">授权释放 CZ</button>
              <button onClick={openRelease} disabled={isWorking || !releaseAmount} className="btn-premium disabled:opacity-50"><span>开启月度释放</span></button>
            </div>

            {currentRelease && Number(currentRelease.epochId) > 0 && (
              <div className="mt-5 p-4 rounded-xl bg-white/5 border border-white/10">
                <div className="grid grid-cols-2 gap-3 text-sm">
                  <div><span className="text-white/40">Epoch</span><div className="font-bold text-white">#{currentRelease.epochId}</div></div>
                  <div><span className="text-white/40">状态</span><div className="font-bold text-white">{currentRelease.finalized ? '已完成' : '分配中'}</div></div>
                  <div><span className="text-white/40">总释放</span><div className="font-bold text-white">{formatNumber(currentRelease.amount, 4)} CZ</div></div>
                  <div><span className="text-white/40">已分配</span><div className="font-bold text-white">{formatNumber(currentRelease.allocatedAmount, 4)} CZ</div></div>
                </div>
                <button onClick={allocateRelease} disabled={isWorking || currentRelease.finalized} className="w-full mt-4 btn-premium disabled:opacity-50">
                  <span>分配下一批</span>
                </button>
              </div>
            )}
          </div>
        </div>

        <div className="glass-premium p-5">
          <h2 className="text-xl font-bold text-white mb-5 flex items-center gap-2">
            <FiSettings className="text-[#00D9A5]" />
            参数配置
          </h2>
          <div className="space-y-3">
            <input className="input-premium font-mono text-sm" value={feeConfig.feeToken} onChange={(e) => setFeeConfig(prev => ({ ...prev, feeToken: e.target.value }))} placeholder="交互费 Token" />
            <input className="input-premium" value={feeConfig.fee} onChange={(e) => setFeeConfig(prev => ({ ...prev, fee: e.target.value }))} placeholder="每次交互费，如 0.4" />
            <input className="input-premium font-mono text-sm" value={feeConfig.receiverA} onChange={(e) => setFeeConfig(prev => ({ ...prev, receiverA: e.target.value }))} placeholder="0.2U 接收地址 A" />
            <input className="input-premium font-mono text-sm" value={feeConfig.receiverB} onChange={(e) => setFeeConfig(prev => ({ ...prev, receiverB: e.target.value }))} placeholder="0.2U 接收地址 B" />
            <button onClick={updateFeeConfig} disabled={isWorking} className="w-full btn-premium disabled:opacity-50"><span>保存交互费配置</span></button>
          </div>

          <div className="mt-5 p-4 rounded-xl bg-white/5 border border-white/10 text-sm text-white/55">
            当前交互费：{formatNumber(fee?.fee || 0, 4)} U，
            A {formatAddress(fee?.receiverA)}，B {formatAddress(fee?.receiverB)}
          </div>

          <div className="mt-5 grid sm:grid-cols-[1fr_auto] gap-3">
            <input className="input-premium" value={inviteReward} onChange={(e) => setInviteReward(e.target.value)} placeholder="邀请奖励 CZ，默认 1" />
            <button onClick={updateInviteReward} disabled={isWorking || inviteReward === ''} className="btn-ghost disabled:opacity-50">保存</button>
          </div>
        </div>
      </section>

      <section className="glass-premium p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold text-white">暂停控制</h2>
          <p className="text-white/45 text-sm">暂停后用户不能质押、提取或领取，管理员仍可恢复。</p>
        </div>
        <div className="flex gap-3">
          <button onClick={() => setPaused(true)} disabled={isWorking || stakingData?.isPaused} className="px-4 py-2 rounded-lg bg-[#FFB800]/20 text-[#FFB800] disabled:opacity-50 flex items-center gap-2">
            <FiPause /> 暂停
          </button>
          <button onClick={() => setPaused(false)} disabled={isWorking || !stakingData?.isPaused} className="px-4 py-2 rounded-lg bg-[#00D9A5]/20 text-[#00D9A5] disabled:opacity-50 flex items-center gap-2">
            <FiPlay /> 恢复
          </button>
        </div>
      </section>
    </div>
  );
}
