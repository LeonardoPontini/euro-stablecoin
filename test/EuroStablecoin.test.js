const { expect } = require("chai");
const { ethers } = require("hardhat");
const { time } = require("@nomicfoundation/hardhat-network-helpers");

function BN(a) {
  return BigInt(a);
}

async function expectRevert(promise) {
  try {
    await promise;
    return false;
  } catch (e) {
    return true;
  }
}

describe("EuroStablecoin", function () {
  let euroStablecoin;
  let owner;
  let user1;
  let user2;
  let user3;
  let initialMultiplier;

  beforeEach(async function () {
    [owner, user1, user2, user3] = await ethers.getSigners();

    const EuroStablecoin = await ethers.getContractFactory("EuroStablecoin");
    euroStablecoin = await EuroStablecoin.deploy(owner.address);
    await euroStablecoin.waitForDeployment();

    initialMultiplier = await euroStablecoin.globalMultiplier();
  });

  describe("Basic Functionality", function () {
    it("should have correct name and symbol", async function () {
      expect(await euroStablecoin.name()).to.equal("Euro Stablecoin");
      expect(await euroStablecoin.symbol()).to.equal("EUROC");
    });

    it("should start with initial multiplier of 1e18", async function () {
      const m = await euroStablecoin.globalMultiplier();
      expect(m).to.equal(BN(1e18));
    });

    it("should have zero initial supply", async function () {
      const supply = await euroStablecoin.totalSupply();
      expect(supply).to.equal(BN(0));
    });
  });

  describe("Minting and Balance", function () {
    beforeEach(async function () {
      await euroStablecoin.connect(owner).mintBase(user1.address, BN(1000000));
    });

    it("should mint tokens correctly", async function () {
      const balance = await euroStablecoin.balanceOf(user1.address);
      expect(balance).to.equal(BN(1000000));
    });

    it("should track multiple holders", async function () {
      await euroStablecoin.connect(owner).mintBase(user2.address, BN(500000));
      const count = await euroStablecoin.holdersCount();
      expect(count).to.equal(BN(2));
    });
  });

  describe("Global Multiplier - Positive Rebase", function () {
    beforeEach(async function () {
      await euroStablecoin.connect(owner).mintBase(user1.address, BN(1000000));
      await euroStablecoin.connect(owner).mintBase(user2.address, BN(1000000));
      await time.increase(24 * 60 * 60 + 1);
    });

    it("should increase multiplier on positive rebase", async function () {
      const initialMultiplier = await euroStablecoin.globalMultiplier();
      
      await euroStablecoin.connect(owner).rebase(BN(100000));
      
      const newMultiplier = await euroStablecoin.globalMultiplier();
      expect(newMultiplier).to.be.greaterThan(initialMultiplier);
    });

    it("should maintain balance proportionally after rebase", async function () {
      const initialBalance1 = await euroStablecoin.balanceOf(user1.address);
      const initialBalance2 = await euroStablecoin.balanceOf(user2.address);
      const ratio = initialBalance1 / initialBalance2;
      
      await euroStablecoin.connect(owner).rebase(BN(200000));
      
      const newBalance1 = await euroStablecoin.balanceOf(user1.address);
      const newBalance2 = await euroStablecoin.balanceOf(user2.address);
      const newRatio = newBalance1 / newBalance2;
      
      expect(newRatio).to.equal(ratio);
    });

    it("should lock new tokens during positive rebase", async function () {
      await euroStablecoin.connect(owner).rebase(BN(200000));
      
      const locked1 = await euroStablecoin.lockedBalanceOf(user1.address);
      const locked2 = await euroStablecoin.lockedBalanceOf(user2.address);
      
      expect(locked1).to.be.greaterThan(BN(0));
      expect(locked2).to.be.greaterThan(BN(0));
    });

    it("should not allow transfer of locked tokens", async function () {
      await euroStablecoin.connect(owner).rebase(BN(200000));
      
      const totalBalance = await euroStablecoin.balanceOf(user1.address);
      const locked = await euroStablecoin.lockedBalanceOf(user1.address);
      const available = totalBalance - locked;
      
      const didRevert = await expectRevert(
        euroStablecoin.connect(user1).transfer(user3.address, available + BN(1))
      );
      expect(didRevert).to.be.true;
    });

    it("should allow transfer of available tokens", async function () {
      await euroStablecoin.connect(owner).rebase(BN(200000));
      
      const totalBalance = await euroStablecoin.balanceOf(user1.address);
      const locked = await euroStablecoin.lockedBalanceOf(user1.address);
      const available = totalBalance - locked;
      
      const transferAmount = BN(100000);
      expect(transferAmount).to.be.lessThanOrEqual(available);
      
      const initialUser3Balance = await euroStablecoin.balanceOf(user3.address);
      await euroStablecoin.connect(user1).transfer(user3.address, transferAmount);
      const finalUser3Balance = await euroStablecoin.balanceOf(user3.address);
      
      expect(finalUser3Balance - initialUser3Balance).to.equal(transferAmount);
    });
  });

  describe("Global Multiplier - Negative Rebase", function () {
    beforeEach(async function () {
      await euroStablecoin.connect(owner).mintBase(user1.address, BN(1000000));
      await time.increase(24 * 60 * 60 + 1);
    });

    it("should decrease multiplier on negative rebase", async function () {
      await euroStablecoin.connect(owner).rebase(BN(-100000));
      
      const newMultiplier = await euroStablecoin.globalMultiplier();
      expect(newMultiplier).to.be.lessThan(initialMultiplier);
    });

    it("should reduce balance after negative rebase", async function () {
      const initialBalance = await euroStablecoin.balanceOf(user1.address);
      
      await euroStablecoin.connect(owner).rebase(BN(-100000));
      
      const newBalance = await euroStablecoin.balanceOf(user1.address);
      expect(newBalance).to.be.lessThan(initialBalance);
    });
  });

  describe("Lock-up Period", function () {
    const LOCK_DURATION = 7 * 24 * 60 * 60;

    beforeEach(async function () {
      await euroStablecoin.connect(owner).mintBase(user1.address, BN(1000000));
      await time.increase(24 * 60 * 60 + 1);
      await euroStablecoin.connect(owner).rebase(BN(200000));
    });

    it("should set correct lock end time", async function () {
      const lockEndTime = await euroStablecoin.lockEndTimeOf(user1.address);
      const now = (await ethers.provider.getBlock('latest')).timestamp;
      const expectedUnlock = now + LOCK_DURATION;
      
      expect(Number(lockEndTime)).to.be.closeTo(expectedUnlock, 5);
    });

    it("should not release locked tokens before expiration", async function () {
      const lockEnd = await euroStablecoin.lockEndTimeOf(user1.address);
      const now = (await ethers.provider.getBlock('latest')).timestamp;
      expect(Number(lockEnd)).to.be.greaterThan(now);
    });

    it("should allow claiming after lock expires", async function () {
      await time.increase(LOCK_DURATION + 1);
      
      const lockedBefore = await euroStablecoin.lockedBalanceOf(user1.address);
      expect(lockedBefore).to.be.greaterThan(BN(0));
      
      await euroStablecoin.connect(user1).claimUnlocked();
      
      const lockedAfter = await euroStablecoin.lockedBalanceOf(user1.address);
      expect(lockedAfter).to.equal(BN(0));
    });

    it("should have zero locked balance after claiming", async function () {
      await time.increase(LOCK_DURATION + 1);
      
      await euroStablecoin.connect(user1).claimUnlocked();
      
      const locked = await euroStablecoin.lockedBalanceOf(user1.address);
      expect(locked).to.equal(BN(0));
    });
  });

  describe("Custom Lock Duration", function () {
    const customLockDuration = 3 * 24 * 60 * 60;

    beforeEach(async function () {
      await euroStablecoin.connect(owner).mintBase(user1.address, BN(1000000));
      await time.increase(24 * 60 * 60 + 1);
    });

    it("should create lockup with custom duration", async function () {
      await euroStablecoin.connect(owner).rebaseWithCustomLockup(BN(200000), customLockDuration);
      
      const lockEndTime = await euroStablecoin.lockEndTimeOf(user1.address);
      const now = (await ethers.provider.getBlock('latest')).timestamp;
      const expectedUnlock = now + customLockDuration;
      
      expect(Number(lockEndTime)).to.be.closeTo(expectedUnlock, 5);
    });
  });

  describe("Transfer Logic", function () {
    beforeEach(async function () {
      await euroStablecoin.connect(owner).mintBase(user1.address, BN(1000000));
      await euroStablecoin.connect(owner).mintBase(user2.address, BN(1000000));
    });

    it("should transfer balance correctly", async function () {
      const transferAmount = BN(100000);
      const initialUser2Balance = await euroStablecoin.balanceOf(user2.address);
      
      await euroStablecoin.connect(user1).transfer(user2.address, transferAmount);
      
      expect(await euroStablecoin.balanceOf(user2.address)).to.equal(initialUser2Balance + transferAmount);
    });

    it("should update balances after transfer", async function () {
      const initialBalance = await euroStablecoin.balanceOf(user1.address);
      const transferAmount = BN(100000);
      
      await euroStablecoin.connect(user1).transfer(user3.address, transferAmount);
      
      const finalBalance = await euroStablecoin.balanceOf(user1.address);
      expect(initialBalance - finalBalance).to.equal(transferAmount);
    });
  });

  describe("Rebase Constraints", function () {
    beforeEach(async function () {
      await euroStablecoin.connect(owner).mintBase(user1.address, BN(1000000));
    });

    it("should prevent rebase within 24 hours", async function () {
      const didRevert = await expectRevert(
        euroStablecoin.connect(owner).rebase(BN(100000))
      );
      expect(didRevert).to.be.true;
    });

    it("should allow rebase after 24 hours", async function () {
      await time.increase(24 * 60 * 60 + 1);
      
      const didRevert = await expectRevert(
        euroStablecoin.connect(owner).rebase(BN(100000))
      );
      expect(didRevert).to.be.false;
    });
  });

  describe("Pause Functionality", function () {
    beforeEach(async function () {
      await euroStablecoin.connect(owner).mintBase(user1.address, BN(1000000));
    });

    it("should allow owner to pause", async function () {
      await euroStablecoin.connect(owner).pause();
      expect(await euroStablecoin.paused()).to.be.true;
    });

    it("should prevent rebase when paused", async function () {
      await euroStablecoin.connect(owner).pause();
      await time.increase(24 * 60 * 60 + 1);
      
      const didRevert = await expectRevert(
        euroStablecoin.connect(owner).rebase(BN(100000))
      );
      expect(didRevert).to.be.true;
    });

    it("should prevent transfers when paused", async function () {
      await euroStablecoin.connect(owner).pause();
      
      const didRevert = await expectRevert(
        euroStablecoin.connect(user1).transfer(user2.address, BN(100000))
      );
      expect(didRevert).to.be.true;
    });

    it("should allow owner to unpause", async function () {
      await euroStablecoin.connect(owner).pause();
      await euroStablecoin.connect(owner).unpause();
      expect(await euroStablecoin.paused()).to.be.false;
    });
  });

  describe("View Functions", function () {
    beforeEach(async function () {
      await euroStablecoin.connect(owner).mintBase(user1.address, BN(1000000));
      await time.increase(24 * 60 * 60 + 1);
      await euroStablecoin.connect(owner).rebase(BN(200000));
    });

    it("should return correct account state", async function () {
      await euroStablecoin.connect(owner).mintBase(user1.address, BN(1000000));
      await time.increase(24 * 60 * 60 + 1);
      await euroStablecoin.connect(owner).rebase(BN(200000));
      
      const [effectiveBalance, lockedRealBalance, lockEndTime, totalBalance] = 
        await euroStablecoin.getAccountState(user1.address);
      
      expect(effectiveBalance).to.be.greaterThan(BN(0));
      expect(lockedRealBalance).to.be.greaterThan(BN(0));
    });
  });

  describe("Extreme Scenarios", function () {
    it("should handle many holders correctly", async function () {
      const signers = await ethers.getSigners();
      const numHolders = 10;
      
      for (let i = 0; i < numHolders; i++) {
        await euroStablecoin.connect(owner).mintBase(signers[i].address, BN(100000));
      }
      
      await time.increase(24 * 60 * 60 + 1);
      await euroStablecoin.connect(owner).rebase(BN(50000));
      
      const totalSupply = await euroStablecoin.totalSupply();
      expect(totalSupply).to.be.greaterThan(BN(0));
    });
  });

  describe("Owner-Only Functions", function () {
    it("should only allow owner to mint", async function () {
      const didRevert = await expectRevert(
        euroStablecoin.connect(user1).mintBase(user2.address, BN(1000))
      );
      expect(didRevert).to.be.true;
    });

    it("should only allow owner to rebase", async function () {
      await time.increase(24 * 60 * 60 + 1);
      const didRevert = await expectRevert(
        euroStablecoin.connect(user1).rebase(BN(100))
      );
      expect(didRevert).to.be.true;
    });

    it("should only allow owner to pause", async function () {
      const didRevert = await expectRevert(
        euroStablecoin.connect(user1).pause()
      );
      expect(didRevert).to.be.true;
    });
  });
});
