const hre = require("hardhat");

async function main() {
  const [deployer] = await hre.ethers.getSigners();

  console.log("Deploying EuroStablecoin with account:", deployer.address);
  console.log("Account balance:", (await hre.ethers.provider.getBalance(deployer.address)).toString());

  const EuroStablecoin = await hre.ethers.getContractFactory("EuroStablecoin");
  const euroStablecoin = await EuroStablecoin.deploy(deployer.address);

  console.log("EuroStablecoin deployed to:", await euroStablecoin.getAddress());

  const name = await euroStablecoin.name();
  const symbol = await euroStablecoin.symbol();
  const multiplier = await euroStablecoin.globalMultiplier();

  console.log("\nContract Details:");
  console.log("Name:", name);
  console.log("Symbol:", symbol);
  console.log("Initial Multiplier:", multiplier.toString());

  console.log("\nDeployment successful!");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
