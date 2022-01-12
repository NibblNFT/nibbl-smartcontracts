import { BigNumber } from "ethers";

type TwavObservations = {
        timestamp: BigNumber;
        cumulativeValuation: BigNumber;
}
export class TWAV {
    
    public twavObservations = new Array<TwavObservations>(6);
    public twavObservationIndex: number;
    public lastBlockTimeStamp: BigNumber;
    TWAV_BLOCK_NUMBERS: number = 6;

    constructor() {
        this.twavObservationIndex = 0;
        this.lastBlockTimeStamp = BigNumber.from(0);
        for (let i = 0; i < this.TWAV_BLOCK_NUMBERS; i++) {
            this.twavObservations[i] = { timestamp: BigNumber.from(0), cumulativeValuation: BigNumber.from(0) };
        }
    }

    addObservation(_valuation: BigNumber, _blockTimestamp: BigNumber) { 
        const _timeElapsed: BigNumber =_blockTimestamp.sub(this.lastBlockTimeStamp);
        const _prevCumulativeValuation: BigNumber = this.twavObservations[((this.twavObservationIndex + this.TWAV_BLOCK_NUMBERS) - 1) % this.TWAV_BLOCK_NUMBERS].cumulativeValuation;
        console.log(_valuation,_timeElapsed);
        
        this.twavObservations[this.twavObservationIndex] = { timestamp: _blockTimestamp, cumulativeValuation: _prevCumulativeValuation.add(_valuation.mul(_timeElapsed)) };
        this.twavObservationIndex = (this.twavObservationIndex + 1) % this.TWAV_BLOCK_NUMBERS;
        this.lastBlockTimeStamp = _blockTimestamp;
    }

    getTwav(): BigNumber {
        const _index: number = ((this.twavObservationIndex + this.TWAV_BLOCK_NUMBERS) - 1) % this.TWAV_BLOCK_NUMBERS;
        const _twavObservationPrev: TwavObservations = this.twavObservations[_index];
        const _twavObservationCurr: TwavObservations = this.twavObservations[(_index + 1) % this.TWAV_BLOCK_NUMBERS];
            // ((twavObservationsIndex + TWAV_BLOCK_NUMBERS) - 1) % TWAV_BLOCK_NUMBERS;
        return ((_twavObservationCurr.cumulativeValuation.sub(_twavObservationPrev.cumulativeValuation)).div((_twavObservationCurr.timestamp.sub(_twavObservationPrev.timestamp))));
    }

    //     function _getTwav() public view returns(uint256 _twav){
    //     if (twavObservations[TWAV_BLOCK_NUMBERS - 1].timestamp != 0) {
    //         TwavObservation memory _twavObservationCurrent = twavObservations[(_index)]; //to subtract 1 from current index
    //         TwavObservation memory _twavObservationPrev = twavObservations[(_index + 1) % TWAV_BLOCK_NUMBERS];
    //         _twav = (_twavObservationCurrent.cumulativeValuation - _twavObservationPrev.cumulativeValuation) / (_twavObservationCurrent.timestamp - _twavObservationPrev.timestamp);
    //     }
    // }

}