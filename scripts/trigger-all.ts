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
  try {
    const e18 = BigNumber.from((1e18).toString());
    const accounts = await ethers.getSigners();
    const user = accounts[0];
    const erc721 = "0x3E21C9F4a012001accc80580153B242582fa601A" // with uri storage
    const userAddress = await user.getAddress();
    const initialTokenPrice: BigNumber = BigNumber.from((1e11).toString()); //10 ^-6 eth
    const initialValuation: BigNumber = BigNumber.from((1e13).toString()); //.001 eth
    const initialTokenSupply: BigNumber = initialValuation.div(initialTokenPrice).mul(e18); // 1e4
    const MIN_SECONDARY_RESERVE_RATIO = BigNumber.from((50_000).toString());;
    const initialSecondaryReserveBalance: BigNumber = BigNumber.from((1e12).toString());
    const nibblVaultImplementationAddress = "0x994147949B0Bc6ee56ea5A2b26ed64CF67aa1FCE";
    const nibblVaultFactoryAddress = "0x80E5cD497FE4C879313415B113973D2b99d985E4";

    const NibblVault = await ethers.getContractFactory("NibblVault");
    const nibblVault = new Contract(nibblVaultImplementationAddress, NibblVault.interface, user);
    // const nibblVault = await NibblVault.deploy();
    // await nibblVault.deployed();
    console.log("NibblVault Implementation deployed to:", nibblVault.address);

    const nibblVaultFactory = await ethers.getContractAt("NibblVaultFactory", nibblVaultFactoryAddress, user);

    // const NibblVaultFactory = await ethers.getContractFactory("NibblVaultFactory");
    // const nibblVaultFactory = await NibblVaultFactory.deploy(nibblVault.address, userAddress, userAddress);
    // await nibblVaultFactory.deployed();

    console.log("NibblVaultFactory deployed to:", nibblVaultFactory.address);

    const erc721Token = await ethers.getContractAt("NibblTestNFT", erc721, user);
    console.log("ERC721 at:", erc721Token.address);


    let safeMintTx = await erc721Token.safeMint(userAddress, "https://ipfs.io/ipfs/QmPkvqYQBSqSY5J8RwC7dbCr6xgNsVdfpZcHgx71eqZPgJ");
    let receipt = await safeMintTx.wait()
    console.log(`safe mint receipt : ${JSON.stringify(receipt.events)}`)
    receipt = receipt.events

    const abiCoder = new ethers.utils.AbiCoder()
    console.log(`${receipt[0].topics[3]}`)

    const fromAddress = abiCoder.decode(["address"], receipt[0].topics[1])
    const toAddress = abiCoder.decode(["address"], receipt[0].topics[2])
    const tokenId = abiCoder.decode(["uint256"], receipt[0].topics[3])

    console.log(`fromAddress : ${fromAddress}`)
    console.log(`toAddress : ${toAddress}`)
    console.log(`tokenId : ${tokenId}`)

    let approveTx = await erc721Token.approve(nibblVaultFactory.address, `${tokenId}`);
    await approveTx.wait()
    console.log("Approved token:", `${tokenId}`);

    let createVaultTx = await nibblVaultFactory.connect(user).createVault(
      erc721Token.address,
      userAddress,
      "tokenName",
      "tokenSymbol",
      `${tokenId}`,
      initialTokenSupply,
      initialTokenPrice,
      0,
      { value: initialSecondaryReserveBalance });
    await createVaultTx.wait()
    console.log("Created Vault");
    //await new Promise(r => setTimeout(r, 10000));


    // const nibblVault = new Contract(nibblVaultImplementationAddress, NibblVault.interface, user);
    const _vaultAddress = await nibblVaultFactory.getVaultAddress(
      userAddress,
      erc721Token.address,
      `${tokenId}`,
      initialTokenSupply,
      initialTokenPrice);
    // const proxyAddress = await vaultFactoryContract.getVaultAddress(curatorAddress, erc721.address, 0, constants.initialTokenSupply, constants.initialTokenPrice);

    console.log("Get Vault Address");
    const _vaultContract = new Contract(_vaultAddress, NibblVault.interface, user);

    await _vaultContract.initiateBuyout({ value: BigNumber.from((1e14).toString()) });
    console.log("Buyout Initiated");
    let buyTx1 = await _vaultContract.buy(0, userAddress, { value: BigNumber.from((1e15).toString()), gasLimit: "500000" });
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
    await _vaultContract.initiateBuyout({ value: BigNumber.from((1e17).toString()) });
    console.log("Buyout Initiated");

  } catch (error) {
    console.log(error)
  }
}

// We recommend this pattern to be able to use async/await everywhere
// and properly handle errors.
main().catch((error) => {
  console.error(error.error);
  process.exitCode = 1;
});