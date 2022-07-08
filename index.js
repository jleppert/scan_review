#!/usr/bin/env node

var fs            = require('fs'),
    path          = require('path'),
    express       = require('express'),
    http          = require('http'),
    request       = require('request'),
    path          = require('path'),
    dnode         = require('dnode'),
    uuid          = require('uuid').v4,
    shoe          = require('shoe'),
    redis         = require('redis'),
    msgpack       = require('msgpackr'),
    microtime     = require('microtime'),
    EventEmitter  = require('events'),
    babelify      = require('babelify'),
    babelPreset   = require('@babel/preset-env'),
    browserify    = require('browserify-middleware'),
    pm2           = require('pm2');

var app = express();

console.log('Building frontend code...');
app.use('/client.js', 
  browserify(
    path.join(__dirname, 'src', 'client.js'), {
      transform: [
        [babelify, {
          global: true,
          ignore: [/\/node_modules\/(?!\@thi.ng\/)/],
          presets: [babelPreset]
        }]
      ]
    }, {
      precompile: true
    }));

var styles = [
  path.join(__dirname, 'node_modules', 'toastify-js', 'src', 'toastify.css'),
  path.join(__dirname, 'node_modules', 'nprogress', 'nprogress.css'),
  path.join(__dirname, 'node_modules', 'bootstrap', 'dist', 'css', 'bootstrap.css'),
  path.join(__dirname, 'node_modules', 'leaflet', 'dist', 'leaflet.css'),
  path.join(__dirname, 'node_modules', 'leaflet-draw', 'dist', 'leaflet.draw.css'),
];

app.use('/style.css', (req, res) => {
  res.status(200);
  res.setHeader('content-type', 'text/css');
  
  for(var stylePath of styles) {
    res.write(fs.readFileSync(stylePath));  
  }

  res.end();
});

var libraries = [
  path.join(__dirname, 'node_modules', 'bootstrap', 'dist', 'js', 'bootstrap.js'),
];

app.use(express.static(path.join(__dirname, 'node_modules', 'leaflet', 'dist')));
app.use(express.static(path.join(__dirname, 'node_modules', 'leaflet-draw', 'dist')));
app.use(express.static(path.join(__dirname, 'lib', 'bokeh', 'bokehjs', 'build', 'js')));

app.use('/vendor.js', (req, res) => {
  res.status(200);
  res.setHeader('content-type', 'application/javascript');
  
  for(var libraryPath of libraries) {
    res.write(fs.readFileSync(libraryPath));  
  }

  res.end();

});

app.use(express.static(path.join(__dirname, 'static')));
app.use(express.static(path.join(__dirname, 'data')));

var server = http.createServer(app);

var redisClient = redis.createClient('/var/run/redis/redis-server.sock');
redisClient.on('error', err => console.log('Shared redis client error', err));
redisClient.on('connect', () => console.log('Shared redis client is connected'));
redisClient.on('reconnecting', () => console.log('Shared redis client is reconnecting'));
redisClient.on('ready', () => console.log('Shared redis client is ready'));

var remotes = {},
    messageStructs = [];

var unpacker = new msgpack.Unpackr({
  structures: messageStructs
}), packer = new msgpack.Packr({
  structures: messageStructs
});

var unpack = unpacker.unpack,
    pack   = packer.pack;

var trackerConfigPath = path.join(require('os').homedir(), '.config', 'libsurvive', 'config.json'); 

var logs = {};

function toArrayBuffer(buf) {
    const ab = new ArrayBuffer(buf.length);
    const view = new Uint8Array(ab);
    for (let i = 0; i < buf.length; ++i) {
        view[i] = buf[i];
    }
    return ab;
}

BigInt.prototype.toJSON = function() { return this.toString() };

