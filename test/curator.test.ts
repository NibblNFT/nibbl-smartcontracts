import { expect } from 'chai';
import { ethers } from 'hardhat';
import { BigNumber, Contract, Signer } from 'ethers';
import { mintTokens, burnTokens, snapshot, restore, getBigNumber, TWO, ZERO } from "./helper";
import * as constants from "./constants";


describe("Curator", function () {
    let accounts: Signer[];
    let snapshotId: Number;
    let admin: Signer;
    let implementorRole: Signer;
    let pauserRole: Signer;
    let feeRole: Signer;
    let curator: Signer;
    let buyer1: Signer;
    let buyer2: Signer;
    

    let erc721: Contract;
    let vaultContract: Contract;
    let vaultImplementationContract: Contract;
    let vaultFactoryContract: Contract;
    let testBancorFormula: Contract;
    
    before(async function () {
        accounts = await ethers.getSigners();   
        admin = accounts[0];
        implementorRole = accounts[1];
        pauserRole = accounts[2];
        feeRole = accounts[3];
        curator = accounts[4];
        buyer1 = accounts[5];
        buyer2 = accounts[6];

        const Erc721 = await ethers.getContractFactory("ERC721Token");
        erc721 = await Erc721.deploy();
        await erc721.deployed(); 

        await erc721.mint(await curator.getAddress(), 0);

        const NibblVault = await ethers.getContractFactory("NibblVault");
        vaultImplementationContract = await NibblVault.deploy();
        await vaultImplementationContract.deployed();

        const NibblVaultFactory = await ethers.getContractFactory("NibblVaultFactory");

        vaultFactoryContract = await NibblVaultFactory.connect(admin).deploy(vaultImplementationContract.address,
                                                                                    await admin.getAddress(),
                                                                                    await admin.getAddress()); 
        await vaultFactoryContract.deployed();
        await erc721.connect(curator).approve(vaultFactoryContract.address, 0);

        await vaultFactoryContract.connect(admin).grantRole(await vaultFactoryContract.FEE_ROLE(), await feeRole.getAddress());
        await vaultFactoryContract.connect(admin).grantRole(await vaultFactoryContract.PAUSER_ROLE(), await pauserRole.getAddress());
        await vaultFactoryContract.connect(admin).grantRole(await vaultFactoryContract.IMPLEMENTER_ROLE(), await implementorRole.getAddress());
        
        await vaultFactoryContract.connect(curator).createVault(erc721.address,
                                            0,
                                            constants.tokenName,
                                            constants.tokenSymbol,
                                            constants.initialTokenSupply,
                                            constants.initialTokenPrice,
                                            { value: constants.initialSecondaryReserveBalance });

        const proxyAddress = await vaultFactoryContract.nibbledTokens(0);
        vaultContract = new ethers.Contract(proxyAddress.toString(), NibblVault.interface, curator);

    });
    
    beforeEach(async function () {
        snapshotId = await snapshot();        
    });

    afterEach(async function () {
        await restore(snapshotId);
    });

    it("should accrue and redeem curator fee correctly", async function () {
        const _buyAmount = ethers.utils.parseEther("1");
        await vaultContract.connect(buyer1).buy(0, await buyer1.getAddress(), { value: _buyAmount });
        const expectedFee = _buyAmount.mul(constants.FEE_CURATOR).div(constants.SCALE);
        expect(await vaultContract.feeAccruedCurator()).to.be.equal(expectedFee);
        await vaultContract.connect(curator).redeemCuratorFee(await curator.getAddress());
        const accruedFeeAfterRedeem = await vaultContract.feeAccruedCurator();
        expect(accruedFeeAfterRedeem).to.be.equal(0);
    });

    it("should withdraw curator fee", async function () {
        const _buyAmount = ethers.utils.parseEther("100000");
        const _expectedFee = _buyAmount.mul(constants.FEE_CURATOR).div(constants.SCALE);
        const initialBalanceAddr1 = await admin.provider.getBalance(await buyer1.getAddress());
        await vaultContract.connect(buyer2).buy(0, await buyer1.getAddress(), { value: _buyAmount });
        expect(await vaultContract.feeAccruedCurator()).to.be.equal(_expectedFee);
        await vaultContract.connect(curator).redeemCuratorFee(await buyer1.getAddress());
        expect(await admin.provider.getBalance(await buyer1.getAddress())).to.equal(initialBalanceAddr1.add(_expectedFee));
    });

    it("should withdraw curator fee", async function () {
        const _buyAmount = ethers.utils.parseEther("100000");
        const _expectedFee = _buyAmount.mul(constants.FEE_CURATOR).div(constants.SCALE);
        const initialBalanceAddr1 = await admin.provider.getBalance(await buyer1.getAddress());
        await vaultContract.connect(buyer2).buy(0, await buyer1.getAddress(), { value: _buyAmount });
        expect(await vaultContract.feeAccruedCurator()).to.be.equal(_expectedFee);
        await vaultContract.connect(curator).redeemCuratorFee(await buyer1.getAddress());
        expect(await admin.provider.getBalance(await buyer1.getAddress())).to.equal(initialBalanceAddr1.add(_expectedFee));
    });

});