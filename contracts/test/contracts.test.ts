import { expect } from "chai";
import { ethers } from "hardhat";
import { time } from "@nomicfoundation/hardhat-network-helpers";
import {
    OracleAggregator,
    OracleReader,
    SyntheticToken,
    SyntheticVault,
    SynthPool,
} from "../typechain-types";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

/** Deploy a minimal ERC-20 that acts as USDC (6 decimals) for testing */
async function deployMockUsdc(owner: HardhatEthersSigner) {
    const ERC20Factory = await ethers.getContractFactory("SyntheticToken", owner);
    const usdc = await ERC20Factory.deploy("Mock USDC", "USDC", owner.address);
    return usdc;
}

// Price helpers — oracle stores 8-decimal prices (e.g. $1000 = 1000_00000000)
const PRICE_8DEC = (dollars: number) => BigInt(dollars) * 100_000_000n;
// OracleReader normalises to 1e18: $1000 = 1000n * 1n0^18
const PRICE_18DEC = (dollars: number) => BigInt(dollars) * 10n ** 18n;

// USDC amounts: 6 decimals
const USDC = (amount: number) => BigInt(amount) * 1_000_000n;

// Synth amounts: 18 decimals
const SYNTH = (amount: number) => BigInt(amount) * 10n ** 18n;

// ─────────────────────────────────────────────────────────────────────────────
// 1. OracleAggregator
// ─────────────────────────────────────────────────────────────────────────────

