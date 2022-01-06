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

(async () => {
    await redisClient.connect();
  
    var trackWidth = 1.0,
        wheelBase  = 1.0, 
        l = 1.0;
        
    var k = (trackWidth + wheelBase) / 2.0;

    function toWheelVelocity(x, y, heading = 1) {
      return [
        x - l * y - k,
        x + l * y - k,
        x - l * y + k,
        x + l * y + k
      ];
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


})();

