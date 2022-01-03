#!/usr/bin/env node

var fs            = require('fs'),
    path          = require('path'),
    express       = require('express'),
    http          = require('http'),
    path          = require('path'),
    dnode         = require('dnode'),
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
  path.join(__dirname, 'node_modules', '@bokeh', 'bokehjs', 'build', 'js', 'bokeh.min.js'),
  path.join(__dirname, 'node_modules', '@bokeh', 'bokehjs', 'build', 'js', 'bokeh-widgets.min.js'),
  path.join(__dirname, 'node_modules', '@bokeh', 'bokehjs', 'build', 'js', 'bokeh-tables.min.js'),
  path.join(__dirname, 'node_modules', '@bokeh', 'bokehjs', 'build', 'js', 'bokeh-api.min.js'),
  path.join(__dirname, 'node_modules', '@bokeh', 'bokehjs', 'build', 'js', 'bokeh-gl.min.js'),
  path.join(__dirname, 'node_modules', '@bokeh', 'bokehjs', 'build', 'js', 'bokeh-mathjax.min.js')
];

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
var sock = shoe(function(stream) {
  var remote;

  var d = dnode({
    ping: function() {
      var r = remotes[remote.id];
      if(r) r.lastPing = Date.now(); 
    },

    getBaseStationConfig: async function(cb = function() {}) {
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
    },

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
