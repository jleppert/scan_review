var redis     = require('redis'),
    msgpack   = require('msgpackr'),
    microtime = require('microtime');

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

/**
 * Mecanum drive kinematic equations. All wheel positions and velocities are given starting with front left and
 * proceeding counter-clockwise (i.e., front left, rear left, rear right, front right). Robot poses are specified in a
 * coordinate system with positive x pointing forward, positive y pointing left, and positive heading measured
 * counter-clockwise from the x-axis.
 */

(async () => {
    await redisClient.connect();
  
    // in mm
/*    var trackWidth = 200.0 * 0.001,
        wheelBase  = 200.0 * 0.001, 
        l = 0.0; // lateral multipler
        
    var k = (trackWidth + wheelBase) / 2.0;

    /*function toWheelVelocity(x, y, heading = 1) {
      return [
        x - l * y - k,
        x + l * y - k,
        x - l * y + k,
        x + l * y + k
      ];
    }*/

    var trackWidth = 200.0 * 0.001,
        wheelBase  = 200.0 * 0.001, 
        wheelRadius = 45 * 0.001,
        lx = trackWidth / 2,
        ly = wheelBase / 2,
        k  = 1/wheelRadius;

    // front left, front right, rear left, rear right
    // output in rad/s
    // https://ecam-eurobot.github.io/Tutorials/mechanical/mecanum.html 
    function toWheelVelocity(x = 0.0, y = 0.0, z = 0.0) {
      
      return [
        k * (x - y - (lx + ly) * z),
        k * (x + y + (lx + ly) * z),
        k * (x + y - (lx + ly) * z),
        k * (x - y + (lx + ly) * z)
      ];
    }

    function fromWheelVelocity(wheels) {
      return [
        (wheels[0] + wheels[1] + wheels[2] + wheels[3])   * (wheelRadius / 4),
        (-wheels[0] + wheels[1] + wheels[2] - wheels[3]) * (wheelRadius / 4),
        (-wheels[0] + wheels[1] - wheels[2] + wheels[3]) * (wheelRadius / 4 * (lx + ly))
      ];
    }

    console.log(linearVelocityToRPM(toWheelVelocity(0.5, 0.0)));

    /* DJI motion controller wheel mapping 
       0 rear left
       1 rear right
       2 front right
       3 front left 
    */

    function remapWheels(wheels) {
      return [
        wheels[3],
        wheels[2],
        wheels[0],
        wheels[1]
      ];
    }

    function linearVelocityToRPM(wheels) {
      return wheels.map(v => {
        return (v * 60 / (Math.PI * 2));
      });
    }

    // S-Curve, 3 terms
    function generatePositionCurve(x0, xd, T) {
      
      var x = [];
      for(var t = 0; t < T; t++) {
        x[t] = x0+(xd-x0)*(10*(Math.pow((t/T), 3))-15*(Math.pow((t/T), 4))+6*(Math.pow((t/T), 5))); 
      }

      return x;
    }

    function generateVelocityCurve(positionCurve) {
      return positionCurve.map((el, i, arr) => {
        if(i === 0) return 0;
        return el - arr[i - 1];
      });
    }

    function generateAccelerationCurve(velocityCurve) {
      return generateVelocityCurve(velocityCurve);
    }

    var timeInterval = 1000 / 100;
    var positions = generatePositionCurve(0.0, 0.5, timeInterval * 5),
        velocities = generateVelocityCurve(positions),
        accelerations = generateAccelerationCurve(velocities);

    console.log(
      JSON.stringify(positions), 
      JSON.stringify(velocities),
      JSON.stringify(accelerations)
    );

    var i = 0, lastVelocity;

    var F = 1.0, kV = 1.0, kA = 1.0;

    
    var MAX_SPEED = 0.2, MAX_ACCEL = 0.1, setPoint = {
      x: 0.0,
      y: 0.5
    };

    var lastPose, lastVelocity;
    setInterval(async () => {
      console.log('tick');
      var velocity = unpack(await(redisClient.getBuffer(Buffer.from('rover_pose_velocity')))),
          pose = unpack(await(redisClient.getBuffer(Buffer.from('rover_pose'))));
          
      var xDirection = 1, yDirection = 1,
          xPositionError = setPoint.x - pose.pos[0],
          yPositionError = setPoint.y - pose.pos[1];
     
      console.log(pose, xPositionError, yPositionError) 
      if(xPositionError < 0) xDirection = -1;
      if(yPositionError < 0) yDirection = -1;

      var outputVelocity = {
        x: 0,
        y: 0
      }, outputAccel = {
        x: 0,
        y: 0
      };

      if(!lastPose) lastPose = pose;
      if(!lastVelocity) lastVelocity = velocity;

      if(MAX_SPEED > Math.abs(velocity.pos[0])) {
        outputVelocity.x = velocity.pos[0] + xDirection * MAX_ACCEL * (pose.timestamp - lastPose.timestamp);
        outputAccel.x = MAX_ACCEL;
      } else {
        outputVelocity.x = MAX_SPEED;
        outputAccel.x = 0;
      }

      if(MAX_SPEED > Math.abs(velocity.pos[1])) {
        outputVelocity.y = velocity.pos[1] + yDirection * MAX_ACCEL * (pose.timestamp - lastPose.timestamp);
        outputAccel.y = MAX_ACCEL;
      } else {
        outputVelocity.y = MAX_SPEED;
        outputAccel.y = 0;
      }

      if(xPositionError <= (outputVelocity.x * outputVelocity.x) / (2 * MAX_ACCEL)) {
        outputVelocity.x = velocity.pos[0] - xDirection * MAX_ACCEL * (pose.timestamp - lastPose.timestamp);
        outputAccel.x = -MAX_ACCEL;
      }

      if(yPositionError <= (outputVelocity.y * outputVelocity.y) / (2 * MAX_ACCEL)) {
        outputVelocity.y = velocity.pos[1] - yDirection * MAX_ACCEL * (pose.timestamp - lastPose.timestamp);
        outputAccel.y = -MAX_ACCEL;
      }

      var xVelocityError = outputVelocity.x - velocity.pos[0],
          yVelocityError = outputVelocity.y - velocity.pos[1],
          xAccel = (velocity.pos[0] - lastVelocity.pos[0]) / (pose.timestamp - lastPose.timestamp),
          yAccel = (velocity.pos[1] - lastVelocity.pos[1]) / (pose.timestamp - lastPose.timestamp),
          xAccelError = outputAccel.x - xAccel,
          yAccelError = outputAccel.y - yAccel;

      var outputX = F + kV * xVelocityError + kA * xAccelError,
          outputY = F + kV * yVelocityError + kA * yAccelError;


      console.log(linearVelocityToRPM(toWheelVelocity(outputX, outputY)));

      lastPose = pose;
      

/*
          targetVelocity = velocities[i],
          targetAcceleration = accelerations[i];

      if(!lastVelocity) lastVelocity = velocity;

      var velocityError = [
        targetVelocity - velocity.pos[0],
        0
      ];

      var currentAcceleration = [
        velocity.pos[0] - lastVelocity.pos[0] / (velocity.timestamp - lastVelocity.timestamp),
        velocity.pos[1] - lastVelocity.pos[1] / (velocity.timestamp - lastVelocity.timestamp)
      ];

      var accelerationError = [
        targetAcceleration - currentAcceleration[0],
        0
      ];


      var output = toWheelVelocity(
        F + kV * velocityError[0] + kA * accelerationError[0],
        0
      );

      


      i++;
      console.log(output);

      */
    }, 100);


})();

