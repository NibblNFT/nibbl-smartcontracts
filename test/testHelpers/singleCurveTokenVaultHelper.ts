import { BigNumber } from "ethers";

export const unlockReservedLiquidity = (continuousTokenSupply: number, reserveTokenBalance: number, reserveRatio: number, amount: number): number => {
        return (1- (1 - (amount / reserveTokenBalance)) ** (reserveRatio)) * continuousTokenSupply;
};

export const mintTokens = (continuousTokenSupply:number, reserveTokenBalance:number, reserveRatio: number, amount: number) : number => {
    // return continuousTokenSupply * ((1 + amount / reserveTokenBalance) ^ (reserveRatio) - 1)
        return  continuousTokenSupply * ((1 + amount / reserveTokenBalance) ** (reserveRatio) - 1)

    // PurchaseReturn = ContinuousTokenSupply * ((1 + ReserveTokensReceived / ReserveTokenBalance) ^ (ReserveRatio) - 1)
// 
}
