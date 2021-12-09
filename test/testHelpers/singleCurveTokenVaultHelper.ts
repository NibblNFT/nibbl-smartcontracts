import { BigNumber } from "ethers";

export const unlockReservedLiquidity = (continuousTokenSupply: number, reserveTokenBalance: number, reserveRatio: number, amount: number): number => {
        return (1- (1 - (amount / reserveTokenBalance)) ** (reserveRatio)) * continuousTokenSupply;
};

export const mintTokens = (continuousTokenSupply:number, reserveTokenBalance:number, reserveRatio: number, amount: number) : number => {
        return  continuousTokenSupply * ((1 + amount / reserveTokenBalance) ** (reserveRatio) - 1)
}

export const burnTokens = (continuousTokenSupply:number, reserveTokenBalance:number, reserveRatio: number, continuousTokensReceived: number) : number => {
//    SaleReturn = ReserveTokenBalance * (1 - (1 - ContinuousTokensReceived / ContinuousTokenSupply) ^ (1 / (ReserveRatio)))

    return reserveTokenBalance * (1 - (1 - (continuousTokensReceived / continuousTokenSupply)) ** (1 / reserveRatio));     
}
