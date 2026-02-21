/** Minimal human-readable ABIs for ethers v6 frontend usage. */

export const SYNTH_POOL_ABI = [
  // views
  "function getReserves() view returns (uint256 usdcReserve, uint256 synthReserve)",
  "function getPrice() view returns (uint256)",
  "function totalSupply() view returns (uint256)",
  "function balanceOf(address) view returns (uint256)",
  "function quoteUsdcForSynth(uint256 usdcIn) view returns (uint256 synthOut, uint256 priceImpactBps)",
  "function quoteSynthForUsdc(uint256 synthIn) view returns (uint256 usdcOut, uint256 priceImpactBps)",
  "function FEE_BPS() view returns (uint256)",
  // mutating
  "function addLiquidity(uint256 usdcAmount, uint256 synthAmount) returns (uint256 lpTokens)",
  "function removeLiquidity(uint256 lpAmount) returns (uint256 usdcOut, uint256 synthOut)",
  "function swapUsdcForSynth(uint256 usdcIn, uint256 minSynthOut) returns (uint256 synthOut)",
  "function swapSynthForUsdc(uint256 synthIn, uint256 minUsdcOut) returns (uint256 usdcOut)",
  // events
  "event LiquidityAdded(address indexed provider, uint256 usdcAmount, uint256 synthAmount, uint256 lpTokens)",
  "event LiquidityRemoved(address indexed provider, uint256 usdcAmount, uint256 synthAmount, uint256 lpTokens)",
  "event Swap(address indexed trader, bool usdcForSynth, uint256 amountIn, uint256 amountOut)",
];

export const SYNTHETIC_VAULT_ABI = [
  "function mint(uint256 usdcAmount)",
  "function redeem(uint256 syntheticAmount)",
  "function getTVL() view returns (uint256)",
  "function collateralRatio() view returns (uint256)",
  "function syntheticToken() view returns (address)",
  "function oracleReader() view returns (address)",
  "function usdc() view returns (address)",
  "event Minted(address indexed user, uint256 usdcIn, uint256 synthOut)",
  "event Redeemed(address indexed user, uint256 synthIn, uint256 usdcOut)",
];

export const SYNTHETIC_TOKEN_ABI = [
  "function name() view returns (string)",
  "function symbol() view returns (string)",
  "function decimals() view returns (uint8)",
  "function totalSupply() view returns (uint256)",
  "function balanceOf(address) view returns (uint256)",
];

export const ORACLE_READER_ABI = [
  "function getLatestPrice() view returns (uint256)",
];

export const ERC20_ABI = [
  "function balanceOf(address) view returns (uint256)",
  "function decimals() view returns (uint8)",
  "function symbol() view returns (string)",
  "function approve(address spender, uint256 amount) returns (bool)",
  "function allowance(address owner, address spender) view returns (uint256)",
];
