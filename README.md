# NBK Finance — IPerCash

Infrastructure de transfert d'argent **Diaspora USA → Afrique (FCFA)**.

Permet aux membres de la diaspora africaine aux États-Unis d'envoyer de l'argent
vers le Cameroun via stablecoins (USDC), sans compte bancaire complexe.

---

## Flux utilisateur

```
Utilisateur (USA)
  ↓ Saisit montant USD / EUR / GBP / CAD / CHF
  ↓ KYC via OwlPay Harbor
  ↓ Paiement Wire ACH ou Carte de débit (Visa Direct)
  ↓
OwlPay Harbor
  ↓ Reçoit USD
  ↓ Envoie USDC → Wallet NBK Finance (Polygon/Ethereum)
  ↓ Webhook → Backend NBK
  ↓
Opérateur NBK Finance
  ↓ Reçoit les USDC
  ↓ Envoie FCFA via Mobile Money (MTN / Orange)
  ↓
Bénéficiaire (Cameroun)
  ✓ Reçoit FCFA sur téléphone
```

---

## Stack technique

| Couche          | Technologie                                         |
|-----------------|-----------------------------------------------------|
| Frontend        | React 19 + TypeScript + Vite 6                      |
| Styles          | Tailwind v4 (dark theme)                            |
| Animations      | Motion (Framer)                                     |
| Backend         | Express + Socket.io                                 |
| Base de données | Supabase (PostgreSQL)                               |
| On-ramp fiat    | OwlPay Harbor (USD/EUR/GBP/CAD/CHF → USDC)         |
| Paiement carte  | Visa Direct via OwlPay Harbor (débit US uniquement) |
| Taux de change  | CoinGecko + ExchangeRate-API (cache 10 min)         |
| Notifications   | Socket.io (temps réel)                              |

---

## Installation

```bash
git clone https://github.com/ton-org/nbk-ramp
cd nbk-ramp
npm install
cp .env.example .env
# Remplir .env (voir section Variables d'environnement)
npm run dev
```

---

## Variables d'environnement

### Supabase
```
SUPABASE_URL=https://xxxx.supabase.co
SUPABASE_ANON_KEY=eyJ...
SUPABASE_SERVICE_ROLE_KEY=eyJ...
VITE_SUPABASE_URL=https://xxxx.supabase.co
VITE_SUPABASE_ANON_KEY=eyJ...
```

### OwlPay Harbor (on-ramp USD → USDC)
Contacter Harbor pour les credentials sandbox :
https://harbor-developers.owlpay.com/docs/getting-started-1
```
HARBOR_API_KEY=your_harbor_api_key
HARBOR_WEBHOOK_SECRET=whs_...
HARBOR_ENV=sandbox   # 'sandbox' ou 'production'
```

### Wallet NBK (reçoit les USDC depuis Harbor)
```
PLATFORM_WALLET=0xTonWalletNBK
VITE_PLATFORM_WALLET=0xTonWalletNBK
```

### Taux de change
Plan gratuit ExchangeRate-API (1500 req/mois — refresh toutes les 10 min) :
https://www.exchangerate-api.com
```
EXCHANGERATE_API_KEY=your_key
```

### Server
```
PORT=3000
APP_URL=http://localhost:3000   # URL publique (ngrok en dev)
NODE_ENV=development
```

---

## Devises supportées

| Devise | Symbole | Conversion Harbor |
|--------|---------|-------------------|
| USD    | $       | Natif Harbor      |
| EUR    | €       | EUR→USD (backend) |
| GBP    | £       | GBP→USD (backend) |
| CAD    | CA$     | CAD→USD (backend) |
| CHF    | Fr      | CHF→USD (backend) |

