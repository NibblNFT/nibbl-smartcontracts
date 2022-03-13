import { expect } from 'chai';
import { ethers } from 'hardhat';
import { BigNumber, Contract, Signer } from 'ethers';
import { mintTokens, burnTokens, snapshot, restore, getBigNumber, TWO } from "./helper";
import * as constants from "./constants";


describe("NibblTokenVault: Trading ", function () {
    let accounts: Signer[];
    let snapshotId: Number;
    let curator: Signer;
    let buyer1: Signer;
    let admin: Signer;
    let addr1: Signer;
    let erc721: Contract;
    let vaultContract: Contract;
    let vaultImplementationContract: Contract;
    let vaultFactoryContract: Contract;
    let testBancorFormula: Contract;
    let pauserRole: Signer;

    let adminAddress: string;
    let implementorRoleAddress: string;
    let pauserRoleAddress: string;
    let feeRoleAddress: string;
    let curatorAddress: string;
    let addr1Address: string;
    let buyer1Address: string;

    before(async function () {
        accounts = await ethers.getSigners();   
        curator = accounts[0];
        buyer1 = accounts[1];
        admin = accounts[2];
        addr1 = accounts[3];
        pauserRole = accounts[4];


        adminAddress = await admin.getAddress();
        pauserRoleAddress = await pauserRole.getAddress();
        curatorAddress = await curator.getAddress();
        buyer1Address = await buyer1.getAddress();
        addr1Address = await addr1.getAddress();

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
        await erc721.approve(vaultFactoryContract.address, 0);
        const TestBancorBondingCurve = await ethers.getContractFactory("TestBancorFormula");
        testBancorFormula = await TestBancorBondingCurve.deploy();
        await testBancorFormula.deployed();
        await vaultFactoryContract.connect(curator).createVault(erc721.address,
                                                0,
                                                constants.tokenName,
                                                constants.tokenSymbol,
                                                constants.initialTokenSupply,
                                                constants.initialTokenPrice,
                                                { value: constants.initialSecondaryReserveBalance });

        const proxyAddress = await vaultFactoryContract.nibbledTokens(0);
        vaultContract = new ethers.Contract(proxyAddress.toString(), NibblVault.interface, buyer1);

    });
    
    beforeEach(async function () {
        snapshotId = await snapshot();        
    });

    afterEach(async function () {
        await restore(snapshotId);
    });

    it("should buy tokens successfully from primary curve", async function () {
        const _buyAmount = ethers.utils.parseEther("1");
        const _feeTotal = constants.FEE_ADMIN.add(constants.FEE_CURATOR).add(constants.FEE_CURVE);
        const _initialSecondaryBalance = await vaultContract.secondaryReserveBalance();
        const _initialPrimaryBalance = await vaultContract.primaryReserveBalance();
        const _buyAmountWithFee = _buyAmount.sub(_buyAmount.mul(_feeTotal).div(constants.SCALE));
        const _purchaseReturn = await mintTokens(testBancorFormula,
                                                constants.initialTokenSupply,
                                                constants.fictitiousPrimaryReserveBalance,
                                                constants.primaryReserveRatio,
                                                _buyAmountWithFee);
        const _initialBalanceFactory = await admin.provider.getBalance(vaultFactoryContract.address);
        const _newSecBalance = _initialSecondaryBalance.add((_buyAmount.mul(constants.FEE_CURVE)).div(constants.SCALE));
        await vaultContract.connect(buyer1).buy(_purchaseReturn,await buyer1.getAddress(), { value: _buyAmount });
        
        expect(await vaultContract.balanceOf(await buyer1.getAddress())).to.equal(_purchaseReturn);
        expect(await vaultContract.secondaryReserveBalance()).to.equal(_newSecBalance);
        expect(await vaultContract.primaryReserveBalance()).to.equal(_initialPrimaryBalance.add(_buyAmountWithFee));
        expect((await admin.provider.getBalance(vaultFactoryContract.address)).sub(_initialBalanceFactory)).to.equal((_buyAmount.mul(constants.FEE_ADMIN)).div(constants.SCALE));        
        expect(await vaultContract.secondaryReserveRatio()).to.equal((_newSecBalance.mul(constants.SCALE)).div(constants.initialValuation));        
        expect(await vaultContract.feeAccruedCurator()).to.equal((_buyAmount.mul(constants.FEE_CURATOR)).div(constants.SCALE));        
    })

    it("should buy tokens successfully on multi curve", async function () {
        const _feeTotal = (constants.FEE_ADMIN).add(constants.FEE_CURATOR).add(constants.FEE_CURVE);

        //Selling Tokens
        const _sellAmount = (constants.initialTokenSupply).div(5); //Selling 1/5th the amount i.e 200k here
        const _expectedSaleReturn = await burnTokens(
                                                    testBancorFormula,
                                                    constants.initialTokenSupply,
                                                    constants.initialSecondaryReserveBalance,
                                                    constants.initialSecondaryReserveRatio,
                                                    _sellAmount);        
        await vaultContract.connect(curator).sell(_sellAmount, _expectedSaleReturn, await curator.getAddress());
        //---------------- 1/5th Tokens Sold ----------------        
        //Buy Tokens
        const _buyAmtTotal = ethers.utils.parseEther("20");
        const _buyAmtSecCurve = _expectedSaleReturn; //secondaryCurve doesn't have any fee so exact amount
        const _purchaseReturnSecCurve = _sellAmount;
        
        const _buyAmtPrimaryCurve = _buyAmtTotal.sub(_buyAmtSecCurve);
        const _buyAmtPrimaryWithFee = _buyAmtPrimaryCurve.sub(_buyAmtPrimaryCurve.mul(_feeTotal).div(constants.SCALE));
        const _purchaseReturnPrimaryCurve = await mintTokens(testBancorFormula, constants.initialTokenSupply, constants.initialPrimaryReserveBalance, constants.primaryReserveRatio, _buyAmtPrimaryWithFee);        
        // Primary curve goes up from initialSupply. Therefore, constant.initialTokenSupply is used as continuousTokenSupply.
        const _initialBalanceBuyer = await vaultContract.balanceOf(await buyer1.getAddress());
        const _initialSecondaryBalance = await vaultContract.secondaryReserveBalance();
        const _initialPrimaryBalance = await vaultContract.primaryReserveBalance();
        
        await vaultContract.connect(buyer1).buy(_purchaseReturnPrimaryCurve.add(_purchaseReturnSecCurve), await buyer1.getAddress(), { value: _buyAmtTotal });
        expect((await vaultContract.balanceOf(await buyer1.getAddress())).sub(_initialBalanceBuyer)).to.equal(_purchaseReturnPrimaryCurve.add(_purchaseReturnSecCurve));
        expect(await vaultContract.secondaryReserveBalance()).to.equal(_initialSecondaryBalance.add(_buyAmtSecCurve).add(_buyAmtPrimaryCurve.mul(constants.FEE_CURVE).div(constants.SCALE)));
        expect(await vaultContract.primaryReserveBalance()).to.equal(_initialPrimaryBalance.add(_buyAmtPrimaryWithFee));
    })

    it("should buy tokens successfully on secondary curve", async function () {
        //Selling Tokens
        const _sellAmount = constants.initialTokenSupply.sub(constants.initialTokenSupply.div(4)); //Selling 1/5th the amount i.e 200k here
        const _expectedSaleReturn = await burnTokens(testBancorFormula, constants.initialTokenSupply, constants.initialSecondaryReserveBalance, constants.initialSecondaryReserveRatio, _sellAmount);        
        await vaultContract.connect(curator).sell(_sellAmount, _expectedSaleReturn, await curator.getAddress());
        //---------------- 3/4th Tokens Sold ----------------        
        //Buy Tokens
        const _buyAmt = ethers.utils.parseEther("1");
        const _purchaseReturn = await mintTokens(testBancorFormula, (constants.initialTokenSupply).sub(_sellAmount), (constants.initialSecondaryReserveBalance).sub(_expectedSaleReturn), (constants.initialSecondaryReserveRatio), _buyAmt);
        const _initialBalanceBuyer = await vaultContract.balanceOf(await buyer1.getAddress());
        const _initialSecondaryBalance = await vaultContract.secondaryReserveBalance();
        await vaultContract.connect(buyer1).buy(_purchaseReturn, await buyer1.getAddress(), { value: _buyAmt });
        expect((await vaultContract.balanceOf(await buyer1.getAddress())).sub(_initialBalanceBuyer)).to.equal(_purchaseReturn);
        expect(await vaultContract.secondaryReserveBalance()).to.equal(_initialSecondaryBalance.add(_buyAmt));
    })

    it("should not buy tokens on primary curve if amtOut low", async function () { 
        const _buyAmount = ethers.utils.parseEther("1");
        const _feeTotal = constants.FEE_ADMIN.add(constants.FEE_CURATOR).add(constants.FEE_CURVE);
       const _buyAmountWithFee = _buyAmount.sub(_buyAmount.mul(_feeTotal).div(constants.SCALE));
        const _purchaseReturn = (await mintTokens(testBancorFormula,
                                                constants.initialTokenSupply,
                                                constants.initialPrimaryReserveBalance,
                                                constants.primaryReserveRatio,
                                                _buyAmountWithFee)).mul(TWO);
        await expect(vaultContract.connect(buyer1).buy(_purchaseReturn, await buyer1.getAddress(), { value: _buyAmount })).to.be.revertedWith("NibblVault: Return too low");
    });

    it("should not buy tokens successfully on multi curve", async function () {
        const _feeTotal = (constants.FEE_ADMIN).add(constants.FEE_CURATOR).add(constants.FEE_CURVE);
        //Selling Tokens
        const _sellAmount = (constants.initialTokenSupply).div(5); //Selling 1/5th the amount i.e 200k here
        const _expectedSaleReturn = await burnTokens(
                                                    testBancorFormula,
                                                    constants.initialTokenSupply,
                                                    constants.initialSecondaryReserveBalance,
                                                    constants.initialSecondaryReserveRatio,
                                                    _sellAmount);        
        await vaultContract.connect(curator).sell(_sellAmount, _expectedSaleReturn, await curator.getAddress());
        //---------------- 1/5th Tokens Sold ----------------        
        //Buy Tokens
        const _buyAmtTotal = ethers.utils.parseEther("20");
        const _buyAmtSecCurve = _expectedSaleReturn; //secondaryCurve doesn't have any fee so exact amount
        const _purchaseReturnSecCurve = _sellAmount;
        
        const _buyAmtPrimaryCurve = _buyAmtTotal.sub(_buyAmtSecCurve);
        const _buyAmtPrimaryWithFee = _buyAmtPrimaryCurve.sub(_buyAmtPrimaryCurve.mul(_feeTotal).div(constants.SCALE));
        const _purchaseReturnPrimaryCurve = await mintTokens(testBancorFormula, constants.initialTokenSupply, constants.initialPrimaryReserveBalance, constants.primaryReserveRatio, _buyAmtPrimaryWithFee);        
        // Primary curve goes up from initialSupply. Therefore, constant.initialTokenSupply is used as continuousTokenSupply.

        await expect(vaultContract.connect(buyer1).buy(_purchaseReturnPrimaryCurve.add(_purchaseReturnSecCurve).mul(TWO), await buyer1.getAddress(), { value: _buyAmtTotal })).to.be.revertedWith("NibblVault: Return too low");
    })
    
    it("should not buy tokens on secondary curve if amtOut low", async function () { 
        //Selling Tokens
        const _sellAmount = constants.initialTokenSupply.sub(constants.initialTokenSupply.div(4)); //Selling 1/5th the amount i.e 200k here
        const _expectedSaleReturn = await burnTokens(testBancorFormula, constants.initialTokenSupply, constants.initialSecondaryReserveBalance, constants.initialSecondaryReserveRatio, _sellAmount);        
        await vaultContract.connect(curator).sell(_sellAmount, _expectedSaleReturn, await curator.getAddress());
        //---------------- 3/4th Tokens Sold ----------------        
        //Buy Tokens
        const _buyAmt = ethers.utils.parseEther("1");
        const _purchaseReturn = (await mintTokens(testBancorFormula, (constants.initialTokenSupply).sub(_sellAmount), (constants.initialSecondaryReserveBalance).sub(_expectedSaleReturn), (constants.initialSecondaryReserveRatio), _buyAmt)).mul(TWO);
         await expect(vaultContract.connect(buyer1).buy(_purchaseReturn, await buyer1.getAddress(), { value: _buyAmt })).to.be.revertedWith("NibblVault: Return too low");
    });

    it("should sell tokens successfully from primary curve", async function () {
        // Buy Tokens 
        const _buyAmount = ethers.utils.parseEther("1");
        const _feeTotal = constants.FEE_ADMIN.add(constants.FEE_CURATOR).add(constants.FEE_CURVE);
        const _initialSecondaryBalance = await vaultContract.secondaryReserveBalance();
        const _initialPrimaryBalance = await vaultContract.primaryReserveBalance();
        const _buyAmountWithFee = _buyAmount.sub(_buyAmount.mul(_feeTotal).div(constants.SCALE));
        const _purchaseReturn = await mintTokens(testBancorFormula, constants.initialTokenSupply, constants.initialPrimaryReserveBalance, constants.primaryReserveRatio, _buyAmountWithFee);
        let _initialBalanceFactory = await admin.provider.getBalance(vaultFactoryContract.address);
        let _newSecBalance = _initialSecondaryBalance.add((_buyAmount.mul(constants.FEE_CURVE)).div(constants.SCALE));
        await vaultContract.connect(buyer1).buy(_purchaseReturn, await buyer1.getAddress(), { value: _buyAmount });
        expect(await vaultContract.balanceOf(await buyer1.getAddress())).to.equal(_purchaseReturn);
        expect(await vaultContract.secondaryReserveBalance()).to.equal(_newSecBalance);
        expect(await vaultContract.totalSupply()).to.equal(constants.initialTokenSupply.add(_purchaseReturn));
        expect(await vaultContract.primaryReserveBalance()).to.equal(_initialPrimaryBalance.add(_buyAmountWithFee));
        expect((await admin.provider.getBalance(vaultFactoryContract.address)).sub(_initialBalanceFactory)).to.equal((_buyAmount.mul(constants.FEE_ADMIN)).div(constants.SCALE));        
        expect(await vaultContract.secondaryReserveRatio()).to.equal((_newSecBalance.mul(constants.SCALE)).div(constants.initialValuation));        
        expect(await vaultContract.feeAccruedCurator()).to.equal((_buyAmount.mul(constants.FEE_CURATOR)).div(constants.SCALE));        
        // ------------------Tokens Bought----------------
        // Sell Tokens
        const _feeAccruedInitial = await vaultContract.feeAccruedCurator();
        const _sellAmount = _purchaseReturn.div(2); //Only selling half the amount bought
        const _sellReturn = await burnTokens(testBancorFormula, constants.initialTokenSupply.add(_purchaseReturn),  _initialPrimaryBalance.add(_buyAmountWithFee), constants.primaryReserveRatio, _sellAmount);
        const _sellReturnWithFee = _sellReturn.sub(_sellReturn.mul(_feeTotal).div(constants.SCALE));
        _initialBalanceFactory = await admin.provider.getBalance(vaultFactoryContract.address);
        await vaultContract.connect(buyer1).sell(_sellAmount, _sellReturnWithFee, await buyer1.getAddress());
        expect((await admin.provider.getBalance(vaultFactoryContract.address)).sub(_initialBalanceFactory)).to.equal((_sellReturn.mul(constants.FEE_ADMIN)).div(constants.SCALE));        
        expect(await vaultContract.totalSupply()).to.equal(constants.initialTokenSupply.add(_purchaseReturn).sub(_sellAmount));
        expect(await vaultContract.balanceOf(await buyer1.getAddress())).to.equal(_purchaseReturn.sub(_sellAmount));
        expect((await vaultContract.feeAccruedCurator()).sub(_feeAccruedInitial)).to.equal((_sellReturn.mul(constants.FEE_CURATOR)).div(constants.SCALE));
        expect(await vaultContract.secondaryReserveRatio()).to.equal((_newSecBalance.add(_sellReturn.mul(constants.FEE_CURVE).div(constants.SCALE))).mul(constants.SCALE).div(constants.initialValuation));        
        expect(await vaultContract.secondaryReserveBalance()).to.equal(_newSecBalance.add(_sellReturn.mul(constants.FEE_CURVE).div(constants.SCALE)));        
        expect(await vaultContract.primaryReserveBalance()).to.equal(_initialPrimaryBalance.add(_buyAmountWithFee).sub(_sellReturn));        
    })

    it("should sell tokens successfully on secondary curve", async function () {
        const _sellAmount = (constants.initialTokenSupply).div(5);
        let _balanceAddr1 = await addr1.provider.getBalance(await addr1.getAddress());
        const _expectedSaleReturn = await burnTokens(testBancorFormula, constants.initialTokenSupply, constants.initialSecondaryReserveBalance, constants.initialSecondaryReserveRatio, _sellAmount);        
        await vaultContract.connect(curator).sell(_sellAmount, _expectedSaleReturn, await addr1.getAddress());
        expect(await vaultContract.balanceOf(await curator.getAddress())).to.equal((constants.initialTokenSupply).sub(_sellAmount));
        expect((await addr1.provider.getBalance(await addr1.getAddress())).sub(_balanceAddr1)).to.equal((_expectedSaleReturn));        
        expect(await vaultContract.secondaryReserveBalance()).to.equal((constants.initialSecondaryReserveBalance).sub(_expectedSaleReturn));
        expect(await vaultContract.totalSupply()).to.equal((constants.initialTokenSupply).sub(_sellAmount));
    })

    it("should sell tokens successfully on multi curve", async function () {
        await vaultContract.connect(curator).transfer(await buyer1.getAddress(), constants.initialTokenSupply); //Transfer all tokens to buyer
        const _buyAmount = ethers.utils.parseEther("5");
        const _feeTotal = (constants.FEE_ADMIN).add(constants.FEE_CURATOR).add(constants.FEE_CURVE);
        const _buyAmountWithFee = _buyAmount.sub(_buyAmount.mul(_feeTotal).div(constants.SCALE));
        const _purchaseReturn = await mintTokens(testBancorFormula,
                                                constants.initialTokenSupply,
                                                constants.initialPrimaryReserveBalance,
                                                constants.primaryReserveRatio,
                                                _buyAmountWithFee);
        await vaultContract.connect(buyer1).buy(_purchaseReturn, await buyer1.getAddress(), { value: _buyAmount });
        expect(await vaultContract.balanceOf(await buyer1.getAddress())).to.equal((constants.initialTokenSupply).add(_purchaseReturn));
        ///--------Bought Tokens --------------//
        // Sell Tokens        
        const _balanceAddr1Initial = await addr1.provider.getBalance(await addr1.getAddress());
        const _initialPrimaryBalance = (constants.initialPrimaryReserveBalance).add(_buyAmountWithFee);
        const _sellAmount = (constants.initialTokenSupply).div(2); //Only selling half the amount bought initially 500k
        const _totalSupplyInitial = (constants.initialTokenSupply).add(_purchaseReturn);
        const _expectedSaleReturnPrimary = _initialPrimaryBalance.sub((constants.initialPrimaryReserveBalance));        
        const _expectedSaleReturnPrimaryWithFee = _expectedSaleReturnPrimary.sub(_expectedSaleReturnPrimary.mul(_feeTotal).div(constants.SCALE));
        const newSecResBal = (constants.initialSecondaryReserveBalance).add(_expectedSaleReturnPrimary.mul(constants.FEE_CURVE).div(constants.SCALE)).add(_buyAmount.mul(constants.FEE_CURVE).div(constants.SCALE));
        const newSecResRatio = newSecResBal.mul(constants.SCALE).div(constants.initialValuation);
        const _expectedSaleReturnSecondary = await burnTokens(testBancorFormula, _totalSupplyInitial.sub(_purchaseReturn), newSecResBal, newSecResRatio, _sellAmount.sub(_purchaseReturn));        
        await vaultContract.connect(buyer1).sell(_sellAmount, _expectedSaleReturnPrimaryWithFee.add(_expectedSaleReturnSecondary), await addr1.getAddress());
        const _balanceAddr1Final = await addr1.provider.getBalance(await addr1.getAddress());
        expect(_balanceAddr1Final.sub(_balanceAddr1Initial)).to.equal(_expectedSaleReturnPrimaryWithFee.add(_expectedSaleReturnSecondary));        
    });

    it("should not sell tokens on primary curve if return amt low", async function () {
        // Buy Tokens 
        const _buyAmount = ethers.utils.parseEther("1");
        const _feeTotal = constants.FEE_ADMIN.add(constants.FEE_CURATOR).add(constants.FEE_CURVE);
        const _initialSecondaryBalance = await vaultContract.secondaryReserveBalance();
        const _initialPrimaryBalance = await vaultContract.primaryReserveBalance();
        const _buyAmountWithFee = _buyAmount.sub(_buyAmount.mul(_feeTotal).div(constants.SCALE));
        const _purchaseReturn = await mintTokens(testBancorFormula, constants.initialTokenSupply, constants.initialPrimaryReserveBalance, constants.primaryReserveRatio, _buyAmountWithFee);
        let _initialBalanceFactory = await admin.provider.getBalance(vaultFactoryContract.address);
        let _newSecBalance = _initialSecondaryBalance.add((_buyAmount.mul(constants.FEE_CURVE)).div(constants.SCALE));
        await vaultContract.connect(buyer1).buy(_purchaseReturn, await buyer1.getAddress(), { value: _buyAmount });
        expect(await vaultContract.balanceOf(await buyer1.getAddress())).to.equal(_purchaseReturn);
        expect(await vaultContract.secondaryReserveBalance()).to.equal(_newSecBalance);
        expect(await vaultContract.totalSupply()).to.equal(constants.initialTokenSupply.add(_purchaseReturn));
        expect(await vaultContract.primaryReserveBalance()).to.equal(_initialPrimaryBalance.add(_buyAmountWithFee));
        expect((await admin.provider.getBalance(vaultFactoryContract.address)).sub(_initialBalanceFactory)).to.equal((_buyAmount.mul(constants.FEE_ADMIN)).div(constants.SCALE));        
        expect(await vaultContract.secondaryReserveRatio()).to.equal((_newSecBalance.mul(constants.SCALE)).div(constants.initialValuation));        
        expect(await vaultContract.feeAccruedCurator()).to.equal((_buyAmount.mul(constants.FEE_CURATOR)).div(constants.SCALE));        
        // ------------------Tokens Bought----------------
        // Sell Tokens
        const _sellAmount = _purchaseReturn.div(2); //Only selling half the amount bought
        const _sellReturn = await burnTokens(testBancorFormula, constants.initialTokenSupply.add(_purchaseReturn),  _initialPrimaryBalance.add(_buyAmountWithFee), constants.primaryReserveRatio, _sellAmount);
        const _sellReturnWithFee = (_sellReturn.sub(_sellReturn.mul(_feeTotal).div(constants.SCALE))).mul(TWO);
        _initialBalanceFactory = await admin.provider.getBalance(vaultFactoryContract.address);
        await expect(vaultContract.connect(buyer1).sell(_sellAmount, _sellReturnWithFee, await buyer1.getAddress())).to.be.revertedWith("NibblVault: Return too low");
    })


    it("should not sell tokens successfully on secondary curve is return too low", async function () {
        const _sellAmount = (constants.initialTokenSupply).div(5);
        const _expectedSaleReturn = (await burnTokens(testBancorFormula, constants.initialTokenSupply, constants.initialSecondaryReserveBalance, constants.initialSecondaryReserveRatio, _sellAmount)).mul(TWO);
        await expect(vaultContract.connect(curator).sell(_sellAmount, _expectedSaleReturn, await addr1.getAddress())).to.be.revertedWith("NibblVault: Return too low");
     })

    it("should not sell tokens successfully on multi curve if return too low", async function () {
        await vaultContract.connect(curator).transfer(await buyer1.getAddress(), constants.initialTokenSupply); //Transfer all tokens to buyer
        const _buyAmount = ethers.utils.parseEther("1");
        const _feeTotal = (constants.FEE_ADMIN).add(constants.FEE_CURATOR).add(constants.FEE_CURVE);
        const _buyAmountWithFee = _buyAmount.sub(_buyAmount.mul(_feeTotal).div(constants.SCALE));
        const _purchaseReturn = await mintTokens(testBancorFormula,
                                                constants.initialTokenSupply,
                                                constants.initialPrimaryReserveBalance,
                                                constants.primaryReserveRatio,
                                                _buyAmountWithFee);
        await vaultContract.connect(buyer1).buy(_purchaseReturn, await buyer1.getAddress(), { value: _buyAmount });
        expect(await vaultContract.balanceOf(await buyer1.getAddress())).to.equal((constants.initialTokenSupply).add(_purchaseReturn));
        ///--------Bought Tokens --------------//
        // Sell Tokens        
        const _initialPrimaryBalance = (constants.initialPrimaryReserveBalance).add(_buyAmountWithFee);
        const _sellAmount = ((constants.initialTokenSupply).add(_purchaseReturn)).div(2); //Only selling half the amount bought initially 500k
        const _totalSupplyInitial = (constants.initialTokenSupply).add(_purchaseReturn);
        const _expectedSaleReturnPrimary = _initialPrimaryBalance.sub((constants.initialPrimaryReserveBalance));        
        const _expectedSaleReturnPrimaryWithFee = _expectedSaleReturnPrimary.sub(_expectedSaleReturnPrimary.mul(_feeTotal).div(constants.SCALE));
        const newSecResBal = (constants.initialSecondaryReserveBalance).add(_expectedSaleReturnPrimary.mul(constants.FEE_CURVE).div(constants.SCALE)).add(_buyAmount.mul(constants.FEE_CURVE).div(constants.SCALE));
        const newSecResRatio = newSecResBal.mul(constants.SCALE).div(constants.initialValuation);
        const _expectedSaleReturnSecondary = await burnTokens(testBancorFormula, _totalSupplyInitial.sub(_purchaseReturn), newSecResBal, newSecResRatio, _sellAmount.sub(_purchaseReturn));        
        await expect(vaultContract.connect(buyer1).sell(_sellAmount, (_expectedSaleReturnPrimaryWithFee.add(_expectedSaleReturnSecondary)).mul(TWO), await addr1.getAddress())).to.be.revertedWith("NibblVault: Return too low");
    });

});