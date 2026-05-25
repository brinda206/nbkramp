/**
 * server/lib/onramp.ts
 *
 * Livraison des tokens USDC/USDT à l'utilisateur lors d'un on-ramp réussi.
 * Le PLATFORM_WALLET doit avoir suffisamment de tokens pour couvrir les livraisons.
 */
import { ethers } from 'ethers';

// ⚠ Amoy remplace Mumbai depuis mars 2024
export type Network = 'polygon' | 'ethereum' | 'amoy';
export type Stable  = 'USDC' | 'USDT';

const INFURA_PROJECT_ID          = process.env.INFURA_PROJECT_ID;
const PLATFORM_WALLET            = process.env.PLATFORM_WALLET;
const PLATFORM_WALLET_PRIVATE_KEY = process.env.PLATFORM_WALLET_PRIVATE_KEY;

const ERC20_ABI = [
  'function decimals() view returns (uint8)',
  'function transfer(address to, uint256 amount) returns (bool)',
  'function balanceOf(address account) view returns (uint256)',
];

function getRpcUrl(network: Network): string {
  if (!INFURA_PROJECT_ID) throw new Error('Missing INFURA_PROJECT_ID');
  switch (network) {
    case 'polygon':
      return `https://polygon-mainnet.infura.io/v3/${INFURA_PROJECT_ID}`;
    case 'amoy':
      return `https://polygon-amoy.infura.io/v3/${INFURA_PROJECT_ID}`;
    case 'ethereum':
      return `https://mainnet.infura.io/v3/${INFURA_PROJECT_ID}`;
    default:
      throw new Error(`Unsupported network: ${network}`);
  }
}

function getStableTokenAddress(network: Network, stable: Stable): string {
  // Les variables d'env suivent le pattern USDC_POLYGON, USDT_AMOY, etc.
  const suffix = network === 'polygon' ? 'POLYGON' : network === 'ethereum' ? 'ETHEREUM' : 'AMOY';
  const key    = `${stable}_${suffix}` as const;
  return process.env[key] ?? '';
}

export async function deliverOnRampTokens(params: {
  reference:   string;
  network:     Network;
  stable:      Stable;
  amountHuman: number;
  destination: string; // adresse wallet de l'utilisateur
}): Promise<string> {
  const { network, stable, amountHuman, destination, reference } = params;

  if (!PLATFORM_WALLET_PRIVATE_KEY) {
    throw new Error('Missing PLATFORM_WALLET_PRIVATE_KEY — ajoutez-la dans .env');
  }
  if (!PLATFORM_WALLET) {
    throw new Error('Missing PLATFORM_WALLET');
  }

  const tokenAddress = getStableTokenAddress(network, stable);
  if (!tokenAddress || tokenAddress === '0x0000000000000000000000000000000000000000') {
    throw new Error(`Stable token address not configured for ${stable} on ${network}`);
  }

  const provider = new ethers.JsonRpcProvider(getRpcUrl(network));
  const signer   = new ethers.Wallet(PLATFORM_WALLET_PRIVATE_KEY, provider);

  const token    = new ethers.Contract(tokenAddress, ERC20_ABI, signer);
  const decimals: number = await token.decimals();

  // Vérifier que le platform wallet a assez de tokens
  const balance = await token.balanceOf(PLATFORM_WALLET);
  const amount  = ethers.parseUnits(Number(amountHuman).toFixed(decimals), decimals);

  if (balance < amount) {
    throw new Error(
      `Platform wallet insuffisant pour livrer ${amountHuman} ${stable} sur ${network}. ` +
      `Solde : ${ethers.formatUnits(balance, decimals)} ${stable}`
    );
  }

  const tx      = await token.transfer(destination, amount);
  const receipt = await tx.wait();

  console.log(`[onramp] Delivered ${amountHuman} ${stable} to ${destination} (${reference}) → ${receipt.hash}`);
  return receipt.hash;
}
