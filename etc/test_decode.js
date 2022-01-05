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

var hrTime = process.hrtime();
var t = hrTime[0] * 1000000 + hrTime[1] / 1000;

//console.log(wheelSpeedMessage);


(async () => {

  var client = redis.createClient();
  await client.connect();

  var current = parseInt(await client.get("rover_startup_timestamp"));
 
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
  x.set('timestamp', microtime.now() - current);


 
  x.set('velocity', [0, 30, 0, 0]);

  console.log(x, packer.pack(x));
  await client.set(Buffer.from('rover_wheel_velocity_command'), packer.pack(x));
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
