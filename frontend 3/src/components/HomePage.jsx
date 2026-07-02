import { motion } from 'framer-motion';
import { FiArrowRight, FiAward, FiCheckCircle, FiGift, FiTrendingUp, FiUsers, FiZap } from 'react-icons/fi';
import { formatNumber } from '../utils/constants';

export default function HomePage({ onPageChange, stakingData }) {
  const miningStatus = stakingData?.miningStatus;

  const stats = [
    { label: '全网 CZ 质押', value: miningStatus?.totalStaked || '0', suffix: 'CZ', icon: <FiTrendingUp /> },
    { label: '已分配奖励', value: miningStatus?.totalDistributed || '0', suffix: 'CZ', icon: <FiGift /> },
    { label: '节点数量', value: miningStatus?.rankedNodeCount || 0, suffix: '个', icon: <FiUsers /> },
  ];

  const bands = [
    { rank: '前 10 名', share: '50%', note: '核心节点池' },
    { rank: '11-50 名', share: '30%', note: '攀登节点池' },
    { rank: '51-100 名', share: '15%', note: '成长节点池' },
    { rank: '100 名以后', share: '5%', note: '普惠节点池' },
  ];

  return (
    <div className="space-y-10 md:space-y-16">
      <section className="relative min-h-[72vh] flex items-center">
        <div className="absolute inset-0 overflow-hidden rounded-[2rem]">
          <img src="/cz-logo.png" alt="CZ" className="absolute right-[-90px] top-1/2 -translate-y-1/2 w-[420px] h-[420px] md:w-[620px] md:h-[620px] rounded-full object-cover opacity-25 blur-[1px]" />
          <div className="absolute inset-0 bg-gradient-to-r from-[#0B1120] via-[#0B1120]/90 to-[#0B1120]/40" />
        </div>

        <motion.div
          initial={{ opacity: 0, y: 24 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.7 }}
          className="relative max-w-4xl px-2 md:px-6"
        >
          <div className="badge-glow mb-7">
            <FiCheckCircle className="w-4 h-4 mr-2" />
            100% 分配 · 无截留 · 链上排名
          </div>

          <h1 className="text-4xl sm:text-6xl md:text-7xl font-bold leading-tight mb-6">
            <span className="text-white">Crypto Zenith</span>
            <br />
            <span className="text-gradient-gold">链上巅峰</span>
          </h1>

          <p className="text-lg sm:text-2xl text-white/65 leading-relaxed max-w-3xl mb-8">
            中本聪给了我们数字黄金，CZ人生给了我们链上分红。
            <br />
            每个人，都是自己加密人生的主角。来，一起登顶加密之巅。
          </p>

          <div className="flex flex-wrap gap-4">
            <motion.button whileHover={{ scale: 1.04 }} whileTap={{ scale: 0.96 }} onClick={() => onPageChange('token-mining')} className="btn-premium">
              <span className="flex items-center gap-2">查看节点排名 <FiArrowRight className="w-5 h-5" /></span>
            </motion.button>
            <motion.button whileHover={{ scale: 1.04 }} whileTap={{ scale: 0.96 }} onClick={() => onPageChange('referral')} className="btn-ghost">
              <span className="flex items-center gap-2"><FiUsers className="w-5 h-5" /> 邀请好友</span>
            </motion.button>
          </div>
        </motion.div>
      </section>

      <section className="grid grid-cols-3 gap-3 md:gap-6">
        {stats.map((stat, index) => (
          <motion.div
            key={stat.label}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: index * 0.1 }}
            className="stat-card-premium"
          >
            <div className="flex items-center gap-2 text-[#FFB800] mb-3">
              {stat.icon}
              <span className="text-white/45 text-sm">{stat.label}</span>
            </div>
            <div className="text-xl sm:text-3xl font-bold text-white">
              {formatNumber(stat.value, 4)}
              <span className="text-white/40 text-sm ml-1">{stat.suffix}</span>
            </div>
          </motion.div>
        ))}
      </section>

      <section className="grid lg:grid-cols-[0.9fr_1.1fr] gap-6">
        <div className="neon-card">
          <div className="neon-card-inner h-full">
            <h2 className="text-2xl font-bold text-white mb-5 flex items-center gap-3">
              <FiZap className="text-[#FFB800]" />
              CZ 人生节点机制
            </h2>
            <div className="space-y-4 text-white/65 leading-relaxed">
              <p>你不需要质押，不需要申请节点。只要你的邀请人完成 CZ 质押，你就进入节点排名。</p>
              <p>每一个有效邀请质押，奖励 1 CZ。每月释放池再按排名分段 100% 分配给所有节点。</p>
              <p>排名越高，拿得越多。项目方不留一分，释放多少，分配多少。</p>
            </div>
          </div>
        </div>

        <div className="glass-premium p-5 md:p-6">
          <h2 className="text-2xl font-bold text-white mb-5 flex items-center gap-3">
            <FiAward className="text-[#00D9A5]" />
            月度释放分配
          </h2>
          <div className="grid sm:grid-cols-2 gap-4">
            {bands.map((band, index) => (
              <motion.div
                key={band.rank}
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ delay: 0.15 + index * 0.08 }}
                className="p-5 rounded-xl bg-white/5 border border-white/10"
              >
                <div className="text-white/50 text-sm">{band.rank}</div>
                <div className="text-4xl font-bold text-gradient-gold my-2">{band.share}</div>
                <div className="text-white/35 text-sm">{band.note}</div>
              </motion.div>
            ))}
          </div>
        </div>
      </section>
    </div>
  );
}
