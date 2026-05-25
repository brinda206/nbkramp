# Luma Ramp v2

Infrastructure on/off-ramp **USD · USDC · USDT ↔ FCFA** sans compte utilisateur.

Fonds sécurisés par smart contract escrow sur Polygon / Ethereum / Mumbai.

---

## Stack

| Couche        | Technologie                                  |
|---------------|----------------------------------------------|
| Frontend      | React 19 + TypeScript + Vite 6               |
| Styles        | Tailwind v4 (dark theme)                     |
| Animations    | Motion (Framer)                              |
| Backend       | Express + Socket.io                          |
| Base de données | Supabase (PostgreSQL)                      |
| Auth          | Aucune — identité par téléphone (hashé SHA-256) + wallet |
| Blockchain    | Ethers.js v6 + Infura RPC + MetaMask         |
| Smart contract | Solidity ^0.8.20 + OpenZeppelin              |
| Paiement fiat | OwlPay (Mobile Money MTN/Orange)             |
| Taux de change | CoinGecko (USDC/USDT) + ExchangeRate-API (XAF/USD) |

---

## Installation rapide

```bash
git clone https://github.com/Nadroj-ciol/luma-ramp-v2
cd luma-ramp-v2
npm install
cp .env.example .env
# → Remplir .env (voir section Variables d'environnement)
npm run dev
```

---

## Variables d'environnement

Copier `.env.example` → `.env` et remplir chaque variable.

### 1. Infura

