// SPDX-License-Identifier: MIT

pragma solidity 0.8.4;

import "hardhat/console.sol";


contract Twav {
    struct TwavObservation {
        uint256 timestamp;
        uint256 cumulativeValuation;
    }

    uint8 public twavObservationsIndex;
    uint8 private constant TWAV_BLOCK_NUMBERS = 12; //3 MIN TWAV => 3 * 4 
    uint32 public lastBlockTimeStamp;

    TwavObservation[TWAV_BLOCK_NUMBERS] public twavObservations;

    function _updateTWAV(uint256 _valuation) internal {
        uint32 _blockTimestamp = uint32(block.timestamp % 2**32);
        uint32 _timeElapsed; 
        unchecked{
            _timeElapsed = _blockTimestamp - lastBlockTimeStamp;
        }
        twavObservations[((twavObservationsIndex++) % TWAV_BLOCK_NUMBERS)] = TwavObservation(_blockTimestamp, _valuation * _timeElapsed);
        lastBlockTimeStamp = _blockTimestamp;

    }

    function _getTwav() internal view returns(uint256 _twav){
        uint8 _index = twavObservationsIndex;
        TwavObservation memory _twavObservationCurrent = twavObservations[_index];
        TwavObservation memory _twavObservationPrev = twavObservations[(_index + 1) % TWAV_BLOCK_NUMBERS];
        _twav = (_twavObservationCurrent.cumulativeValuation - _twavObservationPrev.cumulativeValuation) / (_twavObservationCurrent.timestamp - _twavObservationPrev.timestamp);
    }

}