const _ = require('lodash');

const POINT_TO_DISTANCE_FROM_START = {
  START: 0,
  1: 6.8,
  2: 13.9,
  3: 27.5,
  4: 35.6,
  5: 42.4
}

const POINT_TO_DISTANCE_FROM_START_FINAL = {
  START: 0,
  1: 7.6,
  2: 20.3,
  3: 24.8,
  4: 33.4,
  5: 41.9,
  6: 54.7,
  7: 59.2,
  8: 66.8,
  9: 79.5,
  10: 84.0,
  11: 92.6,
  12: 101.1,
  13: 113.9,
  14: 118.4,
}

function sortByPointAndTime(r) {
  const [point, time] = r.split(':');
  console.log('POINT_TO_DISTANCE_FROM_START[point]: ', POINT_TO_DISTANCE_FROM_START[point]);
  return POINT_TO_DISTANCE_FROM_START[point] * 10000 - parseFloat(time === 'START' ? 0 : time);
}

module.exports = {
  calculateRoundOneFinalResult: (round) => {
    const { greenResults, redResults } = round;
    const greenBestResult = _.maxBy(greenResults, sortByPointAndTime);
    const redBestResult = _.maxBy(redResults, sortByPointAndTime);
    return {greenBestResult, redBestResult};
  },
  
  calculateSemiFinalRoundFinalResult: (round) => {
    let { greenResults, redResults } = round;
    greenResults = greenResults.slice(_.findLastIndex(greenResults, r => ~r.indexOf('START:START')));
    redResults = redResults.slice(_.findLastIndex(redResults, r => ~r.indexOf('START:START')));
    
    console.log("greenResults: ", greenResults);
    console.log("redResults: ", redResults);

    let greenScore = _.sum(_.map(greenResults, r => POINT_TO_DISTANCE_FROM_START_FINAL[r.split(':')[0]])) * 10000;
    let greenLastTime = greenResults[greenResults.length - 1].split(':')[1];
    if (greenLastTime === 'START') greenLastTime = 0;
    greenScore -= parseFloat(greenLastTime);
    console.log("greenScore: ", greenScore);

    let redScore = _.sum(_.map(redResults, r => POINT_TO_DISTANCE_FROM_START_FINAL[r.split(':')[0]])) * 10000;
    let redLastTime = redResults[redResults.length - 1].split(':')[1];
    if (redLastTime === 'START') redLastTime = 0;
    redScore -= parseFloat(redLastTime);
    console.log("redScore: ", redScore);

    return {
      winner: greenScore > redScore ? 'green' : 'red',
    }

  },
  sortByPointAndTime,
}
