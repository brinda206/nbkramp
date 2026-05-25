/**
 * Blockchain service — uses Infura as RPC provider.
 * Wallet interaction via MetaMask (window.ethereum).
 */
import { ethers } from 'ethers';
import type { Network, NetworkConfig } from '../types';
import { NETWORKS, CONTRACT_ADDRESSES } from '../types';

// Minimal ERC-20 ABI (approve + balanceOf)
const ERC20_ABI = [
  'function approve(address spender, uint256 amount) returns (bool)',
  'function allowance(address owner, address spender) view returns (uint256)',
  'function balanceOf(address account) view returns (uint256)',
  'function decimals() view returns (uint8)',
];

// RampEscrow ABI (functions used by frontend)
const ESCROW_ABI = [
  'function deposit(bytes32 txId, uint256 amount, address token) external',
  'function claimExpired(bytes32 txId) external',
  'function getTransaction(bytes32 txId) view returns (tuple(address user, uint256 amount, address token, uint256 createdAt, bool isCompleted, bool isCancelled))',
  'function isExpired(bytes32 txId) view returns (bool)',
  'event Deposited(bytes32 indexed txId, address indexed user, uint256 amount, address token)',
  'event Completed(bytes32 indexed txId, address indexed platformWallet, uint256 amount)',
  'event Cancelled(bytes32 indexed txId, address indexed user, uint256 amount)',
  'event ExpiredClaimed(bytes32 indexed txId, address indexed user, uint256 amount)',
];

class BlockchainService {
  private walletProvider: ethers.BrowserProvider | null = null;
  private infuraProvider: ethers.JsonRpcProvider | null = null;
  private signer: ethers.Signer | null = null;
  private currentNetwork: NetworkConfig | null = null;

  // ─── Connect wallet ────────────────────────────────────────────────────────
  async connect(network: Network): Promise<string> {
    const netConfig = NETWORKS[network];
    if (!window.ethereum) throw new Error('MetaMask not detected. Please install MetaMask.');

    this.walletProvider = new ethers.BrowserProvider(window.ethereum);

    // Request account access
    await this.walletProvider.send('eth_requestAccounts', []);

    // Switch to the correct network
    try {
      await this.walletProvider.send('wallet_switchEthereumChain', [
        { chainId: `0x${netConfig.chainId.toString(16)}` },
      ]);
    } catch (switchError: any) {
      // Chain not added to MetaMask — add it
      if (switchError.code === 4902) {
        await this.walletProvider.send('wallet_addEthereumChain', [{
          chainId:  `0x${netConfig.chainId.toString(16)}`,
          chainName: netConfig.label,
          rpcUrls: [netConfig.rpcUrl],
        }]);
      } else {
        throw switchError;
      }
    }

    this.signer         = await this.walletProvider.getSigner();
    this.currentNetwork = netConfig;

    // Also create an Infura read-only provider for off-chain reads
    this.infuraProvider = new ethers.JsonRpcProvider(netConfig.rpcUrl);

    return await this.signer.getAddress();
  }

  getAddress(): Promise<string> {
    if (!this.signer) throw new Error('Wallet not connected');
    return this.signer.getAddress();
  }

  disconnect() {
    this.signer         = null;
    this.walletProvider = null;
    this.currentNetwork = null;
  }

  // ─── Token helpers ────────────────────────────────────────────────────────
  async getTokenBalance(tokenAddress: string, walletAddress: string): Promise<string> {
    const provider = this.infuraProvider ?? this.walletProvider;
    if (!provider) throw new Error('No provider');
    const token   = new ethers.Contract(tokenAddress, ERC20_ABI, provider);
    const [balance, decimals] = await Promise.all([
      token.balanceOf(walletAddress),
      token.decimals(),
    ]);
    return ethers.formatUnits(balance, decimals);
  }

  // ─── Deposit into escrow (off-ramp: user locks crypto) ───────────────────
  async depositToEscrow(
    lumaReference: string,
    amountHuman: string,
    tokenAddress: string,
    network: Network
  ): Promise<string> {
    if (!this.signer || !this.currentNetwork) throw new Error('Connect wallet first');

    const contractAddress = CONTRACT_ADDRESSES[network];
    if (!contractAddress || contractAddress === '0x0000000000000000000000000000000000000000') {
      throw new Error(`Escrow contract not deployed on ${network} yet`);
    }

    const tokenContract  = new ethers.Contract(tokenAddress, ERC20_ABI, this.signer);
    const escrowContract = new ethers.Contract(contractAddress, ESCROW_ABI, this.signer);

    // Get decimals (USDC = 6, USDT = 6 on Polygon, 18 on Ethereum mainnet)
    const decimals = await tokenContract.decimals();
    const amount   = ethers.parseUnits(amountHuman, decimals);

    // txId = keccak256 of the Luma reference
    const txId = ethers.id(lumaReference);

    // Step 1: Approve escrow to spend tokens
    const allowance = await tokenContract.allowance(await this.signer.getAddress(), contractAddress);
    if (allowance < amount) {
      const approveTx = await tokenContract.approve(contractAddress, amount);
      await approveTx.wait();
    }

    // Step 2: Deposit into escrow
    const depositTx = await escrowContract.deposit(txId, amount, tokenAddress);
    const receipt   = await depositTx.wait();

    return receipt.hash;
  }

  // ─── Claim expired (user self-refunds after 24h) ──────────────────────────
  async claimExpired(lumaReference: string, network: Network): Promise<string> {
    if (!this.signer) throw new Error('Connect wallet first');
    const contractAddress = CONTRACT_ADDRESSES[network];
    const escrow = new ethers.Contract(contractAddress, ESCROW_ABI, this.signer);
    const txId   = ethers.id(lumaReference);
    const tx     = await escrow.claimExpired(txId);
    const receipt = await tx.wait();
    return receipt.hash;
  }

  // ─── Read escrow state (read-only via Infura) ─────────────────────────────
  async getEscrowTx(lumaReference: string, network: Network) {
    const provider = this.infuraProvider ?? new ethers.JsonRpcProvider(NETWORKS[network].rpcUrl);
    const contractAddress = CONTRACT_ADDRESSES[network];
    const escrow = new ethers.Contract(contractAddress, ESCROW_ABI, provider);
    const txId   = ethers.id(lumaReference);
    return escrow.getTransaction(txId);
  }

  isConnected(): boolean {
    return this.signer !== null;
  }

  currentNetworkName(): Network | null {
    return this.currentNetwork?.name ?? null;
  }
}

export const blockchainService = new BlockchainService();

// Extend window type
declare global {
  interface Window {
    ethereum?: any;
  }
}
