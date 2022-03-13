// We require the Hardhat Runtime Environment explicitly here. This is optional
// but useful for running the script in a standalone fashion through `node <script>`.
//
// When running the script with `npx hardhat run <script>` you'll find the Hardhat
// Runtime Environment's members available in the global scope.
import { ethers } from "hardhat";

async function main() {
  // Hardhat always runs the compile task when running scripts with its command
  // line interface.
  //
  // If this script is run directly using `node` you may want to call compile
  // manually to make sure everything is compiled
  // await hre.run('compile');

  // We get the contract to deploy
  const NibblVault = await ethers.getContractFactory("NibblVault");
  const nibblVault = await NibblVault.deploy();
  await nibblVault.deployed();
  console.log("NibblVault Implementation deployed to:", nibblVault.address);

  const NibblVaultFactory = await ethers.getContractFactory("NibblVaultFactory");
  const nibblVaultFactory = await NibblVaultFactory.deploy(nibblVault.address, "0x70129EA2f8c3e4CA8C45621A5eC73a5A93a466D3", "0x70129EA2f8c3e4CA8C45621A5eC73a5A93a466D3");
  await nibblVaultFactory.deployed();
  console.log("NibblVaultFactory deployed to:", nibblVaultFactory.address);
  
}

// We recommend this pattern to be able to use async/await everywhere
// and properly handle errors.
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
