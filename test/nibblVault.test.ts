import { time, loadFixture } from "@nomicfoundation/hardhat-network-helpers";
import { expect } from "chai";
import { BigNumber } from "ethers";
import { ethers, network } from "hardhat";
import { Basket, Basket__factory, ERC721TestToken, ERC721TestToken__factory, NibblVault, NibblVaultFactory, NibblVaultFactory__factory, NibblVault__factory, TestBancorFormula, TestBancorFormula__factory } from "../typechain-types";
import * as constants from "./constants";
import { getBigNumber, getCurrentValuation } from "./helper";
import { TWAV } from "./twav";

describe("NibblVault", function () {

  async function deployNibblVaultFactoryFixture() {
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
    
    const TestBancorFormula: TestBancorFormula__factory = await ethers.getContractFactory("TestBancorFormula");
    const testBancorFormulaContract: TestBancorFormula = await (await TestBancorFormula.connect(admin).deploy()).deployed();
    
    // grant roles
    await vaultFactoryContract.connect(admin).grantRole(await vaultFactoryContract.FEE_ROLE(), feeRole.address);
    await vaultFactoryContract.connect(admin).grantRole(await vaultFactoryContract.PAUSER_ROLE(), pausingRole.address);
    await vaultFactoryContract.connect(admin).grantRole(await vaultFactoryContract.IMPLEMENTER_ROLE(), implementationRole.address);
    
    await erc721Token.mint(curator.address, 0);
    await erc721Token.connect(curator).approve(vaultFactoryContract.address, 0);

    //create a vault
    await vaultFactoryContract.connect(curator).createVault( erc721Token.address, curator.address, constants.tokenName, constants.tokenSymbol, 0, constants.initialTokenSupply, constants.initialTokenPrice, (await time.latest()) + time.duration.days(2), { value: constants.initialSecondaryReserveBalance });

    const proxyAddress = await vaultFactoryContract.getVaultAddress(curator.address, erc721Token.address, 0, constants.initialTokenSupply, constants.initialTokenPrice);
    const vaultContract: NibblVault = NibblVault_Factory.attach(proxyAddress)

    return { admin, implementationRole, feeRole, pausingRole, feeTo, user1, user2, erc721Token, vaultFactoryContract, vaultContract, curator, testBancorFormulaContract, buyer1};
  }

  describe("Initialization", function () {

    it("should initialize the vault.", async function () {
        const { vaultContract, curator, erc721Token } = await loadFixture(deployNibblVaultFactoryFixture);
        expect(await vaultContract.name()).to.equal(constants.tokenName);
        expect(await vaultContract.symbol()).to.equal(constants.tokenSymbol);
        expect(await vaultContract.curator()).to.equal(curator.address);
        expect(await vaultContract.status()).to.equal(0);        
        expect(await vaultContract.assetAddress()).to.equal(erc721Token.address);
        expect(await vaultContract.assetID()).to.equal(0);
        expect(await vaultContract.initialTokenSupply()).to.equal(constants.initialTokenSupply);
        expect(await vaultContract.secondaryReserveBalance()).to.equal(constants.initialSecondaryReserveBalance);
        expect(await vaultContract.secondaryReserveRatio()).to.equal(constants.initialSecondaryReserveRatio);
        expect(await vaultContract.primaryReserveBalance()).to.equal(constants.initialPrimaryReserveBalance);
        expect(await vaultContract.curatorFee()).to.equal(constants.FEE_CURATOR);
    });

    it("should not initialize the vault if secondaryReserveRatio > primaryReserveRatio.", async function () {
      const { vaultFactoryContract, curator, erc721Token } = await loadFixture(deployNibblVaultFactoryFixture);  
      await erc721Token.mint(await curator.getAddress(), 1);
      await erc721Token.connect(curator).approve(vaultFactoryContract.address, 1);
      await expect(vaultFactoryContract.connect(curator).createVault(
        erc721Token.address,
        curator.address,
        constants.tokenName,
        constants.tokenSymbol,
        1,
        constants.initialTokenSupply,
        constants.initialTokenPrice,
        await time.latest(),
        { value: (constants.primaryReserveRatio.mul(constants.initialValuation).div(constants.SCALE)).add(constants.ONE) })).to.be.revertedWith("NibblVault: Excess initial funds");
      });
      
      
      it("should not initialize the vault if secondaryReserveRatio too low.", async function () {
      const { vaultFactoryContract, curator, erc721Token } = await loadFixture(deployNibblVaultFactoryFixture);  
        await erc721Token.mint(await curator.getAddress(), 1);
        await erc721Token.connect(curator).approve(vaultFactoryContract.address, 1);

        await expect(vaultFactoryContract.connect(curator).createVault(
            erc721Token.address,
            curator.address,
            constants.tokenName,
            constants.tokenSymbol,
            1,
            constants.initialTokenSupply,
            constants.initialTokenPrice,
            await time.latest(),
            { value: (constants.initialSecondaryReserveBalance.div(getBigNumber(3, 3))) })).to.be.revertedWith("NibblVault: secResRatio too low");
    });
  });

  describe("Trade", function () {
    it("should buy tokens successfully from primary curve", async function () {
      const { vaultContract, testBancorFormulaContract, admin, buyer1, vaultFactoryContract } = await loadFixture(deployNibblVaultFactoryFixture);
      const _buyAmount = ethers.utils.parseEther("1");
      const _initialSecondaryBalance = await vaultContract.secondaryReserveBalance();
      const _initialPrimaryBalance = await vaultContract.primaryReserveBalance();
      const _buyAmountWithFee = _buyAmount.sub(_buyAmount.mul(constants.FEE_TOTAL).div(constants.SCALE));
      const _purchaseReturn = await testBancorFormulaContract.calculatePurchaseReturn(constants.initialTokenSupply, constants.fictitiousPrimaryReserveBalance, constants.primaryReserveRatio, _buyAmountWithFee);
      const _initialBalanceFactory: BigNumber = await admin.provider.getBalance(vaultFactoryContract.address);
      const _expectedSecBalance = _initialSecondaryBalance.add((_buyAmount.mul(constants.FEE_CURVE)).div(constants.SCALE));
      await vaultContract.connect(buyer1).buy(_purchaseReturn,await buyer1.getAddress(), { value: _buyAmount });
      
      expect(await vaultContract.balanceOf(await buyer1.getAddress())).to.equal(_purchaseReturn);
      expect(await vaultContract.secondaryReserveBalance()).to.equal(_expectedSecBalance);
      expect(await vaultContract.primaryReserveBalance()).to.equal(_initialPrimaryBalance.add(_buyAmountWithFee));
      expect(await vaultContract.secondaryReserveRatio()).to.equal((_expectedSecBalance.mul(constants.SCALE)).div(constants.initialValuation));        
      expect(await vaultContract.feeAccruedCurator()).to.equal((_buyAmount.mul(constants.FEE_CURATOR)).div(constants.SCALE));        
      if (admin.provider) {
        expect((await admin.provider.getBalance(vaultFactoryContract.address)).sub(_initialBalanceFactory)).to.equal((_buyAmount.mul(constants.FEE_ADMIN)).div(constants.SCALE));        
      }
    });
    
    it("should buy tokens successfully on multi curve", async function () {
      const { vaultContract, testBancorFormulaContract, buyer1, curator } = await loadFixture(deployNibblVaultFactoryFixture);
      // Selling Tokens
      const _sellAmount = (constants.initialTokenSupply).div(5); //Selling 1/5th the amount i.e 200k here
      await vaultContract.connect(curator).sell(_sellAmount, 0, await curator.getAddress());
      //---------------- 1/5th Tokens Sold ----------------        
      //Buy Tokens
      const _buyAmtTotal = ethers.utils.parseEther("20");
      const _buyAmtSecCurve = (constants.initialSecondaryReserveBalance).sub(await vaultContract.secondaryReserveBalance()); //secondaryCurve doesn't have any fee so exact amount
      const _purchaseReturnSecCurve = _sellAmount;
      
      const _buyAmtPrimaryCurve = _buyAmtTotal.sub(_buyAmtSecCurve);
      const _buyAmtPrimaryWithFee = _buyAmtPrimaryCurve.sub(_buyAmtPrimaryCurve.mul(constants.FEE_TOTAL).div(constants.SCALE));
      const _purchaseReturnPrimaryCurve = await testBancorFormulaContract.calculatePurchaseReturn(constants.initialTokenSupply, constants.initialPrimaryReserveBalance, constants.primaryReserveRatio, _buyAmtPrimaryWithFee);
      // Primary curve goes up from initialSupply. Therefore, constant.initialTokenSupply is used as continuousTokenSupply.
      const _initialBalanceBuyer = await vaultContract.balanceOf(await buyer1.getAddress());
      const _initialSecondaryBalance = await vaultContract.secondaryReserveBalance();
      const _initialPrimaryBalance = await vaultContract.primaryReserveBalance();
      
      await vaultContract.connect(buyer1).buy(_purchaseReturnPrimaryCurve.add(_purchaseReturnSecCurve), await buyer1.getAddress(), { value: _buyAmtTotal });
      expect((await vaultContract.balanceOf(await buyer1.getAddress())).sub(_initialBalanceBuyer)).to.equal(_purchaseReturnPrimaryCurve.add(_purchaseReturnSecCurve));
      expect(await vaultContract.secondaryReserveBalance()).to.equal(_initialSecondaryBalance.add(_buyAmtSecCurve).add(_buyAmtPrimaryCurve.mul(constants.FEE_CURVE).div(constants.SCALE)));
      expect(await vaultContract.primaryReserveBalance()).to.equal(_initialPrimaryBalance.add(_buyAmtPrimaryWithFee));
    });
    
    it("should buy tokens successfully on secondary curve", async function () {
      const { vaultContract, testBancorFormulaContract, buyer1, curator } = await loadFixture(deployNibblVaultFactoryFixture);
      // Selling Tokens
      const _sellAmount = constants.initialTokenSupply.sub(constants.initialTokenSupply.div(4)); //Selling 3/4 th the amount i.e 750k here
      await vaultContract.connect(curator).sell(_sellAmount, 0, await curator.getAddress());
      //---------------- 3/4th Tokens Sold ----------------        
      //Buy Tokens
      const _buyAmt = ethers.utils.parseEther("1");
      const _buyAmtWithFee = _buyAmt.sub(_buyAmt.mul(constants.FEE_SECONDARY_CURVE).div(constants.SCALE));
      const _purchaseReturn = await testBancorFormulaContract.calculatePurchaseReturn((constants.initialTokenSupply).sub(_sellAmount), await vaultContract.secondaryReserveBalance(), (constants.initialSecondaryReserveRatio), _buyAmtWithFee);
      const _initialBalanceBuyer = await vaultContract.balanceOf(await buyer1.getAddress());
      const _initialSecondaryBalance = await vaultContract.secondaryReserveBalance();
      await vaultContract.connect(buyer1).buy(_purchaseReturn, await buyer1.getAddress(), { value: _buyAmt });
      expect((await vaultContract.balanceOf(await buyer1.getAddress())).sub(_initialBalanceBuyer)).to.equal(_purchaseReturn);
      expect(await vaultContract.secondaryReserveBalance()).to.equal(_initialSecondaryBalance.add(_buyAmtWithFee));
    });
    
    it("should not buy tokens on primary curve if amtOut low", async function () { 
      const { vaultContract, testBancorFormulaContract, buyer1 } = await loadFixture(deployNibblVaultFactoryFixture);
      const _buyAmount = ethers.utils.parseEther("1");
      const _feeTotal = constants.FEE_ADMIN.add(constants.FEE_CURATOR).add(constants.FEE_CURVE);
      const _buyAmountWithFee = _buyAmount.sub(_buyAmount.mul(_feeTotal).div(constants.SCALE));
      const _purchaseReturn = (await testBancorFormulaContract.calculatePurchaseReturn(constants.initialTokenSupply, constants.initialPrimaryReserveBalance, constants.primaryReserveRatio, _buyAmountWithFee)).mul(constants.TWO);
      await expect(vaultContract.connect(buyer1).buy(_purchaseReturn, await buyer1.getAddress(), { value: _buyAmount })).to.be.revertedWith("NibblVault: Return too low");
    });
    
    it("should not buy tokens successfully on multi curve is return too low", async function () {
      const { vaultContract, testBancorFormulaContract, buyer1, curator } = await loadFixture(deployNibblVaultFactoryFixture);
      const _feeTotal = (constants.FEE_ADMIN).add(constants.FEE_CURATOR).add(constants.FEE_CURVE);
      //Selling Tokens
      const _sellAmount = (constants.initialTokenSupply).div(5); //Selling 1/5th the amount i.e 200k here
      const _expectedSaleReturn = await testBancorFormulaContract.calculateSaleReturn( constants.initialTokenSupply, constants.initialSecondaryReserveBalance, constants.initialSecondaryReserveRatio, _sellAmount);        
      await vaultContract.connect(curator).sell(_sellAmount, 0, await curator.getAddress());
      //---------------- 1/5th Tokens Sold ----------------        
      //Buy Tokens
      const _buyAmtTotal = ethers.utils.parseEther("20");
      const _buyAmtSecCurve = _expectedSaleReturn; //secondaryCurve doesn't have any fee so exact amount
      const _purchaseReturnSecCurve = _sellAmount;
      const _buyAmtPrimaryCurve = _buyAmtTotal.sub(_buyAmtSecCurve);
      const _buyAmtPrimaryWithFee = _buyAmtPrimaryCurve.sub(_buyAmtPrimaryCurve.mul(_feeTotal).div(constants.SCALE));
      const _purchaseReturnPrimaryCurve = await testBancorFormulaContract.calculatePurchaseReturn(constants.initialTokenSupply, constants.initialPrimaryReserveBalance, constants.primaryReserveRatio, _buyAmtPrimaryWithFee);        
      // Primary curve goes up from initialSupply. Therefore, constant.initialTokenSupply is used as continuousTokenSupply.
      await expect(vaultContract.connect(buyer1).buy(_purchaseReturnPrimaryCurve.add(_purchaseReturnSecCurve).mul(constants.TWO), await buyer1.getAddress(), { value: _buyAmtTotal })).to.be.revertedWith("NibblVault: Return too low");
    })
    
    it("should not buy tokens on secondary curve if amtOut low", async function () { 
      const { vaultContract, testBancorFormulaContract, buyer1, curator } = await loadFixture(deployNibblVaultFactoryFixture);
      //Selling Tokens
      const _sellAmount = constants.initialTokenSupply.sub(constants.initialTokenSupply.div(4)); //Selling 1/5th the amount i.e 200k here
      const _expectedSaleReturn = await testBancorFormulaContract.calculateSaleReturn(constants.initialTokenSupply, constants.initialSecondaryReserveBalance, constants.initialSecondaryReserveRatio, _sellAmount);        
      await vaultContract.connect(curator).sell(_sellAmount, 0, await curator.getAddress());
      //---------------- 3/4th Tokens Sold ----------------        
      //Buy Tokens
      const _buyAmt = ethers.utils.parseEther("1");
      const _purchaseReturn = (await testBancorFormulaContract.calculatePurchaseReturn((constants.initialTokenSupply).sub(_sellAmount), (constants.initialSecondaryReserveBalance).sub(_expectedSaleReturn), (constants.initialSecondaryReserveRatio), _buyAmt)).mul(constants.TWO);
      await expect(vaultContract.connect(buyer1).buy(_purchaseReturn, await buyer1.getAddress(), { value: _buyAmt })).to.be.revertedWith("NibblVault: Return too low");
    });
    
    it("should sell tokens successfully from primary curve", async function () {
      const { vaultContract, testBancorFormulaContract, buyer1, curator, vaultFactoryContract, admin } = await loadFixture(deployNibblVaultFactoryFixture);
      const _buyAmount = ethers.utils.parseEther("1");
      const _feeTotal = constants.FEE_ADMIN.add(constants.FEE_CURATOR).add(constants.FEE_CURVE);
      const _initialSecondaryBalance = await vaultContract.secondaryReserveBalance();
      const _initialPrimaryBalance = await vaultContract.primaryReserveBalance();
      const _buyAmountWithFee = _buyAmount.sub(_buyAmount.mul(_feeTotal).div(constants.SCALE));
      const _purchaseReturn = await testBancorFormulaContract.calculatePurchaseReturn(constants.initialTokenSupply, constants.initialPrimaryReserveBalance, constants.primaryReserveRatio, _buyAmountWithFee);
      let _initialBalanceFactory = admin.provider ? await admin.provider.getBalance(vaultFactoryContract.address) : ethers.constants.Zero;
      let _newSecBalance = _initialSecondaryBalance.add((_buyAmount.mul(constants.FEE_CURVE)).div(constants.SCALE));
      await vaultContract.connect(buyer1).buy(_purchaseReturn, await buyer1.getAddress(), { value: _buyAmount });
      // ------------------Tokens Bought----------------
      // Sell Tokens
      const _feeAccruedInitial = await vaultContract.feeAccruedCurator();
      const _sellAmount = _purchaseReturn.div(2); //Only selling half the amount bought
      const _sellReturn = await testBancorFormulaContract.calculateSaleReturn(constants.initialTokenSupply.add(_purchaseReturn),  _initialPrimaryBalance.add(_buyAmountWithFee), constants.primaryReserveRatio, _sellAmount);
      const _sellReturnWithFee = _sellReturn.sub(_sellReturn.mul(_feeTotal).div(constants.SCALE));
      _initialBalanceFactory = await admin.provider.getBalance(vaultFactoryContract.address)
      await vaultContract.connect(buyer1).sell(_sellAmount, _sellReturnWithFee, await buyer1.getAddress());
      expect(await vaultContract.totalSupply()).to.equal(constants.initialTokenSupply.add(_purchaseReturn).sub(_sellAmount));
      expect(await vaultContract.balanceOf(await buyer1.getAddress())).to.equal(_purchaseReturn.sub(_sellAmount));
      expect((await vaultContract.feeAccruedCurator()).sub(_feeAccruedInitial)).to.equal((_sellReturn.mul(constants.FEE_CURATOR)).div(constants.SCALE));
      expect(await vaultContract.secondaryReserveRatio()).to.equal((_newSecBalance.add(_sellReturn.mul(constants.FEE_CURVE).div(constants.SCALE))).mul(constants.SCALE).div(constants.initialValuation));        
      expect(await vaultContract.secondaryReserveBalance()).to.equal(_newSecBalance.add(_sellReturn.mul(constants.FEE_CURVE).div(constants.SCALE)));        
      expect(await vaultContract.primaryReserveBalance()).to.equal(_initialPrimaryBalance.add(_buyAmountWithFee).sub(_sellReturn));
      expect((await admin.provider.getBalance(vaultFactoryContract.address)).sub(_initialBalanceFactory)).to.equal((_sellReturn.mul(constants.FEE_ADMIN)).div(constants.SCALE))
    })
    
    it("should sell tokens successfully on secondary curve", async function () {
      const { vaultContract, testBancorFormulaContract, buyer1, curator, vaultFactoryContract, admin } = await loadFixture(deployNibblVaultFactoryFixture);
      const _sellAmount = (constants.initialTokenSupply).div(5);
      let _balanceBuyer1 = buyer1.provider ? await buyer1.provider.getBalance(await buyer1.getAddress()) : buyer1.provider;
      const _expectedSaleReturn = await testBancorFormulaContract.calculateSaleReturn(constants.initialTokenSupply, constants.initialSecondaryReserveBalance, constants.initialSecondaryReserveRatio, _sellAmount);        
      const _expectedSaleReturnWithFee = _expectedSaleReturn.sub(_expectedSaleReturn.mul(constants.FEE_SECONDARY_CURVE).div(constants.SCALE));
      await vaultContract.connect(curator).sell(_sellAmount, _expectedSaleReturnWithFee, buyer1.address);
      expect(await vaultContract.balanceOf(await curator.getAddress())).to.equal((constants.initialTokenSupply).sub(_sellAmount));
      // expect((await addr1.provider.getBalance(await addr1.getAddress())).sub(_balanceAddr1)).to.equal((_expectedSaleReturnWithFee));        
      // expect(await vaultContract.secondaryReserveBalance()).to.equal((constants.initialSecondaryReserveBalance).sub(_expectedSaleReturnWithFee));
      // JS Rounding Error
      expect(await vaultContract.totalSupply()).to.equal((constants.initialTokenSupply).sub(_sellAmount));
    })
    
    it("should sell tokens successfully on multi curve", async function () {
      const { vaultContract, testBancorFormulaContract, buyer1, curator, vaultFactoryContract, admin } = await loadFixture(deployNibblVaultFactoryFixture);
      await vaultContract.connect(curator).transfer(await buyer1.getAddress(), constants.initialTokenSupply); //Transfer all tokens to buyer
      const _buyAmount = ethers.utils.parseEther("5");
      const _feeTotal = (constants.FEE_ADMIN).add(constants.FEE_CURATOR).add(constants.FEE_CURVE);
      const _buyAmountWithFee = _buyAmount.sub(_buyAmount.mul(_feeTotal).div(constants.SCALE));
      const _purchaseReturn = await testBancorFormulaContract.calculatePurchaseReturn( constants.initialTokenSupply, constants.initialPrimaryReserveBalance, constants.primaryReserveRatio, _buyAmountWithFee);
      await vaultContract.connect(buyer1).buy(0, await buyer1.getAddress(), { value: _buyAmount });
      ///--------Bought Tokens --------------//
      // Sell Tokens        
      const _balanceBuyer1Initial = await buyer1.getBalance();
      const _initialPrimaryBalance = (constants.initialPrimaryReserveBalance).add(_buyAmountWithFee);
      const _sellAmount = (constants.initialTokenSupply).div(2); //Only selling half the amount bought initially 500k
      const _totalSupplyInitial = (constants.initialTokenSupply).add(_purchaseReturn);
      const _expectedSaleReturnPrimary = _initialPrimaryBalance.sub((constants.initialPrimaryReserveBalance));        
      const _expectedSaleReturnPrimaryWithFee = _expectedSaleReturnPrimary.sub(_expectedSaleReturnPrimary.mul(_feeTotal).div(constants.SCALE));
      const newSecResBal = (constants.initialSecondaryReserveBalance).add(_expectedSaleReturnPrimary.mul(constants.FEE_CURVE).div(constants.SCALE)).add(_buyAmount.mul(constants.FEE_CURVE).div(constants.SCALE));
      const newSecResRatio = newSecResBal.mul(constants.SCALE).div(constants.initialValuation);
      const _expectedSaleReturnSecondary = await testBancorFormulaContract.calculateSaleReturn(_totalSupplyInitial.sub(_purchaseReturn), newSecResBal, newSecResRatio, _sellAmount.sub(_purchaseReturn));        
      const _expectedSaleReturnSecondaryWithFee = _expectedSaleReturnSecondary.sub(_expectedSaleReturnSecondary.mul(constants.FEE_SECONDARY_CURVE).div(constants.SCALE));
      await vaultContract.connect(buyer1).sell(_sellAmount, _expectedSaleReturnPrimaryWithFee.add(_expectedSaleReturnSecondaryWithFee), buyer1.address);
      const _balanceBuyer11Final = await buyer1.getBalance();
      // expect(_balanceAddr1Final.sub(_balanceAddr1Initial)).to.equal(_expectedSaleReturnPrimaryWithFee.add(_expectedSaleReturnSecondaryWithFee));        
      // 14637145600625506646 
      // 14637145600625506645
      // expect(_balanceBuyer11Final.sub(_balanceBuyer1Initial).toString()).to.equal("14745688336696974277");        Depends on GAS
    });
    
    it("should not sell tokens on primary curve if return amt low", async function () {
      const { vaultContract, testBancorFormulaContract, buyer1, curator, vaultFactoryContract, admin } = await loadFixture(deployNibblVaultFactoryFixture);
      // Buy Tokens 
      const _buyAmount = ethers.utils.parseEther("1");
      const _feeTotal = constants.FEE_ADMIN.add(constants.FEE_CURATOR).add(constants.FEE_CURVE);
      const _initialSecondaryBalance = await vaultContract.secondaryReserveBalance();
      const _initialPrimaryBalance = await vaultContract.primaryReserveBalance();
      const _buyAmountWithFee = _buyAmount.sub(_buyAmount.mul(_feeTotal).div(constants.SCALE));
      const _purchaseReturn = await testBancorFormulaContract.calculatePurchaseReturn(constants.initialTokenSupply, constants.initialPrimaryReserveBalance, constants.primaryReserveRatio, _buyAmountWithFee);
      let _initialBalanceFactory = await admin.provider.getBalance(vaultFactoryContract.address);
      let _newSecBalance = _initialSecondaryBalance.add((_buyAmount.mul(constants.FEE_CURVE)).div(constants.SCALE));
      await vaultContract.connect(buyer1).buy(_purchaseReturn, await buyer1.getAddress(), { value: _buyAmount });
      // ------------------Tokens Bought----------------
      // Sell Tokens
      const _sellAmount = _purchaseReturn.div(2); //Only selling half the amount bought
      const _sellReturn = await testBancorFormulaContract.calculateSaleReturn(constants.initialTokenSupply.add(_purchaseReturn),  _initialPrimaryBalance.add(_buyAmountWithFee), constants.primaryReserveRatio, _sellAmount);
      const _sellReturnWithFee = (_sellReturn.sub(_sellReturn.mul(_feeTotal).div(constants.SCALE))).mul(constants.TWO);
      _initialBalanceFactory = await admin.provider.getBalance(vaultFactoryContract.address)
      await expect(vaultContract.connect(buyer1).sell(_sellAmount, _sellReturnWithFee, await buyer1.getAddress())).to.be.revertedWith("NibblVault: Return too low");
    })
    
    it("should not sell tokens successfully on secondary curve is return too low", async function () {
      const { vaultContract, testBancorFormulaContract, buyer1, curator, vaultFactoryContract, admin } = await loadFixture(deployNibblVaultFactoryFixture);
      const _sellAmount = (constants.initialTokenSupply).div(5);
      const _expectedSaleReturn = (await testBancorFormulaContract.calculateSaleReturn(constants.initialTokenSupply, constants.initialSecondaryReserveBalance, constants.initialSecondaryReserveRatio, _sellAmount)).mul(constants.TWO);
      await expect(vaultContract.connect(curator).sell(_sellAmount, _expectedSaleReturn, buyer1.address)).to.be.revertedWith("NibblVault: Return too low");
    })
    
    it("should not sell tokens successfully on multi curve if return too low", async function () {
      const { vaultContract, testBancorFormulaContract, buyer1, curator, vaultFactoryContract, admin } = await loadFixture(deployNibblVaultFactoryFixture);
      await vaultContract.connect(curator).transfer(await buyer1.getAddress(), constants.initialTokenSupply); //Transfer all tokens to buyer
      const _buyAmount = ethers.utils.parseEther("1");
      const _feeTotal = (constants.FEE_ADMIN).add(constants.FEE_CURATOR).add(constants.FEE_CURVE);
      const _buyAmountWithFee = _buyAmount.sub(_buyAmount.mul(_feeTotal).div(constants.SCALE));
      const _purchaseReturn = await testBancorFormulaContract.calculatePurchaseReturn(constants.initialTokenSupply, constants.initialPrimaryReserveBalance, constants.primaryReserveRatio, _buyAmountWithFee);
      await vaultContract.connect(buyer1).buy(_purchaseReturn, await buyer1.getAddress(), { value: _buyAmount });
      ///--------Bought Tokens --------------//
      // Sell Tokens        
      const _initialPrimaryBalance = (constants.initialPrimaryReserveBalance).add(_buyAmountWithFee);
      const _sellAmount = ((constants.initialTokenSupply).add(_purchaseReturn)).div(2); //Only selling half the amount bought initially 500k
      const _totalSupplyInitial = (constants.initialTokenSupply).add(_purchaseReturn);
      const _expectedSaleReturnPrimary = _initialPrimaryBalance.sub((constants.initialPrimaryReserveBalance));        
      const _expectedSaleReturnPrimaryWithFee = _expectedSaleReturnPrimary.sub(_expectedSaleReturnPrimary.mul(_feeTotal).div(constants.SCALE));
      const newSecResBal = (constants.initialSecondaryReserveBalance).add(_expectedSaleReturnPrimary.mul(constants.FEE_CURVE).div(constants.SCALE)).add(_buyAmount.mul(constants.FEE_CURVE).div(constants.SCALE));
      const newSecResRatio = newSecResBal.mul(constants.SCALE).div(constants.initialValuation);
      const _expectedSaleReturnSecondary = await testBancorFormulaContract.calculateSaleReturn(_totalSupplyInitial.sub(_purchaseReturn), newSecResBal, newSecResRatio, _sellAmount.sub(_purchaseReturn));        
      await expect(vaultContract.connect(buyer1).sell(_sellAmount, (_expectedSaleReturnPrimaryWithFee.add(_expectedSaleReturnSecondary)).mul(constants.TWO), buyer1.address)).to.be.revertedWith("NibblVault: Return too low");
    });
    
    it("should not sell all the tokens successfully", async function () {
      const { vaultContract, testBancorFormulaContract, buyer1, curator, vaultFactoryContract, admin } = await loadFixture(deployNibblVaultFactoryFixture);
      const _sellAmount = constants.initialTokenSupply;
      const _expectedSaleReturn = (await testBancorFormulaContract.calculateSaleReturn(constants.initialTokenSupply, constants.initialSecondaryReserveBalance, constants.initialSecondaryReserveRatio, _sellAmount));
      await expect(vaultContract.connect(curator).sell(_sellAmount, _expectedSaleReturn, buyer1.address)).to.be.revertedWith("NibblVault: Excess sell");
    })
  });
  
  describe("Buyout", function () {

    let twav: TWAV;
    this.beforeEach(() => {
      twav = new TWAV()
    })

    it("Should initiate buyout when bid == currentValuation", async function () {
      const { vaultContract, buyer1 } = await loadFixture(deployNibblVaultFactoryFixture);
      await time.increase(time.duration.days(2));
      const currentValuation: BigNumber = constants.initialValuation;
      const buyoutRejectionValuation: BigNumber = currentValuation.mul((constants.SCALE).add(constants.rejectionPremium)).div(constants.SCALE);
      const buyoutBidDeposit: BigNumber = currentValuation.sub((constants.initialPrimaryReserveBalance).sub(constants.fictitiousPrimaryReserveBalance)).sub(constants.initialSecondaryReserveBalance);
      // totalSupply() < constants.initialTokenSupply ? (secondaryReserveBalance * SCALE /secondaryReserveRatio) : ((primaryReserveBalance) * SCALE  / primaryReserveRatio);
      await vaultContract.connect(buyer1).initiateBuyout({ value: buyoutBidDeposit });
      const blockTime = getBigNumber(await time.latest(), 0);
      twav.addObservation(currentValuation, blockTime);
      expect(await vaultContract.buyoutValuationDeposit()).to.equal(buyoutBidDeposit);
      expect(await vaultContract.bidder()).to.equal(buyer1.address);
      expect(await vaultContract.buyoutBid()).to.equal(currentValuation);
      expect(await vaultContract.buyoutEndTime()).to.equal(blockTime.add(constants.BUYOUT_DURATION));
      expect(await vaultContract.buyoutRejectionValuation()).to.equal(buyoutRejectionValuation);
      expect(await vaultContract.status()).to.equal(1);
      expect(await vaultContract.lastBlockTimeStamp()).to.equal(blockTime);
    })
    
    it("Should initiate buyout when bid >= currentValuation", async function () {
      const { vaultContract, buyer1 } = await loadFixture(deployNibblVaultFactoryFixture);
      await time.increase(time.duration.days(2));
      const currentValuation: BigNumber = constants.initialValuation;
      const initialTokenVaultBalance: BigNumber = await buyer1.provider.getBalance(vaultContract.address)
      const buyoutRejectionValuation: BigNumber = currentValuation.mul(constants.SCALE.add(constants.rejectionPremium)).div(constants.SCALE);
      const buyoutBidDeposit: BigNumber = currentValuation.sub(constants.initialPrimaryReserveBalance.sub(constants.fictitiousPrimaryReserveBalance)).sub(constants.initialSecondaryReserveBalance);
      await vaultContract.connect(buyer1).initiateBuyout({ value: buyoutBidDeposit.mul(BigNumber.from(2)) });
      const blockTime = getBigNumber(await time.latest(), 0);
      twav.addObservation(currentValuation, blockTime);
      expect(await vaultContract.buyoutValuationDeposit()).to.equal(buyoutBidDeposit);
      expect(await vaultContract.bidder()).to.equal(buyer1.address);
      expect(await vaultContract.buyoutBid()).to.equal(currentValuation);
      expect(await vaultContract.buyoutEndTime()).to.equal(blockTime.add(constants.BUYOUT_DURATION));
      expect(await vaultContract.buyoutRejectionValuation()).to.equal(buyoutRejectionValuation);
      expect(await vaultContract.status()).to.equal(1);
      expect(await vaultContract.lastBlockTimeStamp()).to.equal(blockTime);
      const twavObs = await vaultContract.twavObservations(0)
      expect(twavObs.timestamp).to.equal(twav.twavObservations[0].timestamp);
      expect(twavObs.cumulativeValuation).to.equal(twav.twavObservations[0].cumulativeValuation);
      if (buyer1.provider) {
        expect(await buyer1.provider.getBalance(vaultContract.address)).to.equal(initialTokenVaultBalance.add(buyoutBidDeposit));
      }
    });
    
    it("Should not initiate buyout when bid < currentValuation", async function () {
      const { vaultContract, buyer1 } = await loadFixture(deployNibblVaultFactoryFixture);
      await time.increase(time.duration.days(2));
      const currentValuation: BigNumber = constants.initialValuation;
      const buyoutBidDeposit: BigNumber = currentValuation.sub(constants.initialPrimaryReserveBalance.sub(constants.fictitiousPrimaryReserveBalance)).sub(constants.initialSecondaryReserveBalance);
      await expect(vaultContract.connect(buyer1).initiateBuyout({ value: buyoutBidDeposit.div(BigNumber.from(2)) })).to.be.revertedWith("NibblVault: Bid too low");
    });
    it("Should not initiate buyout if minBuyoutTime < now", async function () {
      const { vaultContract, buyer1 } = await loadFixture(deployNibblVaultFactoryFixture);
      const currentValuation: BigNumber = constants.initialValuation;
      const buyoutBidDeposit: BigNumber = currentValuation.sub((constants.initialPrimaryReserveBalance).sub(constants.fictitiousPrimaryReserveBalance)).sub(constants.initialSecondaryReserveBalance);
      await expect(vaultContract.connect(buyer1).initiateBuyout({ value: buyoutBidDeposit })).to.be.revertedWith("NibblVault: minBuyoutTime < now");
    });
    
    it("Should update twav on buy when in buyout", async function () {
      const { vaultContract, buyer1 } = await loadFixture(deployNibblVaultFactoryFixture);
      await time.increase(time.duration.days(2));
      let currentValuation: BigNumber = constants.initialValuation;
      const buyoutBidDeposit: BigNumber = currentValuation.sub((constants.initialPrimaryReserveBalance).sub(constants.fictitiousPrimaryReserveBalance)).sub(constants.initialSecondaryReserveBalance);
      await vaultContract.connect(buyer1).initiateBuyout({ value: buyoutBidDeposit.mul(BigNumber.from(2)) });
      let blockTime = getBigNumber(await time.latest(), 0);
      twav.addObservation(currentValuation, blockTime);
      const twavObs = await vaultContract.twavObservations(0);
      expect(twavObs.timestamp).to.equal(twav.twavObservations[0].timestamp);
      expect(twavObs.cumulativeValuation).to.equal(twav.twavObservations[0].cumulativeValuation);
      // -------------------------Buyout Initiated--------------------------
      // ----------------------------1st Buy Operation Initiated-----------------------------------  
      getBigNumber(await time.increase(time.duration.minutes(2)), 0)
      const _buyAmount = ethers.utils.parseEther("1");
      // currentValuation = await getCurrentValuation(vaultContract); //TWAV is written before buy
      await vaultContract.connect(buyer1).buy(0, buyer1.address, { value: _buyAmount });
      blockTime = getBigNumber(await time.latest(), 0);
      twav.addObservation(currentValuation, blockTime);
      const twavObs1 = await vaultContract.twavObservations(1)
      expect(twavObs1.timestamp).to.equal(twav.twavObservations[1].timestamp);
      expect(twavObs1.cumulativeValuation).to.equal(twav.twavObservations[1].cumulativeValuation);
      // ----------------------------1st Buy Operation-----------------------------------  
      // ----------------------------2nd Buy Operation Initiated-----------------------------------  
      await time.increase(time.duration.minutes(2))       
      currentValuation = await getCurrentValuation(vaultContract); //TWAV is written before buy
      await vaultContract.connect(buyer1).buy(0, buyer1.address, { value: _buyAmount });
      blockTime = getBigNumber(await time.latest(), 0);
      twav.addObservation(currentValuation, blockTime);
      const twavObs2 = await vaultContract.twavObservations(2)
      expect(twavObs2.timestamp).to.equal(twav.twavObservations[2].timestamp);
      expect(twavObs2.cumulativeValuation).to.equal(twav.twavObservations[2].cumulativeValuation);
      // ----------------------------2nd Buy Operation-----------------------------------  
    });
    
    it("Should update twav on sell when in buyout", async function () {
      const { vaultContract, buyer1, curator } = await loadFixture(deployNibblVaultFactoryFixture);
      await time.increase(time.duration.days(2));
      let currentValuation: BigNumber = constants.initialValuation;
      const buyoutBidDeposit: BigNumber = currentValuation.sub(constants.initialPrimaryReserveBalance.sub(constants.fictitiousPrimaryReserveBalance)).sub(constants.initialSecondaryReserveBalance);
      await vaultContract.connect(buyer1).initiateBuyout({ value: buyoutBidDeposit.mul(BigNumber.from(2)) });
      let blockTime = getBigNumber(await time.latest(), 0);
      twav.addObservation(currentValuation, blockTime);
      const twavObs = await vaultContract.twavObservations(0);
      expect(twavObs.timestamp).to.equal(twav.twavObservations[0].timestamp);
      expect(twavObs.cumulativeValuation).to.equal(twav.twavObservations[0].cumulativeValuation);
      // -------------------------Buyout Initiated--------------------------
      
      const _sellAmount = (constants.initialTokenSupply).div(5);
      await vaultContract.connect(curator).sell(_sellAmount, 0, buyer1.address);
      expect(await vaultContract.balanceOf(curator.address)).to.equal(constants.initialTokenSupply.sub(_sellAmount));
      
      expect(await vaultContract.totalSupply()).to.equal(constants.initialTokenSupply.sub(_sellAmount));
      blockTime = getBigNumber(await time.latest(), 0);
      twav.addObservation(currentValuation, blockTime); // No change is valuation happens before twav is recorded 
      const twavObs1 = await vaultContract.twavObservations(1)
      expect(twavObs1.timestamp).to.equal(twav.twavObservations[1].timestamp);
      expect(twavObs1.cumulativeValuation).to.equal(twav.twavObservations[1].cumulativeValuation);
      // ----------------------------1st Sell Operation-----------------------------------  
      // ----------------------------2nd Sell Operation Initiated-----------------------------------  
      currentValuation = await getCurrentValuation(vaultContract);
      await vaultContract.connect(curator).sell(_sellAmount, 0, buyer1.address);
      blockTime = getBigNumber(await time.latest(), 0);
      twav.addObservation(currentValuation, blockTime);
      const twavObs2 = await vaultContract.twavObservations(2)
      expect(twavObs2.timestamp).to.equal(twav.twavObservations[2].timestamp);
      expect(twavObs2.cumulativeValuation).to.equal(twav.twavObservations[2].cumulativeValuation);
      // ----------------------------2nd Buy Operation-----------------------------------  
    });
    
    it("Should reject buyout", async function () {
      const { vaultContract, buyer1, curator } = await loadFixture(deployNibblVaultFactoryFixture);
      await time.increase(time.duration.days(2));
      let currentValuation: BigNumber = constants.initialValuation;
      const buyoutBidDeposit: BigNumber = currentValuation.sub(constants.initialPrimaryReserveBalance.sub(constants.fictitiousPrimaryReserveBalance)).sub(constants.initialSecondaryReserveBalance);
      const buyoutRejectionValuation: BigNumber = currentValuation.mul(constants.SCALE.add(constants.rejectionPremium)).div(constants.SCALE);
      await vaultContract.connect(buyer1).initiateBuyout({ value: buyoutBidDeposit.mul(BigNumber.from(2)) });
      let blockTime = getBigNumber(await time.latest(), 0);
    // -------------------------Buyout Initiated--------------------------

      for (let index = 0; true; index++) {
          const _buyAmount = ethers.utils.parseEther("10");      
          await vaultContract.connect(buyer1).buy(0, buyer1.address, { value: _buyAmount });
          await time.increase(time.duration.minutes(2));
          blockTime = getBigNumber(await time.latest(), 0);
          twav.addObservation(currentValuation, blockTime);
          currentValuation = await getCurrentValuation(vaultContract);
          if (twav.getTwav() >= buyoutRejectionValuation) {
              await vaultContract.connect(buyer1).buy(0, buyer1.address, { value: _buyAmount });
              break;
          }
    }
    expect(await vaultContract.buyoutRejectionValuation()).to.equal(ethers.constants.Zero);
    expect(await vaultContract.buyoutEndTime()).to.equal(ethers.constants.Zero);
    expect((await vaultContract.bidder())).to.equal(ethers.constants.AddressZero);
    expect((await vaultContract.twavObservations(0))[0]).to.equal(ethers.constants.Zero);
    expect(await vaultContract.twavObservationsIndex()).to.equal(ethers.constants.Zero);
    expect(await vaultContract.totalUnsettledBids()).to.equal(buyoutBidDeposit);
    expect(await vaultContract.unsettledBids(buyer1.address)).to.equal(buyoutBidDeposit);
  });


  it("Shouldn't be able to buy after buyout has been completed.", async function () {
      const { vaultContract, buyer1, curator } = await loadFixture(deployNibblVaultFactoryFixture);
      await time.increase(time.duration.days(2));
      await time.increase(time.duration.minutes(2));
      let currentValuation: BigNumber = constants.initialValuation;
      const buyoutBidDeposit: BigNumber = currentValuation.sub((constants.initialPrimaryReserveBalance).sub(constants.fictitiousPrimaryReserveBalance)).sub(constants.initialSecondaryReserveBalance);
      await vaultContract.connect(buyer1).initiateBuyout({ value: buyoutBidDeposit });
      // ---------------------Buyout Initiated--------------------------//
      await time.increase(time.duration.days(5));
      const _buyAmount = ethers.utils.parseEther("2");      
      await expect(vaultContract.connect(buyer1).buy(0, buyer1.address, { value: _buyAmount })).to.be.revertedWith("NibblVault: Bought Out");
    });
    
    
    it("Shouldn't be able to sell after buyout has been completed.", async function () {
    const { vaultContract, buyer1, curator } = await loadFixture(deployNibblVaultFactoryFixture);
    await time.increase(time.duration.days(2));
    let currentValuation: BigNumber = constants.initialValuation;
    const buyoutBidDeposit: BigNumber = currentValuation.sub((constants.initialPrimaryReserveBalance).sub(constants.fictitiousPrimaryReserveBalance)).sub(constants.initialSecondaryReserveBalance);
    await vaultContract.connect(buyer1).initiateBuyout({ value: buyoutBidDeposit });
    // ---------------------Buyout Initiated--------------------------//
    await time.increase(time.duration.days(5));
    
    const _sellAmount = constants.initialTokenSupply.div(5);
    await expect(vaultContract.connect(curator).sell(_sellAmount, 0, buyer1.address)).to.be.revertedWith("NibblVault: Bought Out");
  });
  
  it("Shouldn't be able to initiate buyout with buyout already going on", async function () {
    const { vaultContract, buyer1, curator } = await loadFixture(deployNibblVaultFactoryFixture);
    await time.increase(time.duration.days(2));
    
    let currentValuation: BigNumber = constants.initialValuation;
    const buyoutBidDeposit: BigNumber = currentValuation.sub(constants.initialPrimaryReserveBalance.sub(constants.fictitiousPrimaryReserveBalance)).sub(constants.initialSecondaryReserveBalance);
    await vaultContract.connect(buyer1).initiateBuyout({ value: buyoutBidDeposit });
    // ---------------------Buyout Initiated--------------------------//
    await expect(vaultContract.connect(buyer1).initiateBuyout({ value: buyoutBidDeposit })).to.be.revertedWith("NibblVault: Status!=initialized");
  });
  
  
  it("Should be able to withdraw unsettled bids", async function () {
    const { vaultContract, buyer1, curator } = await loadFixture(deployNibblVaultFactoryFixture);
    await time.increase(time.duration.days(2));
    
    let currentValuation: BigNumber = constants.initialValuation;
    const buyoutBidDeposit: BigNumber = currentValuation.sub(constants.initialPrimaryReserveBalance.sub(constants.fictitiousPrimaryReserveBalance)).sub(constants.initialSecondaryReserveBalance);
    await vaultContract.connect(buyer1).initiateBuyout({ value: buyoutBidDeposit });
    // ---------------------Buyout Initiated--------------------------//
    
    for (let index = 0; true; index++) {
      
      const _buyAmount = ethers.utils.parseEther("10");
      const buyoutRejectionValuation: BigNumber = currentValuation.mul(constants.SCALE.add(constants.rejectionPremium)).div(constants.SCALE);
      let blockTime = getBigNumber(await time.latest(), 0);
      await time.increase(time.duration.minutes(2));
      twav.addObservation(currentValuation, blockTime);
      await vaultContract.connect(buyer1).buy(0, buyer1.address, { value: _buyAmount });
      currentValuation = await getCurrentValuation(vaultContract);
      if (twav.getTwav() >= buyoutRejectionValuation) {
        break;
      }
    }
    // --------------------- Buyout Rejected--------------------------//
    const initialBal = await buyer1.provider.getBalance(vaultContract.address)
    await vaultContract.connect(buyer1).withdrawUnsettledBids(buyer1.address);
    expect(await buyer1.provider.getBalance(vaultContract.address)).to.be.equal(initialBal.sub(buyoutBidDeposit));
  });
  
  
  it("User should be able to initiate buyout after rejection of a bid", async function () {
    const { vaultContract, buyer1, curator } = await loadFixture(deployNibblVaultFactoryFixture);
    await time.increase(time.duration.days(2));
    
    let currentValuation: BigNumber = constants.initialValuation;
    let buyoutBidDeposit: BigNumber = currentValuation.sub(constants.initialPrimaryReserveBalance.sub(constants.fictitiousPrimaryReserveBalance)).sub(constants.initialSecondaryReserveBalance);
    let buyoutRejectionValuation: BigNumber = currentValuation.mul(constants.SCALE.add(constants.rejectionPremium)).div(constants.SCALE);
    let _newPrimaryBalance: BigNumber;
    await vaultContract.connect(buyer1).initiateBuyout({ value: buyoutBidDeposit.mul(BigNumber.from(2)) });
    let blockTime = getBigNumber(await time.latest(), 0);
    twav.addObservation(currentValuation, blockTime);
    const twavObs = await vaultContract.twavObservations(0);
    expect(twavObs.timestamp).to.equal(twav.twavObservations[0].timestamp);
    expect(twavObs.cumulativeValuation).to.equal(twav.twavObservations[0].cumulativeValuation);
    
    // -------------------------Buyout Initiated-------------------------- //
    for (let index = 0; true; index++) {
      const _buyAmount = ethers.utils.parseEther("10");      
      const _feeTotal = constants.FEE_ADMIN.add(constants.FEE_CURATOR).add(constants.FEE_CURVE);
      const _initialSecondaryBalance = await vaultContract.secondaryReserveBalance();
      const _initialPrimaryBalance = await vaultContract.primaryReserveBalance();
      const _buyAmountWithFee = _buyAmount.sub(_buyAmount.mul(_feeTotal).div(constants.SCALE));
      _newPrimaryBalance = _initialPrimaryBalance.add(_buyAmountWithFee);
      const _newSecondaryBalance = _initialSecondaryBalance.add((_buyAmount.mul(constants.FEE_CURATOR)).div(constants.SCALE));
      const _newSecondaryResRatio = _newSecondaryBalance.mul(constants.SCALE).div(constants.initialValuation);
      await vaultContract.connect(buyer1).buy(0, buyer1.address, { value: _buyAmount });
      await time.increase(time.duration.minutes(2));
      blockTime = getBigNumber(await time.latest(), 0);
      twav.addObservation(currentValuation, blockTime);
      currentValuation = (_newSecondaryBalance.mul(constants.SCALE).div(_newSecondaryResRatio)).add((_newPrimaryBalance.sub(constants.fictitiousPrimaryReserveBalance)).mul(constants.SCALE).div(constants.primaryReserveRatio));
      if (twav.getTwav() >= buyoutRejectionValuation) {
        await vaultContract.connect(buyer1).buy(0, buyer1.address, { value: _buyAmount });
        break;
      }
    }
    expect(await vaultContract.status()).to.equal(0);
    expect(await vaultContract.buyoutRejectionValuation()).to.equal(ethers.constants.Zero);
    expect(await vaultContract.buyoutEndTime()).to.equal(ethers.constants.Zero);
    expect((await vaultContract.bidder())).to.equal(ethers.constants.AddressZero);
    expect((await vaultContract.twavObservations(0))[0]).to.equal(ethers.constants.Zero);
    expect(await vaultContract.twavObservationsIndex()).to.equal(ethers.constants.Zero);
    expect(await vaultContract.totalUnsettledBids()).to.equal(buyoutBidDeposit);
    expect(await vaultContract.unsettledBids(buyer1.address)).to.equal(buyoutBidDeposit);
    // ------------------------------Buyout Rejected ------------------------------------ //
    
    currentValuation = _newPrimaryBalance.mul(constants.SCALE).div(constants.primaryReserveRatio);
    buyoutRejectionValuation = currentValuation.mul((constants.SCALE).add(constants.rejectionPremium)).div(constants.SCALE);
    buyoutBidDeposit = currentValuation.sub((constants.initialPrimaryReserveBalance).sub(constants.fictitiousPrimaryReserveBalance)).sub(constants.initialSecondaryReserveBalance);
    await vaultContract.connect(buyer1).initiateBuyout({ value: buyoutBidDeposit.mul(getBigNumber(2, 1)) });
    blockTime = getBigNumber(await time.latest(), 0);
    twav.addObservation(currentValuation, blockTime);
    expect(await vaultContract.bidder()).to.equal(buyer1.address);
    expect(await vaultContract.buyoutEndTime()).to.equal(blockTime.add(constants.BUYOUT_DURATION));
    expect(await vaultContract.status()).to.equal(1);
    expect(await vaultContract.lastBlockTimeStamp()).to.equal(blockTime);
    
  });
  
  
  it("Users should be able redeem funds after buyout", async function () {
    const { vaultContract, buyer1, curator, admin, user1 } = await loadFixture(deployNibblVaultFactoryFixture);
    await time.increase(time.duration.days(2));
    
    let balanceContract = constants.initialSecondaryReserveBalance, curatorFeeAccrued = ethers.constants.Zero;
    
    let _buyAmount = ethers.utils.parseEther("20");      
    curatorFeeAccrued = curatorFeeAccrued.add((_buyAmount.mul(constants.FEE_CURATOR)).div(constants.SCALE));
    await vaultContract.connect(buyer1).buy(0, buyer1.address, { value: _buyAmount }); 
    
    const _buyoutDeposit = getBigNumber("200");                                           
    await vaultContract.connect(buyer1).initiateBuyout({ value: _buyoutDeposit });
    // ---------------------Buyout Initiated--------------------------//
    
    balanceContract = await admin.provider.getBalance(vaultContract.address);
    await time.increase(time.duration.days(5));
    const balanceBuyer = await vaultContract.balanceOf(buyer1.address);
    const totalSupply = await vaultContract.totalSupply();
    const returnAmt: BigNumber = ((balanceContract.sub(curatorFeeAccrued)).mul(balanceBuyer)).div(totalSupply);    
    const initialBalBuyer: BigNumber = await admin.provider.getBalance(user1.address);
    await vaultContract.connect(buyer1).redeem(user1.address); 
    expect(await admin.provider.getBalance(user1.address)).to.be.equal(initialBalBuyer.add(returnAmt));
    expect(await vaultContract.balanceOf(user1.address)).to.be.equal(ethers.constants.Zero);
  });
  
  it("Users should not be able redeem funds before buyout", async function () {
    const { vaultContract, buyer1 } = await loadFixture(deployNibblVaultFactoryFixture);
    await time.increase(time.duration.days(2));
    
    let balanceContract = constants.initialSecondaryReserveBalance, curatorFeeAccrued = ethers.constants.Zero;
    
    let _buyAmount = ethers.utils.parseEther("20");      
    curatorFeeAccrued = curatorFeeAccrued.add((_buyAmount.mul(constants.FEE_CURATOR)).div(constants.SCALE));
    await vaultContract.connect(buyer1).buy(0, buyer1.address, { value: _buyAmount }); 
    // ---------------------Buyout Initiated--------------------------//
    
    await expect(vaultContract.connect(buyer1).redeem(buyer1.address)).to.be.revertedWith("NibblVault: status != buyout"); 
  });
  
  it("Users should not be able redeem funds before buyout", async function () {
    const { vaultContract, buyer1 } = await loadFixture(deployNibblVaultFactoryFixture);
    await time.increase(time.duration.days(2));
    
    let balanceContract = constants.initialSecondaryReserveBalance, curatorFeeAccrued = ethers.constants.Zero;
    
    let _buyAmount = ethers.utils.parseEther("20");      
    curatorFeeAccrued = curatorFeeAccrued.add((_buyAmount.mul(constants.FEE_CURATOR)).div(constants.SCALE));
    await vaultContract.connect(buyer1).buy(0, buyer1.address, { value: _buyAmount }); 
    
    const _buyoutDeposit = getBigNumber("200");                                           
    await vaultContract.connect(buyer1).initiateBuyout({ value: _buyoutDeposit });
    // ---------------------Buyout Initiated--------------------------//
    await expect(vaultContract.connect(buyer1).redeem(buyer1.address)).to.be.revertedWith("NibblVault: buyoutEndTime <= now"); 
    
  });
  
  
  it("Winner should be able to withdraw the locked NFT", async function () {
    const { vaultContract, buyer1, erc721Token } = await loadFixture(deployNibblVaultFactoryFixture);
    await time.increase(time.duration.days(2));
    
    const buyoutBidDeposit = ethers.utils.parseEther("1000");
    await vaultContract.connect(buyer1).initiateBuyout({ value: buyoutBidDeposit });
    // ---------------------Buyout Initiated--------------------------//
    await time.increase(time.duration.days(5));
    // ---------------------Buyout Finished--------------------------//
    //withdrawNFT(address _assetAddress, address _to, uint256 _assetID)
    
    await vaultContract.connect(buyer1).withdrawERC721(await vaultContract.assetAddress(), await vaultContract.assetID(), buyer1.address);
    expect(await erc721Token.ownerOf(0)).to.be.equal(buyer1.address);
  });
  
  it("Only winner should be able to withdraw the locked NFT", async function () {
    const { vaultContract, buyer1, user1 } = await loadFixture(deployNibblVaultFactoryFixture);
    await time.increase(time.duration.days(2));
    
    const buyoutBidDeposit = ethers.utils.parseEther("1000");
    await vaultContract.connect(buyer1).initiateBuyout({ value: buyoutBidDeposit });
    // ---------------------Buyout Initiated--------------------------//
    await time.increase(time.duration.days(5));
    // ---------------------Buyout Finished--------------------------//
    //withdrawNFT(address _assetAddress, address _to, uint256 _assetID)
    
    await expect(vaultContract.connect(user1).withdrawERC721(await vaultContract.assetAddress(), await vaultContract.assetID(), buyer1.address)).to.be.revertedWith("NibblVault: Only winner");
  });
  
  it("Winner should be able to withdraw multiple the locked NFT", async function () {
    const { vaultContract, buyer1, erc721Token } = await loadFixture(deployNibblVaultFactoryFixture);
    await time.increase(time.duration.days(2));
    
    const buyoutBidDeposit = ethers.utils.parseEther("1000");
    await vaultContract.connect(buyer1).initiateBuyout({ value: buyoutBidDeposit });
    // ---------------------Buyout Initiated--------------------------//
    await erc721Token.mint(vaultContract.address, 1);
    await erc721Token.mint(vaultContract.address, 2);
    await time.increase(time.duration.days(5));
    // ---------------------Buyout Finished--------------------------//
    let _assetAddresses = [], _assetIDs = [];
    for (let i = 0; i < 3; i++) {
      _assetAddresses.push(erc721Token.address);
      _assetIDs.push(i);
    }
    await vaultContract.connect(buyer1).withdrawMultipleERC721(_assetAddresses, _assetIDs, buyer1.address);
    expect(await erc721Token.ownerOf(0)).to.be.equal(buyer1.address);
    expect(await erc721Token.ownerOf(1)).to.be.equal(buyer1.address);
    expect(await erc721Token.ownerOf(2)).to.be.equal(buyer1.address);
  });
  
  it("Only Winner should be able to withdraw multiple the locked NFT", async function () {
    const { vaultContract, buyer1, erc721Token, user1 } = await loadFixture(deployNibblVaultFactoryFixture);
    await time.increase(time.duration.days(2));
    const buyoutBidDeposit = ethers.utils.parseEther("1000");
    await vaultContract.connect(buyer1).initiateBuyout({ value: buyoutBidDeposit });
    
    // ---------------------Buyout Initiated--------------------------//
    await erc721Token.mint(vaultContract.address, 1);
    await erc721Token.mint(vaultContract.address, 2);
    await time.increase(time.duration.days(5));
    // ---------------------Buyout Finished--------------------------//
    let _assetAddresses = [], _assetIDs = [];
    for (let i = 0; i < 3; i++) {
      _assetAddresses.push(erc721Token.address);
      _assetIDs.push(i);
    }
    await expect(vaultContract.connect(user1).withdrawMultipleERC721(_assetAddresses, _assetIDs, buyer1.address)).to.be.revertedWith("NibblVault: Only winner");
  });
  
  it("Winner should be able to withdraw locked ERC20", async function () {
    const { vaultContract, buyer1 } = await loadFixture(deployNibblVaultFactoryFixture);
    await time.increase(time.duration.days(2));
    
    const buyoutBidDeposit = ethers.utils.parseEther("1000");
    await vaultContract.connect(buyer1).initiateBuyout({ value: buyoutBidDeposit });
    // ---------------------Buyout Initiated--------------------------//
    const amount = 1000000;    
    
    const ERC20Token = await ethers.getContractFactory("ERC20TestToken");
    const erc20 = await ERC20Token.deploy();
    await erc20.deployed();
    await erc20.mint(vaultContract.address, amount);
    
    await time.increase(time.duration.days(5));
    // ---------------------Buyout Finished--------------------------//

    await vaultContract.connect(buyer1).withdrawERC20(erc20.address, buyer1.address);
    expect(await erc20.balanceOf(buyer1.address)).to.be.equal(amount);
   });

  it("Only Winner should be able to withdraw locked ERC20", async function () {
    const { vaultContract, buyer1, user1 } = await loadFixture(deployNibblVaultFactoryFixture);
    await time.increase(time.duration.days(2));
    
    const buyoutBidDeposit = ethers.utils.parseEther("1000");
    await vaultContract.connect(buyer1).initiateBuyout({ value: buyoutBidDeposit });
    // ---------------------Buyout Initiated--------------------------//
    const amount = 1000000;    
    
    const ERC20Token = await ethers.getContractFactory("ERC20TestToken");
    const erc20 = await ERC20Token.deploy();
    await erc20.deployed();
    await erc20.mint(vaultContract.address, amount);
    
    await time.increase(time.duration.days(5));
    // ---------------------Buyout Finished--------------------------//
    
    await expect(vaultContract.connect(user1).withdrawERC20(erc20.address, buyer1.address)).to.be.revertedWith("NibblVault: Only winner");
    
  });
  
  
  it("Winner should be able to withdraw locked ERC20s", async function () {
    const { vaultContract, buyer1 } = await loadFixture(deployNibblVaultFactoryFixture);
    await time.increase(time.duration.days(2));

    const buyoutBidDeposit = ethers.utils.parseEther("1000");
    await vaultContract.connect(buyer1).initiateBuyout({ value: buyoutBidDeposit });
    // ---------------------Buyout Initiated--------------------------//
    const amount = 1000000;    
    const ERC20Token = await ethers.getContractFactory("ERC20TestToken");
    const erc20a = await ERC20Token.deploy();
    await erc20a.deployed();
    await erc20a.mint(vaultContract.address, amount);
    const erc20b = await ERC20Token.deploy();
    await erc20b.deployed();
    await erc20b.mint(vaultContract.address, amount);

    await time.increase(time.duration.days(5));
    // ---------------------Buyout Finished--------------------------//
    let _assetAddresses = [];
    _assetAddresses.push(erc20a.address, erc20b.address);

    await vaultContract.connect(buyer1).withdrawMultipleERC20(_assetAddresses, buyer1.address);
    expect(await erc20a.balanceOf(buyer1.address)).to.be.equal(amount);
    expect(await erc20b.balanceOf(buyer1.address)).to.be.equal(amount);
  });

  it("Only Winner should be able to withdraw locked ERC20s", async function () {
    const { vaultContract, buyer1, user1 } = await loadFixture(deployNibblVaultFactoryFixture);
    await time.increase(time.duration.days(2));

    const buyoutBidDeposit = ethers.utils.parseEther("1000");
    await vaultContract.connect(buyer1).initiateBuyout({ value: buyoutBidDeposit });
    // ---------------------Buyout Initiated--------------------------//
    const amount = 1000000;    
    const ERC20Token = await ethers.getContractFactory("ERC20TestToken");
    const erc20a = await ERC20Token.deploy();
    await erc20a.deployed();
    await erc20a.mint(vaultContract.address, amount);
    const erc20b = await ERC20Token.deploy();
    await erc20b.deployed();
    await erc20b.mint(vaultContract.address, amount);

    await time.increase(time.duration.days(5));    // ---------------------Buyout Finished--------------------------//
    let _assetAddresses = [];
    _assetAddresses.push(erc20a.address, erc20b.address);

    await expect(vaultContract.connect(user1).withdrawMultipleERC20(_assetAddresses, buyer1.address)).to.be.revertedWith("NibblVault: Only winner");
  });


  it("Winner should be able to withdraw locked ERC1155s", async function () {
    const { vaultContract, buyer1, user1 } = await loadFixture(deployNibblVaultFactoryFixture);
    await time.increase(time.duration.days(2));
    const buyoutBidDeposit = ethers.utils.parseEther("1000");
    await vaultContract.connect(buyer1).initiateBuyout({ value: buyoutBidDeposit });
    // ---------------------Buyout Initiated--------------------------//
    const amount = 1000000;    

    const ERC1155Token = await ethers.getContractFactory("ERC1155TestToken");
    const erc1155 = await ERC1155Token.deploy();
    await erc1155.deployed();
    await erc1155.mint(vaultContract.address, 0, amount);
    
    await time.increase(time.duration.days(5));
    await vaultContract.connect(buyer1).withdrawERC1155(erc1155.address, 0, buyer1.address);
    expect(await erc1155.balanceOf(buyer1.address, 0)).to.be.equal(amount);
  });

  it("Only Winner should be able to withdraw locked ERC1155s", async function () {
    const { vaultContract, buyer1, user1 } = await loadFixture(deployNibblVaultFactoryFixture);
    await time.increase(time.duration.days(2));
    const buyoutBidDeposit = ethers.utils.parseEther("1000");
    await vaultContract.connect(buyer1).initiateBuyout({ value: buyoutBidDeposit });
    // ---------------------Buyout Initiated--------------------------//
    const amount = 1000000;    

    const ERC1155Token = await ethers.getContractFactory("ERC1155TestToken");
    const erc1155 = await ERC1155Token.deploy();
    await erc1155.deployed();
    await erc1155.mint(vaultContract.address, 0, amount);
    
    await time.increase(time.duration.days(5));
    await expect(vaultContract.connect(user1).withdrawERC1155(erc1155.address, 0, buyer1.address)).to.be.revertedWith("NibblVault: Only winner");
  });


  it("Winner should be able to withdraw multiple locked ERC1155s", async function () {
    const { vaultContract, buyer1, user1 } = await loadFixture(deployNibblVaultFactoryFixture);
    await time.increase(time.duration.days(2));

    const buyoutBidDeposit = ethers.utils.parseEther("1000");
    await vaultContract.connect(buyer1).initiateBuyout({ value: buyoutBidDeposit });
    // ---------------------Buyout Initiated--------------------------//
    const amount = 1000000;    

    const ERC1155Token = await ethers.getContractFactory("ERC1155TestToken");
    const erc1155 = await ERC1155Token.deploy();
    await erc1155.deployed();
    await erc1155.mint(vaultContract.address, 0, amount);
    await erc1155.mint(vaultContract.address, 1, amount);
    
    await time.increase(time.duration.days(5));    // ---------------------Buyout Finished--------------------------//
    let _assetAddresses = [], _assetIDs = [0, 1];
    _assetAddresses.push(erc1155.address, erc1155.address);
    
    await vaultContract.connect(buyer1).withdrawMultipleERC1155(_assetAddresses, _assetIDs, buyer1.address);
    expect(await erc1155.balanceOf(buyer1.address, 0)).to.be.equal(amount);
    expect(await erc1155.balanceOf(buyer1.address, 1)).to.be.equal(amount);
  });
  
  it("Only Winner should be able to withdraw multiple locked ERC1155s", async function () {
    const { vaultContract, buyer1, user1 } = await loadFixture(deployNibblVaultFactoryFixture);
    await time.increase(time.duration.days(2));
    const buyoutBidDeposit = ethers.utils.parseEther("1000");
    await vaultContract.connect(buyer1).initiateBuyout({ value: buyoutBidDeposit });
    // ---------------------Buyout Initiated--------------------------//
    const amount = 1000000;    

    const ERC1155Token = await ethers.getContractFactory("ERC1155TestToken");
    const erc1155 = await ERC1155Token.deploy();
    await erc1155.deployed();
    await erc1155.mint(vaultContract.address, 0, amount);
    await erc1155.mint(vaultContract.address, 1, amount);
    
    await time.increase(time.duration.days(5));    // ---------------------Buyout Finished--------------------------//
    let _assetAddresses = [], _assetIDs = [0, 1];
    _assetAddresses.push(erc1155.address, erc1155.address);
    
    await expect(vaultContract.connect(user1).withdrawMultipleERC1155(_assetAddresses, _assetIDs, buyer1.address)).to.be.revertedWith("NibblVault: Only winner");
  });

    it("Should update twav only once on buy in a block when in buyout", async function () {
        const { vaultContract, buyer1, user1 } = await loadFixture(deployNibblVaultFactoryFixture);
        await time.increase(time.duration.days(2));
        await network.provider.send("evm_setAutomine", [false]);
        
        let currentValuation: BigNumber = constants.initialValuation;
        const buyoutBidDeposit: BigNumber = currentValuation.sub((constants.initialPrimaryReserveBalance).sub(constants.fictitiousPrimaryReserveBalance)).sub(constants.initialSecondaryReserveBalance);
        await vaultContract.connect(buyer1).initiateBuyout({ value: buyoutBidDeposit.mul(BigNumber.from(2)) });
        await network.provider.send("evm_mine");
        let blockTime = getBigNumber(await time.latest(), 0);
        twav.addObservation(currentValuation, blockTime);
        const twavObs = await vaultContract.twavObservations(0);
        expect(twavObs.timestamp).to.equal(twav.twavObservations[0].timestamp);
        expect(twavObs.cumulativeValuation).to.equal(twav.twavObservations[0].cumulativeValuation);

        // -------------------------Buyout Initiated--------------------------
        // ----------------------------1st Buy Operation Initiated-----------------------------------  
        await time.increase(time.duration.days(3));
        const _buyAmount = ethers.utils.parseEther("1");
        const _feeTotal = (constants.FEE_ADMIN).add(constants.FEE_CURATOR).add(constants.FEE_CURVE);
        const _initialSecondaryBalance = await vaultContract.secondaryReserveBalance();
        const _initialPrimaryBalance = await vaultContract.primaryReserveBalance();
        const _buyAmountWithFee = _buyAmount.sub(_buyAmount.mul(_feeTotal).div(constants.SCALE));
        const _newPrimaryBalance = _initialPrimaryBalance.add(_buyAmountWithFee);
        const _newSecondaryBalance = _initialSecondaryBalance.add((_buyAmount.mul(constants.FEE_CURATOR)).div(constants.SCALE));
        const _newSecondaryResRatio = _newSecondaryBalance.mul(constants.SCALE).div(constants.initialValuation);
        await vaultContract.connect(buyer1).buy(0, buyer1.address, { value: _buyAmount });
        twav.addObservation(currentValuation, blockTime);
        // ----------------------------1st Buy Operation-----------------------------------  
        // ----------------------------2nd Buy Operation Initiated-----------------------------------  
        currentValuation = (_newSecondaryBalance.mul(constants.SCALE).div(_newSecondaryResRatio)).add((_newPrimaryBalance.sub(constants.fictitiousPrimaryReserveBalance)).mul(constants.SCALE).div(constants.primaryReserveRatio));
        await vaultContract.connect(buyer1).buy(0, buyer1.address, { value: _buyAmount });
        await network.provider.send("evm_mine");
        const twavObservations = await vaultContract.getTwavObservations()
        expect(twavObservations[3][0]).to.equal(0);
        expect(twavObservations[3][1]).to.equal(0);     
        await network.provider.send("evm_setAutomine", [true]);
  });
  
  it("Should update twav only once on sell in a block when in buyout", async function () {
    const { vaultContract, buyer1, user1, curator } = await loadFixture(deployNibblVaultFactoryFixture);
    await time.increase(time.duration.days(2));
    await network.provider.send("evm_setAutomine", [false]);
    let currentValuation: BigNumber = constants.initialValuation;
    const buyoutBidDeposit: BigNumber = currentValuation.sub(constants.initialPrimaryReserveBalance.sub(constants.fictitiousPrimaryReserveBalance)).sub(constants.initialSecondaryReserveBalance);
    await vaultContract.connect(buyer1).initiateBuyout({ value: buyoutBidDeposit.mul(BigNumber.from(2)) });
    await network.provider.send("evm_mine");
    let blockTime = getBigNumber(await time.latest(), 0);
    twav.addObservation(currentValuation, blockTime);
    const twavObs = await vaultContract.twavObservations(0);
    expect(twavObs.timestamp).to.equal(twav.twavObservations[0].timestamp);
    expect(twavObs.cumulativeValuation).to.equal(twav.twavObservations[0].cumulativeValuation);

    // -------------------------Buyout Initiated--------------------------
    
    const _sellAmount = (constants.initialTokenSupply).div(5);
    let _balanceAddr1 = await buyer1.provider.getBalance(buyer1.address);
    // const _expectedSaleReturn = await burnTokens(testBancorFormula, constants.initialTokenSupply, constants.initialSecondaryReserveBalance, constants.initialSecondaryReserveRatio, _sellAmount);        
    await vaultContract.connect(curator).sell(_sellAmount, 0, buyer1.address);
    blockTime = getBigNumber(await time.latest(), 0);
    twav.addObservation(currentValuation, blockTime);
    const twavObs1 = await vaultContract.twavObservations(1)
    // ----------------------------1st Sell Operation-----------------------------------  
    // ----------------------------2nd Sell Operation Initiated-----------------------------------  

    currentValuation = await getCurrentValuation(vaultContract);
    await vaultContract.connect(curator).sell(_sellAmount, 0, buyer1.address);
    await network.provider.send("evm_mine");
    // ----------------------------2nd Buy Operation-----------------------------------  
    await network.provider.send("evm_setAutomine", [true]);

   });
  
    it("Only winner should be able to withdraw the locked NFT", async function () {
      const { vaultContract, buyer1, user1, curator } = await loadFixture(deployNibblVaultFactoryFixture);
      await time.increase(time.duration.days(2));
      const buyoutBidDeposit = ethers.utils.parseEther("1000");
      await vaultContract.connect(buyer1).initiateBuyout({ value: buyoutBidDeposit });
      // ---------------------Buyout Initiated--------------------------//
      await time.increase(time.duration.days(5));
      // ---------------------Buyout Finished--------------------------//
      //withdrawNFT(address _assetAddress, address _to, uint256 _assetID)
      await expect(vaultContract.connect(user1).withdrawERC721(await vaultContract.assetAddress(), await vaultContract.assetID(), buyer1.address)).to.be.revertedWith("NibblVault: Only winner");
    });
    
    it("should transfer ERC1155", async function () {
      const { vaultContract, buyer1, user1, curator } = await loadFixture(deployNibblVaultFactoryFixture);
      await time.increase(time.duration.days(2));
      const amount = 1000000;    
      const ERC1155Token = await ethers.getContractFactory("ERC1155TestToken");
      const erc1155 = await ERC1155Token.deploy();
      await erc1155.deployed();
      const ids = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
      const amounts = [amount, amount, amount, amount, amount, amount, amount, amount, amount, amount];
      await erc1155.mintBatch(curator.address, ids, amounts);
      await erc1155.connect(curator).safeBatchTransferFrom(curator.address, vaultContract.address, ids, amounts, "0x00");
    });
  })
  
  describe("Curator", () => {
    it("should accrue and redeem curator fee correctly", async function () {
      const { vaultContract, buyer1, user1, curator } = await loadFixture(deployNibblVaultFactoryFixture);
      const _buyAmount = ethers.utils.parseEther("1");
      await vaultContract.connect(buyer1).buy(0, await buyer1.getAddress(), { value: _buyAmount });
      const expectedFee = _buyAmount.mul(constants.FEE_CURATOR).div(constants.SCALE);
      expect(await vaultContract.feeAccruedCurator()).to.be.equal(expectedFee);
      await vaultContract.connect(curator).redeemCuratorFee(await curator.getAddress());
      expect( await vaultContract.feeAccruedCurator()).to.be.equal(0);
    });
    
    it("should withdraw curator fee", async function () {
      const { vaultContract, buyer1, user1, curator } = await loadFixture(deployNibblVaultFactoryFixture);
      const _buyAmount = ethers.utils.parseEther("100");
      const _expectedFee = _buyAmount.mul(constants.FEE_CURATOR).div(constants.SCALE);
      const initialBalanceAddr1 = await buyer1.getBalance();
      await vaultContract.connect(user1).buy(0, await buyer1.getAddress(), { value: _buyAmount });
      expect(await vaultContract.feeAccruedCurator()).to.be.equal(_expectedFee);
      await vaultContract.connect(curator).redeemCuratorFee(await buyer1.getAddress());
      expect(await buyer1.getBalance()).to.equal(initialBalanceAddr1.add(_expectedFee));
    });
    
    it("only curator should withdraw curator fee", async function () {
      const { vaultContract, buyer1, user1, curator } = await loadFixture(deployNibblVaultFactoryFixture);
      const _buyAmount = ethers.utils.parseEther("100");
      await vaultContract.connect(user1).buy(0, await buyer1.getAddress(), { value: _buyAmount });
      await expect(vaultContract.connect(user1).redeemCuratorFee(await buyer1.getAddress())).to.be.revertedWith("NibblVault: Only Curator");
    });
    
    it("should update curator", async function () {
      const { vaultContract, buyer1, user1, curator } = await loadFixture(deployNibblVaultFactoryFixture);
      await vaultContract.connect(curator).updateCurator(user1.address);
      expect(await vaultContract.curator()).to.be.equal(user1.address);
    });
    
    it("only curator should update curator", async function () {
      const { vaultContract, buyer1, user1, curator } = await loadFixture(deployNibblVaultFactoryFixture);
      await expect(vaultContract.connect(user1).updateCurator(user1.address)).to.be.revertedWith("NibblVault: Only Curator");
    });
    
    it("new curator should accrue and redeem curator fee correctly", async function () {
      const { vaultContract, buyer1, user1, curator } = await loadFixture(deployNibblVaultFactoryFixture);
      await vaultContract.connect(curator).updateCurator(user1.address);
      expect(await vaultContract.curator()).to.be.equal(user1.address);
      const _buyAmount = ethers.utils.parseEther("1");
      await vaultContract.connect(buyer1).buy(0, await buyer1.getAddress(), { value: _buyAmount });
      const expectedFee = _buyAmount.mul(constants.FEE_CURATOR).div(constants.SCALE);
      expect(await vaultContract.feeAccruedCurator()).to.be.equal(expectedFee);
      await vaultContract.connect(user1).redeemCuratorFee(await curator.getAddress());
      const accruedFeeAfterRedeem = await vaultContract.feeAccruedCurator();
      expect(accruedFeeAfterRedeem).to.be.equal(0);
    });

  })

  

});