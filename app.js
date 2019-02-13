var express = require('express');
var path = require('path');
var favicon = require('serve-favicon');
var _ = require('lodash');
var logger = require('morgan');
var cookieParser = require('cookie-parser');
var bodyParser = require('body-parser');
var async = require('async');
var fs = require('fs');

var index = require('./routes/index');
var users = require('./routes/users');

var app = express();
var server = require('http').Server(app);
var io = require('socket.io')(server);
var db = require('./lib/db');
// var tcpClient = require('./lib/tcp');
var gameUtils = require('./lib/gameUtils');


// mqtt config
var mqtt = require('mqtt');
var mqtt_url = 'mqtt://localhost:1883';
var mqttClient = mqtt.connect(mqtt_url);

mqttClient.on('connect', () => {
  console.log('Connected to broker');
});

// Initiate data
if (!fs.existsSync('./data/currentRoundId.txt')) fs.writeFileSync('./data/currentRoundId.txt', '');
if (!fs.existsSync('./data/currentSemiFinalRoundId.txt')) fs.writeFileSync('./data/currentSemiFinalRoundId.txt', '');

// Application state
var currentRoundId = fs.readFileSync('./data/currentRoundId.txt', 'utf8');
var currentSemiFinalRoundId = fs.readFileSync('./data/currentSemiFinalRoundId.txt', 'utf8');
var currentTimerInterval = null;
var redTimerInterval = null;
var redTimeLeftInMillis = 0;
var greenTimerInterval = null;
var greenTimeLeftInMillis = 0;
var timeLeftInMillis = 0;

const defaultRound = {
  greenName: '',
  greenResults: ['START:START'],
  redName: '',
  redResults: ['START:START'],
};

var dataRed = {
  stadium: 'R',
  resultPassing: []
};

var dataGreen = {
  stadium: 'G',
  resultPassing: []
};

var servoObj = {
  left: "LEFT",
  right: "RIGHT",
  straighleft: "STRAIGH_LEFT",
  straighright: "STRAIGH_RIGHT"
};

var mqttConfig = {
  servoCommandTopic: 'cds/servo/command',
  commandTopic: 'cds/command',
  servoStateTopic: 'cds/servo/state',
  checkSensorStopTopic: 'cds/server/sensor6',
  newCaseTopic: 'cds/case',
  newRoundTopic: 'cds/newRound',
  sensorTopic: 'cds/sensor',
  sensorTopicFinal: 'cds/sensor/final',
  isSendMessageSensor5Topic: 'cds/sensor5/log',
  isSendMessageSensor5TopicFinal: 'cds/sensor5/log/final',
  servoCommandSemiFinalTopic: 'cds/servo/command/final',
  servoNewRound: 'cds/servo/newRound',
  retryTopic: 'cds/retry',
  retrySemiTopic: 'cds/retry/final'
  // sensorFinalTopic: 'cds/final/sensor'
}

