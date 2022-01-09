var redis           = require('redis'),
    msgpack         = require('msgpackr'),
    microtime       = require('microtime'),
    pidController   = require('node-pid-controller'),
    qte             = require('quaternion-to-euler');

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

    //console.log(linearVelocityToRPM(toWheelVelocity(0.5, 0.0)));

    /* DJI motion controller wheel mapping 
       0 rear left
       1 rear right
       2 front right
       3 front left 
    */
      
      // front right
      // front left
      // rear left
      // rear right


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
        return (el - arr[i - 1]) * 10;
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

    var F = 1, kV = 1/0.02, kA = 0.002;

    var MAX_SPEED = 0.2, MAX_ACCEL = 0.1, setPoint = {
      x: 0,
      y: 0.5
    };

    var lastPose, lastVelocity, startTime = parseInt(await redisClient.get("rover_startup_timestamp"));
      
    process.on('SIGINT', async () => {
      
      console.log('Stopping wheels...');

      var x = new Map();
      x.set('timestamp', microtime.now() - startTime);

      x.set('velocity', [0, 0, 0, 0]);

      await redisClient.set(Buffer.from('rover_wheel_velocity_command'), packer.pack(x));

      process.exit();
    });

    var n = 0;

    var startingPose = unpack(await(redisClient.getBuffer(Buffer.from('rover_pose'))));

    var xController = new pidController({
      k_p: 0.25,
      k_i: 0.01,
      k_d: 0.01
    });

    var yController = new pidController({
      k_p: 0.25,
      k_i: 0.01,
      k_d: 0.01
    });

    var thetaController = new pidController({
      k_p: 0.25,
      k_i: 0.01,
      k_d: 0.01
    });

    var xVelocityController = new pidController({
      k_p: 0.25,
      k_i: 0.01,
      k_d: 0.01
    });

    var yVelocityController = new pidController({
      k_p: 0.25,
      k_i: 0.01,
      k_d: 0.01
    });

    xController.setTarget(0.0);
    //yController.setTarget(0.5);
    thetaController.setTarget(deg2Rad(90));

    var TAU = Math.PI * 2;
    function angleWrap(radians) {
      var modifiedAngle = radians % TAU;

      modifiedAngle = (modifiedAngle + TAU) % TAU;

      return modifiedAngle;
    }

    function normDelta(radians) {
      var modifiedAngle = angleWrap(radians);

      if(modifiedAngle > Math.PI) {
        modifiedAngle -= TAU;
      }

      return modifiedAngle;
    }

    function rad2Deg(rad) {
      return rad * 180 / Math.PI;
    }

    function deg2Rad(deg) {
      return deg * Math.PI / 180;
    }
    
    yController.setTarget(0.5);


    var xVelocity = 0, yVelocity = 0;

    var atPositionX = false, atPositionY = false, lastPose = startingPose, resetId, xSet = 0.0, ySet = -0.5;
    setInterval(async () => {
      //console.log('tick');
      var velocity = unpack(await(redisClient.getBuffer(Buffer.from('rover_pose_velocity')))),
          pose = unpack(await(redisClient.getBuffer(Buffer.from('rover_pose'))));
         
      pose.pos[0] = pose.pos[0] - startingPose.pos[0];
      pose.pos[1] = pose.pos[1] - startingPose.pos[1];
      
      //lastPose = Object.assign({}, pose);

      /*var startingAngle = qte(startingPose.rot)[2],
          lastAngle     = qte(lastPose.rot)[2],
          currentAngle  = qte(pose.rot)[2];

      console.log('delta', (normDelta(startingAngle - currentAngle)));*/

      //var ySet = -0.5;

      var xError = xSet   - pose.pos[0],
          yError = ySet - pose.pos[1];

      //console.log(velocity.pos[0], velocity.pos[1], xError, yError);

      //var thetaCorrection = thetaController.update(angleWrap(qte(pose.rot)[2]));

      //console.log('correction', xCorrection, yCorrection, deg2Rad(thetaCorrection));

      //console.log('position', pose.pos[0], pose.pos[1], rad2Deg(qte(pose.rot)[2]));
      var x = new Map();
        x.set('timestamp', microtime.now() - startTime);

      //var thetaCorrection = Math.atan2(-0.5 - pose.pos[1], 0.0 - pose.pos[0]);
      
      //console.log(pose.pos[0], pose.pos[1]);
      //console.log(xCorrection, yCorrection, rad2Deg(thetaCorrection));

      
      var MAX_VELOCITY = 0.2, MAX_ACCEL = 0.005, xDirection = 1, yDirection = 1;
      if(!atPositionY && (Math.abs(yError) >= 0.01)) {
        
        if(yError < 0) yDirection = -1;    

        yVelocity += 0.005;
        yVelocity = Math.max(MAX_VELOCITY, yVelocity);

        if(Math.abs(yError) <= (yVelocity * yVelocity) / (2 * MAX_ACCEL)) {
          yVelocity -= 0.005;
        }

        yVelocity = Math.max(MAX_VELOCITY, yVelocity);

        yVelocity = yVelocity * yDirection;

      } else {
        console.log('arrived at y postion');
        atPositionY = true;
        yVelocity = 0;
      }

      if(!atPositionX && (Math.abs(xError) >= 0.005)) {
        if(xError < 0) xDirection = -1;

        xVelocity += 0.005;
        xVelocity = Math.max(MAX_VELOCITY, xVelocity);

        if(Math.abs(xError) <= (xVelocity * xVelocity) / (2 * MAX_ACCEL)) {
          xVelocity -= 0.005;
        }

        xVelocity = Math.max(MAX_VELOCITY, xVelocity);

        xVelocity = xVelocity * xDirection;
      } else {
        xVelocity = 0;
        console.log('arrived at x position');
        atPositionX = true;
      }

      if(atPositionX && atPositionY) {
        console.log('movement complete');
        
        x.set('velocity', [0, 0, 0, 0]);

        if(resetId) return;
        resetId = setTimeout(async () => {
          //startingPose = unpack(await(redisClient.getBuffer(Buffer.from('rover_pose'))));

          console.log('resetting!!!!!!!!!!!!!!!!!!!');
          xVelocity = 0;
          yVelocity = 0;
          if(ySet > 0) {
            ySet = -0.5;
          } else {
            ySet = 0.5;
          }

          atPositionX = false;
          atPositionY = false;

          resetId = false;
        }, 5000);
      } else {
        
        var wheelOutputs = remapWheels(linearVelocityToRPM(toWheelVelocity(xVelocity, yVelocity, 0)));
        
        console.log(wheelOutputs);      
        x.set('velocity', wheelOutputs.map(v => Math.round(v)));
      }


      await redisClient.set(Buffer.from('rover_wheel_velocity_command'), packer.pack(x));


      return;

      //var wheelOutputs = remapWheels(linearVelocityToRPM(toWheelVelocity(0.0, 0.5, 0.0)));
      
      //console.log(wheelOutputs);

      //return;

     /* var xError = setPoint.x - pose.pos[0],
          yError = setPoint.y - pose.pos[1];

        
        console.log(xError, yError);
        //console.log(xError, yError);

        var vel = velocities[n];
        vel = vel ? vel : 0;
        
        n++;

        var wheelOutputs = remapWheels(linearVelocityToRPM(toWheelVelocity(0.0, vel, 0.0)));
        
        //console.log(wheelOutputs);
        var x = new Map();
        x.set('timestamp', microtime.now() - startTime);

        // rear left
        // rear right
        // front right
        // front left 
        
        //console.log(wheelOutputs); 
        x.set('velocity', wheelOutputs.map(v => Math.round(v)));


        // front right
        // front left
        // rear left
        // rear right

        //x.set('velocity', [30, 0, 0, 0]);

        //console.log(wheelOutputs);
        //console.log(x, packer.pack(x));
        await redisClient.set(Buffer.from('rover_wheel_velocity_command'), packer.pack(x));*/

      var xDirection = 1, yDirection = 1,
          xPositionError = setPoint.x - pose.pos[0],
          yPositionError = setPoint.y - pose.pos[1];

      //console.log(xPositionError, yPositionError, currentPose.pos[0], startingPose.pos[0]);
   
      if(xPositionError < 0) xDirection = -1;
      if(yPositionError < 0) yDirection = -1;

      var outputVelocity = {
        x: 0,
        y: 0
      }, outputAccel = {
        x: 0,
        y: 0
      };

      if(!lastPose) lastPose = Object.assign({}, pose);
      if(!lastVelocity) lastVelocity = Object.assign({}, velocity);

       

      if(MAX_SPEED > Math.abs(velocity.pos[0])) {
        outputVelocity.x = velocity.pos[0] * xDirection * MAX_ACCEL * (pose.timestamp - lastPose.timestamp);
        outputAccel.x = MAX_ACCEL;
      } else {
        outputVelocity.x = MAX_SPEED;
        outputAccel.x = 0;
      }

      if(MAX_SPEED > Math.abs(velocity.pos[1])) {
        outputVelocity.y = velocity.pos[1] + (yDirection * 0.1) * MAX_ACCEL * (pose.timestamp - lastPose.timestamp);
        outputAccel.y = MAX_ACCEL;
      } else {
        outputVelocity.y = MAX_SPEED;
        outputAccel.y = 0;
      }

      //console.log(yPositionError, outputVelocity);

      /*if(xPositionError <= (outputVelocity.x * outputVelocity.x) / (2 * MAX_ACCEL)) {
        outputVelocity.x = velocity.pos[0] * xDirection * MAX_ACCEL * (pose.timestamp - lastPose.timestamp);
        outputAccel.x = -MAX_ACCEL;
      }

      if(yPositionError <= (outputVelocity.y * outputVelocity.y) / (2 * MAX_ACCEL)) {
        outputVelocity.y = velocity.pos[1] - yDirection * MAX_ACCEL * (pose.timestamp - lastPose.timestamp);
        outputAccel.y = -MAX_ACCEL;
      }*/

      var xVelocityError = outputVelocity.x - velocity.pos[0],
          yVelocityError = outputVelocity.y - velocity.pos[1],
          xAccel = (velocity.pos[0] - lastVelocity.pos[0]) / (pose.timestamp - lastPose.timestamp),
          yAccel = (velocity.pos[1] - lastVelocity.pos[1]) / (pose.timestamp - lastPose.timestamp),
          xAccelError = outputAccel.x - xAccel,
          yAccelError = outputAccel.y - yAccel;

      
      //console.log(yVelocityError);

      var outputX = kV * xVelocityError + kA * xAccelError,
          outputY = kV * yVelocityError + kA * yAccelError;

      //console.log(outputX, outputY);
      if(isNaN(outputX) || isNaN(outputY)) return;
      var wheelOutputs = remapWheels(linearVelocityToRPM(toWheelVelocity(outputX, outputY)));
      
      //console.log(yVelocityError);

      var x = new Map();
      x.set('timestamp', microtime.now() - startTime);

      // rear left
      // rear right
      // front right
      // front left 
      
      if(wheelOutputs.some(a => Math.abs(a) > 100)) {
        console.log('over speed');
        wheelOutputs = [0, 0, 0, 0];
      }

      console.log(wheelOutputs);

      x.set('velocity', wheelOutputs.map(v => Math.round(v)));


      // front right
      // front left
      // rear left
      // rear right

      //x.set('velocity', [30, 0, 0, 0]);

      //console.log(wheelOutputs);
      //console.log(x, packer.pack(x));
      await redisClient.set(Buffer.from('rover_wheel_velocity_command'), packer.pack(x));

      lastPose = Object.assign({}, pose);
      lastVelocity = Object.assign({}, velocity);
      

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
    }, 50);


})();

