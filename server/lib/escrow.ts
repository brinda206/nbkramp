/**
 * server/lib/escrow.ts
 *
 * Interactions on-chain avec le contrat RampEscrow.
 * Appelé par le webhook OwlPay pour libérer ou rembourser les tokens.
 */
import { ethers } from 'ethers';

// ⚠ Amoy remplace Mumbai depuis mars 2024
export type Network = 'polygon' | 'ethereum' | 'amoy';

const INFURA_PROJECT_ID    = process.env.INFURA_PROJECT_ID;
const DEPLOYER_PRIVATE_KEY = process.env.DEPLOYER_PRIVATE_KEY;

const ESCROW_ABI = [
  'function completeTransaction(bytes32 txId) external',
  'function cancelTransaction(bytes32 txId) external',
  'function getTransaction(bytes32 txId) view returns (tuple(address user, uint256 amount, address token, uint256 createdAt, bool isCompleted, bool isCancelled))',
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

function getEscrowAddress(network: Network): string {
  if (network === 'polygon')  return process.env.CONTRACT_ADDRESS_POLYGON  ?? '';
  if (network === 'ethereum') return process.env.CONTRACT_ADDRESS_ETHEREUM ?? '';
  if (network === 'amoy')     return process.env.CONTRACT_ADDRESS_AMOY     ?? '';
  throw new Error(`Unknown network: ${network}`);
}

/**
 * Vérifie sur la chaîne si la transaction est déjà dans un état terminal.
 * Évite de rejouer une action si le webhook arrive en double.
 */
async function isAlreadySettled(
  escrow: ethers.Contract,
  txId: string
): Promise<boolean> {
  try {
    const stored = await escrow.getTransaction(txId);
    return stored.isCompleted || stored.isCancelled;
  } catch {
    return false;
  }
}

async function callEscrowAction(params: {
  reference: string;
  network:   Network;
  action:    'complete' | 'cancel';
}): Promise<string> {
  const { reference, network, action } = params;

  if (!DEPLOYER_PRIVATE_KEY) throw new Error('Missing DEPLOYER_PRIVATE_KEY');

  const escrowAddress = getEscrowAddress(network);
  if (!escrowAddress || escrowAddress === '0x0000000000000000000000000000000000000000') {
    throw new Error(`Escrow contract not configured for ${network}`);
  }

  const provider = new ethers.JsonRpcProvider(getRpcUrl(network));
  const signer   = new ethers.Wallet(DEPLOYER_PRIVATE_KEY, provider);
  const escrow   = new ethers.Contract(escrowAddress, ESCROW_ABI, signer);

  // txId = keccak256(reference) — doit correspondre exactement au frontend
  const txId = ethers.id(reference);

  // Guard anti-replay : vérifier l'état on-chain avant d'agir
  const settled = await isAlreadySettled(escrow, txId);
  if (settled) {
    console.warn(`[escrow] ${reference} already settled on-chain — skipping ${action}`);
    return '0x' + '0'.repeat(64); // hash factice, pas de TX envoyée
  }

  const tx =
    action === 'complete'
      ? await escrow.completeTransaction(txId)
      : await escrow.cancelTransaction(txId);

  const receipt = await tx.wait();
  console.log(`[escrow] ${action} ${reference} → ${receipt.hash}`);
  return receipt.hash;
}

export async function releaseOffRampTokens(reference: string, network: Network): Promise<string> {
  return callEscrowAction({ reference, network, action: 'complete' });
}

export async function refundOffRampTokens(reference: string, network: Network): Promise<string> {
  return callEscrowAction({ reference, network, action: 'cancel' });
}