// Global config for socket.io
io.on('connection', function (socket) {
  async.parallel([db.getAllTeams, db.getAllRounds, db.getAllRounds2], (err, data) => {
    if (err) return console.error("Error on emit initData", err);

    socket.emit('remote_dispatch', {
      type: 'INIT_DATA',
      data: {
        teams: data[0],
        rounds: data[1],
        // semiFinalRounds: data[2],
        currentRoundInfo: _.find(data[1], r => r._id === currentRoundId) || defaultRound,
      },
    });

    calculateLeaderboard(lb => {
      socket.emit('remote_dispatch', {
        type: 'UPDATE_LEADERBOARD',
        data: lb,
      });
    });
  });

  socket.on('broadcast', function (data) {
    console.log('Received broadcast request from client', data);
    socket.broadcast.emit(data.emitName, data.payload);
  });

  socket.on('admin/updateTeamList', (data) => {
    console.log('Update Team List: ', data);
    db.teams.remove({}, {
      multi: true
    }, (err) => {
      // team number
      const docs = _.map(_.range(1, 9), i => ({
        id: i,
        name: data.teams[`team${i}`],
      }));
      db.teams.insert(docs, (err, newDocs) => {
        if (err) return console.error('Error when updating team list: ', err);

        socket.broadcast.emit('remote_dispatch', {
          type: 'UPDATE_TEAM_LIST',
          data: newDocs
        });
      });
    });
  });

  // Round 1
  socket.on('admin/createRounds', () => {
    db.rounds.remove({}, {
      multi: true
    }, (err) => {
      if (err) console.error('Error when creating round: ', err);
      db.getAllTeams((err, teams) => {
        let docs = [];
        for (let i = 0; i < teams.length - 1; i += 2) {
          docs.push({
            id: i / 2,
            redId: teams[i].id,
            redName: teams[i].name,
            redResults: ['START:START'],
            greenId: teams[i + 1].id,
            greenName: teams[i + 1].name,
            greenResults: ['START:START'],
          });
        }
        db.rounds.insert(docs, (err, newDocs) => {
          if (err) console.error('Error when creating round: ', err);
          socket.emit('remote_dispatch', {
            type: 'ADMIN_UPDATE_ROUND_LIST',
            data: newDocs,
          });

          currentRoundId = newDocs[0]._id;
          fs.writeFile('./data/currentRoundId.txt', currentRoundId);

          socket.broadcast.emit('remote_dispatch', {
            type: 'CHANGE_ROUND',
            data: newDocs[0],
          })
        });
      });
    });
  });

  socket.on('admin/startRace', (data) => {
    const startTime = new Date();
    const endTime = startTime.getTime() + 180000;
    timeLeftInMillis = 180000;
    //timeLeftInMillis = 60000;

    if (currentTimerInterval) clearInterval(currentTimerInterval);

    currentTimerInterval = setInterval(() => {
      if (timeLeftInMillis <= 0) {
        // Notify the hub that the race has been timed out
        // and stop listening from the hub
        clearInterval(currentTimerInterval);

        mqttClient.publish(mqttConfig.commandTopic, JSON.stringify({
          command: "RACE_STOP_1"
        }));
        mqttClient.unsubscribe(mqttConfig.sensorTopic, (err) => {
          if (err) {
            console.log('Error occur when unsubscribing cds/sensor ', err);
          } else {
            console.log('Unsubscribed cds/sensor');
          }
        });

        // Set timer on client to 0
        socket.broadcast.emit('remote_dispatch', {
          type: 'UPDATE_TIMER',
          data: 0
        });

        socket.broadcast.emit('remote_dispatch', {
          type: 'UPDATE_RED_TIME_LEFT',
          data: 0
        });

        socket.broadcast.emit('remote_dispatch', {
          type: 'UPDATE_GREEN_TIME_LEFT',
          data: 0
        });

        // reset result from previous round
        dataRed.resultPassing = [];
        dataRed.isLogForSensor5 = false;
        dataGreen.resultPassing = [];
        dataRed.isLogForSensor5 = false;  

        calculateRoundOneFinalResult(() => {
          calculateLeaderboard((leaderboard) => {
            socket.broadcast.emit('remote_dispatch', {
              type: 'UPDATE_LEADERBOARD',
              data: leaderboard,
            });
            socket.broadcast.emit('remote_dispatch', {
              type: 'CHANGE_SCREEN',
              data: 'LEADERBOARD',
            });
          });
        });
      } else {
        timeLeftInMillis -= 1000;
        socket.broadcast.emit('remote_dispatch', {
          type: 'UPDATE_TIMER',
          data: timeLeftInMillis
        });
      }
    }, 1000);

    db.rounds.update({
      _id: currentRoundId
    }, {
      $set: {
        raceStartedAt: startTime
      }
    }, (err) => {
      if (err) return console.error('failed to start round: ', err);

      mqttClient.publish(mqttConfig.commandTopic, JSON.stringify({
        command: "RACE_START_1"
      }));

      mqttClient.subscribe(mqttConfig.sensorTopic);
      mqttClient.subscribe('cds/server/servo');
      mqttClient.subscribe('cds/server/case');
      mqttClient.subscribe(mqttConfig.servoStateTopic);
      mqttClient.subscribe(mqttConfig.checkSensorStopTopic);
      mqttClient.subscribe(mqttConfig.newCaseTopic);
      mqttClient.subscribe(mqttConfig.retryTopic);

      mqttClient.on('message', (topic, payload) => {
        switch (topic) {
          case mqttConfig.sensorTopic:
            var data = JSON.parse(payload);
            // console.log('Recive message sensor ', data);
            handleRoundOneLogic(data);
            break;
          case mqttConfig.servoStateTopic:
            var data = JSON.parse(payload);
            console.log('Recieve servo state: ', data);
            handleServoState(data);
            break;
          case mqttConfig.checkSensorStopTopic:
            var data = JSON.parse(payload);
            console.log('Recieve sensor 6 data: ', data);
            if (data.stadium == 'R' && dataRed.rightWay2) {
              handleSensorStopDataRedStadium(data);
            } else if (data.stadium == 'G' && dataGreen.rightWay2) {
              handleSensorStopDataGreenStadium(data);
            }
            break;
          case mqttConfig.newCaseTopic:
            var data = JSON.parse(payload);
            console.log('Recieve new case: ', data);
            handleNewCase(data);
            break;
          case mqttConfig.retryTopic:
            var data = JSON.parse(payload);
            handleNewCase(data);
            break;
        }
      });
    });
  });

  socket.on('admin/changeRound', (data) => {
    db.rounds.findOne({
      _id: data.id
    }, (err, doc) => {
      if (!doc) console.error('round not found: ', data.id);

      currentRoundId = data.id;
      fs.writeFile('./data/currentRoundId.txt', data.id);

      socket.broadcast.emit('remote_dispatch', {
        type: 'CHANGE_ROUND',
        data: doc,
      });
    });
  });

  socket.on('admin/resetRound', (data) => {
    if (currentTimerInterval) clearInterval(currentTimerInterval);

    db.rounds.update({
      _id: currentRoundId
    }, {
      $set: {
        greenResults: ['START:START'],
        redResults: ['START:START'],
        raceStartedAt: undefined
      }
    }, (err) => {
      if (err) return console.error('failed to reset round: ', err);
      dataRed.resultPassing = [];
      dataRed.isLogForSensor5 = false;
      dataGreen.resultPassing = [];
      dataRed.isLogForSensor5 = false;

      mqttClient.publish(mqttConfig.commandTopic, JSON.stringify({
        command: "RACE_RESET_1"
      }));
      mqttClient.unsubscribe(mqttConfig.sensorTopic, (err) => {
        if (err) {
          console.log('Error occur when unsubscribing cds/sensor ', err);
        } else {
          console.log('Unsubscribed cds/sensor');
        }
      });

      // Reset timer on client to 0
      socket.broadcast.emit('remote_dispatch', {
        type: 'UPDATE_TIMER',
        data: 0
      });

      socket.broadcast.emit('remote_dispatch', {
        type: 'UPDATE_RED_TIME_LEFT',
        data: 0
      });

      socket.broadcast.emit('remote_dispatch', {
        type: 'UPDATE_GREEN_TIME_LEFT',
        data: 0
      });


      dispatchCurrentRoundInfoToFrontend();
    });
  });

  // Semifinal Round

  // create semi-final round
  socket.on('admin/createSemiFinalRounds', () => {
    db.semiFinalRounds.remove({}, {
      multi: true
    }, (err) => {
      if (err) console.error('Error when deleting all second rounds: ', err);
      calculateLeaderboard(lb => {
        let docs = [];
        docs.push({
          id: 0,
          redId: lb[0].teamId,
          redName: lb[0].teamName,
          redResults: ['START:START'],
          greenId: lb[3].teamId,
          greenName: lb[3].teamName,
          greenResults: ['START:START'],
        });
        docs.push({
          id: 1,
          redId: lb[1].teamId,
          redName: lb[1].teamName,
          redResults: ['START:START'],
          greenId: lb[2].teamId,
          greenName: lb[2].teamName,
          greenResults: ['START:START'],
        });
        db.semiFinalRounds.insert(docs, (err, newDocs) => {
          if (err) console.error('Error when creating second rounds: ', err);
          socket.emit('remote_dispatch', {
            type: 'ADMIN_UPDATE_SEMI_FINAL_ROUND_LIST',
            data: newDocs,
          });

          currentSemiFinalRoundId = newDocs[0]._id;
          fs.writeFile('./data/currentSemiFinalRoundId.txt', currentSemiFinalRoundId);

          socket.broadcast.emit('remote_dispatch', {
            type: 'CHANGE_SEMI_FINAL_ROUND',
            data: newDocs[0],
          });
        });
      });
    });
  });

  // start semi-final race
  socket.on('admin/startSemiFinalRace', (data) => {
    const startTime = new Date();
    const endTime = startTime.getTime() + 180000;
    timeLeftInMillis = 180000;

    if (currentTimerInterval) clearInterval(currentTimerInterval);

    currentTimerInterval = setInterval(() => {
      if (timeLeftInMillis <= 0) {
        // Notify the hub that the race has been timed out
        // and stop listening from the hub
        clearInterval(currentTimerInterval);

        mqttClient.publish(mqttConfig.commandTopic, JSON.stringify({
          command: "RACE_STOP_2"
        }));
        mqttClient.unsubscribe(mqttConfig.sensorTopicFinal, (err) => {
          if (err) {
            console.log('Error occur when unsubscribing cds/sensor ', err);
          } else {
            console.log('Unsubscribed cds/sensor');
          }
        });

        // Set timer on client to 0
        socket.broadcast.emit('remote_dispatch', {
          type: 'UPDATE_TIMER',
          data: 0
        });

        // reset result from previous round
        dataRed.resultPassing = [];
        dataRed.isLogForSensor5 = false;
        dataGreen.resultPassing = [];
        dataRed.isLogForSensor5 = false;  

        // calculate and announce who win this round
        db.semiFinalRounds.findOne({ _id: currentSemiFinalRoundId }, (err, round) => {
          if (err) return console.error(err);
          const {winner} = gameUtils.calculateSemiFinalRoundFinalResult(round);
          db.semiFinalRounds.update({ _id: currentSemiFinalRoundId }, { $set: { winner } }, {returnUpdatedDocs: true}, (err, num, doc) => {
            socket.broadcast.emit('remote_dispatch', {
              type: 'CHANGE_SEMI_FINAL_ROUND',
              data: doc,
            });
          });
        });
        
      } else {
        timeLeftInMillis -= 1000;
        socket.broadcast.emit('remote_dispatch', {
          type: 'UPDATE_TIMER',
          data: timeLeftInMillis
        });
      }
    }, 1000);

    db.semiFinalRounds.update({ _id: currentSemiFinalRoundId }, { $set: { raceStartedAt: startTime } }, (err) => {
      if (err) return console.error('failed to start round: ', err);
      // Notify the hub that the race has been started
      // and start listening for result coming from the hub
      // tcpClient.send('RACE_START_ROUND_2\n');
      // tcpClient.addListener(handleRoundTwoLogic);

      mqttClient.publish(mqttConfig.commandTopic, JSON.stringify({
        command: "RACE_START_2"
      }));

      mqttClient.subscribe(mqttConfig.sensorTopicFinal);
      mqttClient.subscribe(mqttConfig.newCaseTopic);
      mqttClient.subscribe(mqttConfig.retrySemiTopic);

      mqttClient.on('message', (topic, payload) => {
        switch (topic) {
          case mqttConfig.sensorTopicFinal:
            var data = JSON.parse(payload);
            // console.log('Recive message sensor ', data);
            handleSemiFinalRoundLogic(data);
            break;
          
          case mqttConfig.newCaseTopic:
            var data = JSON.parse(payload);
            console.log('Recieve new case: ', data);
            handleNewCase(data);
            break;
          case mqttConfig.retrySemiTopic:
            var data = JSON.parse(payload);
            handleNewCaseSemi(data);
            break;
        }
      });
    });
  });

  // change semi-final round
  socket.on('admin/changeSemiFinalRound', (data) => {
    db.semiFinalRounds.findOne({
      _id: data.id
    }, (err, doc) => {
      if (!doc) console.error('round not found: ', data.id);

      currentSemiFinalRoundId = data.id;
      fs.writeFile('./data/changeSemiFinalRound.txt', data.id);

      socket.broadcast.emit('remote_dispatch', {
        type: 'CHANGE_SEMI_FINAL_ROUND',
        data: doc,
      });
    });
  });

  // reset semi-final round
  socket.on('admin/resetSemiFinalRound', (data) => {
    if (currentTimerInterval) clearInterval(currentTimerInterval);

    db.semiFinalRounds.update({ _id: currentSemiFinalRoundId }, { $set: { winner: undefined, greenResults: ['START:START'], redResults: ['START:START'], raceStartedAt: undefined } }, {returnUpdatedDocs: true}, (err, num, doc) => {
      if (err) return console.error('failed to reset second round: ', err);

      // Notify the hub that race has been reset
      // and stop listening from the hub
      
      dataRed.resultPassing = [];
      dataRed.isLogForSensor5 = false;
      dataGreen.resultPassing = [];
      dataRed.isLogForSensor5 = false;

      mqttClient.publish(mqttConfig.commandTopic, JSON.stringify({
        command: "RACE_RESET_2"
      }));

      mqttClient.unsubscribe(mqttConfig.sensorTopicFinal, (err) => {
        if (err) {
          console.log('Error occur when unsubscribing cds/sensor ', err);
        } else {
          console.log('Unsubscribed cds/sensor');
        }
      });

      // Reset timer on client to 0
      socket.broadcast.emit('remote_dispatch', {
        type: 'UPDATE_TIMER',
        data: 0
      });

      socket.broadcast.emit('remote_dispatch', {
        type: 'CHANGE_SEMI_FINAL_ROUND',
        data: doc,
      });
    });

    dispatchCurrentSemiFinalRoundInfoToFrontend();
  });

  // Final Round

  // create final round
  socket.on('admin/createFinalRounds', () => {
    db.semiFinalRounds.remove({ id: 2 }, err => {
      db.getAllSemiFinalRounds((err, rounds) => {
        let [banKet1, banKet2] = rounds;
        let championRound = {
          id: 2,
          redId: banKet1[`${banKet1.winner}Id`],
          redName: banKet1[`${banKet1.winner}Name`],
          redResults: ['START:START'],

          greenId: banKet2[`${banKet2.winner}Id`],
          greenName: banKet2[`${banKet2.winner}Name`],
          greenResults: ['START:START'],
          
          isChampionRound: true,
        };
        db.semiFinalRounds.insert(championRound, (err, newRound) => {
          if (err) console.error('Error when creating champion round: ', err);

          db.getAllSemiFinalRounds((err, rounds) => {
            socket.emit('remote_dispatch', {
              type: 'ADMIN_UPDATE_SEMI_FINAL_ROUND_LIST',
              data: rounds,
            });
          });
        });
      });
    });
  });

  function handleNewCase(data) {
    if (data.stadium == "G") {
      dataGreen.resultPassing = [];
      dataGreen.isLogForSensor5 = false;
    } else if (data.stadium == 'R') {
      dataRed.resultPassing = [];
      dataRed.isLogForSensor5 = false;
    }
  }

  function handleNewCaseSemi(data) {
    if (data.stadium == "G") {
      dataGreen.resultPassing = [];
      dataGreen.isLogForSensor5 = false;
      turnServoSemiFinal(data.stadium, 1, servoObj.left);
    } else if (data.stadium == 'R') {
      dataRed.resultPassing = [];
      dataRed.isLogForSensor5 = false;
      turnServoSemiFinal(data.stadium, 1, servoObj.left);
    }
  }

  function handleSensorStopDataRedStadium(data) {
    if (data.isStop == 'true') {
      redTimeLeftInMillis = 5000;
      if (redTimerInterval) clearInterval(redTimerInterval);

      redTimerInterval = setInterval(() => {
        if (redTimeLeftInMillis <= 1000) {
          clearInterval(redTimerInterval);
          console.log("Over 5 seconds");
          dataRed.isLogForSensor5 = true;
          socket.broadcast.emit('remote_dispatch', {
            type: 'UPDATE_RED_TIME_LEFT',
            data: 0
          });
        } else {
          redTimeLeftInMillis -= 1000;
          socket.broadcast.emit('remote_dispatch', {
            type: 'UPDATE_RED_TIME_LEFT',
            data: redTimeLeftInMillis
          });
        }
      }, 1000);
    } else if (data.isStop == 'false') {
      clearInterval(redTimerInterval);
      socket.broadcast.emit('remote_dispatch', {
        type: 'UPDATE_RED_TIME_LEFT',
        data: 0
      });
    }
  }

  function handleSensorStopDataGreenStadium(data) {
    if (data.isStop == 'true') {
      greenTimeLeftInMillis = 5000;
      if (greenTimerInterval) clearInterval(greenTimerInterval);

      greenTimerInterval = setInterval(() => {
        if (greenTimeLeftInMillis <= 1000) {
          clearInterval(greenTimerInterval);
          console.log("Over 5 seconds");
          dataGreen.isLogForSensor5 = true;
          socket.broadcast.emit('remote_dispatch', {
            type: 'UPDATE_GREEN_TIME_LEFT',
            data: 0
          });
        } else {
          greenTimeLeftInMillis -= 1000;
          socket.broadcast.emit('remote_dispatch', {
            type: 'UPDATE_GREEN_TIME_LEFT',
            data: greenTimeLeftInMillis
          });
        }
      }, 1000);
    } else if (data.isStop == 'false') {
      clearInterval(greenTimerInterval);
      socket.broadcast.emit('remote_dispatch', {
        type: 'UPDATE_GREEN_TIME_LEFT',
        data: 0
      });
    }
  }

  function handleServoState(data) {
    if (data.stadium == "G") {
      if (data.servo == 1) {
        dataGreen.servo1 = data.state;
      } else if (data.servo == 2) {
        dataGreen.servo2 = data.state;
      }
    } else if (data.stadium == "R") {
      if (data.servo == 1) {
        dataRed.servo1 = data.state;
      } else if (data.servo == 2) {
        dataRed.servo2 = data.state;
      }
    }
  }

  // Logic of ROUND 1
  function handleRoundOneLogic(data) {
    console.log('Incoming data from the hub for ROUND 1: ', data);
    // let match = data.toString().match(/^([GR]{1})[12]{1}:(START|P[1-5]{1}):(START|[\d\.]+)$/);
    // if (!match) return console.log('Invalid data format. Do nothing!');
    if (data.stadium == "G") {
      handleSensorRound1(dataGreen, data);
    } else if (data.stadium == "R") {
      handleSensorRound1(dataRed, data);
    }
  }

  function handleSensorRound1(dataStadium, data) {
    // console.log("dataStadium: ", dataStadium.resultPassing);
    var lengthDataStadium = dataStadium.resultPassing.length;
    console.log("lengDataStadium: ", lengthDataStadium);
    if (dataStadium.resultPassing.indexOf(data.channel) == -1) {
      var lengthDataStadium = dataStadium.resultPassing.length;

      if (lengthDataStadium == 0) {
        // Đi đúng sensor 1
        if (dataStadium.servo1 == "LEFT" && data.channel == '1') {
          dataStadium.resultPassing.push(data.channel);
          data.channel = '1';
          updateResult(data);
          turnServo(data.stadium, 1, servoObj.straighleft);
          dataStadium.rightWay1 = true;
        } else if (dataStadium.servo1 == "RIGHT" && data.channel == '2') {
          dataStadium.resultPassing.push(data.channel);
          data.channel = '1';
          updateResult(data);
          turnServo(data.stadium, 1, servoObj.straighright);
          dataStadium.rightWay1 = true;
        } 
        // Đi sai sensor 1
        else if (dataStadium.servo1 == "LEFT" && data.channel == '2') {
          dataStadium.resultPassing.push(data.channel);
          // turnServo(data.stadium, 1, servoObj.straighright);
          dataStadium.rightWay1 = false;
        } else if (dataStadium.servo1 == "RIGHT" && data.channel == '1') {
          dataStadium.resultPassing.push(data.channel);
          // turnServo(data.stadium, 1, servoObj.straighleft);
          dataStadium.rightWay1 = false;
        } 
        // quay servo 2
        if (dataStadium.servo2 == "LEFT") {
          console.log("Bien 2 quay trai");
          turnServo(data.stadium, 2, servoObj.left);
        } else if (dataStadium.servo2 == "RIGHT") {
          console.log("Bien 2 quay phai");
          turnServo(data.stadium, 2, servoObj.right);
        }
      }
      // đi đúng sensor 2 
      else if (dataStadium.rightWay1 && (data.channel == '1' || data.channel == '2')) {
        dataStadium.resultPassing.push(data.channel);
        data.channel = '2';
        updateResult(data);
      } 
      // đi sai sensor 2
      else if (!dataStadium.rightWay1 && (data.channel == '1' || data.channel == '2')) {
        dataStadium.resultPassing.push(data.channel);
      }
      
      // check vong 2

      // đi đúng vòng 1
      else if (dataStadium.rightWay1 && lengthDataStadium == 2) {
        // Đi đúng sensor thu 3
        if (dataStadium.servo2 == "LEFT" && data.channel == '3') {
          dataStadium.resultPassing.push(data.channel);
          data.channel = '3';
          updateResult(data);
          turnServo(data.stadium, 2, servoObj.straighleft);
          dataStadium.rightWay2 = true;
        } else if (dataStadium.servo2 == "RIGHT" && data.channel == '4') {
          dataStadium.resultPassing.push(data.channel);
          data.channel = '3';
          updateResult(data);
          turnServo(data.stadium, 2, servoObj.straighright);
          dataStadium.rightWay2 = true;
        } else {
          dataStadium.resultPassing.push(data.channel);
          dataStadium.rightWay2 = false;
        }

        // Đi sai sensor thu 3
        // else if (dataStadium.servo2 == "LEFT" && data.channel == '4') {
        //   dataStadium.resultPassing.push(data.channel);
        //   turnServo(data.stadium, 2, servoObj.straighright);
        //   dataStadium.rightWay2 = false;
        // } else if (dataStadium.servo2 == "RIGHT" && data.channel == '3') {
        //   dataStadium.resultPassing.push(data.channel);
        //   turnServo(data.stadium, 2, servoObj.straighleft);
        //   dataStadium.rightWay2 = false;
        // }
      }

      // đi sai vòng 1 và sai sensor 3
      // else if (!dataStadium.rightWay1 && lengthDataStadium == 2) {
      //   if (data.channel == '3') {
      //     data.rightWay2 = false;
      //     dataStadium.resultPassing.push(data.channel);
      //     turnServo(data.stadium, 2, servoObj.straighleft);
      //   } else if (data.channel == '4') {
      //     data.rightWay2 = false;
      //     dataStadium.resultPassing.push(data.channel);
      //     turnServo(data.stadium, 2, servoObj.straighright);
      //   }
      // }
      // đi đúng sensor 4
      else if (dataStadium.rightWay2 && (data.channel == '3' || data.channel == '4')) {
        dataStadium.resultPassing.push(data.channel);
        data.channel = '4';
        updateResult(data);
        mqttClient.publish(mqttConfig.isSendMessageSensor5Topic, JSON.stringify({
          'stadium': dataStadium.stadium,
        }));
        mqttClient.publish(mqttConfig.servoNewRound, JSON.stringify({
          "stadium":  dataStadium.stadium
        }));
      }
      // đi sai sensor 4 
      else if (!dataStadium.rightWay2 && (data.channel == '3' || data.channel == '4')) {
        dataStadium.resultPassing.push(data.channel);
        mqttClient.publish(mqttConfig.isSendMessageSensor5Topic, JSON.stringify({
          'stadium': dataStadium.stadium,
        }));
        mqttClient.publish(mqttConfig.servoNewRound, JSON.stringify({
          "stadium":  dataStadium.stadium
        }));
      }
      
      // sensor 5
      else if (data.channel == '5') {
        if (dataStadium.isLogForSensor5) {
          dataStadium.resultPassing.push(data.channel);
          data.channel = '5';
          updateResult(data);
        }

        requestNewRound(dataStadium);

      }
      // console.log('Result: ', dataStadium.resultPassing);
    }
  }

  function requestNewRound(dataStadium) {
    mqttClient.publish(mqttConfig.newRoundTopic, JSON.stringify({
      "stadium": dataStadium.stadium
    }))

    handleNewCase(dataStadium);
  }

  function turnServo(stadium, servo, angle) {
    mqttClient.publish(mqttConfig.servoCommandTopic, JSON.stringify({
      "stadium": stadium,
      "servo": servo,
      "angle": angle
    }));
  }

  function updateResult(data) {
    if (data.stadium == "G") {
      db.rounds.update({
        _id: currentRoundId
      }, {
        $push: {
          greenResults: `${data.channel}:${data.runtime}`
        }
      }, err => {
        if (err) console.error('Error when updating result for Green team');
        console.log(`Updated result for Green team: ${data.channel}:${data.runtime}`);
        dispatchCurrentRoundInfoToFrontend();
      });
    } else if (data.stadium == "R") {
      db.rounds.update({
        _id: currentRoundId
      }, {
        $push: {
          redResults: `${data.channel}:${data.runtime}`
        }
      }, err => {
        if (err) console.error('Error when updating result for red team');
        console.log(`Updated result for Red team: ${data.channel}:${data.runtime}`);
        dispatchCurrentRoundInfoToFrontend();
      });
    }
  }

  function updateSemiFinalResult(data) {
    if (data.stadium == "G") {
      db.semiFinalRounds.update({
        _id: currentSemiFinalRoundId
      }, {
        $push: {
          greenResults: `${data.channel}:${data.runtime}`
        }
      }, err => {
        if (err) console.error('Error when updating result for Green team');
        console.log(`Updated result for Green team round 2: ${data.channel}:${data.runtime}`);
        dispatchCurrentSemiFinalRoundInfoToFrontend();
        displayWinner();
      });
    } else if (data.stadium == "R") {
      db.semiFinalRounds.update({
        _id: currentSemiFinalRoundId
      }, {
        $push: {
          redResults: `${data.channel}:${data.runtime}`
        }
      }, err => {
        if (err) console.error('Error when updating result for red team');
        console.log(`Updated result for Red team round 2: ${data.channel}:${data.runtime}`);
        dispatchCurrentSemiFinalRoundInfoToFrontend();
        displayWinner();
      });
    }
  }

  function displayWinner() {
    db.semiFinalRounds.findOne({ _id: currentSemiFinalRoundId }, (err, doc) => {
      if (!doc) console.error('semi-final round not found: ', data.id);
      
      let {greenResults, redResults} = doc;

      greenResults = greenResults.slice(_.findLastIndex(greenResults, r => ~r.indexOf('START:START')));
      redResults = redResults.slice(_.findLastIndex(redResults, r => ~r.indexOf('START:START')));
      
      var isRedWin = redResults[redResults.length - 1].split(':')[0] == 14 ? true : false;
      var isGreenWin = greenResults[greenResults.length - 1].split(':')[0] == 14 ? true : false;
      // const isGreenWin = _.filter(greenResults, r => ~r.indexOf('14')).length === 1;
      // const isRedWin = _.filter(redResults, r => ~r.indexOf('14')).length === 1;
      console.log("redResults", redResults);
      
      console.log("isRedWin", isRedWin);

      if (isGreenWin || isRedWin) {
        // Found the winner
        db.semiFinalRounds.update({ _id: currentSemiFinalRoundId }, { $set: { winner: isGreenWin ? 'green' : 'red' } }, {returnUpdatedDocs: true}, (err, num, doc) => {
          clearInterval(currentTimerInterval);
          // tcpClient.send('RACE_STOP_ROUND_2\n');
          // tcpClient.removeListener(handleRoundTwoLogic);

          mqttClient.publish(mqttConfig.commandTopic, JSON.stringify({
            command: "RACE_STOP_2"
          }));
          mqttClient.unsubscribe(mqttConfig.sensorTopicFinal, (err) => {
            if (err) {
              console.log('Error occur when unsubscribing cds/sensor ', err);
            } else {
              console.log('Unsubscribed cds/sensor');
            }
          });
  
          // Set timer on client to 0
          socket.broadcast.emit('remote_dispatch', {
            type: 'UPDATE_TIMER',
            data: 0
          });
  
          // reset result from previous round
          dataRed.resultPassing = [];
          dataRed.isLogForSensor5 = false;
          dataGreen.resultPassing = [];
          dataRed.isLogForSensor5 = false;  

          socket.broadcast.emit('remote_dispatch', {
            type: 'CHANGE_SEMI_FINAL_ROUND',
            data: doc,
          });
        });
      }
      //  else {
      //   // Resent round info to client
      //   socket.broadcast.emit('remote_dispatch', {
      //     type: 'CHANGE_SEMI_FINAL_ROUND',
      //     data: doc,
      //   });

      //   if (typeof cb === 'function') cb();
      // }
    });
  }

  function dispatchCurrentRoundInfoToFrontend(cb) {
    db.rounds.findOne({
      _id: currentRoundId
    }, (err, doc) => {
      if (!doc) console.error('round not found: ', data.id);

      
      // Resent round info to client
      socket.broadcast.emit('remote_dispatch', {
        type: 'CHANGE_ROUND',
        data: doc,
      });

      if (typeof cb === 'function') cb();
    });
  }

  function dispatchCurrentSemiFinalRoundInfoToFrontend(cb) {
    db.semiFinalRounds.findOne({
      _id: currentSemiFinalRoundId
    }, (err, doc) => {
      if (!doc) console.error('semifinal round not found: ', data.id);

      
      // Resent semi-final round info to client
      socket.broadcast.emit('remote_dispatch', {
        type: 'CHANGE_SEMI_FINAL_ROUND',
        data: doc,
      });

      if (typeof cb === 'function') cb();
    });
  }

  function calculateRoundOneFinalResult(cb) {
    db.rounds.findOne({
      _id: currentRoundId
    }, (err, doc) => {
      if (err) return console.error("Error calculateRoundOneFinalResult: ", err);
      const {
        greenBestResult,
        redBestResult
      } = gameUtils.calculateRoundOneFinalResult(doc);
      console.log('RACE STOPPED. Final result: ', greenBestResult, redBestResult);
      db.rounds.update({
        _id: currentRoundId
      }, {
        $set: {
          greenBestResult,
          redBestResult
        }
      }, cb);
    });
  }

  function calculateLeaderboard(cb) {
    db.getAllRounds((err, rounds) => {
      const leaderboard = _.chain(rounds)
        .filter(r => !!r.greenBestResult && !!r.redBestResult)
        .map(r => [{
          teamId: r.greenId,
          teamName: r.greenName,
          finalResult: r.greenBestResult,
        }, {
          teamId: r.redId,
          teamName: r.redName,
          finalResult: r.redBestResult,
        }])
        .flatten()
        .sortBy(team => gameUtils.sortByPointAndTime(team.finalResult))
        .reverse()
        .value();
      cb(leaderboard);
    });
  }

  function getRandomInt(max) {
    return Math.floor(Math.random() * Math.floor(max) + 1);
  }

  function turnServoSemiFinal(stadium, servo, angle) {
    console.log("Quay servo ", servo, angle);
    mqttClient.publish(mqttConfig.servoCommandSemiFinalTopic, JSON.stringify({
      "stadium": stadium,
      "servo": servo,
      "angle": angle
    }));
  }

  // Logic of semifinal round
  function handleSemiFinalRoundLogic(data) {
    console.log('Incoming data from the hub for ROUND 2: ', data);
    if (data.stadium == "G") {
      handleSemiFinalSensor(dataGreen, data);
    } else if (data.stadium == "R") {
      handleSemiFinalSensor(dataRed, data);
    }
  }

  function handleSemiFinalSensor(dataStadium, data) {
    // console.log("dataStadium: ", dataStadium.resultPassing);
    // if (dataStadium.resultPassing.indexOf(data.channel) == -1) {
      var lengthDataStadium = dataStadium.resultPassing.length;

      // qua sensor 1
      if (lengthDataStadium == 0 && data.channel == '1') {
        dataStadium.resultPassing.push(data.channel);
        data.channel = '1';
        updateSemiFinalResult(data);
        // enable sensor 5 send message to servo
        mqttClient.publish(mqttConfig.isSendMessageSensor5TopicFinal, JSON.stringify({
          'stadium': dataStadium.stadium,
        }));

        turnServoSemiFinal(data.stadium, 1, servoObj.right);
      }
      // qua sensor 4
      else if (lengthDataStadium == 1 && data.channel == '4') {
        // Đi đúng sensor 1
        dataStadium.resultPassing.push(data.channel);
        data.channel = '2';
        updateSemiFinalResult(data);
      }

      // qua sensor 5
      else if (lengthDataStadium == 2 && data.channel == '5') {
        // Đi đúng sensor 1
        dataStadium.resultPassing.push(data.channel);
        data.channel = '3';
        updateSemiFinalResult(data);
      }

      // qua sensor 2
      else if (lengthDataStadium == 3 && data.channel == '2') {
        // Đi đúng sensor 1
        dataStadium.resultPassing.push(data.channel);
        data.channel = '4';
        updateSemiFinalResult(data);
        turnServoSemiFinal(data.stadium, 1, servoObj.left);
      }

      // qua sensor 3
      else if (lengthDataStadium == 4 && data.channel == '3') {
        // Đi đúng sensor 1
        dataStadium.resultPassing.push(data.channel);
        data.channel = '5';
        updateSemiFinalResult(data);
      }

      // qua sensor 4
      else if (lengthDataStadium == 5 && data.channel == '4') {
        // Đi đúng sensor 1
        dataStadium.resultPassing.push(data.channel);
        data.channel = '6';
        updateSemiFinalResult(data);
      }

      // qua sensor 5
      else if (lengthDataStadium == 6 && data.channel == '5') {
        // Đi đúng sensor 1
        dataStadium.resultPassing.push(data.channel);
        data.channel = '7';
        updateSemiFinalResult(data);
      }


      // qua sensor 1
      if (lengthDataStadium == 7 && data.channel == '1') {
        dataStadium.resultPassing.push(data.channel);
        data.channel = '8';
        updateSemiFinalResult(data);
        turnServoSemiFinal(data.stadium, 1, servoObj.right);
      }
      // qua sensor 4
      else if (lengthDataStadium == 8 && data.channel == '4') {
        // Đi đúng sensor 1
        dataStadium.resultPassing.push(data.channel);
        data.channel = '9';
        updateSemiFinalResult(data);
      }

      // qua sensor 5
      else if (lengthDataStadium == 9 && data.channel == '5') {
        // Đi đúng sensor 1
        dataStadium.resultPassing.push(data.channel);
        data.channel = '10';
        updateSemiFinalResult(data);
      }

      // qua sensor 2
      else if (lengthDataStadium == 10 && data.channel == '2') {
        // Đi đúng sensor 1
        dataStadium.resultPassing.push(data.channel);
        data.channel = '11';
        updateSemiFinalResult(data);
      }

      // qua sensor 3
      else if (lengthDataStadium == 11 && data.channel == '3') {
        // Đi đúng sensor 1
        dataStadium.resultPassing.push(data.channel);
        data.channel = '12';
        updateSemiFinalResult(data);
      }

      // qua sensor 4
      else if (lengthDataStadium == 12 && data.channel == '4') {
        // Đi đúng sensor 1
        dataStadium.resultPassing.push(data.channel);
        data.channel = '13';
        updateSemiFinalResult(data);
      }

      // qua sensor 5
      else if (lengthDataStadium == 13 && data.channel == '5') {
        // Đi đúng sensor 1
        dataStadium.resultPassing.push(data.channel);
        data.channel = '14';
        updateSemiFinalResult(data);
      }
    // }
  }
});

// view engine setup
app.set('views', path.join(__dirname, 'views'));
app.set('view engine', 'ejs');

// uncomment after placing your favicon in /public
//app.use(favicon(path.join(__dirname, 'public', 'favicon.ico')));
app.use(function (req, res, next) {
  res.io = io;
  next();
});
app.use(logger('dev'));
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({
  extended: false
}));
app.use(cookieParser());
app.use(express.static(path.join(__dirname, 'public')));

app.use('/', index);
app.use('/users', users);

app.get('*', (req, res) => {
  res.sendFile(path.resolve(__dirname, 'public', 'index.html'));
});

// catch 404 and forward to error handler
app.use(function (req, res, next) {
  var err = new Error('Not Found');
  err.status = 404;
  next(err);
});

// error handler
app.use(function (err, req, res, next) {
  // set locals, only providing error in development
  res.locals.message = err.message;
  res.locals.error = req.app.get('env') === 'development' ? err : {};

  // render the error page
  res.status(err.status || 500);
  res.render('error');
});

module.exports = {
  app: app,
  server: server
};