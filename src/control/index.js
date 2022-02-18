var redis           = require('redis'),
    msgpack         = require('msgpackr'),
    microtime       = require('microtime'),
    qte             = require('quaternion-to-euler');

var PID = require('./PID'),
    FeedForward = require('./FeedForward'),
    AngleController = require('./Angle'),
    PositionVelocitySystem = require('./PositionVelocitySystem');

var redisClient = redis.createClient();
redisClient.on('error', (err) => console.log('Redis Client Error', err));


var messageStructs = [];

var unpacker = new msgpack.Unpackr({
  structures: messageStructs
}), packer = new msgpack.Packr({
  structures: messageStructs
});

var unpack = unpacker.unpack,
    pack   = packer.pack;

var xController = new PositionVelocitySystem({
  update: async function updatePosition() {
    var pose = unpack(await(redisClient.getBuffer(Buffer.from('rover_pose'))));

    console.log('x', pose.pos[0], 'y', pose.pos[1]);
    return pose.pos[0] * -1;

  } }, {
  update: async function updateVelocity() {
    var velocity = unpack(await(redisClient.getBuffer(Buffer.from('rover_pose_velocity'))));
      
    return velocity.pos[0] * -1;

  } },
  new FeedForward(0.012, 0.002),
  new PID(0.25, 0.01, 0.01, 0.0, 0.0, 1 / 0),
  new PID(0.25, 0.01, 0.01, 0.0, 0.0, 1 / 0)
);

var yController = new PositionVelocitySystem({
  update: async function updatePosition() {
    var pose = unpack(await(redisClient.getBuffer(Buffer.from('rover_pose'))));

    return pose.pos[1] * -1;

  } }, {
  update: async function updateVelocity() {
    var velocity = unpack(await(redisClient.getBuffer(Buffer.from('rover_pose_velocity'))));
      
    return velocity.pos[1] * -1;

    } },
  new FeedForward(0.012, 0.00002),
  new PID(0.25, 0.01, 0.01, 0.0, 0.0, 1 / 0),
  new PID(0.25, 0.01, 0.01, 0.0, 0.0, 1 / 0)
);

var thetaController = new PositionVelocitySystem({
  update: async function updatePosition() {
    var pose = unpack(await(redisClient.getBuffer(Buffer.from('rover_pose'))));

    return qte(pose.rot)[2];

  } }, {
  update: async function updateVelocity() {
    var velocity = unpack(await(redisClient.getBuffer(Buffer.from('rover_pose_velocity'))));
      
    return velocity.theta[2];

    } },
  new FeedForward(0.012, 0.00002),
  new AngleController(
    new PID(0.05, 0.01, 0.01, 0.0, 0.0, 1 / 0)
  ),
  new PID(0.05, 0.01, 0.01, 0.0, 0.0, 1 / 0)
);


var angleController = new AngleController(
  new PID(2.75, 0.01, 0.01, 0.0, 0.0, 1 / 0)
);

var startTime = 0;

(async () => {
  await redisClient.connect();
  startTime = parseInt(await redisClient.get("rover_startup_timestamp"));

  startLoop();

})();

function remapWheels(wheels) {
      return [
        wheels[2],
        wheels[3],
        wheels[1],
        wheels[0]
      ];
    }

    function linearVelocityToRPM(wheels) {
      return wheels.map(v => {
        return (v * 60 / (Math.PI * 2));
      });
    }



var trackWidth = 205.0 * 0.001,
    wheelBase  = 205.0 * 0.001, 
    wheelRadius = 45 * 0.001,
    lx = trackWidth / 2,
    ly = wheelBase / 2,
    k  = 1/wheelRadius;

    // front left, front right, rear left, rear right
    // output in rad/s
    // z+ is right rotation in robot frame
    // https://ecam-eurobot.github.io/Tutorials/mechanical/mecanum.html 
    function toWheelVelocity(x = 0.0, y = 0.0, z = 0.0) {
      
      return [
        k * (x - y - (lx + ly) * z),
        k * (x + y + (lx + ly) * z),
        k * (x + y - (lx + ly) * z),
        k * (x - y + (lx + ly) * z)
      ];
    }


process.on('SIGINT', async () => {
  
  console.log('Stopping wheels...');

  var x = new Map();
  x.set('timestamp', microtime.now() - startTime);

  x.set('velocity', [0, 0, 0, 0]);

  await redisClient.set(Buffer.from('rover_wheel_velocity_command'), packer.pack(x));

  process.exit();
});

function deg2Rad(deg) {
  return deg * Math.PI / 180;
}

function rad2Deg(rad) {
      return rad * 180 / Math.PI;
    }



function startLoop() {
  setInterval(async () => {
    var xPower = await xController.update(0.5, 0.5, 0.1); 
    var yPower = await yController.update(0.0, 0.2, 0.1);

    var pose = unpack(await(redisClient.getBuffer(Buffer.from('rover_pose'))));

    var heading = qte(pose.rot)[2];

    console.log('heading', rad2Deg(heading));

    var thetaPower = angleController.calculate(deg2Rad(0), heading);

    //console.log(thetaPower);

    //return;

    var angleSet = deg2Rad(90);
  
    var direction = 1;
    
    console.log('setpoint', heading, angleSet);

    if(heading > angleSet) direction = -1;
    
    //var thetaPower = await thetaController.update(deg2Rad(90), -0.1, -0.1);

    //console.log('ttt', thetaPower);

    //return;

    //return;

    if(Math.abs(thetaPower) > 10) {
      console.log('theta too high', thetaPower);
      //return;
    }
    //return;*/

    var x = new Map();
    x.set('timestamp', microtime.now() - startTime);

    var wheelOutputs = remapWheels(linearVelocityToRPM(toWheelVelocity(xPower, 0, 0)));
    
    //console.log(xPower);   
    console.log(wheelOutputs);      
    x.set('velocity', wheelOutputs.map(v => Math.floor(v)));

    await redisClient.set(Buffer.from('rover_wheel_velocity_command'), packer.pack(x));


    //console.log(xPower);

  }, 100);
}