1. Connectez-vous sur [infura.io](https://infura.io)
2. Créez un projet → copiez le **Project ID**
3. `INFURA_PROJECT_ID=votre_project_id`

Les URLs RPC sont construites automatiquement :
- Polygon mainnet : `https://polygon-mainnet.infura.io/v3/{ID}`
- Mumbai testnet  : `https://polygon-mumbai.infura.io/v3/{ID}`
- Ethereum        : `https://mainnet.infura.io/v3/{ID}`

### 2. Supabase

1. Créez un projet sur [supabase.com](https://supabase.com)
2. **Settings → API** → copiez `URL`, `anon key`, `service_role key`
3. Ouvrez **SQL Editor** → collez et exécutez `supabase/migrations/001_init.sql`

```
SUPABASE_URL=https://xxxx.supabase.co
SUPABASE_ANON_KEY=...
SUPABASE_SERVICE_ROLE_KEY=...   ← serveur uniquement, jamais dans le client
VITE_SUPABASE_URL=https://xxxx.supabase.co
VITE_SUPABASE_ANON_KEY=...
```

### 3. OwlPay

1. Connectez-vous sur votre dashboard OwlPay
2. Récupérez : API Key, Secret, Merchant ID, et l'URL de base
3. Vérifiez les endpoints dans `server/lib/owlpay.ts` :
   - Collection : `POST /collections`
   - Décaissement : `POST /disbursements`
   - Statut : `GET /transactions/{ref}`
   > Ces paths peuvent différer selon votre version — adaptez-les à votre dashboard.

4. Configurez l'URL de webhook dans votre dashboard OwlPay :
   `https://votre-domaine.com/api/payments/webhook`

```
OWLPAY_BASE_URL=https://api.owlpay.io/v1
OWLPAY_API_KEY=...
OWLPAY_SECRET=...
OWLPAY_MERCHANT_ID=...
```

### 4. ExchangeRate-API (taux USD/FCFA)

1. Créez un compte gratuit sur [exchangerate-api.com](https://www.exchangerate-api.com)
2. Le plan gratuit offre 1 500 requêtes/mois (largement suffisant — 1 req/30s = 2 880/jour)
3. `EXCHANGERATE_API_KEY=votre_clé`

### 5. Smart contract (après déploiement)

Après avoir déployé `RampEscrow.sol` (voir section Déploiement) :

```
CONTRACT_ADDRESS_POLYGON=0x...
CONTRACT_ADDRESS_ETHEREUM=0x...
CONTRACT_ADDRESS_MUMBAI=0x...
PLATFORM_WALLET=0x...    ← wallet qui reçoit les tokens lors du completeTransaction()
PLATFORM_WALLET_PRIVATE_KEY=0x...  ← clé privée du wallet qui envoie USDC/USDT on-ramp

VITE_CONTRACT_POLYGON=0x...
VITE_CONTRACT_ETHEREUM=0x...
VITE_CONTRACT_MUMBAI=0x...
VITE_INFURA_PROJECT_ID=votre_project_id
```

---

## Déploiement du smart contract

### Prérequis

```bash
npm install -g hardhat
# ou
npx hardhat init
```

### Déployment Mumbai (testnet — commencer ici)

```bash
# 1. Créer hardhat.config.ts dans la racine
# 2. Configurer le réseau Mumbai avec votre clé privée MetaMask
# 3. Obtenir des MATIC de test : https://faucet.polygon.technology

npx hardhat run scripts/deploy.ts --network mumbai
```

**Script de déploiement minimal** (`scripts/deploy.ts`) :
```typescript
import { ethers } from "hardhat";

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log("Deploying with:", deployer.address);

  const USDC_MUMBAI = "0x0FA8781a83E46826621b3BC094Ea2A0212e71B23";
  const USDT_MUMBAI = "0xA02f6adc7926efeBBd59Fd43A84f4E0c0c91e832";
  const PLATFORM_WALLET = process.env.PLATFORM_WALLET!;

  const RampEscrow = await ethers.getContractFactory("RampEscrow");
  const escrow = await RampEscrow.deploy(PLATFORM_WALLET, [USDC_MUMBAI, USDT_MUMBAI]);
  await escrow.waitForDeployment();

  console.log("RampEscrow deployed to:", await escrow.getAddress());
}

main().catch(console.error);
```

---

## Architecture des flux

### On-ramp (FCFA → USDC/USDT)

```
Utilisateur          Frontend              Backend               OwlPay
    │                    │                    │                      │
    ├─ Saisit montant ──►│                    │                      │
    │                    ├─ POST /transactions►│                      │
    │                    │◄── {reference} ────│                      │
    │                    ├─ POST /payments/collect ──────────────────►│
    │                    │                    │◄── {owlpay_ref} ─────│
    ├◄── Invite phone ───│                    │                      │
    ├─ Confirme PIN ─────────────────────────────────────────────────►│
    │                    │◄──── webhook (completed) ─────────────────│
    │                    │      update DB status                      │
    ├◄── Socket: completed│                   │                      │
```

### Off-ramp (USDC/USDT → FCFA)

```
Utilisateur (MetaMask)   Frontend              Backend              OwlPay    Blockchain
    │                       │                    │                    │            │
    ├─ Connecte MetaMask ───►│                    │                    │            │
    │                       ├─ POST /transactions►│                    │            │
    │                       │◄── {reference} ─────│                    │            │
    │◄── Prompt MetaMask ───│                    │                    │            │
    ├─ Approuve approve() ──────────────────────────────────────────────────────────►│
    ├─ Confirme deposit() ──────────────────────────────────────────────────────────►│
    │                       ├─ PATCH /tx-hash ───►│                    │            │
    │                       ├─ POST /payments/disburse ─────────────────►│           │
    │                       │                    │◄─ webhook (success) ─│           │
    │                       │◄──── Socket: completed ─────────────────│            │
```

---

## Structure du projet

```
luma-ramp-v2/
├── contracts/
│   └── RampEscrow.sol         ← Smart contract escrow (corrigé + SafeERC20 + claimExpired)
├── supabase/
│   └── migrations/
│       └── 001_init.sql       ← Schéma PostgreSQL + RLS
├── server/
│   ├── index.ts               ← Express + Socket.io + refresh taux 30s
│   ├── lib/
│   │   ├── supabase.ts        ← Client service_role (serveur uniquement)
│   │   ├── owlpay.ts          ← Adapter OwlPay (collect + disburse + webhook verify)
│   │   └── rates.ts           ← Taux réels CoinGecko + ExchangeRate-API
│   └── routes/
│       ├── transactions.ts    ← CRUD transactions (Supabase)
│       ├── payments.ts        ← OwlPay initiation + webhook handler
│       └── rates.ts           ← GET /api/rates
├── src/
│   ├── App.tsx                ← UI complète (swap + historique + settings réseau)
│   ├── types.ts               ← Types TypeScript + config réseaux Infura
│   ├── main.tsx
│   ├── index.css
│   ├── lib/
│   │   └── api.ts             ← Client HTTP frontend → backend
│   └── services/
│       └── blockchain.ts      ← Ethers.js v6 + Infura + MetaMask
├── .env.example               ← Template complet commenté
├── .gitignore                 ← Secrets exclus du repo
├── package.json
├── vite.config.ts             ← Aucune clé secrète dans le bundle client
└── tsconfig.json
```

---

## Ce qui a été corrigé vs v1

| Problème v1 | Solution v2 |
|---|---|
| `firebase-applet-config.json` versionné avec clés | `.gitignore` — toutes les clés en `.env` |
| Email admin hardcodé | Supprimé — pas de système de comptes |
| `completeTransaction()` ne transférait pas les tokens | Corrigé + `SafeERC20` + `claimExpired()` trustless |
| Adresses mainnet Polygon en dur dans le code | Variables d'env par réseau |
| ABI `withdraw()` inexistant dans le contrat | ABI synchronisé avec le contrat réel |
| Stockage double Firestore + in-memory (désynchronisé) | Unique source de vérité : Supabase |
| Closure obsolète sur `userProfile` | Supprimé — pas de `userProfile` |
| IDs de transactions `Math.random()` | `gen_random_uuid()` en base |
| Taux hardcodés | CoinGecko + ExchangeRate-API, refresh 30s |
| `GEMINI_API_KEY` exposée dans le bundle Vite | Aucune clé secrète dans `vite.config.ts` |
| Firebase Auth obligatoire | Zéro compte — téléphone hashé + wallet |

---

## Lancement

```bash
npm run dev    # Lance Express + Vite en développement
npm run build  # Build production
npm run lint   # Vérification TypeScript
```

Ouvrir : http://localhost:3000
