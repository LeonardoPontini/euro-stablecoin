const hre = require("hardhat");

async function main() {
  const [owner, user1, user2, user3, user4, user5] = await hre.ethers.getSigners();
  
  const EuroStablecoin = await hre.ethers.getContractFactory("EuroStablecoin");
  const token = await EuroStablecoin.deploy(owner.address);
  await token.waitForDeployment();
  const address = await token.getAddress();
  
  console.log("\n" + "=".repeat(60));
  console.log("EURO STABLECOIN - INTERACTIVE TERMINAL");
  console.log("=".repeat(60));
  console.log("\nContract deployed at:", address);
  
  const format = (n) => hre.ethers.formatUnits(n, 6);
  const parse = (n) => hre.ethers.parseUnits(n.toString(), 6);
  
  async function printState(label) {
    console.log("\n--- " + label + " ---");
    console.log("Total Supply:", format(await token.totalSupply()), "EUROC");
    console.log("Multiplier:", (await token.globalMultiplier()).toString(), "(1e18)");
    console.log("Holders:", (await token.holdersCount()).toString());
    console.log("\nBalances:");
    console.log("  Owner:", format(await token.balanceOf(owner.address)), "EUROC");
    console.log("  User1:", format(await token.balanceOf(user1.address)), "EUROC");
    console.log("  User2:", format(await token.balanceOf(user2.address)), "EUROC");
    console.log("  User3:", format(await token.balanceOf(user3.address)), "EUROC");
    console.log("  User4:", format(await token.balanceOf(user4.address)), "EUROC");
    console.log("  User5:", format(await token.balanceOf(user5.address)), "EUROC");
    console.log("\nLocked:");
    console.log("  User1:", format(await token.lockedBalanceOf(user1.address)), "EUROC");
    console.log("  User2:", format(await token.lockedBalanceOf(user2.address)), "EUROC");
    console.log("  User3:", format(await token.lockedBalanceOf(user3.address)), "EUROC");
  }
  
  console.log("\n" + "-".repeat(60));
  console.log("STEP 1: INITIAL MINTING");
  console.log("-".repeat(60));
  
  await token.connect(owner).mintBase(user1.address, parse(10000));
  await token.connect(owner).mintBase(user2.address, parse(5000));
  await token.connect(owner).mintBase(user3.address, parse(3000));
  
  console.log("\nMinted tokens to User1, User2, User3");
  await printState("After Minting");
  
  console.log("\n" + "-".repeat(60));
  console.log("STEP 2: POSITIVE REBASE (+10%)");
  console.log("-".repeat(60));
  
  await hre.network.provider.send("evm_increaseTime", [24 * 60 * 60]);
  await hre.network.provider.send("evm_mine");
  
  await token.connect(owner).rebase(parse(1800));
  console.log("\nPositive rebase: +10% supply");
  console.log("New tokens minted and LOCKED for 7 days");
  await printState("After Positive Rebase");
  
  console.log("\n" + "-".repeat(60));
  console.log("STEP 3: TRANSFER RESTRICTIONS");
  console.log("-".repeat(60));
  
  const user1Bal = await token.balanceOf(user1.address);
  const user1Locked = await token.lockedBalanceOf(user1.address);
  const user1Avail = user1Bal - user1Locked;
  
  console.log("\nUser1 Balance:", format(user1Bal), "EUROC");
  console.log("User1 Locked:", format(user1Locked), "EUROC");
  console.log("User1 Available:", format(user1Avail), "EUROC");
  
  console.log("\nUser1 tries to transfer MORE than available...");
  try {
    await token.connect(user1).transfer(user4.address, user1Bal);
    console.log("  FAILED - should have reverted!");
  } catch (e) {
    console.log("  SUCCESS - Transaction reverted (cannot spend locked)");
  }
  
  console.log("\nUser1 transfers ONLY available amount...");
  await token.connect(user1).transfer(user4.address, user1Avail);
  console.log("  SUCCESS - Transferred", format(user1Avail), "EUROC to User4");
  
  await printState("After User1 Transfer");
  
  console.log("\n" + "-".repeat(60));
  console.log("STEP 4: NEGATIVE REBASE (-5%)");
  console.log("-".repeat(60));
  
  await hre.network.provider.send("evm_increaseTime", [24 * 60 * 60]);
  await hre.network.provider.send("evm_mine");
  
  await token.connect(owner).rebase(-parse(500));
  console.log("\nNegative rebase: -5% supply contraction");
  console.log("All balances reduced proportionally");
  await printState("After Negative Rebase");
  
  console.log("\n" + "-".repeat(60));
  console.log("STEP 5: ADVANCE TIME & CLAIM LOCKED");
  console.log("-".repeat(60));
  
  await hre.network.provider.send("evm_increaseTime", [7 * 24 * 60 * 60]);
  await hre.network.provider.send("evm_mine");
  
  console.log("\nTime advanced 7 days - locks should be expired");
  
  const user2Locked = await token.lockedBalanceOf(user2.address);
  if (user2Locked > 0) {
    console.log("\nUser2 claims locked tokens...");
    await token.connect(user2).claimUnlocked();
    console.log("  SUCCESS - Claimed", format(user2Locked), "EUROC");
  }
  
  const user3Locked = await token.lockedBalanceOf(user3.address);
  if (user3Locked > 0) {
    console.log("\nUser3 claims locked tokens...");
    await token.connect(user3).claimUnlocked();
    console.log("  SUCCESS - Claimed", format(user3Locked), "EUROC");
  }
  
  await printState("After Claims");
  
  console.log("\n" + "-".repeat(60));
  console.log("STEP 6: USER-TO-USER TRANSFERS");
  console.log("-".repeat(60));
  
  const user4Bal = await token.balanceOf(user4.address);
  console.log("\nUser4 transfers 500 EUROC to User5...");
  await token.connect(user4).transfer(user5.address, parse(500));
  console.log("  SUCCESS!");
  
  console.log("\nUser5 balance:", format(await token.balanceOf(user5.address)), "EUROC");
  
  console.log("\n" + "-".repeat(60));
  console.log("STEP 7: PAUSE/UNPAUSE");
  console.log("-".repeat(60));
  
  await token.connect(owner).pause();
  console.log("\nContract PAUSED by owner");
  
  try {
    await token.connect(user2).transfer(user3.address, parse(1));
    console.log("  FAILED - should have reverted!");
  } catch (e) {
    console.log("  SUCCESS - Transfers blocked while paused");
  }
  
  await token.connect(owner).unpause();
  console.log("\nContract UNPAUSED");
  
  console.log("\nUser2 transfers 100 EUROC to User3...");
  await token.connect(user2).transfer(user3.address, parse(100));
  console.log("  SUCCESS!");
  
  await printState("FINAL STATE");
  
  console.log("\n" + "=".repeat(60));
  console.log("DEMONSTRATION COMPLETE");
  console.log("=".repeat(60));
  console.log("\nContract:", address);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
