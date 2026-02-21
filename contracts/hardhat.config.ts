import { HardhatUserConfig } from "hardhat/config";
import "@nomicfoundation/hardhat-toolbox";
import dotenv from "dotenv";
import path from "path";

dotenv.config({ path: path.resolve(__dirname, "../backend/.env") });

const PRIVATE_KEY = process.env.PRIVATE_KEY || "";
const RPC_URL     = process.env.RPC_URL     || "";
const CHAIN_ID    = parseInt(process.env.CHAIN_ID || "2410");

if (!PRIVATE_KEY) {
  console.warn("[hardhat.config] PRIVATE_KEY not set — network deployment will fail.");
}

const config: HardhatUserConfig = {
  solidity: {
    version: "0.8.20",
    settings: {
      optimizer: { enabled: true, runs: 200 },
    },
  },
  networks: {
    // Kite L1 Testnet
    kiteTestnet: {
      url: RPC_URL,
      chainId: CHAIN_ID,
      accounts: PRIVATE_KEY ? [PRIVATE_KEY] : [],
    },
    // Local Hardhat (for unit testing)
    hardhat: {
      chainId: 31337,
    },
  },
  paths: {
    artifacts: "./artifacts",
    sources:   "./contracts",
    tests:     "./test",
    cache:     "./cache",
  },
};

export default config;
