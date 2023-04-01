import { time, loadFixture } from "@nomicfoundation/hardhat-network-helpers";
import { expect } from "chai";
import { ethers } from "hardhat";
import { Basket, Basket__factory, ERC1155Link, ERC1155Link__factory, ERC721TestToken, ERC721TestToken__factory, NibblVault, NibblVault2, NibblVault2__factory, NibblVaultFactory, NibblVaultFactory__factory, NibblVaultHelper, NibblVaultHelper__factory, NibblVault__factory, TestBancorFormula, TestBancorFormula__factory } from "../typechain-types";
import * as constants from "./constants";
import { getBigNumber } from "./helper";
import { BigNumber } from "ethers";


describe("ERC1155 Wrap", function () {

    async function deployNibblVaultFixture() {
        const [admin, implementationRole, feeRole, pausingRole, curator, feeTo, user1, user2, buyer1] = await ethers.getSigners();
        // Deploy ERC721Token
        const ERC721Token_Factory: ERC721TestToken__factory = await ethers.getContractFactory("ERC721TestToken");
        const erc721Token: ERC721TestToken = await (await ERC721Token_Factory.deploy()).deployed();

        //Deploy NibblVaultImplementation
        const NibblVault_Factory: NibblVault__factory = await ethers.getContractFactory("NibblVault");
        const vaultImplementation: NibblVault = await (await NibblVault_Factory.deploy()).deployed();

        // Deploy BasketImplementation
        const Basket_Factory: Basket__factory = await ethers.getContractFactory("Basket");
        const basketImplementation: Basket = await (await Basket_Factory.deploy()).deployed();

        // Deploy NibblVaultFactory
        const NibblVaultFactory: NibblVaultFactory__factory = await ethers.getContractFactory("NibblVaultFactory");
        const vaultFactoryContract: NibblVaultFactory = await (await NibblVaultFactory.connect(admin).deploy(vaultImplementation.address, feeTo.address, admin.address, basketImplementation.address)).deployed();

        const ERC1155Link_Factory: ERC1155Link__factory = await ethers.getContractFactory("ERC1155Link");
        const erc1155LinkImplementation: ERC1155Link = await (await ERC1155Link_Factory.deploy(vaultFactoryContract.address)).deployed();

        //Deploy NibblVaultImplementation
        const NibblVault2_Factory: NibblVault2__factory = await ethers.getContractFactory("NibblVault2");
        const vaultImplementation2: NibblVault2 = await (await NibblVault2_Factory.deploy(erc1155LinkImplementation.address)).deployed();

        const NibblVaultHelper_Factory: NibblVaultHelper__factory = await ethers.getContractFactory("NibblVaultHelper");
        const vaultHelper: NibblVaultHelper = await (await NibblVaultHelper_Factory.deploy()).deployed();

        const TestBancorFormula: TestBancorFormula__factory = await ethers.getContractFactory("TestBancorFormula");
        const testBancorFormulaContract: TestBancorFormula = await (await TestBancorFormula.connect(admin).deploy()).deployed();

        // grant roles
        await vaultFactoryContract.connect(admin).grantRole(await vaultFactoryContract.FEE_ROLE(), feeRole.address);
        await vaultFactoryContract.connect(admin).grantRole(await vaultFactoryContract.PAUSER_ROLE(), pausingRole.address);
        await vaultFactoryContract.connect(admin).grantRole(await vaultFactoryContract.IMPLEMENTER_ROLE(), implementationRole.address);

        await erc721Token.mint(curator.address, 0);
        await erc721Token.connect(curator).approve(vaultFactoryContract.address, 0);

        //create a vault
        await vaultFactoryContract.connect(curator).createVault(erc721Token.address, curator.address, constants.tokenName, constants.tokenSymbol, 0, constants.initialTokenSupply, constants.initialTokenPrice, (await time.latest()) + time.duration.days(4), { value: constants.initialSecondaryReserveBalance });

        await vaultFactoryContract.connect(implementationRole).proposeNewVaultImplementation(vaultImplementation2.address);
        await time.increase(constants.UPDATE_TIME_FACTORY);

        await vaultFactoryContract.updateVaultImplementation();

        const proxyAddress = await vaultFactoryContract.getVaultAddress(curator.address, erc721Token.address, 0, constants.initialTokenSupply, constants.initialTokenPrice);
        const vaultContract: NibblVault2 = NibblVault2_Factory.attach(proxyAddress).connect(curator)

        await (await vaultContract.createERC1155Link("Name", "Symbol")).wait();
        const erc1155Link = ERC1155Link_Factory.attach(await vaultContract.nibblERC1155Link());

        return { admin, implementationRole, feeRole, pausingRole, feeTo, user1, user2, erc721Token, vaultFactoryContract, vaultContract, curator, testBancorFormulaContract, buyer1, erc1155Link, vaultHelper };
    }

    describe("Wrapping and UnWrapping", () => {
        it("Should wrap tokens via vaultHelper", async function () {
            const { curator, erc1155Link, vaultContract, user1, vaultHelper, testBancorFormulaContract } = await loadFixture(deployNibblVaultFixture);
            const _tokenID = 0
            await (await erc1155Link.connect(curator).addTier(constants.MAX_CAP, constants.USER_CAP, constants.MINT_RATIO, _tokenID, constants.URI)).wait();
            // Huge Buy
            const _buyAmount = ethers.utils.parseEther("100");
            const _buyAmountWithFee = _buyAmount.sub(_buyAmount.mul(constants.FEE_TOTAL).div(constants.SCALE));
            const _purchaseReturn = await testBancorFormulaContract.calculatePurchaseReturn(constants.initialTokenSupply, constants.fictitiousPrimaryReserveBalance, constants.primaryReserveRatio, _buyAmountWithFee);
            const wrapAmt = 10;
            await vaultHelper.connect(user1).wrapNativeToERC1155(vaultContract.address, erc1155Link.address, user1.address, _purchaseReturn, 10, 0, { value: ethers.utils.parseEther("100") })
            expect(await vaultContract.balanceOf(user1.address)).to.be.equal(_purchaseReturn.sub(constants.MINT_RATIO.mul(wrapAmt)));
            expect(await erc1155Link.balanceOf(user1.address, _tokenID)).to.be.equal(wrapAmt)
            await vaultHelper.connect(user1).wrapNativeToERC1155(vaultContract.address, erc1155Link.address, user1.address, 0, 10, 0, { value: ethers.utils.parseEther("150") })
            // expect(await vaultContract.balanceOf(user1.address)).to.be.equal(_purchaseReturn.sub(constants.MINT_RATIO.mul(wrapAmt)));
            // expect(await erc1155Link.balanceOf(user1.address, _tokenID)).to.be.equal(wrapAmt)
        });
        
        it("Should unwrap tokens via vaultHelper", async function () {
            const { curator, erc1155Link, vaultContract, user1, vaultHelper, testBancorFormulaContract } = await loadFixture(deployNibblVaultFixture);
            const _tokenID = 0
            await (await erc1155Link.connect(curator).addTier(constants.MAX_CAP, constants.USER_CAP, constants.MINT_RATIO, _tokenID, constants.URI)).wait();
            // Huge Buy
            const wrapAmt = 10;
            await vaultHelper.connect(user1).wrapNativeToERC1155(vaultContract.address, erc1155Link.address, user1.address, 0, wrapAmt, 0, { value: ethers.utils.parseEther("100") })
            expect(await erc1155Link.balanceOf(user1.address, _tokenID)).to.be.equal(wrapAmt)
            // Wrapped
            const _sellAmount = constants.MINT_RATIO.mul(wrapAmt);
            const _expectedSaleReturn = await testBancorFormulaContract.calculateSaleReturn(
                await vaultContract.totalSupply(),
                await vaultContract.primaryReserveBalance(),
                constants.primaryReserveRatio,
                _sellAmount);
            const _feeTotal = constants.FEE_ADMIN.add(constants.FEE_CURATOR).add(constants.FEE_CURVE);
            
            const _expectedSaleReturnWithFee = _expectedSaleReturn.sub(_expectedSaleReturn.mul(_feeTotal).div(constants.SCALE)).add(1);
            //            
            await erc1155Link.connect(user1).setApprovalForAll(vaultHelper.address, true)
                let _balanceBuyer1 = await user1.provider.getBalance(await user1.getAddress()) ;
            await vaultHelper.connect(user1).unwrapERC1155ToNative(vaultContract.address, erc1155Link.address, user1.address, _expectedSaleReturnWithFee, 0, 10)
            expect(await erc1155Link.balanceOf(user1.address, _tokenID)).to.be.equal(0)
            // Some amt go for gas
            expect(await user1.provider.getBalance(await user1.getAddress())).to.be.lt(_balanceBuyer1.add(_expectedSaleReturnWithFee))
            expect(await user1.provider.getBalance(await user1.getAddress())).to.be.gt(_balanceBuyer1)
        });


        it("Users should be able redeem funds after buyout", async function () {
            const { curator, erc1155Link, vaultContract, user1, vaultHelper, testBancorFormulaContract, user2, buyer1 } = await loadFixture(deployNibblVaultFixture);

            // const { vaultContract, buyer1, curator, admin, user1 } = await loadFixture(deployNibblVaultFactoryFixture);
            await time.increase(time.duration.days(2));
            
            let balanceContract = constants.initialSecondaryReserveBalance, curatorFeeAccrued = ethers.constants.Zero;
            
            let _buyAmount = ethers.utils.parseEther("20");      
            curatorFeeAccrued = curatorFeeAccrued.add((_buyAmount.mul(constants.FEE_CURATOR)).div(constants.SCALE));
            await vaultContract.connect(user2).buy(0, user2.address, { value: _buyAmount }); 
            await vaultContract.connect(user1).buy(0, user1.address, { value: _buyAmount }); 
            
            const _buyoutDeposit = getBigNumber("200");                                           
            await vaultContract.connect(user2).initiateBuyout({ value: _buyoutDeposit });
            // --------------------- Wrap --------------------------//
            await (await erc1155Link.connect(curator).addTier(constants.MAX_CAP, constants.USER_CAP, constants.MINT_RATIO, 0, constants.URI)).wait();
            await (await erc1155Link.connect(curator).addTier(constants.MAX_CAP, constants.USER_CAP, constants.MINT_RATIO, 1, constants.URI)).wait();
            await (await erc1155Link.connect(curator).addTier(constants.MAX_CAP, constants.USER_CAP, constants.MINT_RATIO, 2, constants.URI)).wait();
            await (await erc1155Link.connect(curator).addTier(constants.MAX_CAP, constants.USER_CAP, constants.MINT_RATIO, 3, constants.URI)).wait();
            await (await vaultContract.connect(user1).buy(0, user1.address, { value: ethers.utils.parseEther("100") })).wait();
            await (await vaultContract.connect(user1).approve(erc1155Link.address, await vaultContract.balanceOf(user1.address))).wait()        
            const wrapAmt = 10;
            await (await erc1155Link.connect(user1).wrap(wrapAmt, 0, user1.address)).wait()           
            await (await erc1155Link.connect(user1).wrap(wrapAmt, 1, user1.address)).wait()           
            await (await erc1155Link.connect(user1).wrap(wrapAmt, 2, user1.address)).wait()           
            await (await erc1155Link.connect(user1).wrap(wrapAmt, 3, user1.address)).wait()           
            // ---------------------Buyout Initiated--------------------------//
            balanceContract = await user1.provider.getBalance(vaultContract.address);
            await time.increase(time.duration.days(5));
            const balanceBuyer = await vaultContract.balanceOf(user1.address);
            const totalSupply = await vaultContract.totalSupply();
            const returnAmt: BigNumber = ((balanceContract.sub(curatorFeeAccrued)).mul(balanceBuyer)).div(totalSupply);    
            const initialBalBuyer: BigNumber = await user1.provider.getBalance(buyer1.address);
            await erc1155Link.connect(user1).setApprovalForAll(vaultHelper.address, true);
            await vaultHelper.connect(user1).redeemMultipleEditionsForNative(erc1155Link.address, vaultContract.address, [0, 1, 2, 3], buyer1.address);
            (await erc1155Link.balanceOf(user1.address, 0)).isZero;
            (await erc1155Link.balanceOf(vaultHelper.address, 0)).isZero;
            (await erc1155Link.balanceOf(user1.address, 1)).isZero;
            (await erc1155Link.balanceOf(vaultHelper.address, 1)).isZero;
            (await erc1155Link.balanceOf(user1.address, 2)).isZero;
            (await erc1155Link.balanceOf(vaultHelper.address, 2)).isZero;
            (await erc1155Link.balanceOf(user1.address, 3)).isZero;
            (await erc1155Link.balanceOf(vaultHelper.address, 3)).isZero;
            (await user1.provider.getBalance(buyer1.address)).gt(initialBalBuyer);
            
        });
        it("Users should be able redeem funds from multiple tokenIDs after buyout", async function () {
            const { curator, erc1155Link, vaultContract, user1, vaultHelper, testBancorFormulaContract, user2, buyer1 } = await loadFixture(deployNibblVaultFixture);

            // const { vaultContract, buyer1, curator, admin, user1 } = await loadFixture(deployNibblVaultFactoryFixture);
            await time.increase(time.duration.days(2));
            
            let balanceContract = constants.initialSecondaryReserveBalance, curatorFeeAccrued = ethers.constants.Zero;
            
            let _buyAmount = ethers.utils.parseEther("20");      
            curatorFeeAccrued = curatorFeeAccrued.add((_buyAmount.mul(constants.FEE_CURATOR)).div(constants.SCALE));
            await vaultContract.connect(user2).buy(0, user2.address, { value: _buyAmount }); 
            await vaultContract.connect(user1).buy(0, user1.address, { value: _buyAmount }); 
            
            const _buyoutDeposit = getBigNumber("200");                                           
            await vaultContract.connect(user2).initiateBuyout({ value: _buyoutDeposit });
            // --------------------- Wrap --------------------------//
            await (await erc1155Link.connect(curator).addTier(constants.MAX_CAP, constants.USER_CAP, constants.MINT_RATIO, 0, constants.URI)).wait();
            await (await vaultContract.connect(user1).buy(0, user1.address, { value: ethers.utils.parseEther("100") })).wait();
            await (await vaultContract.connect(user1).approve(erc1155Link.address, await vaultContract.balanceOf(user1.address))).wait()        
            const wrapAmt = 10;
            await (await erc1155Link.connect(user1).wrap(wrapAmt, 0, user1.address)).wait()           
            // ---------------------Buyout Initiated--------------------------//
            balanceContract = await user1.provider.getBalance(vaultContract.address);
            await time.increase(time.duration.days(5));
            const balanceBuyer = await vaultContract.balanceOf(user1.address);
            const totalSupply = await vaultContract.totalSupply();
            const returnAmt: BigNumber = ((balanceContract.sub(curatorFeeAccrued)).mul(balanceBuyer)).div(totalSupply);    
            const initialBalBuyer: BigNumber = await user1.provider.getBalance(buyer1.address);
            await erc1155Link.connect(user1).setApprovalForAll(vaultHelper.address, true);
            await vaultHelper.connect(user1).redeemEditionForNative(erc1155Link.address, vaultContract.address, 0, buyer1.address);
            (await erc1155Link.balanceOf(user1.address, 0)).isZero;
            (await erc1155Link.balanceOf(vaultHelper.address, 0)).isZero;
            (await user1.provider.getBalance(buyer1.address)).gt(initialBalBuyer);
            
        });
          

    })

})