var sock = shoe(function(stream) {
  var remote;

  async function getBaseStationConfig(cb = function() {}) {
      //console.log(fs.readFileSync(trackerConfigPath).toString());

      var config = {
        obj: JSON.parse((await redisClient.get('rover_pose_config')).toString()),
        basePoses: await (async function() {
          return ((await redisClient.keys('rover_base_pose-*')) || []).map(key => async function() {
            return (await redisClient.get(key));
          });
        })()
      };

      cb(config);
      //cb(JSON.parse(fs.readFileSync(trackerConfigPath).toString() ));
  }

  var d = dnode({
    getClientTimeout: function(cb = function() {}) {
      cb(clientTimeout);
    },
    ping: function() {
      var r = remotes[remote.id];
      if(r) r.lastPing = Date.now(); 
    },

    getBaseStationConfig: getBaseStationConfig,

    on: function(key, rateInMs = 100, cb = function() {}) {
      var id = remote.timers[`${key}_${rateInMs}`];

      if(id) clearInterval(id);
      id = setInterval(async () => {
        try {
          cb(key, unpack((await redisClient.get(
            redisClient.commandOptions({ returnBuffers: true }),
            key
          ))));

        } catch(e) {
          console.log('Error getting key', key, e.toString());
        }
      }, rateInMs);

      remote.timers[`${key}_${rateInMs}`] = id;
    },

    off: function(id) {
      var id = remote.timers[`${key}_${rateInMs}`];

      if(id) clearInterval(id);

      delete remote.timers[`${key}_${rateInMs}`];
    },

    get: async function(key, cb = function() {}) {
      var val = (await redisClient.get(Buffer.from(key)));

      if(val) return cb(val.toString());
      cb();
    },

    set: async function(key, value, cb = function() {}) {
      cb(await redisClient.set(Buffer.from(key), value));
    },

    publish: async function(key, value) {
      await redisClient.publish(Buffer.from(key), value);
    },

    subscribe: async function(key, cb = function() {}, unpackMessage = false) {
      var subscriber = redisClient.duplicate();
      remote.redisClients.push(subscriber);

      subscriber.on('error', err => console.log('remote id', remote.id, 'subscriber for key', key, 'redis client error', err));
      subscriber.on('connect', () => console.log('remote id', remote.id, 'subscriber for key', key, 'redis client is connected'));
      subscriber.on('reconnecting', () => console.log('remote id', remote.id, 'subscriber for key', key, 'redis client is reconnecting'));
      subscriber.on('ready', () => console.log('remote id', remote.id, 'subscriber for key', key, 'redis client is ready'));

      await subscriber.connect();

      await subscriber.subscribe(Buffer.from(key), (message, key) => {
        //console.log(key, message);

        //message = Buffer.from(message);
        //if(unpackMessage) {
        //  message = Buffer.isBuffer(message) ? message : Buffer.from(message);
        //}
        cb(key.toString(), unpackMessage ? unpack(message) : JSON.parse(message.toString()));
      }, true);
    },

    stopNow: function() {
      pm2.connect(err => {
        if(err) return console.log(err);

        pm2.restart({
          name: 'mecanum_drive_controller'
        }, (err, apps) => {
          console.log(err, apps);
        });
      });
    },

    getParameters: async function(cb = function() {}) {
      cb(unpack((await redisClient.get(
        redisClient.commandOptions({ returnBuffers: true }),
        'rover_parameters'
      ))));
    },

    getRadarParameters: async function(cb = function() {}) {
      cb(unpack((await redisClient.get(
        redisClient.commandOptions({ returnBuffers: true }),
        'radar_parameters'
      ))));
    },

    setParameters: async function(params = {}, key, cb = function() {}) {
      params = new Map(Object.entries(params));

      var currentParams = unpack((await redisClient.get(
        redisClient.commandOptions({ returnBuffers: true }),
        key)));

      var startupTimestamp = parseInt(await redisClient.get('rover_startup_timestamp'));

      params.set('timestamp', 0);  

      var packedParams = packer.pack(params);

      console.log('setting params for key', key, 'current params', currentParams, 'new params', params);

      await redisClient.set(redisClient.commandOptions({ returnBuffers: true }),
        key, packedParams);

      await redisClient.publish(
        redisClient.commandOptions({ returnBuffers: true }),
        key,
        packedParams
      );

      cb(unpack((await redisClient.get(
        redisClient.commandOptions({ returnBuffers: true }),
        key
      )))); 
    },

    getScanProfile: function(profileDataFilePath, cb = function() {}) {
      var profileDataFile = new hdf5.File(profileDataFilePath);

      var sampleCount = profileDataFile.get('raw_proc_data').shape[1];

      var positions = profileDataFile.get('position').to_array();

      var minX = Math.min.apply(Math, positions.map(p => Math.abs(p[0]))),
          minY = Math.min.apply(Math, positions.map(p => Math.abs(p[1]))),
          maxX = Math.max.apply(Math, positions.map(p => Math.abs(p[0]))),
          maxY = Math.max.apply(Math, positions.map(p => Math.abs(p[1])));

      positions = positions.map((p, i) => [p, i]);

      var profileData = { 
        profile: [], 
        x: [], 
        y: [], 
        time: [], 
        field: []
      };

      var profileProps = {
        vmin: 0,
        vmax: 0,
        dt: 0,
        maxX: 0,
        maxY: 0,
        tmin: [],
        tmax: [],
        sampleCount: 0,
        xStepSize: 0.01,
        yStepSize: 0.01
      };

      positions = positions.sort((a, b) => {
        return a[0][1] - b[0][1] || a[0][0] - b[0][0];
      });

      var profileRawData = profileDataFile.get('raw_proc_data').to_array();

      // filter out no data profiles
      positions = positions.filter(p => {
        var pos         = { x: p[0][0], y: p[0][1] },
            fieldValues = profileRawData[p[1]];

        if(fieldValues.every(s => s === 0)) return false;
        return true;
      });

      var avgProfile = new Array(profileRawData[0].length).fill(0);

      profileRawData.forEach(p => {
        p.forEach((s, i) => {
          avgProfile[i] = avgProfile[i] + s;
        });
      });

      const chunkSize = profileRawData.length;
      const profileChunks = profileRawData.reduce((resultArray, item, index) => {
        const chunkIndex = Math.floor(index/chunkSize)

        if(!resultArray[chunkIndex]) {
          resultArray[chunkIndex] = [];
        }

        resultArray[chunkIndex].push(item)

        return resultArray
      }, []).map(chunk => {

        var avgProfile = new Array(profileRawData[0].length).fill(0);

        chunk.forEach(p => {
          p.forEach((s, i) => {
            avgProfile[i] = avgProfile[i] + s;
          });
        });

        return avgProfile.map(p => p / chunkSize);
      });

      avgProfile = avgProfile.map(p => p / profileRawData.length);

      var avgStepX = maxX / positions.length;
      var avgStepY = maxY / positions.length;

      positions.forEach((p, profileCount) => {
        var pos         = { x: p[0][0], y: p[0][1] },
            sampleCount = profileDataFile.get('raw_proc_data').shape[1],
            attrs       = profileDataFile.get('raw_proc_data').attrs,
            dt          = 299792458.0 / 2 / (Number(attrs.stepFrequency.value) * 1e6);


        var xPos = ((avgStepX / maxX) * pos.x) || 0,
            yPos = ((avgStepY / maxY) * pos.y) || 0;

        var fieldValues = profileRawData[p[1]].map((v, i) => v - avgProfile[i]);

        //var fieldValues = profileRawData[p[1]].map((v, i) => v - profileChunks[Math.floor(p[1] / chunkSize)][i]);

        profileProps.tmin.push(Math.max.apply(Math, fieldValues.map(Math.abs)) * -1);
        profileProps.tmax.push(Math.max.apply(Math, fieldValues));

        profileData.profile = profileData.profile.concat(new Array(fieldValues.length).fill(profileCount));

        profileData.x = profileData.x.concat(new Array(fieldValues.length).fill(xPos));
        profileData.y = profileData.y.concat(new Array(fieldValues.length).fill(yPos));

        profileData.time = profileData.time.concat([...new Array(fieldValues.length)].map((v, i) => {
          return (i / fieldValues.length) * dt;
        }));

        profileData.field = profileData.field.concat(fieldValues);
        profileProps.dt = dt;
        profileProps.sampleCount = sampleCount;
      });

      profileProps.profileCount = positions.length;
      profileProps.minX = minX;
      profileProps.minY = minY;
      profileProps.maxX = maxX;
      profileProps.maxY = maxY;
      profileProps.vmin = Math.max.apply(Math, profileProps.tmin.map(Math.abs)) * -1;
      profileProps.vmax = Math.max.apply(Math, profileProps.tmax);

      cb(profileData, profileProps);
    },

    getDataProcessingStatus: function(cb = function() {}) {
      request('http://localhost:9005/status', (err, res, body) => {
        if(err) {
          console.log(err, body);
          return cb(err.toString());
        } else {
          var status = null;
          
          try {
            status = JSON.parse(body);
          } catch(e) {
            console.log(e.toString());
            return cb(err);
          }

          if(status) cb(null, status);
        }
      });
    },

    getLineProcessStatus: function(scanId, cb = function() {}) {
      request(`http://localhost/outputjson/${scanId}/img`, { json: true }, (err, res, body) => {
        if(err) {
          console.log(err.toString());
          return cb(err.toString());
        }

        if(res.statusCode === 200) {
          cb(false, body);
        }
      });
    },

    restartRadarProcess: function(cb = function() {}) {
      request('http://radar:8081/restart', { json: true }, (err, res, body) => {
        if(err) return cb(err.toString());
        cb(false, body);
      });
    },

    startLogging: async function(cb = function() {}) {
      var logIndex = {
        started_at: new Date().getTime(),
        rover_startup_timestamp: parseInt((await redisClient.get('rover_startup_timestamp'))),
        keys: {},
        id: uuid.v4() 
      };

      await (getBaseStationConfig(config => {
        logIndex.baseStationConfig = config;
      }));

      var keysToLog = 
        [
          ['rover_pose', 100],
          ['rover_battery_state', 1], 
          ['rover_wheel_encoder', 100],
          ['rover_wheel_velocity_command', 100, true],
          ['rover_wheel_velocity_output', 100]
      ];

      logIndex.keysToLog = keysToLog;

      keysToLog.forEach(keyDesc => {
        var key       = keyDesc[0],
            rateInMs  = keyDesc[1],
            deDupe    = keyDesc[2] || false;

        logIndex.running = true;

        logIndex.keys[key] = {
          intervalId: 0,
          queue: [],
          count: 0,
          writer: fs.createWriteStream(path.join(__dirname, 'data', `${logIndex.started_at}-${key}.msgpack`))
        };

        var lastRecord;
        logIndex.keys[key].intervalId = setInterval(async () => {
          var record = (await redisClient.get(Buffer.from(key)));
          
          if(deDupe) {  
        
            if(!lastRecord) {
              lastRecord = record;
              logIndex.keys[key].count++;
              logIndex.keys[key].queue.push(record);
            }

            if(lastRecord.timestamp === record.timestamp) return;
            
            lastRecord = record;
            logIndex.keys[key].queue.push(record);
            
            logIndex.keys[key].count++;
          } else {
            logIndex.keys[key].count++;
            logIndex.keys[key].queue.push(record);
          }
        }, rateInMs);
      });

      fs.writeFileSync(path.join(__dirname, 'data', `${logIndex.started_at}-index.json`), JSON.stringify(logIndex));

      function logWriter() {
        Object.keys(logIndex.keys).forEach(k => {
          var q = logIndex.keys[k],
              writer = logIndex.keys[k].writer;
          
          var record;
          while(record = q.pop()) {
            writeStream.write(record);
            writeStream.write("\n");
          }
        });

        logIndex.writerIntervalId = setTimeout(logWriter, 1000);
      }

      logIndex.writerIntervalId = setTimeout(logWriter, 1000);

      logs[logIndex.uuid] = logIndex;

      cb(logIndex);
    },
    stopLogging: function(uuid) {
      var logIndex = logs[uuid];

      if(logIndex && logIndex.running) {
        
        function checkKeys() {
          if(Object.keys(logIndex).map(k => logIndex[k].intervalId).every(id => id === 0)) {
            logIndex.running = false;
            logIndex.stopped_at = new Date().getTime();

            fs.writeFileSync(path.join(__dirname, 'data', `${logIndex.started_at}-index.json`), JSON.stringify(logIndex));
          }
        }

        Object.keys(logIndex).forEach(k => {
          var key = logIndex[k];

          function closeQueue() {
            if(key.queue.length) return setTimeout(closeQueue, 1000);
            clearInterval(key.IntervalId);
            key.intervalId = 0;

            key.writer.close();
            checkKeys();
          }

          closeQueue();
        });
      }
    }
  });

   d.on('remote', function(r) {
    console.log(d);
    r.id = stream.id;
    remote = r;

    remotes[r.id] = remote;

    remote.stream = stream;
    remote.ee = new EventEmitter();
    remote.timers = {};
    remote.redisClients = [];
    r.lastPing = Date.now();

    console.log('New client connected', r.id, remotes);
  });

  d.pipe(stream).pipe(d);
});

