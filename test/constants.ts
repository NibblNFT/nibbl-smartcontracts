import { time } from "@nomicfoundation/hardhat-network-helpers";
import { BigNumber } from "ethers";
import { ethers } from "hardhat";
import { getBigNumber } from "./helper";

export const tokenName = "NibblToken";
export const tokenSymbol = "NIBBL";
export const SCALE: BigNumber = BigNumber.from(1e6);
export const decimal = BigNumber.from((1e18).toString());
export const rejectionPremium: BigNumber = BigNumber.from(150_000); // 15%
export const BUYOUT_DURATION: number = time.duration.days(4);   // 4 days
export const initialTokenPrice: BigNumber = BigNumber.from((1e14).toString()); // 10 ^-4 eth / 0.0001 eth
export const initialValuation: BigNumber = BigNumber.from((1e20).toString()); // 100 eth
export const initialTokenSupply: BigNumber = initialValuation.div(initialTokenPrice).mul(decimal); // 1e24 Tokens = 1e6 tokens * decimal
export const primaryReserveRatio: BigNumber = BigNumber.from(300_000); // 30%
// minimum reserve ratio that the secondary curve can have initially 
export const MIN_SECONDARY_RESERVE_RATIO: BigNumber = BigNumber.from(50_000); // 5% secondary reserve ratio needs to be greater than 5%
export const UPDATE_TIME_FACTORY = time.duration.days(2);
export const initialSecondaryReserveBalance: BigNumber = ethers.utils.parseEther("10"); // Initial secondary reserve balance deposited by curator 
export const initialSecondaryReserveRatio: BigNumber = initialSecondaryReserveBalance.mul(SCALE).div(initialValuation); // 10% / 100000 / 1e6 = 0.1
export const fictitiousPrimaryReserveBalance = (primaryReserveRatio.mul(initialValuation)).div(SCALE); // 30 eth, ReserveBalance if the secondaryReserveRatio = primaryReserveRatio 
export const initialPrimaryReserveBalance: BigNumber = fictitiousPrimaryReserveBalance; // For calculation purposes
export const TWAV_ARRAY_SIZE: number = 10;

// Curator fee is between .75% to 1.5%
//curator fee is proportional to the secondary reserve ratio/primaryReseveRatio i.e. initial liquidity added by curator
export const MIN_CURATOR_FEE: BigNumber = BigNumber.from(7_500); // .75%
export const CURATOR_FEE_VARIABLE: BigNumber = BigNumber.from(7_500); // .75%
export const MAX_CURATOR_FEE: BigNumber = BigNumber.from(15_000); // 1.5%

// curatorFee = (((_secondaryReserveRatio - MIN_SECONDARY_RESERVE_RATIO) * MIN_CURATOR_FEE) / (primaryReserveRatio - MIN_SECONDARY_RESERVE_RATIO)) + MIN_CURATOR_FEE; 
export const FEE_CURATOR: BigNumber = ((initialSecondaryReserveRatio.sub(MIN_SECONDARY_RESERVE_RATIO).mul(CURATOR_FEE_VARIABLE)).div(primaryReserveRatio.sub(MIN_SECONDARY_RESERVE_RATIO))).add(MIN_CURATOR_FEE); //.9%

export const FEE_ADMIN: BigNumber = BigNumber.from(2500); // .25%
// Sum of curatorFee and curveFee is 1.5%
export const FEE_CURVE: BigNumber = MAX_CURATOR_FEE.sub(FEE_CURATOR);
export const FEE_TOTAL = (FEE_ADMIN).add(FEE_CURATOR).add(FEE_CURVE);
export const FEE_SECONDARY_CURVE = (FEE_ADMIN).add(FEE_CURATOR); // Fee charged in Secondary Curve, It is not charged on multicurve buy

export const ONE = getBigNumber(1)
export const TWO = getBigNumber(2)


/// ERC1155Link
export const URI = "TOKEN_URI";
export const MINT_RATIO = getBigNumber(10); // 10 * 1e18
export const USER_CAP = 100; // 100 
export const MAX_CAP = 200; // 200 
