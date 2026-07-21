const fs = require('fs');
const path = require('path');
const { ethers } = require('ethers');

const DEFAULT_STAKING_BANK = '0x903fcce5d67648FBE6Dccc9806e3bd7D303380fD';
const DEFAULT_SALE_TOKEN = '0x2922933e6B4a58530634BAEcF983Dd8ac34d4444';
const DEFAULT_PAYMENT_TOKEN = '0x55d398326f99059fF775485246999027B3197955';
const DEFAULT_RPC_URLS = [
  'https://bsc.publicnode.com',
  'https://bsc-dataseed.binance.org/',
  'https://bsc-dataseed1.binance.org/',
  'https://bsc-dataseed2.binance.org/',
  'https://bsc.blockpi.network/v1/rpc/public',
  'https://rpc.ankr.com/bsc',
];

const STAKING_ABI = [
  'function saleToken() view returns (address)',
  'function paymentToken() view returns (address)',
  'function tokenPrice() view returns (uint256)',
  'function totalSold() view returns (uint256)',
  'function totalUSDTReceived() view returns (uint256)',
  'function totalRewardsDistributed() view returns (uint256)',
  'function totalInterestClaimed() view returns (uint256)',
  'function dailyInterestRateBps() view returns (uint256)',
  'function paused() view returns (bool)',
  'function owner() view returns (address)',
  'function pendingOwner() view returns (address)',
  'function teamWallet() view returns (address)',
  'function getSaleStatus() view returns (uint256 _totalSold, uint256 _totalUSDTReceived, uint256 _totalRewardsDistributed, uint256 _tokenPrice, bool _paused)',
  'function getUserInfo(address user) view returns (address referrer, uint256 purchased, uint256 directReward, uint256 indirectReward, uint256 teamReward, uint256 claimed, uint256 referralCount)',
  'function getReferralsPaginated(address user, uint256 offset, uint256 limit) view returns (address[] result, uint256 total)',
  'function pendingRewards(address user) view returns (uint256)',
  'function pendingInterest(address user) view returns (uint256)',
];

const ERC20_ABI = [
  'function balanceOf(address) view returns (uint256)',
  'function decimals() view returns (uint8)',
  'function symbol() view returns (string)',
];

const ZERO = '0x0000000000000000000000000000000000000000';
const PUBLIC_CACHE_MS = Number(process.env.STAKING_PUBLIC_CACHE_MS || 15000);
const USER_CACHE_MS = Number(process.env.STAKING_USER_CACHE_MS || 8000);

const cacheStore = globalThis.__czStakingCache || {
  snapshots: new Map(),
};
globalThis.__czStakingCache = cacheStore;

const CACHE_DIR = process.env.STAKING_CACHE_DIR || process.env.CACHE_DIR || '';
const FILE_CACHE_MAX_AGE_MS = Number(process.env.STAKING_FILE_CACHE_MAX_AGE_MS || 24 * 60 * 60 * 1000);

const cacheFilePath = (key) => {
  if (!CACHE_DIR) return '';
  const name = Buffer.from(key).toString('base64url');
  return path.join(CACHE_DIR, `${name}.json`);
};

const readFileCache = (key) => {
  const filePath = cacheFilePath(key);
  if (!filePath) return null;
  try {
    if (!fs.existsSync(filePath)) return null;
    const cached = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    if (!cached?.timestamp || !cached?.data) return null;
    if (Date.now() - cached.timestamp > FILE_CACHE_MAX_AGE_MS) return null;
    return cached;
  } catch (error) {
    console.warn('read staking file cache failed:', error?.message || error);
    return null;
  }
};

const writeFileCache = (key, cached) => {
  const filePath = cacheFilePath(key);
  if (!filePath) return;
  try {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, `${JSON.stringify(cached)}\n`);
  } catch (error) {
    console.warn('write staking file cache failed:', error?.message || error);
  }
};

const rpcUrls = () => {
  const configured = process.env.BSC_RPC_URLS || process.env.RPC_URLS || '';
  const urls = configured
    ? configured.split(',').map((url) => url.trim()).filter(Boolean)
    : DEFAULT_RPC_URLS;
  return [...new Set(urls)];
};

const stakingBankAddress = () =>
  process.env.STAKING_BANK || process.env.VITE_STAKING_BANK || DEFAULT_STAKING_BANK;

const valueAt = (value, key, index, fallback = undefined) => {
  if (!value) return fallback;
  return value[key] ?? value[index] ?? fallback;
};

const toNumber = (value, fallback = 0) => {
  if (value === undefined || value === null) return fallback;
  return Number(value);
};

const toEther = (value, fallback = '0') => {
  if (value === undefined || value === null) return fallback;
  return ethers.formatEther(value);
};

const userInfoView = (userInfo, pendingRewards, pendingInterest) => {
  if (!userInfo) return null;
  return {
    referrer: valueAt(userInfo, 'referrer', 0, ZERO),
    purchased: toEther(valueAt(userInfo, 'purchased', 1)),
    directReward: toEther(valueAt(userInfo, 'directReward', 2)),
    indirectReward: toEther(valueAt(userInfo, 'indirectReward', 3)),
    teamReward: toEther(valueAt(userInfo, 'teamReward', 4)),
    claimed: toEther(valueAt(userInfo, 'claimed', 5)),
    referralCount: toNumber(valueAt(userInfo, 'referralCount', 6)),
    pendingRewards: toEther(pendingRewards),
    pendingInterest: toEther(pendingInterest),
  };
};

