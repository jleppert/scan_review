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
   
    var sampleRate = 100,
        samplesPerSecond = 1000 / sampleRate;
    
    var lastPose, lastAcceleration;
    setInterval(async () => {
      var pose = unpack(await redisClient.getBuffer(Buffer.from('rover_pose')));

      if(!lastPose) lastPose = pose;
      var elapsed = pose.timestamp - lastPose.timestamp;
      
      if(elapsed > 0) {
        var velocityMessage = new Map();
        velocityMessage.set('timestamp', pose.timestamp);
        velocityMessage.set('x', (pose.pos[0] - lastPose.pos[0]) / elapsed);
        velocityMessage.set('y', (pose.pos[1] - lastPose.pos[1]) / elapsed);
        velocityMessage.set('z', (pose.pos[2] - lastPose.pos[2]) / elapsed);

        redisClient.set(Buffer.from('rover_pose_velocity2'), packer.pack(velocityMessage));
      }
      
      lastPose = pose;

    }, sampleRate);
})();

