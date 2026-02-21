# Oracle-Backed Synthetic Asset Protocol

> Permissionless oracle listings with self-insuring AMM pools.  
> Powered by **Kite AI Agent × x402 × Switchboard × Kite L1 Testnet**

---

## Architecture

```
User (Browser)
    ↓  wallet connect + forms
Frontend (React + Vite + ethers v6)
    ↓  REST API
Backend (Express + ethers v6)
    ↓  deploy + read contracts
Kite L1 Testnet (EVM)
    ├── OracleAggregator.sol    ← price feed (agent-discovered URLs via job runner)
    ├── OracleReader.sol        ← normalises price → 1e18
    ├── SyntheticToken.sol      ← ERC-20 minted/burned by Vault
    └── SyntheticVault.sol      ← mint/redeem with collateral invariant
```

### Agent Fee Model (mock x402)

| Bucket          | Share | Purpose                             |
|-----------------|-------|-------------------------------------|
| Research Fee    | 40%   | Kite AI agent data-source discovery |
| Oracle Funding  | 40%   | Fund Switchboard feed incentives    |
| Deploy Buffer   | 20%   | Gas costs for contract deployment   |

---

## Folder Structure

```
kite-ai/
├── contracts/                 ← Hardhat project (Solidity)
│   ├── contracts/
│   │   ├── SyntheticToken.sol
│   │   ├── OracleReader.sol
│   │   ├── SyntheticVault.sol
│   │   └── OracleAggregator.sol
│   ├── scripts/deploy.ts
│   ├── hardhat.config.ts
│   └── package.json
├── backend/                   ← Express API
│   ├── src/
│   │   ├── index.ts           ← routes: /create-market, /contracts, /market-data, /update-oracle
│   │   ├── deployer.ts        ← programmatic contract deployment
│   │   ├── agent.ts           ← OpenRouter research simulation
│   │   ├── oracle-runner.ts   ← fetch URL → parse JSONPath → update OracleAggregator
│   │   └── store.ts           ← in-memory market state
│   └── package.json
├── frontend/                  ← React + Vite
│   ├── src/
│   │   ├── App.tsx            ← main layout + create-market form
│   │   ├── components/
│   │   │   ├── WalletConnect.tsx
│   │   │   ├── MarketInfo.tsx
│   │   │   ├── MintForm.tsx
│   │   │   └── RedeemForm.tsx
│   │   ├── lib/abis.ts
│   │   └── lib/x402.ts        ← native x402 EIP-3009 signer (no Kite Agent Passport)
│   └── package.json
└── src/                       ← existing Kite agent (unchanged)
```

---

## Step-by-Step Run Guide

### Prerequisites

- Node.js >= 18
- MetaMask (or any EIP-1193 wallet) with Kite Testnet added
- Testnet tokens from https://faucet.gokite.ai/

---

### Step 1 — Configure environment

```bash
cp backend/.env.example backend/.env
```

Edit `backend/.env`:

```env
# Kite Testnet RPC — verify at https://testnet.kitescan.ai/
RPC_URL=https://rpc.testnet.gokite.ai
CHAIN_ID=2410

# Your deployer private key (wallet: 0x1a5de860035E2E388140345a0F15897A19A92DB8)
PRIVATE_KEY=0x...

# Testnet stablecoin (Test USDT on Kite)
USDC_ADDRESS=0x0fF5393387ad2f9f691FD6Fd28e07E3969e27e63

# OpenRouter for AI research (get free key at https://openrouter.ai)
OPENROUTER_API_KEY=sk-or-v1-...

PORT=3000
```

```bash
cp frontend/.env.example frontend/.env
# VITE_BACKEND_URL=http://localhost:3000  (already set)
```

> **Note:** `CHAIN_ID` and `RPC_URL` for Kite Testnet — check the current values
> at https://testnet.kitescan.ai/ under "Network" settings.

---

### Step 2 — Compile contracts

```bash
npm run protocol:compile
# or: cd contracts && npm install && npm run compile
```

Expected output:
```
Compiled 16 Solidity files successfully (evm target: paris).
```

---

### Step 3 — Start backend

```bash
npm run protocol:backend
# or: cd backend && npm install && npm run dev
```

Expected output:
```
Oracle Synthetic Protocol — Backend
http://localhost:3000
  POST /create-market
  GET  /contracts
  GET  /market-data
  POST /set-oracle-price  (dev override)
  POST /update-oracle     (fetch from URLs → update OracleAggregator)
```

---

### Step 4 — Start frontend

In a new terminal:

```bash
npm run protocol:frontend
# or: cd frontend && npm install && npm run dev
```

Open: http://localhost:5173

---

### Step 5 — Create a market (x402 payment)

**Option A: Via browser wallet (no Kite Agent Passport needed)**

1. Open http://localhost:5173
2. Connect MetaMask → switch to Kite Testnet (Chain ID 2410)
3. Get testnet USDT from https://faucet.gokite.ai/
4. Fill in the **Create Market** form (e.g. Asset: **Rubies**, Symbol: **sRUBY**)
5. Click **Create Market (x402)**
6. A payment confirmation card appears — review the amount and payee
7. Click **Sign & Pay** — MetaMask prompts for an EIP-712 signature (no transaction, just a signature)
8. Backend receives the `X-Payment` header, calls Pieverse facilitator to settle on Kite, then deploys contracts

**Option B: Via Kite Trade Agent**

