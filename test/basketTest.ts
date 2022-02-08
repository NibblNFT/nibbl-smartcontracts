import { expect } from "chai";
import { ethers, network } from "hardhat";
import { BigNumber } from "ethers";
import { setTime } from "./testHelpers/time";
import { TWAV } from "./testHelpers/twavHelper";

describe("Basket", function () {
    const tokenName = "NibblToken";
    const tokenSymbol = "NIBBL";
    const SCALE: BigNumber = BigNumber.from(1e6);
    const ONE = BigNumber.from(1);
    const decimal = BigNumber.from((1e18).toString());
    const FEE_ADMIN: BigNumber = BigNumber.from(2_000);
    const FEE_CURATOR: BigNumber = BigNumber.from(4_000);
    const FEE_CURVE: BigNumber = BigNumber.from(4_000);

    const MAX_FEE_ADMIN: BigNumber = BigNumber.from(2_000);
    const MAX_FEE_CURATOR: BigNumber = BigNumber.from(4_000);
    const MAX_FEE_CURVE: BigNumber = BigNumber.from(4_000);
    const rejectionPremium: BigNumber = BigNumber.from(100_000);
    const primaryReserveRatio: BigNumber = BigNumber.from(500_000);

    const initialTokenPrice: BigNumber = BigNumber.from((1e14).toString()); //10 ^-4 eth
    const initialValuation: BigNumber = BigNumber.from((1e20).toString()); //100 eth
    const initialTokenSupply: BigNumber = initialValuation.div(initialTokenPrice).mul(decimal);
    const initialSecondaryReserveBalance: BigNumber = ethers.utils.parseEther("10");
    const requiredReserveBalance: BigNumber = primaryReserveRatio.mul(initialValuation).div(SCALE);
    const initialSecondaryReserveRatio: BigNumber = initialSecondaryReserveBalance.mul(SCALE).div(initialValuation);
    const primaryReserveBalance: BigNumber = primaryReserveRatio.mul(initialValuation).div(SCALE);
    const fictitiousPrimaryReserveBalance = primaryReserveRatio.mul(initialValuation).div(SCALE);

    beforeEach(async function () {
        
        const [curator, admin, buyer1, buyer2, addr1, implementerRole, feeRole, pauserRole] = await ethers.getSigners();
        this.curator = curator;
        this.admin = admin;
        this.buyer1 = buyer1;
        this.buyer2 = buyer2;
        this.addr1 = addr1;
        this.implementerRole = implementerRole;
        this.feeRole = feeRole;
        this.pauserRole = pauserRole;

        this.NFT = await ethers.getContractFactory("NFT");
        this.nft = await this.NFT.deploy();
        await this.nft.deployed();

        this.NibblVault = await ethers.getContractFactory("NibblVault");
        this.nibblVaultImplementation = await this.NibblVault.deploy();
        await this.nibblVaultImplementation.deployed();

        this.Basket = await ethers.getContractFactory("Basket");
        this.basketImplementation = await this.Basket.deploy();
        await this.basketImplementation.deployed();


        this.NibblVaultFactory = await ethers.getContractFactory("NibblVaultFactory");
        this.tokenVaultFactory = await this.NibblVaultFactory.connect(this.curator).deploy(this.nibblVaultImplementation.address, this.basketImplementation.address, this.admin.address, this.admin.address); 
        await this.tokenVaultFactory.deployed();
        
        this.ERC1155Token = await ethers.getContractFactory("ERC1155Token");
        this.erc1155Token = await this.ERC1155Token.deploy();
        await this.erc1155Token.deployed();



        this.Proxy = await ethers.getContractFactory("Proxy");
        this.basket = await this.Proxy.deploy(this.basketImplementation.address);
        await this.basket.deployed();

        this.basket = await ethers.getContractAt("Basket", this.basket.address);
        await this.basket.connect(this.curator).initialise();

        for (let i = 0; i < 10; i++) {
            await this.nft.mint(this.curator.address, i);
            await this.nft.connect(this.curator).transferFrom(this.curator.address, this.basket.address, i);
        }
            // function mint(address to, uint tokenID, uint256 amount) public {
        for (let i = 0; i < 10; i++) {
            await this.erc1155Token.mint(this.curator.address, i, 500);
            await this.erc1155Token.connect(this.curator).safeTransferFrom(this.curator.address, this.basket.address, i, 500, "0x00");
        }
        await this.basket.approve(this.tokenVaultFactory.address, 0)
        console.log(await this.basket.getApproved(0));
    
    });

    it("Should create a new vault", async function() {
        await this.tokenVaultFactory.createVault(this.basket.address, 0, tokenName, tokenSymbol, initialTokenSupply,10**14, {value: initialSecondaryReserveBalance});
        const proxyAddress = await this.tokenVaultFactory.nibbledTokens(0);
        this.tokenVault = new ethers.Contract(proxyAddress.toString(), this.NibblVault.interface, this.curator);
        expect(await this.tokenVault.name()).to.equal(tokenName);
        expect(await this.tokenVault.symbol()).to.equal(tokenSymbol);
        expect(await this.tokenVault.curator()).to.equal(this.curator.address);
        expect(await this.tokenVault.status()).to.equal(0);        
        expect(await this.tokenVault.assetAddress()).to.equal(this.basket.address);
        expect(await this.tokenVault.assetID()).to.equal(0);
        expect(await this.tokenVault.initialTokenSupply()).to.equal(initialTokenSupply);
        expect(await this.tokenVault.secondaryReserveBalance()).to.equal(initialSecondaryReserveBalance);
        expect(await this.tokenVault.secondaryReserveRatio()).to.equal(initialSecondaryReserveRatio);
        expect(await this.tokenVault.primaryReserveBalance()).to.equal(primaryReserveBalance);
        expect(await this.basket.ownerOf(0)).to.equal(this.tokenVault.address);
    })
    
    it("Owner of the basket should be able to withdraw single NFT from basket", async function () {
            // function withdrawERC721(address _token, uint256 _tokenId, address _to) external {
        await this.basket.connect(this.curator).withdrawERC721(this.nft.address, 0, this.buyer1.address);
        expect(await this.nft.ownerOf(0)).to.equal(this.buyer1.address);
    });

    it("Owner of the basket should be able to withdraw Multiple NFT from basket", async function () {
    // function withdrawMultipleERC721(address[] memory _tokens, uint256[] memory _tokenId, address _to) external {
        let tokenAddressArray = [], tokenIdArray = [];
        
        for (let i = 0; i < 10; i++) {
            tokenAddressArray.push(this.nft.address);
            tokenIdArray.push(i);
        }
        await this.basket.connect(this.curator).withdrawMultipleERC721(tokenAddressArray, tokenIdArray, this.buyer1.address);
        for (let i = 0; i < 10; i++) {
            expect(await this.nft.ownerOf(i)).to.equal(this.buyer1.address);
        }
    });

    it("Owner of the basket should be able to withdraw ERC1155 from basket", async function () {
        await this.basket.connect(this.curator).withdrawERC1155(this.erc1155Token.address, 0, this.curator.address);
        expect(await this.erc1155Token.balanceOf(this.curator.address, 0)).to.equal(500);
    });
    // function withdrawMultipleERC1155(address[] memory _tokens, uint256[] memory _tokenIds, uint256[] memory _amounts) external {


    it("Owner of the basket should be able to withdraw multiple ERC1155 from basket", async function () {
        let tokenAddressArray = [], tokenIdArray = [];
        
        for (let i = 0; i < 10; i++) {
            tokenAddressArray.push(this.erc1155Token.address);
            tokenIdArray.push(i);
        }

        await this.basket.connect(this.curator).withdrawMultipleERC1155(tokenAddressArray, tokenIdArray, this.curator.address);
        for (let i = 0; i < 10; i++) {
            expect(await this.erc1155Token.balanceOf(this.curator.address, i)).to.equal(500);
        }
    });


});
