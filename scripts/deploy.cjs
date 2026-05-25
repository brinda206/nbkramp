/**
 * scripts/deploy.cjs
 *
 * ⚠ Extension .cjs obligatoire — projet ESM + Hardhat
 *
 * Usage :
 *   npm run deploy:amoy
 *   npm run deploy:polygon
 *
 * Après déploiement, copier les adresses dans .env :
 *   CONTRACT_ADDRESS_AMOY=0x...
 *   VITE_CONTRACT_AMOY=0x...
 */

const TOKENS = {
  amoy: {
    usdc: '0x41E94Eb019C0762f9Bfcf9Fb1E58725BfB0e7582',
    usdt: '0x1616d425Cd540B256475cBfb604586C8598eC0FB',
  },
  polygon: {
    usdc: '0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174',
    usdt: '0xc2132D05D31c914a87C6611C10748AEb04B58e8F',
  },
  ethereum: {
    usdc: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
    usdt: '0xdAC17F958D2ee523a2206206994597C13D831ec7',
  },
};

async function main() {
  // hre = Hardhat Runtime Environment, injecté automatiquement par Hardhat
  const { ethers, network } = require('hardhat');

  const [deployer] = await ethers.getSigners();
  const net        = network.name;

  console.log(`\n🚀 Deploying RampEscrow to ${net}`);
  console.log(`   Deployer : ${deployer.address}`);

  const balance = await ethers.provider.getBalance(deployer.address);
  console.log(`   Balance  : ${ethers.formatEther(balance)} MATIC\n`);

  if (balance === 0n) {
    console.error('❌ Zero balance — get testnet MATIC at https://faucet.polygon.technology');
    process.exit(1);
  }

  const platformWallet = process.env.PLATFORM_WALLET;
  if (!platformWallet || platformWallet === '0xYourPlatformWalletAddress') {
    console.error('❌ Set PLATFORM_WALLET in .env before deploying');
    process.exit(1);
  }

  const tokens = TOKENS[net];
  if (!tokens) {
    console.error(`❌ No token addresses configured for network: ${net}`);
    console.error(`   Available: ${Object.keys(TOKENS).join(', ')}`);
    process.exit(1);
  }

  console.log(`   USDC           : ${tokens.usdc}`);
  console.log(`   USDT           : ${tokens.usdt}`);
  console.log(`   Platform wallet: ${platformWallet}\n`);

  const RampEscrow = await ethers.getContractFactory('RampEscrow');
  const escrow     = await RampEscrow.deploy(platformWallet, [tokens.usdc, tokens.usdt]);

  console.log('   Waiting for deployment...');
  await escrow.waitForDeployment();

  const address = await escrow.getAddress();
  console.log(`\n✅ RampEscrow deployed at: ${address}`);

  const envKey = net === 'amoy' ? 'AMOY' : net === 'polygon' ? 'POLYGON' : 'ETHEREUM';
  console.log(`\n─── Ajouter dans .env ──────────────────────────────`);
  console.log(`CONTRACT_ADDRESS_${envKey}=${address}`);
  console.log(`VITE_CONTRACT_${envKey}=${address}`);
  console.log(`────────────────────────────────────────────────────\n`);

  // Vérification Polygonscan (mainnet uniquement)
  if (process.env.POLYGONSCAN_API_KEY && net !== 'amoy') {
    console.log('Verifying on Polygonscan...');
    try {
      const hre = require('hardhat');
      await hre.run('verify:verify', {
        address,
        constructorArguments: [platformWallet, [tokens.usdc, tokens.usdt]],
      });
      console.log('✅ Contract verified');
    } catch (e) {
      console.warn('⚠  Verification failed:', e.message);
    }
  }
}

main().catch(err => {
  console.error('\n❌ Deploy failed:', err);
  process.exit(1);
});