1. Ensure backend is running (`npm run protocol:backend`)
2. Run the trade agent: `npm run dev`
3. Connect Kite MCP (OAuth via Kite Portal when prompted)
4. Fund your Kite wallet with testnet USDT from https://faucet.gokite.ai/
5. Type: `create synthetic market for Rubies with 10 USDT payment`
6. The agent pays via Kite Agent Passport, backend settles via Pieverse, deploys contracts

**Option C: Demo mode (no payment)**

Set `X402_DISABLE=true` in `backend/.env` to allow create-market without payment (for local testing only).

---

Creating a market will:
- Settle payment on Kite via Pieverse facilitator (real testnet USDT to `PAYEE_ADDRESS`)
- Split fee: 40% research, 40% oracle, 20% deployment buffer
- Run AI research (OpenRouter) to discover data sources (URL + JSONPath)
- Deploy `OracleAggregator`, `SyntheticToken`, `OracleReader`, `SyntheticVault` on Kite Testnet
- Fetch initial price from research URLs and update OracleAggregator
- Transfer SyntheticToken ownership to Vault

---

### Step 6 — Mint synthetic tokens

1. Connect MetaMask (add Kite Testnet, ensure USDC balance)
2. Enter USDC amount in the **Mint** form
3. Click **Approve & Mint** (two transactions: approve + mint)

---

### Step 7 — Redeem

1. Enter synthetic token amount in the **Redeem** form
2. Click **Redeem** — burns synthetic tokens, returns USDC at oracle price

---

### Step 8 — Oracle price updates

**Automatic:** The backend refreshes prices every 5 minutes by default (configurable via `ORACLE_INTERVAL_MS` in `backend/.env`).

Set the interval (milliseconds):
```env
ORACLE_INTERVAL_MS=300000   # 5 minutes (default)
ORACLE_INTERVAL_MS=60000    # 1 minute
ORACLE_INTERVAL_MS=0        # disable auto-refresh
```

**Manual trigger:** Force an immediate update from research URLs:
```bash
curl -X POST http://localhost:3000/update-oracle
```

Or click **Update from URLs** in the Dev Tools panel on the frontend.

**Manual override (dev):** Set a fixed USD price:
```bash
curl -X POST http://localhost:3000/set-oracle-price \
  -H "Content-Type: application/json" \
  -d '{"price": 1250}'
```

---

### Manual Hardhat Deployment (optional)

```bash
cd contracts
npx hardhat run scripts/deploy.ts --network kiteTestnet
```

This writes `backend/deployed.json` which the backend auto-loads on restart.

---

## Smart Contract Details

### Collateral Invariant

```
scaledVaultBalance = USDC.balanceOf(vault) × 1e12       # → 18-decimal USD
valueIn18          = totalSupply × oraclePrice / 1e18
requiredCollateral = valueIn18 × collateralRatio / 1e18  # collateralRatio = 1e18 (100%)

INVARIANT: scaledVaultBalance >= requiredCollateral
```

Enforced after every `mint()` and `redeem()`. Reverts if violated.

### Mint Formula

```
syntheticAmount = (usdcAmount × 1e12 × 1e18) / oraclePrice
```

Example: deposit $1000 USDC at oracle price $1000/token → receive 1.0 sMOTO

### Redeem Formula

```
usdcAmount18 = syntheticAmount × oraclePrice / 1e18
usdcAmount   = usdcAmount18 / 1e12
```

Example: redeem 1.0 sMOTO at oracle price $1000/token → receive $1000 USDC

---

## API Reference

### `POST /create-market`

```json
{
  "assetName": "Motorcycle Price Index",
  "assetSymbol": "sMOTO",
  "assetDescription": "...",
  "totalPayment": 10
}
```

Response: deployed contract addresses + AI research + fee allocation.

### `GET /contracts`

Returns all deployed addresses.

### `GET /market-data`

Returns oracle price, vault TVL, total supply — read from chain.

### `POST /set-oracle-price`

```json
{ "price": 1500 }
```

Manual override for OracleAggregator price (dev only).

### `POST /update-oracle`

Fetches price from research data sources (url + jsonPath), parses, and calls `updatePrice` on OracleAggregator. Uses the market's stored research from create-market.

---

## Kite Testnet Info

| Property   | Value                                           |
|------------|-------------------------------------------------|
| Explorer   | https://testnet.kitescan.ai/                    |
| Faucet     | https://faucet.gokite.ai/                       |
| Token      | Test USDT `0x0fF5393387ad2f9f691FD6Fd28e07E3969e27e63` |
| Block Time | 1 second                                        |

---

## Troubleshooting

| Issue | Fix |
|-------|-----|
| `Artifact not found` | Run `cd contracts && npm run compile` first |
| `RPC_URL not set` | Fill in `backend/.env` with Kite RPC |
| `PRIVATE_KEY not set` | Add deployer private key to `backend/.env` |
| `Stale oracle` | Prices auto-refresh every 5min. Call `POST /update-oracle` manually or set `ORACLE_INTERVAL_MS` |
| `Wrong network` | Switch MetaMask to Kite Testnet (Chain ID 2410) |
| `EIP-3009 not supported` | Token does not support native x402. Use `X402_DISABLE=true` and Kite Agent Passport instead |
| MetaMask shows wrong network | Add Kite Testnet to MetaMask with correct Chain ID and RPC |
| USDC balance 0 | Get testnet tokens from https://faucet.gokite.ai/ |
