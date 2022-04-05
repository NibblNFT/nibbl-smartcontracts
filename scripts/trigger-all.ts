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
    const erc721 = "0x3A5DCA5C53109715F2E3fE51b10698B62CDf1A0D"; //0xCf2867459A94De0693b207b4F8135cc79F568574
    const userAddress = await user.getAddress();
    const tokenID = 10000001; // Update token ID on every run
    const initialTokenPrice: BigNumber = BigNumber.from((1e12).toString()); //10 ^-6 eth
    const initialValuation: BigNumber = BigNumber.from((1e15).toString()); //.001 eth
    const initialTokenSupply: BigNumber = initialValuation.div(initialTokenPrice).mul(e18); // 1e4
    const MIN_SECONDARY_RESERVE_RATIO = BigNumber.from((50_000).toString());;
    const initialSecondaryReserveBalance: BigNumber = BigNumber.from((1e14).toString());
    const nibblVaultImplementationAddress = "0x153343e97FB52C0df633D80290fbE1afc6DC86B5";
    const nibblVaultFactoryAddress = "0x757DB73A18a2C8EfC92E4A8227c9Afc537A38b1E";

    const NibblVault = await ethers.getContractFactory("NibblVault");
    const nibblVault = new Contract(nibblVaultImplementationAddress, NibblVault.interface, user);
    // await NibblVault.deploy();
    // await nibblVault.deployed();
    console.log("NibblVault Implementation deployed to:", nibblVault.address);

    const NibblVaultFactory = await ethers.getContractFactory("NibblVaultFactory");
    const nibblVaultFactory =  await ethers.getContractAt( "NibblVaultFactory", nibblVaultFactoryAddress, user);

    // await NibblVaultFactory.deploy(nibblVault.address, userAddress, userAddress);
    // await nibblVaultFactory.deployed();
    console.log("NibblVaultFactory deployed to:", nibblVaultFactory.address);
    
    const ERC721Token = await ethers.getContractFactory("ERC721Token");
    const erc721Token = await ethers.getContractAt("ERC721Token", erc721, user);
    console.log("ERC721 at:", erc721Token.address);
    
    await erc721Token.mint(userAddress, tokenID);
    console.log("Minted token:", tokenID);
    await new Promise(r => setTimeout(r, 10000));
    
    await erc721Token.approve(nibblVaultFactoryAddress, tokenID);
    console.log("Approved token:", tokenID);
    await new Promise(r => setTimeout(r, 10000));
    
    await nibblVaultFactory.connect(user).createVault(erc721Token.address,
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
    const _vaultAddress = await nibblVaultFactory.getVaultAddress(userAddress,
        erc721Token.address,
        tokenID,
        initialTokenSupply);
        
    const _vaultContract = new Contract(_vaultAddress, NibblVault.interface, user);
    await _vaultContract.buy(0, userAddress, {value: BigNumber.from((1e16).toString())});
    console.log("Bought");
    await new Promise(r => setTimeout(r, 10000));
    await _vaultContract.initiateBuyout({ value: BigNumber.from((1e16).toString()) });
    console.log("Buyout Initiated");
    await new Promise(r => setTimeout(r, 10000));
    await _vaultContract.buy(0, userAddress, { value: BigNumber.from((1e16).toString()) });
    console.log("Bought");
    await new Promise(r => setTimeout(r, 10000));
    await _vaultContract.buy(0, userAddress, {value: BigNumber.from((1e16).toString())});
    console.log("Bought");
    await new Promise(r => setTimeout(r, 10000));
    await _vaultContract.buy(0, userAddress, {value: BigNumber.from((1e16).toString())});
    console.log("Bought");
    await new Promise(r => setTimeout(r, 10000));
    await _vaultContract.sell(1000, 0, userAddress);
    console.log("Sold");
    await new Promise(r => setTimeout(r, 10000));
    await _vaultContract.updateTWAV();
    console.log("Updated TWAV");
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
