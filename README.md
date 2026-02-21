# Oracle Synthetic Protocol — Autonomous Agent on Kite AI

A fully autonomous AI agent that researches real-world assets, pays x402 fees from its own wallet, and deploys on-chain synthetic asset markets on Kite Testnet — with no wallet popups or manual confirmations.

```
User (Web UI)
     ↓
Autonomous Agent (Backend)
     ↓
x402 Payment Layer  ←  Agent signs EIP-3009 with PRIVATE_KEY
     ↓
Kite Smart Contracts (OracleAggregator · SyntheticToken · SyntheticVault · SynthPool)
     ↓
Switchboard-compatible Oracle
```

---

## Architecture

| Layer | Description |
|-------|-------------|
| **Agent Wallet** | Holds `PRIVATE_KEY`; signs all x402 payments autonomously |
| **x402 Layer** | EIP-3009 `transferWithAuthorization` → Pieverse facilitator → on-chain USDT settlement |
| **Backend API** | Express + SSE; job-based pipeline with real-time progress streaming |
| **Smart Contracts** | OracleAggregator, SyntheticToken, OracleReader, SyntheticVault, SynthPool on Kite Testnet |
| **Frontend** | React + Vite; agent identity panel, live progress timeline, payment proof |

---

## Quick Start

### 1. Install dependencies

```bash
# Contracts
cd contracts && npm install && npm run compile && cd ..

# Backend
cd backend && npm install && cd ..

# Frontend
cd frontend && npm install && cd ..
```

### 2. Configure the backend

```bash
cp backend/.env.example backend/.env
```

Edit `backend/.env` and set:

```env
RPC_URL=https://rpc.testnet.gokite.ai
PRIVATE_KEY=<your_agent_private_key>
USDC_ADDRESS=0x0fF5393387ad2f9f691FD6Fd28e07E3969e27e63
PAYEE_ADDRESS=<address_to_receive_fees>
OPENROUTER_API_KEY=<optional_but_recommended>
```

> **Fund the agent wallet** with testnet USDT at https://faucet.gokite.ai/

### 3. Start the backend

```bash
cd backend && npm run dev
```

The agent logs its identity on startup:
```
[agent] Identity: 0xYourAgentAddress
[agent] Signature: 0x4a2b...
```

### 4. Start the frontend

```bash
cp frontend/.env.example frontend/.env
cd frontend && npm run dev
```

Open http://localhost:5173

---

## Demo Flow

1. Open the frontend → agent identity panel shows automatically
2. Fill in asset name (e.g. "Gold") and click **Create Market (Autonomous)**
3. Backend starts a job — frontend streams real-time progress via SSE:
   - ✓ AI Research
   - ✓ x402 Payment (agent signs EIP-3009, facilitator settles on Kite)
   - ✓ Deploy OracleAggregator
   - ✓ Deploy SyntheticToken
   - ✓ Deploy SyntheticVault
   - ✓ Deploy SynthPool
   - ✓ Oracle Price Init
4. Frontend shows on-chain tx hashes for each step
5. Payment proof panel shows settlement tx hash on Kite Testnet
6. Connect wallet to mint/redeem synthetic assets or provide AMM liquidity

---

## API Endpoints

| Method | Route | Description |
|--------|-------|-------------|
| `POST` | `/create-market` | Start autonomous market creation (no wallet required) |
| `GET`  | `/job/:id` | Poll job status |
| `GET`  | `/job/:id/stream` | SSE real-time progress stream |
| `GET`  | `/agent-identity` | Agent wallet address + signature proof |
| `GET`  | `/contracts` | Deployed contract addresses |
| `GET`  | `/market-data` | Live oracle price, TVL, supply |
| `GET`  | `/pool-data` | AMM reserves + swap quotes |
| `POST` | `/update-oracle` | Fetch → parse → update OracleAggregator |
| `POST` | `/set-oracle-price` | Dev: manual price override |

---

## Security Controls

| Control | Env Variable | Default |
|---------|-------------|---------|
| Per-request spend cap | `AGENT_SPEND_CAP_PER_REQUEST` | 50 USDT |
| 24h rolling spend cap | `AGENT_DAILY_SPEND_CAP` | 500 USDT |
| Rate limit (requests/window) | `RATE_LIMIT_MAX_REQUESTS` | 10 |
| Rate limit window | `RATE_LIMIT_WINDOW_MS` | 60 000 ms |
| Emergency kill-switch | `AGENT_REVOKED=true` | false |
| Disable payments (testing) | `X402_DISABLE=true` | false |

---

## Smart Contracts (Kite Testnet)

Deployed automatically by the agent:

| Contract | Purpose |
|----------|---------|
| `OracleAggregator` | Stores asset price (updated by oracle runner) |
| `OracleReader` | Converts aggregator price to 18-decimal format |
| `SyntheticToken` | ERC-20 representing the synthetic asset |
| `SyntheticVault` | Accepts USDC collateral → mints/redeems synths (150% ratio) |
| `SynthPool` | Constant-product AMM for synth/USDC swaps |

---

## Deployment

### Backend — Railway

```bash
# From project root
railway login
railway init
railway up --dockerfile backend/Dockerfile
railway variables set PRIVATE_KEY=... RPC_URL=... USDC_ADDRESS=... PAYEE_ADDRESS=...
```

### Frontend — Vercel

```bash
cd frontend
vercel --prod
# Set VITE_BACKEND_URL=https://your-backend.railway.app in Vercel dashboard
```

### Docker (self-hosted)

```bash
# Build from project root
docker build -f backend/Dockerfile -t oracle-synthetic .

docker run -p 3000:3000 \
  -e PRIVATE_KEY=... \
  -e RPC_URL=https://rpc.testnet.gokite.ai \
  -e USDC_ADDRESS=0x0fF5393387ad2f9f691FD6Fd28e07E3969e27e63 \
  -e PAYEE_ADDRESS=... \
  oracle-synthetic
```

---

## Example Logs

```
[agent] Identity: 0x1a5de860035E2E388140345a0F15897A19A92DB8
[agent] Signature: 0x4a2b8f...

[job:1740000000000] Running AI research for "Gold"...
[job:1740000000000] Payment settled. txHash: 0xabc123... | amount: 10 USDT
[job:1740000000000] Deploying contracts...
[deployer] OracleAggregator: 0xDEF456...
[deployer] SyntheticToken:   0xGHI789...
[deployer] SyntheticVault:   0xJKL012...
[deployer] SynthPool:        0xMNO345...
[job:1740000000000] Market creation complete.
```

---

## Environment Variables Reference

See `backend/.env.example` for the full list with descriptions.

Key variables:
- `PRIVATE_KEY` — agent wallet private key (required)
- `RPC_URL` — Kite testnet RPC (required)
- `USDC_ADDRESS` — testnet USDT contract (required)
- `PAYEE_ADDRESS` — fee recipient address
- `OPENROUTER_API_KEY` — enables AI research (optional; uses fallback if unset)
- `X402_DISABLE=true` — skip payment for local testing
