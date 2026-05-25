// hardhat.config.cjs
// Extension .cjs obligatoire quand package.json a "type": "module"

require('@nomicfoundation/hardhat-toolbox');
require('dotenv/config');

const DEPLOYER_PRIVATE_KEY = process.env.DEPLOYER_PRIVATE_KEY ?? '';
if (!DEPLOYER_PRIVATE_KEY) {
  console.warn('[hardhat] DEPLOYER_PRIVATE_KEY not set — deploy commands will fail');
}

const INFURA_ID = process.env.INFURA_PROJECT_ID ?? '';

/** @type {import('hardhat/config').HardhatUserConfig} */
const config = {
  solidity: {
    version: '0.8.20',
    settings: { optimizer: { enabled: true, runs: 200 } },
  },

  paths: {
    // On pointe vers contracts/src/ qui ne contiendra QUE les vrais contrats
    // Les fichiers .t.sol (Foundry) restent dans contracts/ mais sont ignorés
    // car on change le dossier source vers contracts/src
    sources:   './contracts/src',
    tests:     './test',
    cache:     './cache',
    artifacts: './artifacts',
  },

  networks: {
    hardhat:   { chainId: 31337 },
    localhost: { url: 'http://127.0.0.1:8545' },
    amoy: {
      url:      `https://polygon-amoy.infura.io/v3/${INFURA_ID}`,
      accounts: DEPLOYER_PRIVATE_KEY ? [DEPLOYER_PRIVATE_KEY] : [],
      chainId:  80002,
      gasPrice: 'auto',
    },
    polygon: {
      url:      `https://polygon-mainnet.infura.io/v3/${INFURA_ID}`,
      accounts: DEPLOYER_PRIVATE_KEY ? [DEPLOYER_PRIVATE_KEY] : [],
      chainId:  137,
      gasPrice: 'auto',
    },
    ethereum: {
      url:      `https://mainnet.infura.io/v3/${INFURA_ID}`,
      accounts: DEPLOYER_PRIVATE_KEY ? [DEPLOYER_PRIVATE_KEY] : [],
      chainId:  1,
      gasPrice: 'auto',
    },
  },

  etherscan: {
    apiKey: {
      polygon:     process.env.POLYGONSCAN_API_KEY ?? '',
      polygonAmoy: process.env.POLYGONSCAN_API_KEY ?? '',
    },
  },
};

module.exports = config;