Harbor n'acceptant que USD nativement, les autres devises sont converties
en USD par notre backend avant envoi (transparent pour l'utilisateur).

---

## Méthodes de paiement

### Wire / ACH (défaut)
Harbor retourne les coordonnées bancaires (account_number, routing_number…).
L'utilisateur effectue un virement depuis sa banque américaine.
Délai : 1-3 jours ouvrés.

### Carte de débit (Visa Direct)
Harbor retourne une `card_payment_url`. L'utilisateur paie directement.
**Uniquement cartes de débit américaines.** Nécessite activation Harbor.
Disponible depuis avril 2026. Contacter Harbor pour activer.

---

## Structure du projet

```
nbk-ramp/
├── server/
│   ├── index.ts                 ← Express + Socket.io + refresh taux 10min
│   ├── lib/
│   │   ├── harbor.ts            ← Adapter OwlPay Harbor (KYC + transfers + webhooks)
│   │   ├── rates.ts             ← Taux multi-devises (cache 10min + fallback)
│   │   └── supabase.ts          ← Client Supabase service_role
│   └── routes/
│       ├── customers.ts         ← KYC Harbor + création transfers multi-devises
│       ├── transactions.ts      ← CRUD transactions Supabase
│       └── rates.ts             ← GET /api/rates
├── src/
│   ├── App.tsx                  ← Interface utilisateur complète (5 étapes)
│   └── main.tsx
├── supabase/
│   └── migrations/
│       ├── 001_init.sql         ← Schema initial
│       └── 002_add_harbor.sql   ← Colonnes Harbor + table customers
├── .env.example
└── package.json
```

---

## Lancement

```bash
npm run dev     # Démarre Express + Vite
npm run build   # Build production
npm run lint    # Vérification TypeScript
```

Ouvrir : http://localhost:3000

---

## Tests Harbor sandbox

### Séquence complète
```powershell
# 1. Créer un customer
$c = Invoke-RestMethod -Uri "http://localhost:3000/api/customers" `
  -Method POST -ContentType "application/json" `
  -Body '{"first_name":"Jean","last_name":"Test","email":"jean+1@test.com","phone_country_code":"US","phone_number":"555-555-1234","birth_date":"1990-01-15"}'

# 2. Ouvrir agreement_link puis kyc_link dans le navigateur
# Attendre status = 'verified' (1-2 min sandbox)

# 3. Créer une transaction
$tx = Invoke-RestMethod -Uri "http://localhost:3000/api/transactions" `
  -Method POST -ContentType "application/json" `
  -Body '{"type":"on-ramp","from_currency":"USD","to_currency":"USDC","from_amount":100,"phone":"+237671339019","wallet_address":"0xTON_WALLET","network":"polygon"}'

# 4. Créer le transfer Harbor
$tr = Invoke-RestMethod -Uri "http://localhost:3000/api/customers/$($c.harbor_uuid)/transfers" `
  -Method POST -ContentType "application/json" `
  -Body "{`"amount`":`"100`",`"currency`":`"USD`",`"reference`":`"$($tx.reference)`",`"beneficiary_phone`":`"+237671339019`"}"

# 5. Simuler le paiement Wire
Invoke-RestMethod -Uri "http://localhost:3000/api/customers/simulate-paid/$($tr.transfer_uuid)" -Method POST
Invoke-RestMethod -Uri "http://localhost:3000/api/customers/simulate-completed/$($tr.transfer_uuid)" -Method POST

# 6. Vérifier dans Supabase : status = 'completed'
```

### Carte de test Visa Direct (sandbox)
```
Numéro : 4111 1111 1111 1111
Expiry : 12/30
CVV    : 123
ZIP    : 12345
```

### Email de test (éviter les doublons Harbor)
Utiliser `test+N@email.com` (jean+1@, jean+2@, etc.)
Harbor traite ces adresses comme distinctes.

---

## Webhook Harbor

Enregistrer la subscription (remplacer avec l'URL ngrok actuelle) :
```powershell
Invoke-RestMethod `
  -Uri "https://harbor-sandbox.owlpay.com/api/v1/notifications/subscriptions" `
  -Method POST `
  -Headers @{"X-API-KEY"="TON_API_KEY";"Content-Type"="application/json"} `
  -Body '{"endpoint":"https://TON_NGROK/api/customers/harbor-webhook","notification_types":["*"]}'
```

---

## Après réception USDC (opérateur NBK)

Le terminal affiche automatiquement :
```
✅ USDC reçus sur wallet NBK
  Référence      : LR-XXXXXX
  USDC reçus     : 98.5 USDC sur polygon
  FCFA à envoyer : 59672 XAF
  Bénéficiaire   : +237671339019
  Devise origine : EUR 90
```

L'opérateur envoie ensuite les FCFA via Mobile Money (MTN/Orange).
L'automatisation sera intégrée via l'API IPerCash quand disponible.