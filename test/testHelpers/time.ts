import { network } from 'hardhat';

export async function increaseTime(value: number, type: string) {
    
    let timeToIncrease;

    switch(type) {
        case 'seconds': timeToIncrease =  value;
        break;
        case 'minutes': timeToIncrease =  value * 60;
        break;
        case 'hours': timeToIncrease =  value * 60 * 60;
        break;
        case 'days': timeToIncrease =  value * 24 * 60 * 60;
        break;
        default: timeToIncrease = value;
        break;
    }

    await network.provider.send('evm_increaseTime', [timeToIncrease]);
    await network.provider.send('evm_mine');

}

export async function setTime(value: number) {
    await network.provider.send('evm_setNextBlockTimestamp', [value]);
    // await network.provider.send('evm_mine');

}