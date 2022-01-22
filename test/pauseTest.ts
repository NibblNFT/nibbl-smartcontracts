import { expect } from "chai";
import { ethers, network } from "hardhat";
import { BigNumber } from "ethers";
import { mintTokens, burnTokens } from "./testHelpers/singleCurveTokenVaultHelper";
import { setTime , increaseTime } from "./testHelpers/time";
import { TWAV } from "./testHelpers/twavHelper";

describe("Paused", function () {
  const tokenName = "NibblToken";
  const tokenSymbol = "NIBBL";
  const SCALE: BigNumber = BigNumber.from(1e9);
  const decimal = BigNumber.from((1e18).toString());
  const FEE_ADMIN: BigNumber = BigNumber.from(2_000_000);
  const FEE_CURATOR: BigNumber = BigNumber.from(4_000_000);
  const FEE_CURVE: BigNumber = BigNumber.from(4_000_000);
  const MAX_FEE_CURATOR: BigNumber = BigNumber.from(4_000_000);
  const rejectionPremium: BigNumber = BigNumber.from(100_000_000);
  const primaryReserveRatio: BigNumber = BigNumber.from(500_000_000);
  const BUYOUT_DURATION: BigNumber = BigNumber.from(3 * 24 * 60 * 60);
  const THREE_MINS: BigNumber = BigNumber.from(180)
  let blockTime: BigNumber = BigNumber.from(Math.ceil((Date.now() / 1e3)));
  const initialTokenPrice: BigNumber = BigNumber.from((1e14).toString()); //10 ^-4 eth
  const initialValuation: BigNumber = BigNumber.from((1e20).toString()); //100 eth
  const initialTokenSupply: BigNumber = initialValuation.div(initialTokenPrice).mul(decimal);
  const initialSecondaryReserveBalance: BigNumber = ethers.utils.parseEther("10");
  const initialSecondaryReserveRatio: BigNumber = initialSecondaryReserveBalance.mul(SCALE).div(initialValuation);
  const primaryReserveBalance: BigNumber = primaryReserveRatio.mul(initialValuation).div(SCALE);
  const fictitiousPrimaryReserveBalance = primaryReserveRatio.mul(initialValuation).div(SCALE);

  beforeEach(async function () {
    const [curator, admin, buyer1, buyer2, addr1, addr2, addr3, addr4] = await ethers.getSigners();
    this.curator = curator;
    this.admin = admin;
    this.buyer1 = buyer1;
    this.buyer2 = buyer2;
    this.addr1 = addr1;
    this.addr2 = addr2;
    this.addr3 = addr3;
    this.addr4 = addr4;

    this.NFT = await ethers.getContractFactory("NFT");
    this.nft = await this.NFT.deploy();
    await this.nft.deployed();
    
    this.nft.mint(this.curator.address, 0);

    this.NibblVault = await ethers.getContractFactory("NibblVault");
    this.nibblVaultImplementation = await this.NibblVault.deploy();
    await this.nibblVaultImplementation.deployed();
    // Basket
    this.Basket = await ethers.getContractFactory("Basket");
    this.basketImplementation = await this.Basket.deploy();
    await this.basketImplementation.deployed();

    this.NibblVaultFactory = await ethers.getContractFactory("NibblVaultFactory");
    this.tokenVaultFactory = await this.NibblVaultFactory.deploy(this.nibblVaultImplementation.address, this.basketImplementation.address, this.admin.address);
    await this.tokenVaultFactory.deployed();
    this.nft.approve(this.tokenVaultFactory.address, 0);

    this.TestBancorBondingCurve = await ethers.getContractFactory("TestBancorBondingCurve");
    this.TestTWAVContract = await ethers.getContractFactory("TestTwav");
    this.testBancorBondingCurve = await this.TestBancorBondingCurve.deploy();
    this.testTWAV = await this.TestTWAVContract.deploy();
    await this.testTWAV.deployed();
    await this.testBancorBondingCurve.deployed();

    await this.tokenVaultFactory.createVault(this.nft.address, 0, tokenName, tokenSymbol, initialTokenSupply, 10 ** 14, MAX_FEE_CURATOR, { value: initialSecondaryReserveBalance });
    const proxyAddress = await this.tokenVaultFactory.nibbledTokens(0);
    this.tokenVault = new ethers.Contract(proxyAddress.toString(), this.NibblVault.interface, this.curator);
    this.twav = new TWAV();
  })
    beforeEach(async function () {
      const [curator, admin, buyer1, addr1, addr2, addr3, addr4] = await ethers.getSigners();
      this.curator = curator;
      this.admin = admin;
      this.buyer1 = buyer1;
      this.addr1 = addr1;
      this.addr2 = addr2;
      this.addr3 = addr3;
      this.addr4 = addr4;

      this.NFT = await ethers.getContractFactory("NFT");
      this.nft = await this.NFT.deploy();
      await this.nft.deployed();
      this.nft.mint(this.curator.address, 0);

      this.NibblVault = await ethers.getContractFactory("NibblVault");
      this.nibblVaultImplementation = await this.NibblVault.deploy();
      await this.nibblVaultImplementation.deployed();
        
      // Basket
      this.Basket = await ethers.getContractFactory("Basket");
      this.basketImplementation = await this.Basket.deploy();
      await this.basketImplementation.deployed();

      this.NibblVaultFactory = await ethers.getContractFactory("NibblVaultFactory");
      this.tokenVaultFactory = await this.NibblVaultFactory.connect(this.admin).deploy(this.nibblVaultImplementation.address, this.basketImplementation.address, this.admin.address);
      await this.tokenVaultFactory.deployed();

      this.nft.approve(this.tokenVaultFactory.address, 0);

      this.TestBancorBondingCurve = await ethers.getContractFactory("TestBancorBondingCurve");
      this.testBancorBondingCurve = await this.TestBancorBondingCurve.deploy();
      await this.testBancorBondingCurve.deployed();
        
      await this.tokenVaultFactory.connect(this.curator).createVault(this.nft.address, 0, tokenName, tokenSymbol, initialTokenSupply, 10 ** 14, MAX_FEE_CURATOR, { value: initialSecondaryReserveBalance });
      const proxyAddress = await this.tokenVaultFactory.nibbledTokens(0);
      this.tokenVault = new ethers.Contract(proxyAddress.toString(), this.NibblVault.interface, this.curator);
 
    });

    it("Admin should be able to withdraw the locked NFT when paused", async function () {
      await this.tokenVaultFactory.connect(this.admin).pause();
      await this.tokenVault.connect(this.admin).withdrawERC721WhenPaused(await this.tokenVault.assetAddress(), await this.tokenVault.assetID(), this.addr1.address);
      expect(await this.nft.ownerOf(0)).to.be.equal(this.addr1.address);
    });


    it("Admin should be able to withdraw locked ERC20s when paused", async function () {
      const amount = 1000000;

      this.ERC20Token = await ethers.getContractFactory("ERC20Token");
      this.erc20 = await this.ERC20Token.deploy();
      await this.erc20.deployed();
      await this.erc20.mint(this.tokenVault.address, amount);
      await this.tokenVaultFactory.connect(this.admin).pause();
      await this.tokenVault.connect(this.admin).withdrawERC20WhenPaused(this.erc20.address, this.addr1.address);
      expect(await this.erc20.balanceOf(this.addr1.address)).to.be.equal(amount);
    });

    it("Winner should be able to withdraw locked ERC1155s", async function () {
      const amount = 1000000;
      this.ERC1155Token = await ethers.getContractFactory("ERC1155Token");
      this.erc1155 = await this.ERC1155Token.deploy();
      await this.erc1155.deployed();
      await this.erc1155.mint(this.tokenVault.address, 0, amount);
    
      await this.tokenVaultFactory.connect(this.admin).pause();
    
      await this.tokenVault.connect(this.admin).withdrawERC1155WhenPaused(this.erc1155.address, 0, this.addr1.address);
      expect(await this.erc1155.balanceOf(this.addr1.address, 0)).to.be.equal(amount);
    });
    // ---------------------------- //
  
    it("Admin shouldn't be able to withdraw the locked NFT when not paused", async function () {
      await expect(this.tokenVault.connect(this.admin).withdrawERC721WhenPaused(await this.tokenVault.assetAddress(), await this.tokenVault.assetID(), this.addr1.address)).to.be.revertedWith("NibblVault: Not Paused");
    });


    it("Admin should not be able to withdraw locked ERC20s when not paused", async function () {
      const amount = 1000000;
      this.ERC20Token = await ethers.getContractFactory("ERC20Token");
      this.erc20 = await this.ERC20Token.deploy();
      await this.erc20.deployed();
      await this.erc20.mint(this.tokenVault.address, amount);
      await expect(this.tokenVault.connect(this.admin).withdrawERC20WhenPaused(this.erc20.address, this.addr1.address)).to.be.revertedWith("NibblVault: Not Paused");
      // 
    });

    it("Admin should not be able to withdraw locked ERC1155s when not paused", async function () {
      const amount = 1000000;
      this.ERC1155Token = await ethers.getContractFactory("ERC1155Token");
      this.erc1155 = await this.ERC1155Token.deploy();
      await this.erc1155.deployed();
      await this.erc1155.mint(this.tokenVault.address, 0, amount);
      await expect(this.tokenVault.connect(this.admin).withdrawERC1155WhenPaused(this.erc1155.address, 0, this.addr1.address)).to.be.revertedWith("NibblVault: Not Paused");
    });

    it("Users should not be able to withdraw funds when paused", async function () {
       let balanceContract = initialSecondaryReserveBalance, curatorFeeAccrued = ethers.constants.Zero;
    blockTime = await this.testTWAV.getCurrentBlockTime();
    let _primaryReserveBalance = primaryReserveBalance;
    const FEE_TOTAL = FEE_ADMIN.add(FEE_CURATOR).add(FEE_CURVE);

    let _buyAmount = ethers.utils.parseEther("20");      
    balanceContract = balanceContract.add(_buyAmount.sub(_buyAmount.mul(FEE_ADMIN).div(SCALE)));
    curatorFeeAccrued = curatorFeeAccrued.add((_buyAmount.mul(FEE_CURATOR)).div(SCALE));
    _primaryReserveBalance = _primaryReserveBalance.add(_buyAmount.sub(_buyAmount.mul(FEE_TOTAL).div(SCALE)));
    await this.tokenVault.connect(this.buyer1).buy(0, this.buyer1.address, { value: _buyAmount }); 
        
    _buyAmount = ethers.utils.parseEther("20");      
    balanceContract = balanceContract.add(_buyAmount.sub(_buyAmount.mul(FEE_ADMIN).div(SCALE)));
    curatorFeeAccrued = curatorFeeAccrued.add((_buyAmount.mul(FEE_CURATOR)).div(SCALE));
    _primaryReserveBalance = _primaryReserveBalance.add(_buyAmount.sub(_buyAmount.mul(FEE_TOTAL).div(SCALE)));
    await this.tokenVault.connect(this.buyer1).buy(0, this.addr1.address, { value: _buyAmount }); 
    
    _buyAmount = ethers.utils.parseEther("20");      
    balanceContract = balanceContract.add(_buyAmount.sub(_buyAmount.mul(FEE_ADMIN).div(SCALE)));
    curatorFeeAccrued = curatorFeeAccrued.add((_buyAmount.mul(FEE_CURATOR)).div(SCALE));
    _primaryReserveBalance = _primaryReserveBalance.add(_buyAmount.sub(_buyAmount.mul(FEE_TOTAL).div(SCALE)));
    await this.tokenVault.connect(this.buyer1).buy(0, this.addr1.address, { value: _buyAmount }); 
    
    _buyAmount = ethers.utils.parseEther("20");      
    balanceContract = balanceContract.add(_buyAmount.sub(_buyAmount.mul(FEE_ADMIN).div(SCALE)));
    curatorFeeAccrued = curatorFeeAccrued.add((_buyAmount.mul(FEE_CURATOR)).div(SCALE));
    _primaryReserveBalance = _primaryReserveBalance.add(_buyAmount.sub(_buyAmount.mul(FEE_TOTAL).div(SCALE)));
    await this.tokenVault.connect(this.buyer1).buy(0, this.addr1.address, { value: _buyAmount }); 
        
    blockTime = blockTime.add(THREE_MINS);
    await setTime(blockTime.toNumber());
    
    await this.tokenVaultFactory.connect(this.admin).pause();
    
    const balanceBuyer = await this.tokenVault.balanceOf(this.buyer1.address);
    const totalSupply = await this.tokenVault.totalSupply();
    const returnAmt: BigNumber = ((balanceContract.sub(curatorFeeAccrued)).mul(balanceBuyer)).div(totalSupply);
    const initialBalAddr1: BigNumber = await this.admin.provider.getBalance(this.addr1.address);
    await this.tokenVault.connect(this.buyer1).unlockFundsWhenPaused(this.addr1.address); 
    expect(await this.admin.provider.getBalance(this.addr1.address)).to.be.equal(initialBalAddr1.add(returnAmt));
    expect(await this.tokenVault.balanceOf(this.buyer1.address)).to.be.equal(ethers.constants.Zero);
   });


  
});