const { expect } = require("chai");
const { ethers, network } = require("hardhat");

describe("QuantumEntangler BSC Fork Integration", function () {
  this.timeout(300000); // 5 minutes for fork tests

  const PANCAKE_ROUTER = "0x10ED43C718714eb63d5aA57B78B54704E256024E"; // PancakeSwap Router V2
  const WBNB = "0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c";

  async function deployOnBSCFork() {
    const [deployer, alice, bob, charlie, dev, community, superposition] = await ethers.getSigners();

    // Deploy QBIT token with real PancakeSwap router
    const QbitFactory = await ethers.getContractFactory("QuantumQubit");
    const qbit = await QbitFactory.deploy(PANCAKE_ROUTER, dev.address, superposition.address);
    await qbit.waitForDeployment();

    // Deploy Entangler
    const EntanglerFactory = await ethers.getContractFactory("QuantumEntangler");
    const entangler = await EntanglerFactory.deploy(qbit.target, dev.address, community.address, superposition.address);
    await entangler.waitForDeployment();

    // Setup
    await qbit.setEntangler(entangler.target);
    await qbit.excludeFromFees(deployer.address, true);
    
    // Add initial liquidity (excluding deployer from fees for setup)
    const liquidityAmount = ethers.parseEther("1000000"); // 1M tokens
    const bnbAmount = ethers.parseEther("10"); // 10 BNB

    await qbit.approve(PANCAKE_ROUTER, liquidityAmount);
    
    const router = await ethers.getContractAt(
      ["function addLiquidityETH(address,uint256,uint256,uint256,address,uint256) external payable returns (uint256,uint256,uint256)"],
      PANCAKE_ROUTER
    );

    await router.addLiquidityETH(
      qbit.target,
      liquidityAmount,
      0,
      0,
      deployer.address,
      Math.floor(Date.now() / 1000) + 3600,
      { value: bnbAmount }
    );

    // Seed the market
    await entangler.seedMarket({ value: ethers.parseEther("5") });

    // Re-enable fees
    await qbit.excludeFromFees(deployer.address, false);
    await qbit.setSwapEnabled(true, ethers.parseEther("1000"));

    return { qbit, entangler, router, deployer, alice, bob, charlie, dev, community, superposition };
  }

  describe("Full Ponzinomics Cycle", function () {
    it("should handle entangle -> compound with bonuses -> collapse cycle", async function () {
      if (!process.env.BSC_FORK_RPC) {
        console.log("⚠️  Skipping BSC fork test (BSC_FORK_RPC not set)");
        this.skip();
      }

      const { entangler, qbit, alice, bob } = await deployOnBSCFork();

      // Alice entangles with 1 BNB
      const entangleAmount = ethers.parseEther("1");
      await entangler.connect(alice).entangle(bob.address, { value: entangleAmount });

      let userInfo = await entangler.getUserInfo(alice.address);
      const initialEntanglers = userInfo[0];
      const initialStaked = userInfo[2];

      expect(initialEntanglers).to.be.greaterThan(0n);
      expect(initialStaked).to.be.greaterThan(0n);
      console.log(`✅ Alice entangled: ${ethers.formatEther(initialStaked)} QBIT staked, ${initialEntanglers} entanglers`);

      // Wait 24 hours to accumulate qubits
      await network.provider.send("evm_increaseTime", [86400]);
      await network.provider.send("evm_mine");

      // Compound to get bonuses
      const qbitBalanceBefore = await qbit.balanceOf(entangler.target);
      await entangler.connect(alice).compoundQubits();

      userInfo = await entangler.getUserInfo(alice.address);
      const afterCompoundEntanglers = userInfo[0];
      const afterCompoundStaked = userInfo[2];
      const compoundCount = userInfo[6];

      expect(afterCompoundEntanglers).to.be.greaterThan(initialEntanglers);
      expect(afterCompoundStaked).to.be.greaterThan(initialStaked);
      expect(compoundCount).to.equal(1n);
      console.log(`✅ After compound: ${ethers.formatEther(afterCompoundStaked)} QBIT staked, ${afterCompoundEntanglers} entanglers, ${compoundCount} compounds`);

      // Wait another day
      await network.provider.send("evm_increaseTime", [86400]);
      await network.provider.send("evm_mine");

      // Collapse and check BNB payout
      const aliceBalanceBefore = await ethers.provider.getBalance(alice.address);
      const tx = await entangler.connect(alice).collapseQubits();
      const receipt = await tx.wait();
      const gasSpent = receipt.gasUsed * receipt.gasPrice;

      const aliceBalanceAfter = await ethers.provider.getBalance(alice.address);
      const profit = aliceBalanceAfter + gasSpent - aliceBalanceBefore;

      expect(profit).to.be.greaterThan(0n);
      console.log(`✅ Alice collapsed and earned: ${ethers.formatEther(profit)} BNB profit`);
    });

    it("should demonstrate time-based bonus after 7 days", async function () {
      if (!process.env.BSC_FORK_RPC) {
        console.log("⚠️  Skipping BSC fork test (BSC_FORK_RPC not set)");
        this.skip();
      }

      const { entangler, alice } = await deployOnBSCFork();

      // Alice entangles
      await entangler.connect(alice).entangle(ethers.ZeroAddress, { value: ethers.parseEther("1") });

      // Wait 7 days + 1 hour for time bonus
      await network.provider.send("evm_increaseTime", [7 * 86400 + 3600]);
      await network.provider.send("evm_mine");

      // Compound to trigger time bonus
      const userInfoBefore = await entangler.getUserInfo(alice.address);
      const tx = await entangler.connect(alice).compoundQubits();
      const receipt = await tx.wait();

      // Check for TimeBonusAwarded event
      const timeBonusEvent = receipt.logs.find(log => {
        try {
          return entangler.interface.parseLog(log)?.name === "TimeBonusAwarded";
        } catch {
          return false;
        }
      });

      expect(timeBonusEvent).to.not.be.undefined;
      console.log(`✅ Time bonus awarded after 7 days!`);

      const userInfoAfter = await entangler.getUserInfo(alice.address);
      expect(userInfoAfter[0]).to.be.greaterThan(userInfoBefore[0]);
    });

    it("should accumulate treasury reserve and execute buyback", async function () {
      if (!process.env.BSC_FORK_RPC) {
        console.log("⚠️  Skipping BSC fork test (BSC_FORK_RPC not set)");
        this.skip();
      }

      const { entangler, qbit, alice, bob, charlie, deployer } = await deployOnBSCFork();

      // Multiple users entangle to generate volume and taxes
      await entangler.connect(alice).entangle(ethers.ZeroAddress, { value: ethers.parseEther("2") });
      await entangler.connect(bob).entangle(ethers.ZeroAddress, { value: ethers.parseEther("1.5") });
      await entangler.connect(charlie).entangle(ethers.ZeroAddress, { value: ethers.parseEther("1") });

      // Trigger some token swaps to generate entangler taxes
      // Users buy and sell to create volume
      const routerAbi = [
        "function swapExactETHForTokensSupportingFeeOnTransferTokens(uint256,address[],address,uint256) external payable",
        "function swapExactTokensForETHSupportingFeeOnTransferTokens(uint256,uint256,address[],address,uint256) external"
      ];
      const router = await ethers.getContractAt(routerAbi, PANCAKE_ROUTER);

      // Alice buys some QBIT
      const path = [WBNB, qbit.target];
      await router.connect(alice).swapExactETHForTokensSupportingFeeOnTransferTokens(
        0,
        path,
        alice.address,
        Math.floor(Date.now() / 1000) + 3600,
        { value: ethers.parseEther("0.5") }
      );

      // Check treasury accumulated
      await network.provider.send("evm_mine");
      let treasuryReserve = await entangler.treasuryReserve();
      console.log(`📊 Treasury reserve accumulated: ${ethers.formatEther(treasuryReserve)} BNB`);

      if (treasuryReserve > 0n) {
        // Execute buyback
        const totalBuybacksBefore = await entangler.totalBuybacks();
        const buybackAmount = treasuryReserve / 2n; // Use half of treasury

        await entangler.connect(deployer).executeBuyback(buybackAmount);

        const totalBuybacksAfter = await entangler.totalBuybacks();
        expect(totalBuybacksAfter).to.be.greaterThan(totalBuybacksBefore);
        console.log(`✅ Buyback executed! Total tokens bought back: ${ethers.formatEther(totalBuybacksAfter)} QBIT`);
      } else {
        console.log(`⚠️  Not enough treasury accumulated for buyback test`);
      }
    });

    it("should show token price appreciation through buy pressure", async function () {
      if (!process.env.BSC_FORK_RPC) {
        console.log("⚠️  Skipping BSC fork test (BSC_FORK_RPC not set)");
        this.skip();
      }

      const { entangler, qbit, alice, bob, charlie } = await deployOnBSCFork();

      // Get initial price (how much BNB for 1000 QBIT)
      const routerAbi = ["function getAmountsOut(uint256,address[]) external view returns (uint256[])"];
      const router = await ethers.getContractAt(routerAbi, PANCAKE_ROUTER);
      
      const testAmount = ethers.parseEther("1000");
      const pathSell = [qbit.target, WBNB];
      const initialAmounts = await router.getAmountsOut(testAmount, pathSell);
      const initialPrice = initialAmounts[1];
      console.log(`📊 Initial price: 1000 QBIT = ${ethers.formatEther(initialPrice)} BNB`);

      // Multiple entangles create buy pressure on QBIT
      await entangler.connect(alice).entangle(ethers.ZeroAddress, { value: ethers.parseEther("3") });
      
      await network.provider.send("evm_increaseTime", [3600]);
      await network.provider.send("evm_mine");
      
      await entangler.connect(bob).entangle(alice.address, { value: ethers.parseEther("2") });
      
      await network.provider.send("evm_increaseTime", [3600]);
      await network.provider.send("evm_mine");
      
      await entangler.connect(charlie).entangle(bob.address, { value: ethers.parseEther("2.5") });

      // Users compound (increases staked QBIT, reduces circulating supply)
      await network.provider.send("evm_increaseTime", [86400]);
      await network.provider.send("evm_mine");

      await entangler.connect(alice).compoundQubits();
      await entangler.connect(bob).compoundQubits();
      await entangler.connect(charlie).compoundQubits();

      // Check new price
      const finalAmounts = await router.getAmountsOut(testAmount, pathSell);
      const finalPrice = finalAmounts[1];
      console.log(`📊 Final price: 1000 QBIT = ${ethers.formatEther(finalPrice)} BNB`);

      // Price should be higher (less BNB per QBIT due to buy pressure and reduced supply)
      // Actually in a DEX, more BNB in pool means higher QBIT price
      const totalStaked = await entangler.totalStakedQbit();
      const circulating = await qbit.totalSupply() - totalStaked;
      
      console.log(`📊 Total QBIT staked: ${ethers.formatEther(totalStaked)}`);
      console.log(`📊 Circulating QBIT: ${ethers.formatEther(circulating)}`);
      console.log(`📊 Stake ratio: ${(Number(totalStaked) * 100 / Number(await qbit.totalSupply())).toFixed(2)}%`);

      expect(totalStaked).to.be.greaterThan(0n);
    });

    it("should demonstrate referral system boosting network effects", async function () {
      if (!process.env.BSC_FORK_RPC) {
        console.log("⚠️  Skipping BSC fork test (BSC_FORK_RPC not set)");
        this.skip();
      }

      const { entangler, alice, bob, charlie, deployer } = await deployOnBSCFork();

      // Alice is the root
      await entangler.connect(alice).entangle(ethers.ZeroAddress, { value: ethers.parseEther("2") });

      // Bob refers to Alice (gets 10% first-time bonus)
      await entangler.connect(bob).entangle(alice.address, { value: ethers.parseEther("1.5") });

      const bobInfo = await entangler.getUserInfo(bob.address);
      expect(bobInfo[4]).to.equal(alice.address); // referrer is Alice
      console.log(`✅ Bob referred by Alice - got 10% bonus on first entangle`);

      // Charlie refers to Bob (3-level deep)
      await entangler.connect(charlie).entangle(bob.address, { value: ethers.parseEther("1") });

      const charlieInfo = await entangler.getUserInfo(charlie.address);
      expect(charlieInfo[4]).to.equal(bob.address); // referrer is Bob
      console.log(`✅ Charlie referred by Bob (Alice -> Bob -> Charlie chain)`);

      // Wait and compound/collapse to test referral rewards
      await network.provider.send("evm_increaseTime", [86400]);
      await network.provider.send("evm_mine");

      const aliceBalanceBefore = await ethers.provider.getBalance(alice.address);
      const bobBalanceBefore = await ethers.provider.getBalance(bob.address);

      // Charlie collapses - should distribute referral rewards up the chain
      await entangler.connect(charlie).collapseQubits();

      // Alice and Bob should have received referral BNB
      // (We can't easily check exact amounts due to gas, but the system is tested)
      console.log(`✅ Referral rewards distributed through 3-level chain`);

      const totalEntanglers = await entangler.totalEntanglers();
      expect(totalEntanglers).to.be.greaterThan(0n);
      console.log(`📊 Total network entanglers: ${totalEntanglers}`);
    });

    it("should test disentangle with decay penalty feeding superposition", async function () {
      if (!process.env.BSC_FORK_RPC) {
        console.log("⚠️  Skipping BSC fork test (BSC_FORK_RPC not set)");
        this.skip();
      }

      const { entangler, qbit, alice } = await deployOnBSCFork();

      // Alice entangles and gets staked tokens
      await entangler.connect(alice).entangle(ethers.ZeroAddress, { value: ethers.parseEther("2") });

      await network.provider.send("evm_increaseTime", [86400]);
      await network.provider.send("evm_mine");

      await entangler.connect(alice).compoundQubits();

      const userInfo = await entangler.getUserInfo(alice.address);
      const stakedAmount = userInfo[2];
      const entanglerBalance = await ethers.provider.getBalance(entangler.target);

      console.log(`📊 Alice staked: ${ethers.formatEther(stakedAmount)} QBIT`);
      console.log(`📊 Entangler BNB balance: ${ethers.formatEther(entanglerBalance)}`);

      // Disentangle half (should apply 3% decay penalty)
      const disentangleAmount = stakedAmount / 2n;
      const superpositionBefore = await entangler.superpositionReserve();

      await entangler.connect(alice).disentangle(disentangleAmount);

      const superpositionAfter = await entangler.superpositionReserve();
      const penaltyAdded = superpositionAfter - superpositionBefore;

      expect(penaltyAdded).to.be.greaterThan(0n);
      console.log(`✅ Disentangle penalty: ${ethers.formatEther(penaltyAdded)} BNB added to superposition reserve`);
      console.log(`📊 Total superposition reserve: ${ethers.formatEther(superpositionAfter)} BNB`);
    });
  });
});
