import { ethers, network } from 'hardhat';
import { BigNumber } from "ethers";


export const tokenName = "NibblToken";
export const tokenSymbol = "NIBBL";
export const SCALE: BigNumber = BigNumber.from(1e6);
export const decimal = BigNumber.from((1e18).toString());
export const rejectionPremium: BigNumber = BigNumber.from(100_000);
export const BUYOUT_DURATION: BigNumber = BigNumber.from(5 * 24 * 60 * 60);   // 5 days
export const initialTokenPrice: BigNumber = BigNumber.from((1e14).toString()); //10 ^-4 eth
export const initialValuation: BigNumber = BigNumber.from((1e20).toString()); //100 eth
export const initialTokenSupply: BigNumber = initialValuation.div(initialTokenPrice).mul(decimal);
export const initialSecondaryReserveBalance: BigNumber = ethers.utils.parseEther("10");
export const initialSecondaryReserveRatio: BigNumber = initialSecondaryReserveBalance.mul(SCALE).div(initialValuation);
export const primaryReserveRatio: BigNumber = BigNumber.from(200_000);
export const fictitiousPrimaryReserveBalance = (primaryReserveRatio.mul(initialValuation)).div(SCALE);
export const initialPrimaryReserveBalance: BigNumber = fictitiousPrimaryReserveBalance;
export const UPDATE_TIME_FACTORY = BigNumber.from(2 * 24 * 60 * 60);
export const TWAV_ARRAY_SIZE: number = 4;
export const MAX_SECONDARY_RESERVE_BALANCE: BigNumber = ethers.utils.parseEther("20");
    /// @notice minimum reserve ratio that the secondary curve can have initially 
export const MIN_SECONDARY_RESERVE_RATIO: BigNumber = BigNumber.from(50_000);

export const MAX_CURATOR_FEE: BigNumber = BigNumber.from(10_000);
export const MIN_CURATOR_FEE: BigNumber = BigNumber.from(5_000);
// curatorFee = (((_secondaryReserveRatio - MIN_SECONDARY_RESERVE_RATIO) * MIN_CURATOR_FEE) / (primaryReserveRatio - MIN_SECONDARY_RESERVE_RATIO)) + MIN_CURATOR_FEE; //curator fee is proportional to the secondary reserve ratio/primaryReseveRatio i.e. initial liquidity added by curator

export const FEE_CURATOR: BigNumber = ((initialSecondaryReserveRatio.sub(MIN_SECONDARY_RESERVE_RATIO).mul(MIN_CURATOR_FEE)).div(primaryReserveRatio.sub(MIN_SECONDARY_RESERVE_RATIO))).add(MIN_CURATOR_FEE);
// initialSecondaryReserveRatio.mul(BigNumber.from("10000")).div(primaryReserveRatio);
export const FEE_ADMIN: BigNumber = BigNumber.from(2_000);
export const FEE_CURVE: BigNumber = BigNumber.from(4_000);