const readWithProvider = async (provider, account, rpcUrl) => {
  const contract = new ethers.Contract(stakingBankAddress(), STAKING_ABI, provider);

  const [
    saleStatus,
    isPaused,
    saleTokenAddress,
    paymentTokenAddress,
    tokenPrice,
    owner,
    pendingOwner,
    teamWallet,
    dailyInterestRateBps,
    saleTokenBalance,
  ] = await Promise.all([
    contract.getSaleStatus(),
    contract.paused().catch(() => false),
    contract.saleToken().catch(() => DEFAULT_SALE_TOKEN),
    contract.paymentToken().catch(() => DEFAULT_PAYMENT_TOKEN),
    contract.tokenPrice().catch(() => ethers.parseEther('1')),
    contract.owner().catch(() => ZERO),
    contract.pendingOwner().catch(() => ZERO),
    contract.teamWallet().catch(() => ZERO),
    contract.dailyInterestRateBps().catch(() => 100n),
    (async () => {
      const addr = await contract.saleToken().catch(() => DEFAULT_SALE_TOKEN);
      const token = new ethers.Contract(addr, ERC20_ABI, provider);
      return token.balanceOf(stakingBankAddress()).catch(() => 0n);
    })(),
  ]);

  let userInfo = null;
  let referrals = [];
  let referralsTotal = 0;

  if (account) {
    const [userInfoRaw, pendingRewardsRaw, pendingInterestRaw, referralsRaw] = await Promise.all([
      contract.getUserInfo(account).catch(() => null),
      contract.pendingRewards(account).catch(() => 0n),
      contract.pendingInterest(account).catch(() => 0n),
      contract.getReferralsPaginated(account, 0, 10).catch(() => null),
    ]);

    userInfo = userInfoView(userInfoRaw, pendingRewardsRaw, pendingInterestRaw);
    if (referralsRaw) {
      referrals = Array.from(valueAt(referralsRaw, 'result', 0, []));
      referralsTotal = toNumber(valueAt(referralsRaw, 'total', 1));
    }
  }

  return {
    userInfo,
    referrals,
    referralsTotal,
    saleStatus: {
      totalSold: toEther(valueAt(saleStatus, '_totalSold', 0)),
      totalUSDTReceived: toEther(valueAt(saleStatus, '_totalUSDTReceived', 1)),
      totalRewardsDistributed: toEther(valueAt(saleStatus, '_totalRewardsDistributed', 2)),
      tokenPrice: toEther(valueAt(saleStatus, '_tokenPrice', 3)),
      paused: Boolean(valueAt(saleStatus, '_paused', 4)),
    },
    saleTokenAddress,
    paymentTokenAddress,
    tokenPrice: toEther(tokenPrice),
    owner,
    pendingOwner,
    teamWallet,
    isPaused: Boolean(isPaused),
    interestInfo: {
      rateBps: Number(dailyInterestRateBps ?? 100n),
      poolBalance: toEther(saleTokenBalance),
    },
    cache: {
      source: 'live',
      rpcUrl,
      generatedAt: Date.now(),
      stale: false,
    },
  };
};

const readSnapshot = async (account) => {
  let lastError = null;
  for (const url of rpcUrls()) {
    try {
      const provider = new ethers.JsonRpcProvider(url, 56, { staticNetwork: true });
      return await readWithProvider(provider, account, url);
    } catch (error) {
      lastError = error;
      console.warn(`staking api rpc failed: ${url}`, error?.shortMessage || error?.message || error);
    }
  }
  throw lastError || new Error('All BSC RPC nodes failed');
};

const getCachedSnapshot = async (account, refresh) => {
  const key = account ? `user:${account.toLowerCase()}` : 'public';
  const ttl = account ? USER_CACHE_MS : PUBLIC_CACHE_MS;
  const now = Date.now();
  let cached = cacheStore.snapshots.get(key);
  if (!cached) {
    cached = readFileCache(key);
    if (cached) cacheStore.snapshots.set(key, cached);
  }

  if (!refresh && cached && now - cached.timestamp <= ttl) {
    return {
      ...cached.data,
      cache: {
        ...cached.data.cache,
        source: 'memory-cache',
        ageMs: now - cached.timestamp,
        stale: false,
      },
    };
  }

  try {
    const data = await readSnapshot(account);
    const nextCache = { timestamp: Date.now(), data };
    cacheStore.snapshots.set(key, nextCache);
    writeFileCache(key, nextCache);
    return data;
  } catch (error) {
    if (cached) {
      return {
        ...cached.data,
        cache: {
          ...cached.data.cache,
          source: 'stale-memory-cache',
          ageMs: now - cached.timestamp,
          stale: true,
          error: error?.shortMessage || error?.message || 'RPC read failed',
        },
      };
    }
    throw error;
  }
};

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }

  if (req.method !== 'GET') {
    res.status(405).json({ ok: false, error: 'Method not allowed' });
    return;
  }

  const accountInput = req.query?.account || '';
  const account = accountInput && ethers.isAddress(accountInput) ? ethers.getAddress(accountInput) : '';
  const refresh = req.query?.refresh === '1' || req.query?.refresh === 'true';

  try {
    const data = await getCachedSnapshot(account, refresh);
    res.setHeader('Cache-Control', 'no-store');
    res.status(200).json({ ok: true, data });
  } catch (error) {
    res.status(502).json({
      ok: false,
      error: 'Unable to read staking data',
      message: error?.shortMessage || error?.message || String(error),
    });
  }
};