sock.install(server, '/ws');

const clientTimeout = 10 * 1000;
function initCleanupRemotes() {
  setInterval(() => {
    console.log('Starting cleanup of remotes', remotes);
    Object.keys(remotes).forEach(async (id) => {
      var r = remotes[id];
      
      if(!r || !r.lastPing || ((Date.now() - r.lastPing) > clientTimeout)) {
        console.log('Client timed out', id, Date.now(), r.lastPing, 'last seen', Date.now() - r.lastPing, 'greater than timeout of', clientTimeout);
        
        r.ee.removeAllListeners();
        
        for(var [key, timer] of Object.entries(remotes[id].timers)) {
          clearInterval(timer);
        }

        remotes[id].timers = [];
       
        var index = 0; 
        for(var client of remotes[id].redisClients) {
          await client.disconnect();
          remotes[id].redisClients[index] = null;
          delete remotes[id].redisClients[index];
          index++;
        }

        remotes[id].redisClients = [];

        r.stream.close();

        delete remotes[id];
      }
    });
  }, clientTimeout);
}

var hdf5;
if(require.main === module) {
  (async () => {
    hdf5 = await import('h5wasm');
    await hdf5.ready;

    await redisClient.connect();
  
    server.listen(3000, function() {
      initCleanupRemotes();
      console.log(`Scan review UI started on ${server.address().address}:${server.address().port}`);
    });
  })();
}
