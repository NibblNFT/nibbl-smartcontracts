import { expect } from "chai";
import { ethers, network } from "hardhat";
import { BigNumber } from "ethers";
import { mintTokens, burnTokens } from "./testHelpers/singleCurveTokenVaultHelper";
import { setTime , increaseTime } from "./testHelpers/time";
import { TWAV } from "./testHelpers/twavHelper";

describe("Paused", function () {
  const tokenName = "NibblToken";
  const tokenSymbol = "NIBBL";
  const decimal = BigNumber.from((1e18).toString());
  const MAX_FEE_CURATOR: BigNumber = BigNumber.from(4_000_000);
  const initialTokenPrice: BigNumber = BigNumber.from((1e14).toString()); //10 ^-4 eth
  const initialValuation: BigNumber = BigNumber.from((1e20).toString()); //100 eth
  const initialTokenSupply: BigNumber = initialValuation.div(initialTokenPrice).mul(decimal);
  const initialSecondaryReserveBalance: BigNumber = ethers.utils.parseEther("10");
  
  beforeEach(async function () {
        const [curator, admin ,buyer1, addr1, addr2, addr3, addr4] = await ethers.getSigners();
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
        
        await this.tokenVaultFactory.connect(this.curator).createVault(this.nft.address, 0, tokenName, tokenSymbol, initialTokenSupply,10**14, MAX_FEE_CURATOR, {value: initialSecondaryReserveBalance});
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



});