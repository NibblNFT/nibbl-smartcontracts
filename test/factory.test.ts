import { expect } from 'chai';
import { ethers } from 'hardhat';
import { BigNumber, Contract, Signer } from 'ethers';
import { mintTokens, burnTokens, snapshot, restore, getBigNumber, TWO, ZERO, latest, advanceTimeAndBlock, duration } from "./helper";
import * as constants from "./constants";


describe("Factory", function () {
    let accounts: Signer[];
    let snapshotId: Number;
    let admin: Signer;
    let implementorRole: Signer;
    let pauserRole: Signer;
    let feeRole: Signer;
    let curator: Signer;
    let user1: Signer;
    let user2: Signer;

    let adminAddress: string;
    let implementorRoleAddress: string;
    let pauserRoleAddress: string;
    let feeRoleAddress: string;
    let curatorAddress: string;
    let user1Address: string;
    let user2Address: string;
    

    let erc721: Contract;
    let vaultContract: Contract;
    let vaultImplementationContract: Contract;
    let basketImplementationContract: Contract;
    let vaultFactoryContract: Contract;
    let testBancorFormula: Contract;
    
    before(async function () {
        accounts = await ethers.getSigners();   
        admin = accounts[0];
        implementorRole = accounts[1];
        pauserRole = accounts[2];
        feeRole = accounts[3];
        curator = accounts[4];
        user1 = accounts[5];
        user2 = accounts[6];

        adminAddress = await admin.getAddress();
        implementorRoleAddress = await implementorRole.getAddress()
        pauserRoleAddress = await pauserRole.getAddress()
        feeRoleAddress = await feeRole.getAddress()
        curatorAddress = await curator.getAddress()
        user1Address = await user1.getAddress();
        user2Address = await user2.getAddress()

        const Erc721 = await ethers.getContractFactory("ERC721Token");
        erc721 = await Erc721.deploy();
        await erc721.deployed(); 

        await erc721.mint(curatorAddress, 0);

        const NibblVault = await ethers.getContractFactory("NibblVault");
        vaultImplementationContract = await NibblVault.deploy();
        await vaultImplementationContract.deployed();

        const Basket = await ethers.getContractFactory("Basket");
        basketImplementationContract = await Basket.deploy();
        await basketImplementationContract.deployed();

        const NibblVaultFactory = await ethers.getContractFactory("NibblVaultFactory");

        vaultFactoryContract = await NibblVaultFactory.connect(admin).deploy(vaultImplementationContract.address,
                                                                                                    adminAddress,
                                                                                                    adminAddress,
                                                                                                    basketImplementationContract.address); 
        await vaultFactoryContract.deployed();
        await erc721.connect(curator).approve(vaultFactoryContract.address, 0);

        await vaultFactoryContract.connect(admin).grantRole(await vaultFactoryContract.FEE_ROLE(), feeRoleAddress);
        await vaultFactoryContract.connect(admin).grantRole(await vaultFactoryContract.PAUSER_ROLE(), pauserRoleAddress);
        await vaultFactoryContract.connect(admin).grantRole(await vaultFactoryContract.IMPLEMENTER_ROLE(), implementorRoleAddress);
        
        await vaultFactoryContract.connect(curator).createVault(erc721.address,
            curatorAddress,
            constants.tokenName,
            constants.tokenSymbol,
            0,
            constants.initialTokenSupply,
            constants.initialTokenPrice,
            await latest(),
            { value: constants.initialSecondaryReserveBalance });

        const proxyAddress = await vaultFactoryContract.getVaultAddress(curatorAddress, erc721.address, 0, constants.initialTokenSupply, constants.initialTokenPrice);
        vaultContract = new ethers.Contract(proxyAddress.toString(), NibblVault.interface, curator);

    });
    
    beforeEach(async function () {
        snapshotId = await snapshot();        
    });

    afterEach(async function () {
        await restore(snapshotId);
    });

    it("should propose feeTo address", async function () {
        await vaultFactoryContract.connect(feeRole).proposeNewAdminFeeAddress(user1Address);
        const blockTime = await latest();
        const pendingFeeTo = await vaultFactoryContract.pendingFeeTo();
        const feeToUpdateTime = await vaultFactoryContract.feeToUpdateTime();
        expect(pendingFeeTo).to.be.equal(user1Address);
        expect(feeToUpdateTime).to.be.equal(blockTime.add(constants.UPDATE_TIME_FACTORY));
    });

    it("should update proposed feeTo address", async function () {
        await vaultFactoryContract.connect(admin).connect(feeRole).proposeNewAdminFeeAddress(user1Address);
        const blockTime = await latest();
        const pendingFeeTo = await vaultFactoryContract.pendingFeeTo();
        const feeToUpdateTime = await vaultFactoryContract.feeToUpdateTime();
        expect(pendingFeeTo).to.be.equal(user1Address);
        expect(feeToUpdateTime).to.be.equal(blockTime.add(constants.UPDATE_TIME_FACTORY));
        // --------------- Proposed FeeTo ----------------- //
        await advanceTimeAndBlock(constants.UPDATE_TIME_FACTORY);
        await vaultFactoryContract.updateNewAdminFeeAddress();
        const feeTo = await vaultFactoryContract.feeTo();
        expect(feeTo).to.be.equal(user1Address);
    });

    it("should fail to update feeTo address if UPDATE_TIME hasn't passed", async function () {
        await vaultFactoryContract.connect(feeRole).proposeNewAdminFeeAddress(user1Address);
        const blockTime = await latest();
        const pendingFeeTo = await vaultFactoryContract.pendingFeeTo();
        const feeToUpdateTime = await vaultFactoryContract.feeToUpdateTime();
        expect(pendingFeeTo).to.be.equal(user1Address);
        expect(feeToUpdateTime).to.be.equal(blockTime.add(constants.UPDATE_TIME_FACTORY));
        // --------------- Proposed FeeTo ----------------- //
        await expect(vaultFactoryContract.updateNewAdminFeeAddress()).to.be.revertedWith("NibblVaultFactory: UPDATE_TIME not passed");
    });

    it("should fail to update feeTo address if not proposed", async function () {

        await expect(vaultFactoryContract.updateNewAdminFeeAddress()).to.be.revertedWith("NibblVaultFactory: Not Proposed");
    });

    it("should propose new admin fee", async function () {
        const _newFee = 1_000;
        await vaultFactoryContract.connect(feeRole).proposeNewAdminFee(_newFee);
        const blockTime = await latest();
        const pendingFeeAdmin = await vaultFactoryContract.pendingFeeAdmin();
        const feeAdminUpdateTime = await vaultFactoryContract.feeAdminUpdateTime();
        expect(pendingFeeAdmin).to.be.equal(_newFee);
        expect(feeAdminUpdateTime).to.be.equal(blockTime.add(constants.UPDATE_TIME_FACTORY));
    });

    it("should fail to propose new admin fee is fee greater than MAX_ADMIN_FEE", async function () {
        const _newFee = 15_000;
        await expect(vaultFactoryContract.connect(feeRole).proposeNewAdminFee(_newFee)).to.be.revertedWith("NibblVaultFactory: Fee value greater than MAX_ADMIN_FEE");
    });

    it("should update new admin fee", async function () {
        const _newFee = 1_000;
        await vaultFactoryContract.connect(feeRole).proposeNewAdminFee(_newFee);
        const blockTime = await latest();
        const pendingFeeAdmin = await vaultFactoryContract.pendingFeeAdmin();
        const feeAdminUpdateTime = await vaultFactoryContract.feeAdminUpdateTime();
        expect(pendingFeeAdmin).to.be.equal(_newFee);
        expect(feeAdminUpdateTime).to.be.equal(blockTime.add(constants.UPDATE_TIME_FACTORY));
   
        await advanceTimeAndBlock(constants.UPDATE_TIME_FACTORY);

        await vaultFactoryContract.updateNewAdminFee();
        expect(await vaultFactoryContract.feeAdmin()).to.equal(_newFee);
    });
  
    it("should buy when admin fee is 0", async function () {
        const _newFee = 0;
        await vaultFactoryContract.connect(feeRole).proposeNewAdminFee(_newFee);
        const blockTime = await latest();
        const pendingFeeAdmin = await vaultFactoryContract.pendingFeeAdmin();
        const feeAdminUpdateTime = await vaultFactoryContract.feeAdminUpdateTime();
        expect(pendingFeeAdmin).to.be.equal(_newFee);
        expect(feeAdminUpdateTime).to.be.equal(blockTime.add(constants.UPDATE_TIME_FACTORY));
   
        await advanceTimeAndBlock(constants.UPDATE_TIME_FACTORY);
        await vaultFactoryContract.updateNewAdminFee();
        expect(await vaultFactoryContract.feeAdmin()).to.equal(_newFee);
        vaultContract.buy(0, curatorAddress, {value: getBigNumber(100)});
    });
  
    it("should fail to update fee if UPDATE_TIME hasn't passed", async function () {
        const _newFee = 1_000;
        await vaultFactoryContract.connect(feeRole).proposeNewAdminFee(_newFee);
        let blockTime = await latest();
        const pendingFeeAdmin = await vaultFactoryContract.pendingFeeAdmin();
        const feeAdminUpdateTime = await vaultFactoryContract.feeAdminUpdateTime();
        expect(pendingFeeAdmin).to.be.equal(_newFee);
        expect(feeAdminUpdateTime).to.be.equal(blockTime.add(constants.UPDATE_TIME_FACTORY));
        await expect(vaultFactoryContract.updateNewAdminFee()).to.be.revertedWith("NibblVaultFactory: UPDATE_TIME not passed");
    });

    it("should fail to update fee if not proposed", async function () {
       await expect(vaultFactoryContract.updateNewAdminFee()).to.be.revertedWith("NibblVaultFactory: Not Proposed");
    });

    it("should withdraw admin fee", async function () {
        const _buyAmount = ethers.utils.parseEther("1000");
        const _feeAmountAdmin = _buyAmount.mul(constants.FEE_ADMIN).div(constants.SCALE);
        await vaultContract.connect(user1).buy(0, user1Address, { value: _buyAmount });
        const _initialBalanceFactory = await admin.provider.getBalance(vaultFactoryContract.address);
        await vaultFactoryContract.connect(admin).withdrawAdminFee();
        const _finalBalanceFactory = await admin.provider.getBalance(vaultFactoryContract.address);
        expect(_initialBalanceFactory).to.be.equal(_finalBalanceFactory.add(_feeAmountAdmin));
    });
  
    it("should propose nibblVaultImplementation", async function () {
        await vaultFactoryContract.connect(implementorRole).proposeNewVaultImplementation(user1Address);
        const blockTime = await latest();
        const pendingVaultImplementation = await vaultFactoryContract.pendingVaultImplementation();
        const vaultUpdateTime = await vaultFactoryContract.vaultUpdateTime();
        expect(pendingVaultImplementation).to.be.equal(user1Address);
        expect(vaultUpdateTime).to.be.equal(blockTime.add(constants.UPDATE_TIME_FACTORY));
    });

    it("should update nibblVaultImplementation", async function () {
        await vaultFactoryContract.connect(implementorRole).proposeNewVaultImplementation(user1Address);
        const blockTime = await latest();
        const pendingVaultImplementation = await vaultFactoryContract.pendingVaultImplementation();
        const vaultUpdateTime = await vaultFactoryContract.vaultUpdateTime();
        expect(pendingVaultImplementation).to.be.equal(user1Address);
        expect(vaultUpdateTime).to.be.equal(blockTime.add(constants.UPDATE_TIME_FACTORY));
        await advanceTimeAndBlock(constants.UPDATE_TIME_FACTORY);
        await vaultFactoryContract.updateVaultImplementation();
        expect(await vaultFactoryContract.vaultImplementation()).to.equal(user1Address);
    });

    it("should fail to update nibblVaultImplementation if UPDATE_TIME hasn't passed", async function () {
        await vaultFactoryContract.connect(implementorRole).proposeNewVaultImplementation(user1Address);
        const blockTime = await latest();
        const pendingVaultImplementation = await vaultFactoryContract.pendingVaultImplementation();
        const vaultUpdateTime = await vaultFactoryContract.vaultUpdateTime();
        expect(pendingVaultImplementation).to.be.equal(user1Address);
        expect(vaultUpdateTime).to.be.equal(blockTime.add(constants.UPDATE_TIME_FACTORY));

        await expect(vaultFactoryContract.updateVaultImplementation()).to.be.revertedWith("NibblVaultFactory: UPDATE_TIME not passed");
    });

    it("should fail to update nibblVaultImplementation if not proposed", async function () {
        await expect(vaultFactoryContract.updateVaultImplementation()).to.be.revertedWith("NibblVaultFactory: Not Proposed");
    });

    it("should fail to create a vault if initial balance is too low", async function () {

        
        await expect(vaultFactoryContract.connect(curator).createVault(
            erc721.address,
            curatorAddress,
            constants.tokenName,
            constants.tokenSymbol,
            0,
            constants.initialTokenSupply,
            10 ** 14,
            await latest(), {
                value: 0
            })).to.be.revertedWith("NibblVaultFactory: Initial reserve balance too low");
    });

    it("should fail if curator isn't sender", async function () {
        await expect(vaultFactoryContract.connect(user1).createVault(
            erc721.address,
            user1Address,
            constants.tokenName,
            constants.tokenSymbol,
            0,
            constants.initialTokenSupply,
            10 ** 14,
            await latest(),
            { value: constants.initialSecondaryReserveBalance })).to.be.revertedWith("NibblVaultFactory: Invalid sender");
    });

    it("should allow default admin to be able to change RoleAdmin", async function () {
        await vaultFactoryContract.connect(admin).setRoleAdmin(await vaultFactoryContract.IMPLEMENTER_ROLE(), await vaultFactoryContract.PAUSER_ROLE());
        expect(await vaultFactoryContract.getRoleAdmin(await vaultFactoryContract.IMPLEMENTER_ROLE())).to.equal(await vaultFactoryContract.PAUSER_ROLE());    
    });

    it("should allow RoleAdmin to grantRole", async function () {
        await vaultFactoryContract.connect(admin).grantRole(await vaultFactoryContract.IMPLEMENTER_ROLE(), user1Address);
        expect(await vaultFactoryContract.hasRole(await vaultFactoryContract.IMPLEMENTER_ROLE(), user1Address)).to.equal(true);    
    });

    it("should allow RoleAdmin to revokeRole", async function () {
        await vaultFactoryContract.connect(admin).grantRole(await vaultFactoryContract.IMPLEMENTER_ROLE(), user1Address);
        expect(await vaultFactoryContract.hasRole(await vaultFactoryContract.IMPLEMENTER_ROLE(), user1Address)).to.equal(true);    
        await vaultFactoryContract.connect(admin).revokeRole(await vaultFactoryContract.IMPLEMENTER_ROLE(), user1Address);
        expect(await vaultFactoryContract.hasRole(await vaultFactoryContract.IMPLEMENTER_ROLE(), user1Address)).to.equal(false);
    });

    it("should deploy basket deterministically and initialise successfully", async function () {
        const _mix = Math.random().toString();
        await vaultFactoryContract.createBasket(curatorAddress, _mix);        
        const _address = await vaultFactoryContract.getBasketAddress(curatorAddress, _mix);
        const Basket = await ethers.getContractFactory("Basket");
        const _basket = new ethers.Contract(_address, Basket.interface, curator);
        const _curator = await _basket.ownerOf(0);
        const _supportsInterface = await _basket.supportsInterface("0x79f071ff")
        expect(_curator).to.equal(curatorAddress);
        expect(_supportsInterface).to.equal(true);
    })
    it("should propose basketVaultImplementation", async function () {
        await vaultFactoryContract.connect(implementorRole).proposeNewBasketImplementation(user1Address);
        const blockTime = await latest();
        const pendingBasketImplementation = await vaultFactoryContract.pendingBasketImplementation();
        const basketUpdateTime = await vaultFactoryContract.basketUpdateTime();
        expect(pendingBasketImplementation).to.be.equal(user1Address);
        expect(basketUpdateTime).to.be.equal(blockTime.add(constants.UPDATE_TIME_FACTORY));
    });

    it("should update nibblBasketImplementation", async function () {
        await vaultFactoryContract.connect(implementorRole).proposeNewBasketImplementation(user1Address);
        const blockTime = await latest();
        const pendingBasketImplementation = await vaultFactoryContract.pendingBasketImplementation();
        const basketUpdateTime = await vaultFactoryContract.basketUpdateTime();
        expect(pendingBasketImplementation).to.be.equal(user1Address);
        expect(basketUpdateTime).to.be.equal(blockTime.add(constants.UPDATE_TIME_FACTORY));
        await advanceTimeAndBlock(constants.UPDATE_TIME_FACTORY);
        await vaultFactoryContract.updateBasketImplementation();
        expect(await vaultFactoryContract.basketImplementation()).to.equal(user1Address);
    });

    it("should fail to update nibblBasketImplementation if UPDATE_TIME hasn't passed", async function () {
        await vaultFactoryContract.connect(implementorRole).proposeNewBasketImplementation(user1Address);
        const blockTime = await latest();
        const pendingBasketImplementation = await vaultFactoryContract.pendingBasketImplementation();
        const basketUpdateTime = await vaultFactoryContract.basketUpdateTime();
        expect(pendingBasketImplementation).to.be.equal(user1Address);
        expect(basketUpdateTime).to.be.equal(blockTime.add(constants.UPDATE_TIME_FACTORY));
        await expect(vaultFactoryContract.updateBasketImplementation()).to.be.revertedWith("NibblVaultFactory: UPDATE_TIME not passed");
    });

    it("should fail to update nibblBasketImplementation if not proposed", async function () {
       await expect(vaultFactoryContract.updateBasketImplementation()).to.be.revertedWith("NibblVaultFactory: Not Proposed");
    });

});