const username = "CS6700";

const _ = require('lodash');
const AgarioClient = require('agario-client'); //Use next line in your scripts
const RL = require('./rl.js'); //reinforcejs
//Load vector utilities
const Vec = require('./vector').Vec;
const line_intersect = require('./vector').line_intersect;
const line_point_intersect = require('./vector').line_point_intersect;


//AGAR CLIENT STATE
const client = new AgarioClient('worker'); //create new client and call it "worker" (not nickname)
client.debug = 1; //setting debug to 1 (available 0-5)
let interval_id = 0; //here we will store setInterval's ID
let map; //stupid client doesn't remember map sizes but fires event..........
//
const targetTypes = {
  NONE: 0,
  CELL: 1,
  VIRUS: 2,
  WALL: 3
};
const actionTypes = {
  UP: 0,
  LEFT: 1,
  DOWN: 2,
  RIGHT: 3
};

const sensorCount = 12;
const sensorRange = 500;
const sensors = _.map(_.range(sensorCount), (i, index, all) => {
  const rad = i * ((2 * Math.PI) / all.length);
  return new Vec(Math.cos(rad) * sensorRange, Math.sin(rad) * sensorRange);
});

//REINFORCEJS State
let agent;

//Setup Functions
const agarSetup = () => {
  client.on('lostMyBalls', () => {
      client.log('Died, respawning');
      client.spawn(username);
  });

  client.on('connected', () => { //when we connected to server
      client.log('Connected, spawning');
      client.spawn(username); //spawning new ball
      interval_id = setInterval(onTick, 50); //we will search for target to eat every 100ms
  });

  client.on('reset', () => { //when client clears everything (connection lost?)
      clearInterval(interval_id);
  });

  client.on('connectionError', (e) => {
      client.log('Connection failed with reason: ' + e);
      client.log('Server address set to: ' + client.server + ' please check if this is correct and working address');
  });

  client.on('mapSizeLoad', (minX, minY, maxX, maxY) => {
    map = {minX, maxX, minY, maxY};
  });
};

const agarStart = () => {
  const srv = "127.0.0.1:9158";
  console.log('Connecting to ' + srv);
  client.connect('ws://' + srv); //do not forget to add ws://
};

const reinforceSetup = () => {
  const env = {
    getNumStates: () => sensorCount * 3 + 2,
    getMaxNumActions: () => 4
  };

  const spec = {
    alpha: 0.005,
    epsilon: 0.2,
    experience_add_every: 5,
    experience_size: 10000,
    gamma: 0.9,
    learning_steps_per_iteration: 5,
    num_hidden_units: 100,
    tderror_clamp: 1,
    update: "qlearn"
  };

  agent = new RL.DQNAgent(env, spec);
};

// MAIN HELPER FUNCTIONS
const sees = (sensor, position, ball) => {
  const res = line_point_intersect(position, position.add(sensor), new Vec(ball.x, ball.y), ball.size);
  if (_.isObject(res)) {
    return res.up.dist_from(position);
  } else {
    return false;
  }
};

const getCurrentState = () => {
  let myCt = client.my_balls.length;
  if (myCt === 0) {
    return false;
  }
  let myX = 0;
  let myY = 0;
  let mySize = 0;
  for (const b of client.my_balls) {
    const ball = client.balls[b];
    myX += ball.x;
    myY += ball.y;
    mySize += ball.size;
  }
  const me = {
    totalSize: mySize,
    totalBalls: myCt,
    pAvg: new Vec(myX/myCt, myY/myCt)
  };

  const sensorDetections = _.map(sensors, () => {
    return {
      dist: sensorRange,
      targetType: targetTypes.NONE,
      targetSize: -1
    };
  });

  for (const ball in client.balls) {
    if (ball.visible && !ball.mine && !ball.destroyed) {
      for (let i=0; i<sensors.length; i++) {
        const seen = sees(sensors[i], me.pAvg, ball);
        if (_.isNumber(seen) && seen < sensorDetections[i].dist) {
          sensorDetections[i] = {
            dist: seen,
            targetType: ball.virus ? targetTypes.VIRUS : targetTypes.CELL,
            targetSize: ball.size
          };
        }
      }
    }
  }

  return {
    score: client.score,
    me,
    sensorDetections
  };
};

const serialize = (state) => {
  const me = [state.me.totalSize, state.me.totalBalls];
  const sensors = _.flatten(_.map(state.sensorDetections, (sd) => {
    return [sd.dist, sd.targetType, sd.targetSize];
  }));
  return me.concat(sensors);
};


// MAIN LOOP
let prevScore = null;
const onTick = () => {
  const state = getCurrentState();
  if (!_.isObject(state)) {
    if (_.isNumber(prevScore)) {
      agent.learn(-prevScore);
    }
    prevScore = null;
    return;
  }
  if (_.isNumber(prevScore)) {
    agent.learn(state.score - prevScore);
  }

  const action = agent.act(serialize(state))
  let moveTo;
  if (action === actionTypes.UP) {
    moveTo = new Vec(state.me.pAvg.x, state.me.pAvg.y + 500);
  } else if (action === actionTypes.RIGHT) {
    moveTo = new Vec(state.me.pAvg.x + 500, state.me.pAvg.y);
  } else if (action === actionTypes.DOWN) {
    moveTo = new Vec(state.me.pAvg.x, state.me.pAvg.y - 500);
  } else if (action === actionTypes.LEFT) {
    moveTo = new Vec(state.me.pAvg.x - 500, state.me.pAvg.y);
  }
  client.moveTo(moveTo.x, moveTo.y);
  prevScore = state.score;
};

//START
agarSetup();
reinforceSetup();
agarStart();
