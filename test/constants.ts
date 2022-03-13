import { ethers, network } from 'hardhat';
import { BigNumber } from "ethers";


export const tokenName = "NibblToken";
export const tokenSymbol = "NIBBL";
export const SCALE: BigNumber = BigNumber.from(1e6);
export const decimal = BigNumber.from((1e18).toString());
export const rejectionPremium: BigNumber = BigNumber.from(100_000);
export const BUYOUT_DURATION: BigNumber = BigNumber.from(36 * 60 * 60);   // 36 hours
export const initialTokenPrice: BigNumber = BigNumber.from((1e14).toString()); //10 ^-4 eth
export const initialValuation: BigNumber = BigNumber.from((1e20).toString()); //100 eth
export const initialTokenSupply: BigNumber = initialValuation.div(initialTokenPrice).mul(decimal);
export const initialSecondaryReserveBalance: BigNumber = ethers.utils.parseEther("10");
export const initialSecondaryReserveRatio: BigNumber = initialSecondaryReserveBalance.mul(SCALE).div(initialValuation);
export const primaryReserveRatio: BigNumber = BigNumber.from(250_000);
export const fictitiousPrimaryReserveBalance = (primaryReserveRatio.mul(initialValuation)).div(SCALE);
export const initialPrimaryReserveBalance: BigNumber = fictitiousPrimaryReserveBalance;
export const UPDATE_TIME_FACTORY = BigNumber.from(2 * 24 * 60 * 60);
export const TWAV_ARRAY_SIZE: number = 4;


export const FEE_CURATOR: BigNumber = initialSecondaryReserveRatio.mul(BigNumber.from("10000")).div(primaryReserveRatio);
export const FEE_ADMIN: BigNumber = BigNumber.from(2_000);
export const FEE_CURVE: BigNumber = BigNumber.from(4_000);