var redis = require('redis'),
    msgpack = require('msgpackr');

var structs = [];
let unpacker = new msgpack.Unpackr({
  structures: structs,
});

let packer = new msgpack.Packr({
  structures: structs
});


var wheelSpeedMessage = {
  timestamp: new Uint32Array([510862028]),
  velocity: [
    new Int16Array([-32768]),
    new Int16Array([32767]),
    new Int16Array([0]),
    new Int16Array([1])
  ]
};

// Carol Construction Supply / Logan Contractors / john myers 319-855-8472
// 3x4x8
// jmyers@atlasroofing.com


var hrTime = process.hrtime();
var t = hrTime[0] * 1000000 + hrTime[1] / 1000;

//console.log(wheelSpeedMessage);

//var process = require('process');

(async () => {

  var client = redis.createClient();
  await client.connect();

  var current = parseInt(await client.get("rover_startup_timestamp"));

  var params = unpacker.unpack((await client.get(
    client.commandOptions({ returnBuffers: true }),
    'rover_wheel_voltage_command'
  )));

  // 1 - back right, 2 - front right, 3 - front left, 4 - back left

  params.set('voltage', [-6000, -6000, 6000, 6000]);
  
  //params.set('voltage', [0, 0, 0, 0]);

  //params.set('voltage', 100);

  var packedParams = packer.pack(params);

  await client.set(client.commandOptions({ returnBuffers: true }), 'rover_wheel_voltage_command', packedParams);


  process.on('SIGINT', async () => {
    console.log('exiting');
    var params = unpacker.unpack((await client.get(
      client.commandOptions({ returnBuffers: true }),
      'rover_wheel_voltage_command'
    )));

    params.set('voltage', [0, 0, 0, 0]);
    
    var packedParams = packer.pack(params);

    await client.set(client.commandOptions({ returnBuffers: true }), 'rover_wheel_voltage_command', packedParams);

    process.exit();
  });
  
  console.log(params);

  return;
 

 
 /* 
  var data = await client.getBuffer(Buffer.from("rover_base_pose-LH1-LHB-6B84C4CA"));
  
  var s = unpacker.unpack(data);

  console.log(data, s);*/

   
  //var data = await client.getBuffer(Buffer.from("rover_wheel_velocity"));
  //var s = unpacker.unpack(data);

  //var n = packer.pack(s);

  //console.log(data, s, n);

  //console.log(structs);
  var microtime = require('microtime');

  var x = new Map();
  x.set('timestamp', 0);
  x.set('startFrequency', 1500.00);
  x.set('stepFrequency', 20.00);
  x.set('frequencyCount', 151);
  x.set('intermediateFreq', 32.00);
  x.set('transmitPower', -10.0);
  x.set('loPower', 15);
  x.set('sampleCount', 2048);
  x.set('channelCount', 2);
  x.set('stepTriggerTimeInMicro', 50);
  
  x.set('synthWarmupTimeInMicro', 1000000 * 5);

  x.set('settlingTimeInMicro', 500);
  x.set('bufferSampleDelay', 0);


  
  console.log(x, packer.pack(x));
  await client.set(Buffer.from('radar_parameters'), packer.pack(x));
  /*
  setInterval(async function() {
    var data = await client.getBuffer(Buffer.from("rover_wheel_encoder"));
    
    console.log(data);
    console.log(msgpack.unpack(data));

    /*var data = await client.getBuffer(Buffer.from("rover_battery_state"));
    
    console.log(data);
    console.log(msgpack.unpack(data));
  }, 1/60 * 1000);
  */

})();
