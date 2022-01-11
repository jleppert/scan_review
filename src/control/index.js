var redis           = require('redis'),
    msgpack         = require('msgpackr'),
    microtime       = require('microtime');

var PID = require('./PID'),
    FeedForward = require('./FeedForward'),
    PositionVelocitySystem = require('./PositionVelocitySystem');


var positionController = new PID(0.25, 0.01, 0.01, 0.0, 0.0, 1 / 0),
    velocityController = new PID(0.25, 0.01, 0.01, 0.0, 0.0, 1 / 0),
    feedForward        = new FeedForward(0.012, 0.00002);

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

var positionVelocityController = new PositionVelocitySystem({
  update: async function updatePosition() {
    var pose = unpack(await(redisClient.getBuffer(Buffer.from('rover_pose'))));

    console.log('x', pose.pos[0], 'y', pose.pos[1]);
    return pose.pos[0] * -1;

  } }, {
  update: async function updateVelocity() {
    var velocity = unpack(await(redisClient.getBuffer(Buffer.from('rover_pose_velocity'))));
      
    return velocity.pos[0] * -1;

  } },
  feedForward, positionController, velocityController);


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



function startLoop() {
  setInterval(async () => {
    var xPower = await positionVelocityController.update(0.5, 0.2, 0.2); 

    var x = new Map();
    x.set('timestamp', microtime.now() - startTime);

    var wheelOutputs = remapWheels(linearVelocityToRPM(toWheelVelocity(xPower, 0, 0)));
    
    console.log(xPower);   
    console.log(wheelOutputs);      
    x.set('velocity', wheelOutputs.map(v => Math.floor(v)));

    await redisClient.set(Buffer.from('rover_wheel_velocity_command'), packer.pack(x));


    //console.log(xPower);

  }, 10);
}
