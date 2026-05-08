import { motion } from 'framer-motion';
import { FiTrendingUp, FiUsers, FiDollarSign, FiZap, FiArrowRight, FiAward, FiActivity, FiCheckCircle } from 'react-icons/fi';
import { formatNumber } from '../utils/constants';
import { useLanguage } from '../contexts/LanguageContext';

export default function HomePage({ onPageChange, stakingData }) {
  const { t } = useLanguage();
  const miningStatus = stakingData?.miningStatus;

  const stats = [
    {
      label: t('home.tokenPoolStaked'),
      value: miningStatus?.totalStaked || '0',
      suffix: 'NBT',
      icon: <FiDollarSign className="w-5 h-5" />,
      color: 'gold',
    },
    {
      label: t('tokenMining.distributedRewards'),
      value: miningStatus?.totalDistributed || '0',
      suffix: 'NBT',
      icon: <FiZap className="w-5 h-5" />,
      color: 'primary',
    },
    {
      label: t('home.maxApy'),
      value: '365',
      suffix: '%',
      icon: <FiActivity className="w-5 h-5" />,
      color: 'gold',
    },
  ];

  const features = [
    {
      icon: <FiDollarSign className="w-7 h-7" />,
      title: t('home.tokenMiningTitle'),
      subtitle: t('home.tokenMiningSubtitle'),
      description: t('home.tokenMiningDesc'),
      stats: t('home.tokenMiningStats'),
      color: 'from-[#FFB800] to-[#FF8A00]',
      page: 'token-mining',
    },
    {
      icon: <FiUsers className="w-7 h-7" />,
      title: t('home.referralTitle'),
      subtitle: t('home.referralSubtitle'),
      description: t('home.referralDesc'),
      stats: t('home.referralStats'),
      color: 'from-[#00D9A5] to-[#FFB800]',
      page: 'referral',
    },
    {
      icon: <FiAward className="w-7 h-7" />,
      title: t('home.teamTitle'),
      subtitle: t('home.teamSubtitle'),
      description: t('home.teamDesc'),
      stats: t('home.teamStats'),
      color: 'from-[#FFB800] to-[#FF8A00]',
      page: 'referral',
    },
  ];

  const getColorClass = (color) => {
    return color === 'primary' ? 'text-[#00D9A5]' : 'text-[#FFB800]';
  };

  return (
    <div className="space-y-8 md:space-y-16">
      {/* Hero Section */}
      <section className="relative pt-4 md:pt-8 pb-8 md:pb-12">
        {/* 装饰性光球 */}
        <div className="absolute top-0 left-1/4 w-48 md:w-96 h-48 md:h-96 bg-[#00D9A5]/10 rounded-full blur-[80px] md:blur-[120px] animate-float" />
        <div
          className="absolute bottom-0 right-1/4 w-40 md:w-80 h-40 md:h-80 bg-[#FFB800]/10 rounded-full blur-[60px] md:blur-[100px] animate-float"
          style={{ animationDelay: "3s" }}
        />

        <motion.div
          initial={{ opacity: 0, y: 30 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8 }}
          className="relative text-center">
          {/* Badge */}
          <motion.div
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ delay: 0.2 }}
            className="inline-block mb-8">
            <span className="badge-glow">
              <FiCheckCircle className="w-4 h-4 mr-2" />
              {t("home.badge")}
            </span>
          </motion.div>

          {/* Main Title */}
          <h1 className="text-3xl sm:text-5xl md:text-7xl font-bold mb-4 md:mb-6 leading-tight">
            <span className="text-white">{t("home.title1")}</span>
            <br />
            <span className="text-gradient-premium text-glow">
              {t("home.title2")}
            </span>
          </h1>

          {/* Subtitle */}
          <p className="text-base sm:text-xl md:text-2xl text-white/50 max-w-3xl mx-auto mb-6 md:mb-10 leading-relaxed px-2">
            {t("home.subtitle")}
            <br />
            <span className="text-white/70">{t("home.totalReward")}</span>
          </p>

          {/* CTA Buttons */}
          <div className="flex flex-wrap justify-center gap-4">
            <motion.button
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.95 }}
              onClick={() => onPageChange("token-mining")}
              className="btn-premium">
              <span className="flex items-center gap-2">
                {t("home.startMining")} <FiArrowRight className="w-5 h-5" />
              </span>
            </motion.button>
            <motion.button
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.95 }}
              onClick={() => onPageChange("referral")}
              className="btn-ghost">
              <span className="flex items-center gap-2">
                <FiUsers className="w-5 h-5" /> {t("home.inviteFriends")}
              </span>
            </motion.button>
          </div>
        </motion.div>
      </section>

      {/* Stats Section */}
      <section>
        <div className="grid grid-cols-3 lg:grid-cols-3 gap-3 md:gap-6">
          {stats.map((stat, index) => (
            <motion.div
              key={stat.label}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: index * 0.1 }}
              className="stat-card-premium group">
              <div className="flex items-center justify-between mb-3">
                <span
                  className={`${getColorClass(
                    stat.color
                  )} opacity-60 group-hover:opacity-100 transition-opacity`}>
                  {stat.icon}
                </span>
                <div
                  className={`w-2 h-2 rounded-full ${
                    stat.color === "primary" ? "bg-[#00D9A5]" : "bg-[#FFB800]"
                  } animate-pulse`}
                />
              </div>
              <div className="number-display">
                <span className="text-2xl sm:text-3xl md:text-4xl font-bold text-white">
                  {formatNumber(stat.value)}
                </span>
                <span className="text-white/40 text-sm ml-2">
                  {stat.suffix}
                </span>
              </div>
              <div className="text-white/40 text-sm mt-2">{stat.label}</div>
            </motion.div>
          ))}
        </div>
      </section>

      {/* Features Section */}
      <section>
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="text-center mb-12">
          <h2 className="text-2xl sm:text-3xl md:text-4xl font-bold mb-4 text-white">
            {t("home.chooseMethod")}
            <span className="text-gradient-premium">
              {t("home.miningMethod")}
            </span>
          </h2>
          <p className="text-white/50">{t("home.moreChannels")}</p>
        </motion.div>

        <div className="grid md:grid-cols-3 gap-6">
          {features.map((feature, index) => (
            <motion.div
              key={feature.title}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.2 + index * 0.1 }}
              onClick={() => onPageChange(feature.page)}
              className="group relative rounded-2xl p-[1px] cursor-pointer overflow-hidden"
              style={{
                background: `linear-gradient(135deg, ${
                  feature.color.includes("00D9A5")
                    ? "rgba(0, 217, 165, 0.3)"
                    : "rgba(255, 184, 0, 0.3)"
                }, transparent)`,
              }}>
              {/* 内部卡片 */}
              <div className="relative rounded-2xl p-4 sm:p-6 bg-[#0F1629] h-full overflow-hidden transition-all duration-300 group-hover:bg-[#131B2E]">
                {/* 背景光效 */}
                <div
                  className={`absolute top-0 right-0 w-40 h-40 rounded-full bg-gradient-to-br ${feature.color} opacity-5 blur-3xl group-hover:opacity-10 transition-opacity`}
                />

                <div className="relative">
                  {/* 头部：图标 + 标签 */}
                  <div className="flex items-start justify-between mb-5">
                    <div
                      className={`w-14 h-14 rounded-2xl bg-gradient-to-br ${feature.color} flex items-center justify-center shadow-lg group-hover:scale-110 group-hover:rotate-3 transition-all duration-300`}>
                      <span className="text-[#0B1120]">{feature.icon}</span>
                    </div>
                    <span
                      className={`px-3 py-1.5 rounded-full text-xs font-semibold bg-gradient-to-r ${feature.color} text-[#0B1120]`}>
                      {feature.stats}
                    </span>
                  </div>

                  {/* 标题和副标题 */}
                  <h3 className="text-xl font-bold text-white mb-1 group-hover:text-[#00D9A5] transition-colors">
                    {feature.title}
                  </h3>
                  <p className="text-sm text-white/40 mb-3">
                    {feature.subtitle}
                  </p>

                  {/* 描述 */}
                  <p className="text-white/50 text-sm leading-relaxed mb-5">
                    {feature.description}
                  </p>

                  {/* 底部操作 */}
                  <div className="flex items-center justify-between pt-4 border-t border-white/5">
                    <div className="flex items-center text-white/60 group-hover:text-[#00D9A5] transition-colors">
                      <span className="text-sm font-medium">
                        {t("home.learnMore")}
                      </span>
                      <FiArrowRight className="w-4 h-4 ml-2 group-hover:translate-x-2 transition-transform" />
                    </div>
                    {/* 装饰性点 */}
                    <div className="flex gap-1">
                      <div
                        className={`w-1.5 h-1.5 rounded-full ${
                          index % 2 === 0 ? "bg-[#00D9A5]" : "bg-[#FFB800]"
                        }`}
                      />
                      <div className="w-1.5 h-1.5 rounded-full bg-white/20" />
                      <div className="w-1.5 h-1.5 rounded-full bg-white/10" />
                    </div>
                  </div>
                </div>
              </div>
            </motion.div>
          ))}
        </div>
      </section>

      {/* Token Distribution */}
      <section className="neon-card">
        <div className="neon-card-inner">
          <h2 className="text-2xl md:text-3xl font-bold mb-8 text-center text-white">
            {t("home.tokenDistribution")}
          </h2>

          <div className="grid md:grid-cols-6 gap-8">
            {[
              {
                percent: 40,
                label: t("home.miningRewardAlloc"),
                color: "cyan",
              },
              {
                percent: 20,
                label: t("home.tokenMiningAlloc"),
                color: "purple",
              },
              {
                percent: 15,
                label: t("home.teamAlloc"),
                color: "blue",
              },
              {
                percent: 10,
                label: t("home.marketingPromotion"),
                color: "orange",
              },
              {
                percent: 10,
                label: t("home.ecologicalFund"),
                color: "green",
              },
              {
                percent: 5,
                label: t("home.consultant"),
                color: "pink",
              },
            ].map((item, index) => (
              <motion.div
                key={item.label}
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ delay: 0.3 + index * 0.1 }}
                className="text-center group">
                {/* Circle Progress */}
                <div className="relative w-32 h-32 mx-auto mb-4">
                  <svg className="w-full h-full transform -rotate-90">
                    <circle
                      cx="64"
                      cy="64"
                      r="56"
                      stroke="rgba(255,255,255,0.1)"
                      strokeWidth="8"
                      fill="none"
                    />
                    <motion.circle
                      cx="64"
                      cy="64"
                      r="56"
                      stroke={`url(#gradient-${item.color})`}
                      strokeWidth="8"
                      fill="none"
                      strokeLinecap="round"
                      initial={{ strokeDasharray: "0 352" }}
                      animate={{
                        strokeDasharray: `${item.percent * 3.52} 352`,
                      }}
                      transition={{
                        duration: 1.5,
                        delay: 0.5 + index * 0.2,
                        ease: "easeOut",
                      }}
                    />
                    <defs>
                      <linearGradient
                        id={`gradient-${item.color}`}
                        x1="0%"
                        y1="0%"
                        x2="100%"
                        y2="0%">
                        <stop
                          offset="0%"
                          stopColor={
                            item.color === "cyan"
                              ? "#00D9A5"
                              : item.color === "purple"
                              ? "#A855F7"
                              : item.color === "blue"
                              ? "#3B82F6"
                              : item.color === "orange"
                              ? "#F97316"
                              : item.color === "green"
                              ? "#22C55E"
                              : item.color === "pink"
                              ? "#EC4899"
                              : "#94A3B8"
                          }
                        />
                        <stop
                          offset="100%"
                          stopColor={
                            item.color === "cyan"
                              ? "#00B88A"
                              : item.color === "purple"
                              ? "#7C3AED"
                              : item.color === "blue"
                              ? "#2563EB"
                              : item.color === "orange"
                              ? "#EA580C"
                              : item.color === "green"
                              ? "#16A34A"
                              : item.color === "pink"
                              ? "#DB2777"
                              : "#64748B"
                          }
                        />
                      </linearGradient>
                    </defs>
                  </svg>
                  <div className="absolute inset-0 flex items-center justify-center">
                    <span
                      className={`text-3xl font-bold ${
                        item.color === "cyan"
                          ? "text-[#00D9A5]"
                          : item.color === "purple"
                          ? "text-[#A855F7]"
                          : item.color === "blue"
                          ? "text-[#3B82F6]"
                          : item.color === "orange"
                          ? "text-[#F97316]"
                          : item.color === "green"
                          ? "text-[#22C55E]"
                          : item.color === "pink"
                          ? "text-[#EC4899]"
                          : "text-white/60"
                      }`}>
                      {item.percent}%
                    </span>
                  </div>
                </div>

                <h3 className="text-lg font-semibold text-white mb-1">
                  {item.label}
                </h3>
              </motion.div>
            ))}
          </div>
        </div>
      </section>
    </div>
  );
}
