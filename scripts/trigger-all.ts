// We require the Hardhat Runtime Environment explicitly here. This is optional
// but useful for running the script in a standalone fashion through `node <script>`.
//
// When running the script with `npx hardhat run <script>` you'll find the Hardhat
// Runtime Environment's members available in the global scope.
import { BigNumber, Contract, Wallet } from "ethers";
import { getContractAddress } from "ethers/lib/utils";
import { ethers } from "hardhat";
//Rinkeby

async function main() {
    const e18 = BigNumber.from((1e18).toString());
    const accounts = await ethers.getSigners();   
    const user = accounts[0];
    const erc721 = "0x7B68493BdBbdd9D0f171b6C0543b64dAb9B6522E"; //0xCf2867459A94De0693b207b4F8135cc79F568574
    const userAddress = await user.getAddress();
    const tokenID = "1000010000000100000010011"; // Update token ID on every run
    const initialTokenPrice: BigNumber = BigNumber.from((1e11).toString()); //10 ^-6 eth
    const initialValuation: BigNumber = BigNumber.from((1e13).toString()); //.001 eth
    const initialTokenSupply: BigNumber = initialValuation.div(initialTokenPrice).mul(e18); // 1e4
    const MIN_SECONDARY_RESERVE_RATIO = BigNumber.from((50_000).toString());;
    const initialSecondaryReserveBalance: BigNumber = BigNumber.from((1e12).toString());
    const nibblVaultImplementationAddress = "0x40186f22eE6A88efDC2D6899798f396e63169ee7";
    const nibblVaultFactoryAddress = "0x98ebA985c644147Ca51F1F12dd727Ba727BB4ce2";

    const NibblVault = await ethers.getContractFactory("NibblVault");
    const nibblVault = new Contract(nibblVaultImplementationAddress, NibblVault.interface, user);
    // const nibblVault = await NibblVault.deploy();
    // await nibblVault.deployed();
    console.log("NibblVault Implementation deployed to:", nibblVault.address);

    const nibblVaultFactory =  await ethers.getContractAt( "NibblVaultFactory", nibblVaultFactoryAddress, user);
    
    // const NibblVaultFactory = await ethers.getContractFactory("NibblVaultFactory");
    // const nibblVaultFactory = await NibblVaultFactory.deploy(nibblVault.address, userAddress, userAddress);
    // await nibblVaultFactory.deployed();
    console.log("NibblVaultFactory deployed to:", nibblVaultFactory.address);
    
    const erc721Token = await ethers.getContractAt("ERC721Token", erc721, user);
    console.log("ERC721 at:", erc721Token.address);
    // const ERC721Token = await ethers.getContractFactory("ERC721Token");
    // const erc721Token = await ERC721Token.deploy();
    // await erc721Token.deployed();
  
    await erc721Token.mint(userAddress, tokenID);
    console.log("Minted token:", tokenID);
    await new Promise(r => setTimeout(r, 10000));
    
    
    await erc721Token.approve(nibblVaultFactory.address, tokenID);
    console.log("Approved token:", tokenID);
    await new Promise(r => setTimeout(r, 10000));

  await nibblVaultFactory.connect(user).createVault(
                                        erc721Token.address,
                                        userAddress,
                                        "tokenName",
                                        "tokenSymbol",
                                        tokenID,
                                        initialTokenSupply,
                                        initialTokenPrice,
                                        0,
                                        { value: initialSecondaryReserveBalance });
    console.log("Created Vault");
    await new Promise(r => setTimeout(r, 10000));
    
    
    // const nibblVault = new Contract(nibblVaultImplementationAddress, NibblVault.interface, user);
    const _vaultAddress = await nibblVaultFactory.getVaultAddress(
        userAddress,
        erc721Token.address,
        tokenID,
        initialTokenSupply,
        initialTokenPrice);
      // const proxyAddress = await vaultFactoryContract.getVaultAddress(curatorAddress, erc721.address, 0, constants.initialTokenSupply, constants.initialTokenPrice);

    console.log("Get Vault Address");
    const _vaultContract = new Contract(_vaultAddress, NibblVault.interface, user);

    await _vaultContract.initiateBuyout({ value: BigNumber.from((1e14).toString()) });
    console.log("Buyout Initiated");
    await _vaultContract.buy(0, userAddress, { value: BigNumber.from((1e15).toString()), gasLimit: "500000" });
    console.log("Bought");
    await new Promise(r => setTimeout(r, 15000));
    await _vaultContract.updateTWAV();
    console.log("Updated TWAV");
    await new Promise(r => setTimeout(r, 15000));
    await _vaultContract.buy(0, userAddress, { value: BigNumber.from((1e15).toString()), gasLimit: "500000" });
    console.log("Bought");
    await new Promise(r => setTimeout(r, 15000));
    await _vaultContract.buy(0, userAddress, { value: BigNumber.from((1e15).toString()), gasLimit: "500000" });
    console.log("Bought");
    await new Promise(r => setTimeout(r, 15000));
    await _vaultContract.buy(0, userAddress, { value: BigNumber.from((1e15).toString()), gasLimit: "500000" });
    console.log("Bought");
    await new Promise(r => setTimeout(r, 10000));
    await _vaultContract.sell(((await _vaultContract.balanceOf(userAddress)).div(BigNumber.from(2))), 0, userAddress, { gasLimit: "500000" });
    console.log("Sold");
    await new Promise(r => setTimeout(r, 10000));
    await _vaultContract.initiateBuyout({value: BigNumber.from((1e16).toString())});
    console.log("Buyout Initiated");
    
}

// We recommend this pattern to be able to use async/await everywhere
// and properly handle errors.
main().catch((error) => {
  console.error(error.error);
  process.exitCode = 1;
});
