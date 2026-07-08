import { useState, useEffect, useCallback, useMemo } from 'react';
import { ethers } from 'ethers';
import { CURRENT_NETWORK, EXPECTED_CHAIN_ID } from '../utils/constants';

// 创建默认的只读 Provider（用于未连接钱包时读取链上数据）
// 依次尝试多个 RPC，直到有一个成功，避免单个节点被墙导致全站不可用
const createDefaultProvider = async () => {
  const rpcUrls = CURRENT_NETWORK.rpcUrls;
  const errors = [];
  for (const url of rpcUrls) {
    try {
      const provider = new ethers.JsonRpcProvider(url);
      // 用 getNetwork 做快速连通性测试
      await provider.getNetwork();
      return provider;
    } catch (err) {
      errors.push(`${url}: ${err?.message || err}`);
    }
  }
  console.error('All RPC nodes failed:', errors);
  // 兜底：返回第一个，让上层有对象可用，但后续调用会继续失败并给出提示
  return new ethers.JsonRpcProvider(rpcUrls[0]);
};

const parseChainId = (value) => {
  if (typeof value === 'number') return value;
  if (typeof value === 'bigint') return Number(value);
  if (typeof value !== 'string') return null;
  return value.toLowerCase().startsWith('0x')
    ? parseInt(value, 16)
    : parseInt(value, 10);
};

const getInjectedProvider = () => {
  if (typeof window === 'undefined' || typeof window.ethereum === 'undefined') return null;
  const { ethereum } = window;

  if (Array.isArray(ethereum.providers)) {
    return ethereum.providers.find((provider) => provider.isMetaMask) || ethereum.providers[0];
  }

  return ethereum;
};

export function useWallet() {
  const [account, setAccount] = useState(null);
  const [chainId, setChainId] = useState(null);
  const [walletProvider, setWalletProvider] = useState(null);
  const [signer, setSigner] = useState(null);
  const [isConnecting, setIsConnecting] = useState(false);
  const [error, setError] = useState(null);

  const [defaultProvider, setDefaultProvider] = useState(null);
  const [providerError, setProviderError] = useState(null);

  // 初始化默认只读 Provider，带错误提示
  useEffect(() => {
    let cancelled = false;
    createDefaultProvider()
      .then((p) => {
        if (!cancelled) {
          setDefaultProvider(p);
          setProviderError(null);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          console.error('Failed to initialize default provider:', err);
          setProviderError('无法连接到 BSC 节点，请检查网络或开启 VPN');
        }
      });
    return () => { cancelled = true; };
  }, []);

  // Read calls should always use the configured target network.
  const provider = defaultProvider;

  // 断开连接
  const disconnect = useCallback(() => {
    setAccount(null);
    setChainId(null);
    setWalletProvider(null);
    setSigner(null);
  }, []);

  const refreshWalletState = useCallback(async () => {
    const injectedProvider = getInjectedProvider();
    if (!injectedProvider) return;

    const [accounts, currentChainId] = await Promise.all([
      injectedProvider.request({ method: 'eth_accounts' }),
      injectedProvider.request({ method: 'eth_chainId' }),
    ]);

    setChainId(parseChainId(currentChainId));

    if (accounts.length > 0) {
      const browserProvider = new ethers.BrowserProvider(injectedProvider);
      const walletSigner = await browserProvider.getSigner();

      setAccount(accounts[0]);
      setWalletProvider(browserProvider);
      setSigner(walletSigner);
    } else {
      disconnect();
    }
  }, [disconnect]);

  const isCorrectNetwork = !account || chainId === EXPECTED_CHAIN_ID;

  // 检查钱包是否已连接
  const checkConnection = useCallback(async () => {
    if (!getInjectedProvider()) return;

    try {
      await refreshWalletState();
    } catch (err) {
      console.error('Check connection error:', err);
    }
  }, [refreshWalletState]);

  // 连接钱包
  const connect = useCallback(async () => {
    const injectedProvider = getInjectedProvider();
    if (!injectedProvider) {
      setError('请安装 MetaMask 钱包');
      return;
    }

    setIsConnecting(true);
    setError(null);

    try {
      const accounts = await injectedProvider.request({
        method: 'eth_requestAccounts',
      });

      const browserProvider = new ethers.BrowserProvider(injectedProvider);
      const walletSigner = await browserProvider.getSigner();
      const currentChainId = await injectedProvider.request({ method: 'eth_chainId' });

      setAccount(accounts[0]);
      setChainId(parseChainId(currentChainId));
      setWalletProvider(browserProvider);
      setSigner(walletSigner);
    } catch (err) {
      if (err?.code === -32002) {
        setError('MetaMask 已有连接请求，请打开钱包确认');
      } else if (err?.code === 4001) {
        setError('您取消了钱包连接');
      } else {
        setError(err?.message || '连接钱包失败');
      }
    } finally {
      setIsConnecting(false);
    }
  }, []);

  // 切换网络
  const switchNetwork = useCallback(async () => {
    const injectedProvider = getInjectedProvider();
    if (!injectedProvider) {
      setError('请安装 MetaMask 钱包');
      return;
    }

    try {
      await injectedProvider.request({
        method: 'wallet_switchEthereumChain',
        params: [{ chainId: CURRENT_NETWORK.chainId }],
      });
      await refreshWalletState();
    } catch (switchError) {
      // 如果网络不存在，添加网络
      if (switchError.code === 4902) {
        try {
          await injectedProvider.request({
            method: 'wallet_addEthereumChain',
            params: [CURRENT_NETWORK],
          });
          await refreshWalletState();
        } catch (addError) {
          setError('添加网络失败');
        }
      } else {
        setError('切换网络失败');
      }
    }
  }, [refreshWalletState]);

  // 监听账户和网络变化
  useEffect(() => {
    const injectedProvider = getInjectedProvider();
    if (!injectedProvider) return;

    const handleAccountsChanged = () => {
      refreshWalletState().catch((err) => console.error('Refresh wallet after account change error:', err));
    };

    const handleChainChanged = (chainId) => {
      setChainId(parseChainId(chainId));
      refreshWalletState().catch((err) => console.error('Refresh wallet after chain change error:', err));
    };

    const handleFocus = () => {
      refreshWalletState().catch((err) => console.error('Refresh wallet on focus error:', err));
    };

    injectedProvider.on?.('accountsChanged', handleAccountsChanged);
    injectedProvider.on?.('chainChanged', handleChainChanged);
    window.addEventListener('focus', handleFocus);

    checkConnection();

    return () => {
      injectedProvider.removeListener?.('accountsChanged', handleAccountsChanged);
      injectedProvider.removeListener?.('chainChanged', handleChainChanged);
      window.removeEventListener('focus', handleFocus);
    };
  }, [checkConnection, refreshWalletState]);

  return {
    account,
    chainId,
    provider,
    walletProvider,
    signer,
    isConnecting,
    isConnected: !!account,
    isCorrectNetwork,
    error: error || providerError,
    connect,
    disconnect,
    switchNetwork,
  };
}
