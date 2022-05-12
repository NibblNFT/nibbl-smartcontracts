// We require the Hardhat Runtime Environment explicitly here. This is optional
// but useful for running the script in a standalone fashion through `node <script>`.
//
// When running the script with `npx hardhat run <script>` you'll find the Hardhat
// Runtime Environment's members available in the global scope.
import { BigNumber, Contract, Wallet } from "ethers";
import { getContractAddress } from "ethers/lib/utils";
import { ethers } from "hardhat";
//Rinkeby
// NibblVault Implementation deployed to: 0xFebc3B90C9FDd74a683c2FE958A2Ad3279C8c699
// Basket Implementation deployed to: 0x8d0D9466e59ec23626AdFB974A8e1eaa6602A420
// NibblVaultFactory deployed to: 0x2AE5d7a9E2Bad8723BcE224cDDD9a22952B6F183
// NibblUIHelper deployed to: 0x78454A79C212956e9d96A7c1606032dc069e4EE4
async function main() {
  try {
    const e18 = BigNumber.from((1e18).toString());
    const accounts = await ethers.getSigners();
    const user = accounts[0];
    const erc721 = "0x0bCd3aD3732130747b984d43886B2a543438A96c" // with uri storage
    const userAddress = await user.getAddress();
    const initialTokenPrice: BigNumber = BigNumber.from((1e11).toString()); //10 ^-6 eth
    const initialValuation: BigNumber = BigNumber.from((1e13).toString()); //.001 eth
    const initialTokenSupply: BigNumber = initialValuation.div(initialTokenPrice).mul(e18); // 1e4
    const MIN_SECONDARY_RESERVE_RATIO = BigNumber.from((50_000).toString());;
    const initialSecondaryReserveBalance: BigNumber = BigNumber.from((1e12).toString());
    const nibblVaultImplementationAddress = "0xFebc3B90C9FDd74a683c2FE958A2Ad3279C8c699";
    const nibblVaultFactoryAddress = "0x2AE5d7a9E2Bad8723BcE224cDDD9a22952B6F183";

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


    let safeMintTx = await erc721Token.safeMint(userAddress, "https://ipfs.io/ipfs/QmPkvqYQBSqSY5J8RwC7dbCr6xgNsVdfpZcHgx71eqZPgJ", { gasPrice: (await user.provider.getGasPrice()).mul(BigNumber.from(2)) });
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

    let approveTx = await erc721Token.approve(nibblVaultFactory.address, `${tokenId}`, {gasPrice: (await user.provider.getGasPrice()).mul(BigNumber.from(2))});
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
      { value: initialSecondaryReserveBalance, gasPrice: (await user.provider.getGasPrice()).mul(BigNumber.from(2)) });
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

    await _vaultContract.initiateBuyout({ value: BigNumber.from((1e14).toString()), gasPrice: (await user.provider.getGasPrice()).mul(BigNumber.from(2)) });
    console.log("Buyout Initiated");
    let buyTx1 = await _vaultContract.buy(0, userAddress, { value: BigNumber.from((1e15).toString()), gasLimit: "500000", gasPrice: (await user.provider.getGasPrice()).mul(BigNumber.from(2)) });
    console.log("Bought");
    await new Promise(r => setTimeout(r, 15000));
    await _vaultContract.updateTWAV({gasLimit: "500000", gasPrice: (await user.provider.getGasPrice()).mul(BigNumber.from(2))});
    console.log("Updated TWAV");
    await new Promise(r => setTimeout(r, 15000));
    await _vaultContract.buy(0, userAddress, { value: BigNumber.from((1e15).toString()), gasLimit: "500000", gasPrice: (await user.provider.getGasPrice()).mul(BigNumber.from(2)) });
    console.log("Bought");
    await new Promise(r => setTimeout(r, 15000));
    await _vaultContract.buy(0, userAddress, { value: BigNumber.from((1e15).toString()), gasLimit: "500000", gasPrice: (await user.provider.getGasPrice()).mul(BigNumber.from(2)) });
    console.log("Bought");
    await new Promise(r => setTimeout(r, 15000));
    await _vaultContract.buy(0, userAddress, { value: BigNumber.from((1e15).toString()), gasLimit: "500000", gasPrice: (await user.provider.getGasPrice()).mul(BigNumber.from(2)) });
    console.log("Bought");
    await new Promise(r => setTimeout(r, 10000));
    await _vaultContract.sell(((await _vaultContract.balanceOf(userAddress)).div(BigNumber.from(2))), 0, userAddress, { gasLimit: "500000", gasPrice: (await user.provider.getGasPrice()).mul(BigNumber.from(2)) });
    console.log("Sold");
    await new Promise(r => setTimeout(r, 10000));
    await _vaultContract.initiateBuyout({ value: BigNumber.from((1e17).toString()), gasPrice: (await user.provider.getGasPrice()).mul(BigNumber.from(2)) });
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