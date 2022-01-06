#!/usr/bin/env node

var fs            = require('fs'),
    path          = require('path'),
    express       = require('express'),
    http          = require('http'),
    path          = require('path'),
    dnode         = require('dnode'),
    uuid          = require('uuid').v4,
    shoe          = require('shoe'),
    redis         = require('redis'),
    msgpack       = require('msgpackr'),
    EventEmitter  = require('events'),
    browserify    = require('browserify-middleware');

var app = express();
app.use('/client.js', browserify(path.join(__dirname, 'src', 'client.js')));

var styles = [
  path.join(__dirname, 'node_modules', 'toastify-js', 'src', 'toastify.css'),
  path.join(__dirname, 'node_modules', 'nprogress', 'nprogress.css'),
  path.join(__dirname, 'node_modules', 'bootstrap', 'dist', 'css', 'bootstrap.css')
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

app.use(express.static(path.join(__dirname, 'lib', 'bokeh', 'bokehjs', 'build', 'js')));

app.use('/vendor.js', (req, res) => {
  res.status(200);
  res.setHeader('content-type', 'application/javascript');
  
  for(var libraryPath of libraries) {
    res.write(fs.readFileSync(libraryPath));  
  }

  res.end();

});

app.use(express.static('static'));
app.use(express.static('data'));

var server = http.createServer(app);

var redisClient = redis.createClient();
redisClient.on('error', (err) => console.log('Redis Client Error', err));

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

var sock = shoe(function(stream) {
  var remote;

  async function getBaseStationConfig(cb = function() {}) {
      //console.log(fs.readFileSync(trackerConfigPath).toString());

      var config = {
        obj: JSON.parse((await redisClient.get('rover_pose_config')).toString()),
        basePoses: await (async function() {
          return ((await redisClient.keys('rover_base_pose-*')) || []).map(key => async function() {
            return (await redisClient.getBuffer(key));
          });
        })()
      };

      cb(config);
      //cb(JSON.parse(fs.readFileSync(trackerConfigPath).toString() ));
  }

  var d = dnode({
    ping: function() {
      var r = remotes[remote.id];
      if(r) r.lastPing = Date.now(); 
    },

    getBaseStationConfig: getBaseStationConfig,

    on: function(key, rateInMs = 100, cb = function() {}) {
      var id = remote.timers[`${key}_${rateInMs}`];

      if(id) clearInterval(id);
      id = setInterval(async () => {
        cb(key, unpack((await redisClient.getBuffer(key))));
      }, rateInMs);

      remote.timers[`${key}_${rateInMs}`] = id;
    },

    off: function(id) {
      var id = remote.timers[`${key}_${rateInMs}`];

      if(id) clearInterval(id);

      delete remote.timers[`${key}_${rateInMs}`];
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
          var record = (await redisClient.getBuffer(Buffer.from(key)));
          
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
    r.id = Math.random();
    remote = r;

    remotes[r.id] = remote;
    remote.ee = new EventEmitter();
    remote.timers = {};

    console.log('New client connected', r.id, remotes);
  });

  d.pipe(stream).pipe(d);
});

sock.install(server, '/ws');

setInterval(() => {
  Object.keys(remotes).forEach((id) => {
    var r = remotes[id];
    
    if(!r || !r.lastPing || ((Date.now() - r.lastPing) > 60 * 1000)) {
      console.log('Client timed out', id, Date.now(), r.lastPing);
      delete remotes[id];
    }
  });
}, 30 * 1000);

if(require.main === module) {
  (async () => {
    await redisClient.connect();
  
    server.listen(3000, function() {
      console.log(`Scan review UI started on ${server.address().address}:${server.address().port}`);
    });
  })();
}
