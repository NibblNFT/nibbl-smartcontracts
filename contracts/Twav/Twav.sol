// SPDX-License-Identifier: MIT

pragma solidity 0.8.4;

import "hardhat/console.sol";


contract Twav {
    struct TwavObservation {
        uint256 timestamp;
        uint256 cumulativeValuation;
    }

    uint8 public twavObservationsIndex;
    uint8 private constant TWAV_BLOCK_NUMBERS = 6; //TWAV of last 6 Txs 
    uint32 public lastBlockTimeStamp;

    TwavObservation[TWAV_BLOCK_NUMBERS] public twavObservations;

    function _updateTWAV(uint256 _valuation, uint32 _blockTimestamp) internal {
        //TODO: Should time elapsed be zero while initiating?
        uint32 _timeElapsed; 
        unchecked{
            _timeElapsed = _blockTimestamp - lastBlockTimeStamp;
        }
        uint256 _prevCumulativeValuation = twavObservations[((twavObservationsIndex + TWAV_BLOCK_NUMBERS) - 1) % TWAV_BLOCK_NUMBERS].cumulativeValuation;
        twavObservations[twavObservationsIndex] = TwavObservation(_blockTimestamp, _prevCumulativeValuation + (_valuation * _timeElapsed)); //add the previous observation to make it cumulative
        console.log(_valuation, _timeElapsed);
        twavObservationsIndex = (twavObservationsIndex + 1) % TWAV_BLOCK_NUMBERS;
        lastBlockTimeStamp = _blockTimestamp;
    }

    function _getTwav() public view returns(uint256 _twav){
        if (twavObservations[TWAV_BLOCK_NUMBERS - 1].timestamp != 0) {
            uint8 _index = ((twavObservationsIndex + TWAV_BLOCK_NUMBERS) - 1) % TWAV_BLOCK_NUMBERS;
            TwavObservation memory _twavObservationCurrent = twavObservations[(_index)]; //to subtract 1 from current index
            TwavObservation memory _twavObservationPrev = twavObservations[(_index + 1) % TWAV_BLOCK_NUMBERS];
            _twav = (_twavObservationCurrent.cumulativeValuation - _twavObservationPrev.cumulativeValuation) / (_twavObservationCurrent.timestamp - _twavObservationPrev.timestamp);
        }
    }

}