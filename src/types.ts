export type Currency = 'USDC' | 'USDT' | 'USD' | 'FCFA';
// ⚠ Amoy remplace Mumbai depuis mars 2024 (Mumbai déprécié par Polygon)
export type Network  = 'polygon' | 'ethereum' | 'amoy';
// ⚠ 'swap' est désactivé dans l'UI — le backend ne le supporte pas encore
export type TxType   = 'on-ramp' | 'off-ramp' | 'swap';
export type TxStatus = 'pending' | 'processing' | 'completing' | 'completed' | 'failed' | 'expired';

export interface Transaction {
  id:            string;
  reference:     string;
  type:          TxType;
  from_currency: Currency;
  to_currency:   Currency;
  from_amount:   number;
  to_amount:     number;
  rate:          number;
  status:        TxStatus;
  network?:      Network | null;
  tx_hash?:      string | null;
  created_at:    string;
  updated_at:    string;
}

export interface Rates {
  USDC_FCFA: number;
  USDT_FCFA: number;
  USD_FCFA:  number;
  USD_USDC:  number;
  USD_USDT:  number;
  USDC_USD:  number;
  USDT_USD:  number;
  FCFA_USDC: number;
  FCFA_USDT: number;
  FCFA_USD:  number;
  [key: string]: number;
}

export interface NetworkConfig {
  name:    Network;
  label:   string;
  chainId: number;
  rpcUrl:  string;
  usdc:    string;
  usdt:    string;
}

export const NETWORKS: Record<Network, NetworkConfig> = {
  polygon: {
    name:    'polygon',
    label:   'Polygon',
    chainId: 137,
    rpcUrl:  `https://polygon-mainnet.infura.io/v3/${import.meta.env.VITE_INFURA_PROJECT_ID}`,
    usdc:    '0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174',
    usdt:    '0xc2132D05D31c914a87C6611C10748AEb04B58e8F',
  },
  ethereum: {
    name:    'ethereum',
    label:   'Ethereum',
    chainId: 1,
    rpcUrl:  `https://mainnet.infura.io/v3/${import.meta.env.VITE_INFURA_PROJECT_ID}`,
    usdc:    '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
    usdt:    '0xdAC17F958D2ee523a2206206994597C13D831ec7',
  },
  // ⚠ Amoy (80002) remplace Mumbai (80001) — faucet : https://faucet.polygon.technology
  amoy: {
    name:    'amoy',
    label:   'Amoy (testnet)',
    chainId: 80002,
    rpcUrl:  `https://polygon-amoy.infura.io/v3/${import.meta.env.VITE_INFURA_PROJECT_ID}`,
    usdc:    '0x41E94Eb019C0762f9Bfcf9Fb1E58725BfB0e7582',
    usdt:    '0x1616d425Cd540B256475cBfb604586C8598eC0FB',
  },
};

// Adresses du contrat RampEscrow par réseau (depuis .env)
export const CONTRACT_ADDRESSES: Record<Network, string> = {
  polygon:  import.meta.env.VITE_CONTRACT_POLYGON  ?? '',
  ethereum: import.meta.env.VITE_CONTRACT_ETHEREUM ?? '',
  amoy:     import.meta.env.VITE_CONTRACT_AMOY     ?? '',
};
