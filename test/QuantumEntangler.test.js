const { expect } = require("chai");
const { ethers, network } = require("hardhat");

describe("QuantumEntangler integration", function () {
  this.timeout(120000);

  async function deployFixture() {
    const [deployer, alice, bob, dev, community, superposition] = await ethers.getSigners();

    const MockRouter = await ethers.getContractFactory("MockPancakeRouter");
    const router = await MockRouter.deploy(ethers.ZeroAddress);
    await router.waitForDeployment();

    const QbitFactory = await ethers.getContractFactory("QuantumQubit");
    const qbit = await QbitFactory.deploy(router.target, dev.address, superposition.address);
    await qbit.waitForDeployment();

    const EntanglerFactory = await ethers.getContractFactory("QuantumEntangler");
    const entangler = await EntanglerFactory.deploy(qbit.target, dev.address, community.address, superposition.address);
    await entangler.waitForDeployment();

    await qbit.setEntangler(entangler.target);
    await qbit.setSwapEnabled(false, 0);

    return { qbit, entangler, router, deployer, alice, bob, dev, community, superposition };
  }

  it("entangles with a referral boost once", async () => {
    const { entangler, alice, bob } = await deployFixture();

    const deposit = ethers.parseEther("750");
    const expectedQubits = await entangler.calculateQubitBuySimple(deposit);

    const tx = await entangler.connect(alice).entangle(bob.address, { value: deposit });
    await tx.wait();

    const [entanglers, claimed, staked, , referrer] = await entangler.getUserInfo(alice.address);
    expect(referrer).to.equal(bob.address);
    expect(entanglers).to.be.greaterThan(0n);

    const qubitsUsed = entanglers * 86400n;
    const residual = claimed + qubitsUsed;
    const deltaFirst = residual - expectedQubits;
    expect(deltaFirst * 10n).to.equal(expectedQubits);

    const secondTx = await entangler.connect(alice).entangle(bob.address, { value: deposit });
    await secondTx.wait();

    const [entanglersAfter, claimedAfter] = await entangler.getUserInfo(alice.address);
    expect(entanglersAfter).to.be.greaterThan(entanglers);

    const residualAfter = claimedAfter + entanglersAfter * 86400n;
    const deltaSecond = residualAfter - residual;
    expect(deltaSecond).to.be.greaterThan(0n);
    expect(deltaSecond).to.be.at.most(expectedQubits);
  });

  it("allows collapse payouts and referral distribution", async () => {
    const { entangler, qbit, alice, bob, dev, community, superposition } = await deployFixture();

    const deposit = ethers.parseEther("800");
    await entangler.connect(alice).entangle(bob.address, { value: deposit });

    await network.provider.send("evm_increaseTime", [86400]);
    await network.provider.send("evm_mine");

    await entangler.connect(alice).compoundQubits();

    await network.provider.send("evm_increaseTime", [86400]);
    await network.provider.send("evm_mine");

    const balanceBefore = await ethers.provider.getBalance(alice.address);
    const devBefore = await ethers.provider.getBalance(dev.address);
    const communityBefore = await ethers.provider.getBalance(community.address);

    const tx = await entangler.connect(alice).collapseQubits();
    const receipt = await tx.wait();
    const gasSpent = receipt && receipt.gasPrice ? receipt.gasUsed * receipt.gasPrice : 0n;

    const balanceAfter = await ethers.provider.getBalance(alice.address);
    expect(balanceAfter + gasSpent).to.be.greaterThan(balanceBefore);

    expect(await ethers.provider.getBalance(dev.address)).to.be.greaterThan(devBefore);
    expect(await ethers.provider.getBalance(community.address)).to.be.greaterThan(communityBefore);

    const superpositionReserve = await entangler.superpositionReserve();
    expect(superpositionReserve).to.be.greaterThan(0n);

    const staked = (await entangler.getUserInfo(alice.address))[2];
    expect(staked).to.be.greaterThan(0n);

    await entangler.connect(alice).disentangle(staked / 2n);
    expect(await qbit.balanceOf(entangler.target)).to.be.greaterThan(0n);
  });

  it("processes the superposition vault burn flow", async () => {
    const { entangler, qbit, alice, dev, community, superposition } = await deployFixture();

    const deposit = ethers.parseEther("900");
    await entangler.connect(alice).entangle(ethers.ZeroAddress, { value: deposit });

    await network.provider.send("evm_increaseTime", [86400]);
    await network.provider.send("evm_mine");

    await entangler.connect(alice).compoundQubits();

    await network.provider.send("evm_increaseTime", [86400]);
    await network.provider.send("evm_mine");

    await entangler.connect(alice).collapseQubits();

    const reserve = await entangler.superpositionReserve();
    expect(reserve).to.be.greaterThan(0n);

    const tokenBalanceBefore = await qbit.balanceOf(entangler.target);
    await entangler.processSuperposition(tokenBalanceBefore, true);

    const tokenBalanceAfter = await qbit.balanceOf(entangler.target);
    expect(tokenBalanceAfter).to.be.lessThan(tokenBalanceBefore);
    expect(await ethers.provider.getBalance(superposition.address)).to.be.greaterThan(0n);
  });
});