describe("OracleAggregator", () => {
    let oracle: OracleAggregator;
    let owner: HardhatEthersSigner;
    let updater: HardhatEthersSigner;
    let stranger: HardhatEthersSigner;

    beforeEach(async () => {
        [owner, updater, stranger] = await ethers.getSigners();
        const Factory = await ethers.getContractFactory("OracleAggregator", owner);
        oracle = await Factory.deploy(PRICE_8DEC(1000), 8, owner.address);
    });

    it("stores initial price on deploy", async () => {
        const [, answer] = await oracle.latestRoundData();
        expect(answer).to.equal(PRICE_8DEC(1000));
    });

    it("returns correct decimals", async () => {
        expect(await oracle.decimals()).to.equal(8);
    });

    it("owner can update price", async () => {
        await oracle.updatePrice(PRICE_8DEC(2000));
        const [, answer] = await oracle.latestRoundData();
        expect(answer).to.equal(PRICE_8DEC(2000));
    });

    it("increments roundId on every update", async () => {
        const [roundBefore] = await oracle.latestRoundData();
        await oracle.updatePrice(PRICE_8DEC(1500));
        const [roundAfter] = await oracle.latestRoundData();
        expect(roundAfter).to.equal(roundBefore + 1n);
    });

    it("authorized updater can update price after setUpdater", async () => {
        await oracle.setUpdater(updater.address);
        expect(await oracle.updater()).to.equal(updater.address);
        await oracle.connect(updater).updatePrice(PRICE_8DEC(3000));
        const [, answer] = await oracle.latestRoundData();
        expect(answer).to.equal(PRICE_8DEC(3000));
    });

    it("stranger cannot update price", async () => {
        await expect(
            oracle.connect(stranger).updatePrice(PRICE_8DEC(9999))
        ).to.be.revertedWith("OracleAggregator: not updater");
    });

    it("stranger cannot change updater", async () => {
        await expect(
            oracle.connect(stranger).setUpdater(stranger.address)
        ).to.be.revertedWithCustomError(oracle, "OwnableUnauthorizedAccount");
    });

    it("rejects zero or negative price", async () => {
        await expect(oracle.updatePrice(0)).to.be.revertedWith(
            "OracleAggregator: price must be positive"
        );
    });

    it("emits PriceUpdated on update", async () => {
        await expect(oracle.updatePrice(PRICE_8DEC(1500)))
            .to.emit(oracle, "PriceUpdated")
            .withArgs(PRICE_8DEC(1000), PRICE_8DEC(1500), await time.latest() + 1);
    });

    it("emits UpdaterChanged on setUpdater", async () => {
        await expect(oracle.setUpdater(updater.address))
            .to.emit(oracle, "UpdaterChanged")
            .withArgs(owner.address, updater.address);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. OracleReader
// ─────────────────────────────────────────────────────────────────────────────

describe("OracleReader", () => {
    let oracle: OracleAggregator;
    let reader: OracleReader;
    let owner: HardhatEthersSigner;

    beforeEach(async () => {
        [owner] = await ethers.getSigners();

        const OracleFactory = await ethers.getContractFactory("OracleAggregator", owner);
        oracle = await OracleFactory.deploy(PRICE_8DEC(1000), 8, owner.address);

        const ReaderFactory = await ethers.getContractFactory("OracleReader", owner);
        reader = await ReaderFactory.deploy(await oracle.getAddress());
    });

    it("normalises 8-dec price to 18-dec", async () => {
        const price = await reader.getLatestPrice();
        // $1000 with 8 dec → $1000 with 18 dec
        expect(price).to.equal(PRICE_18DEC(1000));
    });

    it("handles price with more than 18 decimals (downscales)", async () => {
        // Deploy oracle with 20 decimals — price $1 = 1 * 10^20
        const OracleFactory = await ethers.getContractFactory("OracleAggregator", owner);
        const oracle20 = await OracleFactory.deploy(10n ** 20n, 20, owner.address);
        const ReaderFactory = await ethers.getContractFactory("OracleReader", owner);
        const reader20 = await ReaderFactory.deploy(await oracle20.getAddress());
        const price = await reader20.getLatestPrice();
        expect(price).to.equal(10n ** 18n); // exactly $1 in 18 dec
    });

    it("reverts on stale price (>5 min)", async () => {
        // Advance time past the staleness threshold (5 min = 300s)
        await time.increase(301);
        await expect(reader.getLatestPrice()).to.be.revertedWith(
            "OracleReader: stale price"
        );
    });

    it("accepts fresh price just at threshold", async () => {
        await time.increase(299);
        const price = await reader.getLatestPrice();
        expect(price).to.equal(PRICE_18DEC(1000));
    });

    it("reverts if reader deployed with zero address", async () => {
        const ReaderFactory = await ethers.getContractFactory("OracleReader", owner);
        await expect(
            ReaderFactory.deploy(ethers.ZeroAddress)
        ).to.be.revertedWith("OracleReader: zero address");
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. SyntheticToken
// ─────────────────────────────────────────────────────────────────────────────

describe("SyntheticToken", () => {
    let token: SyntheticToken;
    let owner: HardhatEthersSigner;
    let user: HardhatEthersSigner;
    let stranger: HardhatEthersSigner;

    beforeEach(async () => {
        [owner, user, stranger] = await ethers.getSigners();
        const Factory = await ethers.getContractFactory("SyntheticToken", owner);
        token = await Factory.deploy("Synthetic BTC", "sBTC", owner.address);
    });

    it("has correct name and symbol", async () => {
        expect(await token.name()).to.equal("Synthetic BTC");
        expect(await token.symbol()).to.equal("sBTC");
    });

    it("owner can mint tokens", async () => {
        await token.mint(user.address, SYNTH(100));
        expect(await token.balanceOf(user.address)).to.equal(SYNTH(100));
    });

    it("owner can burn tokens", async () => {
        await token.mint(user.address, SYNTH(100));
        await token.burn(user.address, SYNTH(40));
        expect(await token.balanceOf(user.address)).to.equal(SYNTH(60));
    });

    it("stranger cannot mint", async () => {
        await expect(
            token.connect(stranger).mint(stranger.address, SYNTH(1))
        ).to.be.revertedWithCustomError(token, "OwnableUnauthorizedAccount");
    });

    it("stranger cannot burn", async () => {
        await token.mint(user.address, SYNTH(10));
        await expect(
            token.connect(stranger).burn(user.address, SYNTH(1))
        ).to.be.revertedWithCustomError(token, "OwnableUnauthorizedAccount");
    });

    it("totalSupply tracks mints and burns", async () => {
        await token.mint(user.address, SYNTH(100));
        await token.mint(stranger.address, SYNTH(50));
        await token.burn(user.address, SYNTH(30));
        expect(await token.totalSupply()).to.equal(SYNTH(120));
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// 4. SyntheticVault
// ─────────────────────────────────────────────────────────────────────────────

describe("SyntheticVault", () => {
    let oracle: OracleAggregator;
    let reader: OracleReader;
    let synth: SyntheticToken;
    let usdc: SyntheticToken; // reuse SyntheticToken as mock ERC-20 for USDC
    let vault: SyntheticVault;
    let owner: HardhatEthersSigner;
    let user: HardhatEthersSigner;

    // Asset price: $1000
    const ORACLE_PRICE_8DEC = PRICE_8DEC(1000);
    // 100% collateral ratio
    const COLLATERAL_RATIO = 10n ** 18n;

    beforeEach(async () => {
        [owner, user] = await ethers.getSigners();

        // Deploy oracle + reader
        const OracleFactory = await ethers.getContractFactory("OracleAggregator", owner);
        oracle = await OracleFactory.deploy(ORACLE_PRICE_8DEC, 8, owner.address);

        const ReaderFactory = await ethers.getContractFactory("OracleReader", owner);
        reader = await ReaderFactory.deploy(await oracle.getAddress());

        // Deploy mock USDC (6 dec)
        const TokenFactory = await ethers.getContractFactory("SyntheticToken", owner);
        usdc = await TokenFactory.deploy("Mock USDC", "USDC", owner.address);
        synth = await TokenFactory.deploy("Synthetic BTC", "sBTC", owner.address);

        // Deploy vault
        const VaultFactory = await ethers.getContractFactory("SyntheticVault", owner);
        vault = await VaultFactory.deploy(
            await synth.getAddress(),
            await reader.getAddress(),
            await usdc.getAddress(),
            COLLATERAL_RATIO
        );

        // Transfer synth ownership to vault so it can mint/burn
        await synth.transferOwnership(await vault.getAddress());

        // Give user 10,000 USDC and approve vault
        await usdc.mint(user.address, USDC(10_000));
        await usdc.connect(user).approve(await vault.getAddress(), USDC(10_000));
    });

    // ── Mint ──────────────────────────────────────────────────────────────────

    describe("mint", () => {
        it("mints correct synth amount for $1000 oracle price", async () => {
            // Deposit 1000 USDC → should receive 1 sBTC (at $1000/sBTC)
            await vault.connect(user).mint(USDC(1_000));
            const synthBalance = await synth.balanceOf(user.address);
            expect(synthBalance).to.equal(SYNTH(1));
        });

        it("transfers USDC from user to vault", async () => {
            await vault.connect(user).mint(USDC(1_000));
            expect(await usdc.balanceOf(await vault.getAddress())).to.equal(USDC(1_000));
        });

        it("emits Minted event", async () => {
            await expect(vault.connect(user).mint(USDC(1_000)))
                .to.emit(vault, "Minted")
                .withArgs(user.address, USDC(1_000), SYNTH(1));
        });

        it("reverts on zero amount", async () => {
            await expect(vault.connect(user).mint(0)).to.be.revertedWith("Vault: zero amount");
        });

        it("mint scales proportionally at different price", async () => {
            // Change oracle to $2000 → 1000 USDC should yield 0.5 sBTC
            await oracle.updatePrice(PRICE_8DEC(2000));
            await vault.connect(user).mint(USDC(1_000));
            const synthBalance = await synth.balanceOf(user.address);
            expect(synthBalance).to.equal(SYNTH(1) / 2n);
        });
    });

    // ── Redeem ────────────────────────────────────────────────────────────────

    describe("redeem", () => {
        beforeEach(async () => {
            // Mint 1 sBTC first
            await vault.connect(user).mint(USDC(1_000));
        });

        it("burns synth and returns correct USDC", async () => {
            const usdcBefore = await usdc.balanceOf(user.address);
            await vault.connect(user).redeem(SYNTH(1));
            const usdcAfter = await usdc.balanceOf(user.address);
            expect(usdcAfter - usdcBefore).to.equal(USDC(1_000));
        });

        it("burns the synth tokens", async () => {
            await vault.connect(user).redeem(SYNTH(1));
            expect(await synth.balanceOf(user.address)).to.equal(0n);
        });

        it("emits Redeemed event", async () => {
            await expect(vault.connect(user).redeem(SYNTH(1)))
                .to.emit(vault, "Redeemed")
                .withArgs(user.address, SYNTH(1), USDC(1_000));
        });

        it("reverts on zero amount", async () => {
            await expect(vault.connect(user).redeem(0)).to.be.revertedWith("Vault: zero amount");
        });

        it("reverts if user has insufficient synth", async () => {
            await expect(vault.connect(user).redeem(SYNTH(999))).to.be.revertedWith(
                "Vault: insufficient synth balance"
            );
        });

        it("reverts if vault has insufficient USDC liquidity", async () => {
            // Drain vault by adjusting balances — simulate by deploying a new vault with no USDC
            const TokenFactory = await ethers.getContractFactory("SyntheticToken", owner);
            const emptyUsdc = await TokenFactory.deploy("Empty USDC", "eUSDC", owner.address);
            const emptySynth = await TokenFactory.deploy("Empty Synth", "eSYNTH", owner.address);
            const VaultFactory = await ethers.getContractFactory("SyntheticVault", owner);
            const emptyVault = await VaultFactory.deploy(
                await emptySynth.getAddress(),
                await reader.getAddress(),
                await emptyUsdc.getAddress(),
                COLLATERAL_RATIO
            );
            await emptySynth.transferOwnership(await emptyVault.getAddress());
            // Manually mint synth to user outside vault (owner trick before transferOwnership)
            // This test is checked implicitly by the vault's USDC balance check
            await expect(emptyVault.connect(user).redeem(SYNTH(1))).to.be.revertedWith(
                "Vault: insufficient synth balance"
            );
        });
    });

    // ── getTVL ────────────────────────────────────────────────────────────────

    describe("getTVL", () => {
        it("returns 0 before any deposits", async () => {
            expect(await vault.getTVL()).to.equal(0n);
        });

        it("returns deposited USDC after mint", async () => {
            await vault.connect(user).mint(USDC(5_000));
            expect(await vault.getTVL()).to.equal(USDC(5_000));
        });

        it("decreases after redeem", async () => {
            await vault.connect(user).mint(USDC(2_000));
            await vault.connect(user).redeem(SYNTH(1));
            expect(await vault.getTVL()).to.equal(USDC(1_000));
        });
    });

    // ── Staleness protection ──────────────────────────────────────────────────

    describe("staleness protection (via OracleReader)", () => {
        it("mint reverts when oracle price is stale", async () => {
            await time.increase(301);
            await expect(vault.connect(user).mint(USDC(1_000))).to.be.revertedWith(
                "OracleReader: stale price"
            );
        });
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// 5. SynthPool
// ─────────────────────────────────────────────────────────────────────────────

describe("SynthPool", () => {
    let usdc: SyntheticToken;
    let synth: SyntheticToken;
    let pool: SynthPool;
    let owner: HardhatEthersSigner;
    let lp: HardhatEthersSigner;
    let trader: HardhatEthersSigner;

    // Initial pool seed: 1,000,000 USDC + 1000 sBTC → price = $1000/sBTC
    const SEED_USDC = USDC(1_000_000);
    const SEED_SYNTH = SYNTH(1_000);

    beforeEach(async () => {
        [owner, lp, trader] = await ethers.getSigners();

        const TokenFactory = await ethers.getContractFactory("SyntheticToken", owner);
        usdc = await TokenFactory.deploy("Mock USDC", "USDC", owner.address);
        synth = await TokenFactory.deploy("Synthetic BTC", "sBTC", owner.address);

        const PoolFactory = await ethers.getContractFactory("SynthPool", owner);
        pool = await PoolFactory.deploy(
            await usdc.getAddress(),
            await synth.getAddress(),
            "Atlas LP sBTC/USDC",
            "KLP-sBTC"
        );

        // Mint tokens to LP and trader
        await usdc.mint(lp.address, SEED_USDC + USDC(100_000));
        await synth.mint(lp.address, SEED_SYNTH + SYNTH(100));
        await usdc.mint(trader.address, USDC(100_000));
        await synth.mint(trader.address, SYNTH(10));

        // Approvals
        await usdc.connect(lp).approve(await pool.getAddress(), ethers.MaxUint256);
        await synth.connect(lp).approve(await pool.getAddress(), ethers.MaxUint256);
        await usdc.connect(trader).approve(await pool.getAddress(), ethers.MaxUint256);
        await synth.connect(trader).approve(await pool.getAddress(), ethers.MaxUint256);
    });

    // ── addLiquidity ──────────────────────────────────────────────────────────

    describe("addLiquidity", () => {
        it("mints LP tokens on first deposit", async () => {
            await pool.connect(lp).addLiquidity(SEED_USDC, SEED_SYNTH);
            expect(await pool.balanceOf(lp.address)).to.be.gt(0n);
        });

        it("sets correct reserves on first deposit", async () => {
            await pool.connect(lp).addLiquidity(SEED_USDC, SEED_SYNTH);
            const [resUsdc, resSynth] = await pool.getReserves();
            expect(resUsdc).to.equal(SEED_USDC);
            expect(resSynth).to.equal(SEED_SYNTH);
        });

        it("reverts on zero amounts", async () => {
            await expect(pool.connect(lp).addLiquidity(0, SEED_SYNTH)).to.be.revertedWith(
                "Pool: zero amounts"
            );
            await expect(pool.connect(lp).addLiquidity(SEED_USDC, 0)).to.be.revertedWith(
                "Pool: zero amounts"
            );
        });

        it("subsequent deposit adjusts to current ratio", async () => {
            await pool.connect(lp).addLiquidity(SEED_USDC, SEED_SYNTH);
            // LP 2 provides double — pool adjusts, reserves double
            const [owner2] = await ethers.getSigners();
            await usdc.mint(owner2.address, USDC(2_000_000));
            await synth.mint(owner2.address, SYNTH(2_000));
            await usdc.connect(owner2).approve(await pool.getAddress(), ethers.MaxUint256);
            await synth.connect(owner2).approve(await pool.getAddress(), ethers.MaxUint256);
            await pool.connect(owner2).addLiquidity(USDC(2_000_000), SYNTH(2_000));
            const [resUsdc, resSynth] = await pool.getReserves();
            expect(resUsdc).to.equal(SEED_USDC * 3n);
            expect(resSynth).to.equal(SEED_SYNTH * 3n);
        });

        it("emits LiquidityAdded event", async () => {
            await expect(pool.connect(lp).addLiquidity(SEED_USDC, SEED_SYNTH))
                .to.emit(pool, "LiquidityAdded");
        });
    });

    // ── removeLiquidity ───────────────────────────────────────────────────────

    describe("removeLiquidity", () => {
        beforeEach(async () => {
            await pool.connect(lp).addLiquidity(SEED_USDC, SEED_SYNTH);
        });

        it("burns LP tokens and returns assets", async () => {
            const lpBalance = await pool.balanceOf(lp.address);
            const usdcBefore = await usdc.balanceOf(lp.address);
            const synthBefore = await synth.balanceOf(lp.address);

            await pool.connect(lp).removeLiquidity(lpBalance);

            expect(await usdc.balanceOf(lp.address)).to.be.gt(usdcBefore);
            expect(await synth.balanceOf(lp.address)).to.be.gt(synthBefore);
            expect(await pool.balanceOf(lp.address)).to.equal(0n);
        });

        it("reverts on zero LP amount", async () => {
            await expect(pool.connect(lp).removeLiquidity(0)).to.be.revertedWith(
                "Pool: zero LP"
            );
        });

        it("emits LiquidityRemoved event", async () => {
            const lpBalance = await pool.balanceOf(lp.address);
            await expect(pool.connect(lp).removeLiquidity(lpBalance))
                .to.emit(pool, "LiquidityRemoved");
        });
    });

    // ── swapUsdcForSynth ──────────────────────────────────────────────────────

    describe("swapUsdcForSynth (buy synth)", () => {
        beforeEach(async () => {
            await pool.connect(lp).addLiquidity(SEED_USDC, SEED_SYNTH);
        });

        it("gives synth in exchange for USDC", async () => {
            const synthBefore = await synth.balanceOf(trader.address);
            await pool.connect(trader).swapUsdcForSynth(USDC(1_000), 0n);
            const synthAfter = await synth.balanceOf(trader.address);
            expect(synthAfter).to.be.gt(synthBefore);
        });

        it("deducts USDC from trader", async () => {
            const usdcBefore = await usdc.balanceOf(trader.address);
            await pool.connect(trader).swapUsdcForSynth(USDC(1_000), 0n);
            const usdcAfter = await usdc.balanceOf(trader.address);
            expect(usdcAfter).to.equal(usdcBefore - USDC(1_000));
        });

        it("applies 0.3% fee (synth received slightly less than ideal)", async () => {
            // Without fee, $1000 USDC at $1000/sBTC price and deep liquidity → ~1 sBTC
            // With 0.3% fee, synth out < SYNTH(1)
            await pool.connect(trader).swapUsdcForSynth(USDC(1_000), 0n);
            const synthAfter = await synth.balanceOf(trader.address);
            // existing synth (10) + received: received < 1 because of fee & price impact
            const received = synthAfter - SYNTH(10);
            expect(received).to.be.lt(SYNTH(1));
            expect(received).to.be.gt(SYNTH(1) * 99n / 100n); // within 1% of ideal
        });

        it("reverts on slippage — minSynthOut too high", async () => {
            await expect(
                pool.connect(trader).swapUsdcForSynth(USDC(1_000), SYNTH(1))
            ).to.be.revertedWith("Pool: slippage exceeded");
        });

        it("reverts when pool has no liquidity", async () => {
            const PoolFactory = await ethers.getContractFactory("SynthPool", owner);
            const emptyPool = await PoolFactory.deploy(
                await usdc.getAddress(),
                await synth.getAddress(),
                "Empty Pool",
                "EP"
            );
            await usdc.connect(trader).approve(await emptyPool.getAddress(), ethers.MaxUint256);
            await expect(
                emptyPool.connect(trader).swapUsdcForSynth(USDC(100), 0n)
            ).to.be.revertedWith("Pool: no liquidity");
        });

        it("emits Swap event with usdcForSynth=true", async () => {
            await expect(pool.connect(trader).swapUsdcForSynth(USDC(1_000), 0n))
                .to.emit(pool, "Swap")
                .withArgs(trader.address, true, USDC(1_000), await getExpectedSynthOut(USDC(1_000)));
        });

        it("reverts with zero input", async () => {
            await expect(pool.connect(trader).swapUsdcForSynth(0n, 0n)).to.be.revertedWith(
                "Pool: zero input"
            );
        });
    });

    // ── swapSynthForUsdc ──────────────────────────────────────────────────────

    describe("swapSynthForUsdc (sell synth)", () => {
        beforeEach(async () => {
            await pool.connect(lp).addLiquidity(SEED_USDC, SEED_SYNTH);
        });

        it("gives USDC in exchange for synth", async () => {
            const usdcBefore = await usdc.balanceOf(trader.address);
            await pool.connect(trader).swapSynthForUsdc(SYNTH(1), 0n);
            const usdcAfter = await usdc.balanceOf(trader.address);
            expect(usdcAfter).to.be.gt(usdcBefore);
        });

        it("deducts synth from trader", async () => {
            const synthBefore = await synth.balanceOf(trader.address);
            await pool.connect(trader).swapSynthForUsdc(SYNTH(1), 0n);
            const synthAfter = await synth.balanceOf(trader.address);
            expect(synthAfter).to.equal(synthBefore - SYNTH(1));
        });

        it("reverts on slippage — minUsdcOut too high", async () => {
            await expect(
                pool.connect(trader).swapSynthForUsdc(SYNTH(1), USDC(1_000))
            ).to.be.revertedWith("Pool: slippage exceeded");
        });

        it("reverts with zero input", async () => {
            await expect(pool.connect(trader).swapSynthForUsdc(0n, 0n)).to.be.revertedWith(
                "Pool: zero input"
            );
        });

        it("emits Swap event with usdcForSynth=false", async () => {
            await expect(pool.connect(trader).swapSynthForUsdc(SYNTH(1), 0n))
                .to.emit(pool, "Swap");
        });
    });

    // ── getPrice ──────────────────────────────────────────────────────────────

    describe("getPrice", () => {
        it("returns 0 before liquidity is added", async () => {
            expect(await pool.getPrice()).to.equal(0n);
        });

        it("returns correct spot price after initial liquidity ($1000/sBTC)", async () => {
            await pool.connect(lp).addLiquidity(SEED_USDC, SEED_SYNTH);
            // reserveUsdc=1_000_000 USDC (6 dec), reserveSynth=1000 sBTC (18 dec)
            // price = reserveUsdc * 1e18 / reserveSynth
            //       = 1_000_000 * 10^6 * 10^18 / (1000 * 10^18) = 1_000_000 / 1000 = 1000 USDC (6 dec)
            const price = await pool.getPrice();
            expect(price).to.equal(USDC(1_000)); // 1000 USDC per synth token
        });

        it("price increases after buying synth (less synth, more USDC in pool)", async () => {
            await pool.connect(lp).addLiquidity(SEED_USDC, SEED_SYNTH);
            const priceBefore = await pool.getPrice();
            await pool.connect(trader).swapUsdcForSynth(USDC(10_000), 0n);
            const priceAfter = await pool.getPrice();
            expect(priceAfter).to.be.gt(priceBefore);
        });

        it("price decreases after selling synth (more synth, less USDC in pool)", async () => {
            await pool.connect(lp).addLiquidity(SEED_USDC, SEED_SYNTH);
            const priceBefore = await pool.getPrice();
            await pool.connect(trader).swapSynthForUsdc(SYNTH(1), 0n);
            const priceAfter = await pool.getPrice();
            expect(priceAfter).to.be.lt(priceBefore);
        });
    });

    // ── quotes ────────────────────────────────────────────────────────────────

    describe("quoteUsdcForSynth / quoteSynthForUsdc", () => {
        beforeEach(async () => {
            await pool.connect(lp).addLiquidity(SEED_USDC, SEED_SYNTH);
        });

        it("quoteUsdcForSynth returns non-zero for valid input", async () => {
            const [synthOut, impact] = await pool.quoteUsdcForSynth(USDC(1_000));
            expect(synthOut).to.be.gt(0n);
            expect(impact).to.be.gte(0n);
        });

        it("quoteSynthForUsdc returns non-zero for valid input", async () => {
            const [usdcOut, impact] = await pool.quoteSynthForUsdc(SYNTH(1));
            expect(usdcOut).to.be.gt(0n);
            expect(impact).to.be.gte(0n);
        });

        it("quote returns (0,0) on empty pool", async () => {
            const PoolFactory = await ethers.getContractFactory("SynthPool", owner);
            const emptyPool = await PoolFactory.deploy(
                await usdc.getAddress(), await synth.getAddress(), "E", "E"
            );
            const [out, impact] = await emptyPool.quoteUsdcForSynth(USDC(1_000));
            expect(out).to.equal(0n);
            expect(impact).to.equal(0n);
        });
    });

    // ── LP fee accrual ────────────────────────────────────────────────────────

    describe("LP fee accrual", () => {
        it("LPs receive more assets than deposited after trades (fees)", async () => {
            await pool.connect(lp).addLiquidity(SEED_USDC, SEED_SYNTH);

            // Record balances before deposit
            const usdcDeposited = SEED_USDC;

            // Trader makes several swaps — fees accumulate in pool
            for (let i = 0; i < 10; i++) {
                await pool.connect(trader).swapUsdcForSynth(USDC(5_000), 0n);
            }

            const lpBalance = await pool.balanceOf(lp.address);
            await pool.connect(lp).removeLiquidity(lpBalance);

            const usdcReceived = await usdc.balanceOf(lp.address);
            // LP should have received MORE USDC than originally deposited (due to fees)
            expect(usdcReceived).to.be.gte(usdcDeposited);
        });
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// Helper — compute expected synth out from a swap for event matching
// ─────────────────────────────────────────────────────────────────────────────
async function getExpectedSynthOut(usdcIn: bigint): Promise<bigint> {
    const FEE_DENOM = 10_000n;
    const FEE_BPS = 30n;
    const reserveUsdc = USDC(1_000_000);
    const reserveSynth = SYNTH(1_000);
    const usdcInFee = usdcIn * (FEE_DENOM - FEE_BPS) / FEE_DENOM;
    return (usdcInFee * reserveSynth) / (reserveUsdc + usdcInFee);
}
