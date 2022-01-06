var dnode         = require('dnode'),
    shoe          = require('shoe'),
    reconnect     = require('reconnect/shoe'),
    progressBar   = require('nprogress'),
    notify        = require('toastify-js'),
    template      = require('resig'),
    colorBrewer   = require('colorbrewer');

var remote;
var connectionManager = reconnect((stream) => {
  var d = dnode({
    data: function(key, value) {
      console.log('got data', key, value);
    }
  });

  var pingIntervalId;
  d.on('remote', function(r) {
    remote = r;

    initUI();

    if(pingIntervalId) clearInterval(pingIntervalId);
    pingIntervalId = setInterval(() => {
      remote.ping();
    }, 5000);
  });


  d.pipe(stream).pipe(d);


}).connect('/ws');

connectionManager.on('connect', () => {
  if(retryNotify) retryNotify.hideToast();
  notify({
    text: 'Connected.',
    duration: 3000,
    close: false,
    gravity: 'bottom',
    position: 'left',
    stopOnFocus: false,
    style: {
      background: 'linear-gradient(to right, #00b09b, #96c93d)',
    },
  }).showToast();
});

connectionManager.on('disconnect', () => {
  notify({
    text: 'Disconnected.',
    duration: 3000,
    close: false,
    gravity: 'bottom',
    position: 'left',
    stopOnFocus: false,
    style: {
      background: 'linear-gradient(to right, #00b09b, #96c93d)',
    },
  }).showToast();
});

var retryNotify;
connectionManager.on('reconnect', () => {
  retryNotify = notify({
    text: 'Trying to reconnect...',
    duration: 3000,
    close: false,
    gravity: 'bottom',
    position: 'left',
    stopOnFocus: false,
    style: {
      background: 'linear-gradient(to right, #00b09b, #96c93d)',
    },
  }).showToast();
});


const toPascal = (s) => {
  var str = s.toLowerCase().replace(/[^a-zA-Z0-9]+(.)/g, (m, chr) => chr.toUpperCase());
  return str.charAt(0).toUpperCase() + str.slice(1);
};


var currentTrackerConfig;
function initUI() {
  console.log('init ui');

  var positionPlot, positionSource, xRange, yRange, xAxis, yAxis, xGrid, yGrid;
  
  var tools = ['pan', 'crosshair', 'wheel_zoom', 'box_zoom', 'reset', 'save'];
  remote.getBaseStationConfig(config => {
    
    currentTrackerConfig = config;

    var dim = 1.397 / 2;

    xRange = new Bokeh.Range1d({ start: dim * -1, end: dim });
    yRange = new Bokeh.Range1d({ start: dim * -1, end: dim });

    positionPlot = new Bokeh.Plot({
      title: '2D Position Estimate',
      x_range: xRange,
      y_range: yRange,
      width: initialWidth,
      height: 500,
      background_fill_color: '#F2F2F7'
    });

    tools.forEach(t => {
      var tool = new Bokeh[`${toPascal(t)}Tool`]();
      positionPlot.add_tools(tool);
    });

    var xPositionPlot = new Bokeh.Plotting.figure({
      title: 'X Position',
      width: initialWidth,
      height: 400,
      background_fill_color: '#F2F2F7',
      tools: tools
    });

    var yPositionPlot = new Bokeh.Plotting.figure({
      title: 'Y Position',
      width: initialWidth,
      height: 400,
      background_fill_color: '#F2F2F7',
      tools: tools
    });

    xAxis = new Bokeh.LinearAxis({ axis_line_color: null });
    yAxis = new Bokeh.LinearAxis({ axis_line_color: null });

    positionPlot.add_layout(xAxis, 'below');
    positionPlot.add_layout(yAxis, 'left');

    xGrid = new Bokeh.Grid({ ticker: xAxis.ticker, dimension: 0 });
    yGrid = new Bokeh.Grid({ ticker: yAxis.ticker, dimension: 1 });
   
    positionPlot.add_layout(xGrid);
    positionPlot.add_layout(yGrid);

    positionSource = new Bokeh.ColumnDataSource({
      data: { timestamp: [], x: [], y: [] }
    });

    xSource = new Bokeh.ColumnDataSource({
      data: { timestamp: [], x: [] }
    });

    ySource = new Bokeh.ColumnDataSource({
      data: { timestamp: [], y: [] }
    });

    const xyLine = new Bokeh.Line({
      x: { field: "x" },
      y: { field: "y" },
      line_color: "#666699",
      line_width: 2
    });

    xPositionPlot.line({ field: 'timestamp' }, { field: 'x' }, {
      source: xSource,
      line_color: "#666699",
      line_width: 2
    });

    yPositionPlot.line({ field: 'timestamp' }, { field: 'y' }, {
      source: ySource,
      line_color: "#666699",
      line_width: 2
    });

    positionPlot.add_glyph(xyLine, positionSource);

    var velocityPlot = new Bokeh.Plotting.figure({
      title: 'Velocity Estimate',
      width: initialWidth,
      height: 400,
      background_fill_color: '#F2F2F7',
      tools: tools
    });

    var velocitySource = new Bokeh.ColumnDataSource({
      data: {
        timestamp: [],
        x: [],
        y: []
      }
    });


    var velocityScheme = colorBrewer.Spectral[4];

    velocityPlot.line({ field: 'timestamp' }, { field: 'x' }, {
      source: velocitySource,
      line_color: velocityScheme[0],
      legend_label: 'velocity_x',
      line_width: 2
    });

    velocityPlot.line({ field: 'timestamp' }, { field: 'y' }, {
      source: velocitySource,
      line_color: velocityScheme[1],
      legend_label: 'velocity_y',
      line_width: 2
    });

    addPlot(positionPlot);
    addPlot(xPositionPlot);
    addPlot(yPositionPlot);
    addPlot(velocityPlot);

    remote.on('rover_pose', 100, (key, pose) => {
      positionSource.data.timestamp.push(pose.timestamp);
      positionSource.data.x.push(pose.pos[0]);
      positionSource.data.y.push(pose.pos[1] * -1);

      xSource.data.x.push(pose.pos[0]);
      xSource.data.timestamp.push(pose.timestamp);

      ySource.data.y.push(pose.pos[1] * -1);
      ySource.data.timestamp.push(pose.timestamp);


      positionSource.change.emit();
      xSource.change.emit();
      ySource.change.emit();
    });

    remote.on('rover_pose_velocity', 100, (key, velocity) => {
      velocitySource.data.timestamp.push(velocity.timestamp);
      velocitySource.data.x.push(velocity.x);
      velocitySource.data.y.push(velocity.y);

      velocitySource.change.emit();
    });

    var initialWidth = window.innerWidth * 0.75;
    var batteryPlot = new Bokeh.Plotting.figure({
      title: 'Battery State',
      width: initialWidth,
      height: 400,
      background_fill_color: '#F2F2F7',
      tools: tools
    });

    var wheelEncodersPlot = new Bokeh.Plotting.figure({
      title: 'Wheel Encoders',
      width: initialWidth,
      height: 400,
      background_fill_color: '#F2F2F7',
      tools: tools
    });

    var batterySource = new Bokeh.ColumnDataSource({
      data: { 
        timestamp: [], 
        adc_val: [],
        current: [], 
        percent: [], 
        temperature: [] }
    });

    var batteryFields;

    var yRangeMapping = {
      adc_val: new Bokeh.Range1d({ start: 8000, end: 11000 }),
      percent: new Bokeh.Range1d({ start: 0, end: 100 }),
      current: new Bokeh.Range1d({ start: -2000, end: 0 }),
      temperature: new Bokeh.Range1d({ start: 100, end: 500 })
    };

    batteryPlot.extra_y_ranges = yRangeMapping;
    window.batteryFields = batteryFields;
    window.batteryPlot = batteryPlot;

    var scheme = colorBrewer.Spectral;
    var legendMapping = {}; 

    remote.on('rover_battery_state', 1000, (key, batteryMessage) => {
      if(!batteryFields) {


        batteryFields = Object.keys(batteryMessage).map((bKey, i) => {
          if(bKey === 'timestamp') return;
          
          var yRangeName = yRangeMapping[bKey] ? bKey : undefined,
              legendLabel = legendMapping[bKey] ? legendMapping[bKey] : bKey;

          batteryPlot.line({ field: 'timestamp' }, { field: bKey }, {
            source: batterySource,
            line_color: scheme[Object.keys(batteryMessage).length - 1][i],
            line_width: 2,
            legend_label: legendLabel,
            y_range_name: yRangeName
          });

          batteryPlot.add_layout(new Bokeh.LinearAxis({ y_range_name: yRangeName, axis_label: legendLabel }), i % 2 === 0 ? 'left' : 'right');
        });

        batteryPlot.change.emit();

        addPlot(batteryPlot);
      } else {
        Object.keys(batteryMessage).forEach(key => {
          if(key === 'timestamp') return batterySource.data.timestamp.push(batteryMessage.timestamp);
          batterySource.data[key].push(batteryMessage[key]);

        });

        batterySource.change.emit();
      }
    });

    var wheelEncoderFields;

    var wheelEncodersYRangeMapping = {
      rpm: new Bokeh.Range1d({ start: -200, end: 200 }),
      enc: new Bokeh.Range1d({ start: 0, end: 45000 }),
    };

    wheelEncodersPlot.extra_y_ranges = wheelEncodersYRangeMapping; 

    var wheelEncodersScheme = colorBrewer.Spectral[4];
    var wheelEncodersLegendMapping = {}; 

    var wheelEncodersSource;
    remote.on('rover_wheel_encoder', 100, (key, wheelEncoderMessage) => {
      var fieldLengths = {};

      if(!wheelEncoderFields) {
        var data = { timestamp: [] };

        for(var i = 0; i < 4; i++) {
          data[`rpm_${i}`] = [];
          data[`enc_${i}`] = [];
        }

        wheelEncodersSource = new Bokeh.ColumnDataSource({ data: data });

        wheelEncoderFields = Object.keys(wheelEncoderMessage).map((bKey, i) => {
          if(bKey === 'timestamp') return;
          
          fieldLengths[bKey] = wheelEncoderMessage[bKey].length;
          var yRangeName = wheelEncodersYRangeMapping[bKey] ? bKey : undefined,
              legendLabel = wheelEncodersLegendMapping[bKey] ? wheelEncodersLegendMapping[bKey] : bKey;
          
          if(bKey === 'rpm' || bKey === 'enc') {
            
            for(var i = 0; i < 4; i++) {
              wheelEncodersPlot.line({ field: 'timestamp' }, { field: `${bKey}_${i}` }, {
                source: wheelEncodersSource,
                line_color: wheelEncodersScheme[i],
                line_width: 2,
                legend_label: `${legendLabel}_${i}`,
                y_range_name: yRangeName
              });
            }
          }

          wheelEncodersPlot.add_layout(new Bokeh.LinearAxis({ y_range_name: yRangeName, axis_label: legendLabel }), bKey === 'rpm' ? 'left' : 'right');
        });

        wheelEncodersPlot.change.emit();

        addPlot(wheelEncodersPlot);
      } else {
        Object.keys(wheelEncoderMessage).forEach(k => {
          if(k === 'timestamp') return wheelEncodersSource.data.timestamp.push(wheelEncoderMessage.timestamp);
          
          if(k === 'rpm' || k === 'enc') {
            for(var i = 0; i < 4; i++) {
              wheelEncodersSource.data[`${k}_${i}`].push(wheelEncoderMessage[k][i]);
            }
          }
        });

        wheelEncodersSource.change.emit();

      }
    });
    
    var wheelVelocityCommandFields, wheelVelocityOutputFields;;

    var wheelVelocityYRangeMapping = {
      velocity: new Bokeh.Range1d({ start: -200, end: 200 }),
    };

    var wheelVelocityPlot = new Bokeh.Plotting.figure({
      title: 'Wheel Velocity Commands & Outputs',
      width: initialWidth,
      height: 400,
      background_fill_color: '#F2F2F7',
      y_range: wheelVelocityYRangeMapping.velocity,
      tools: tools
    });

    var wheelVelocityScheme = colorBrewer.Spectral[4];
    var wheelVelocityLegendMapping = {}; 

    var wheelVelocityOutputSource;
    remote.on('rover_wheel_velocity_output', 100, (key, wheelVelocityMessage) => {
      //console.log(wheelVelocityMessage.timestamp);
      if(!wheelVelocityOutputFields) {
        var outputData = { timestamp: [] };

        for(var i = 0; i < 4; i++) {
          outputData[`velocity_${i}`] = [];
        }

        wheelVelocityOutputSource = new Bokeh.ColumnDataSource({ data: outputData });
        window.wheelVelocityOutputSource = wheelVelocityOutputSource;

        wheelVelocityOutputFields = Object.keys(wheelVelocityMessage).map((bKey, i) => {
          if(bKey === 'timestamp') return;
          
          if(bKey === 'velocity') {
            
            for(var i = 0; i < 4; i++) {
              wheelVelocityPlot.line({ field: 'timestamp' }, { field: `${bKey}_${i}` }, {
                source: wheelVelocityOutputSource,
                line_color: wheelVelocityScheme[i],
                line_width: 2,
                legend_label: `${bKey}_output_${i}`,
              });
            }
          }
        });

        wheelVelocityPlot.change.emit();
        window.addPlot = addPlot;
        window.wheelVelocityPlot = wheelVelocityPlot;
        addPlot(wheelVelocityPlot);
      } else {
        Object.keys(wheelVelocityMessage).forEach(k => {
          if(k === 'timestamp') return wheelVelocityOutputSource.data.timestamp.push(wheelVelocityMessage.timestamp);
          
          if(k === 'velocity') {
            for(var i = 0; i < 4; i++) {
              wheelVelocityOutputSource.data[`${k}_${i}`].push(wheelVelocityMessage[k][i]);
            }
          }
        });

        wheelVelocityOutputSource.change.emit();
      }
    });

    var wheelVelocityCommandSource;

    var lastWheelVelocityCommand;
    
    remote.on('rover_wheel_velocity_command', 100, (key, wheelVelocityMessage) => {
      if(!wheelVelocityCommandFields) {
        var outputData = { timestamp: [] };

        for(var i = 0; i < 4; i++) {
          outputData[`velocity_${i}`] = [];
        }

        wheelVelocityCommandSource = new Bokeh.ColumnDataSource({ data: outputData });

        wheelVelocityCommandFields = Object.keys(wheelVelocityMessage).map((bKey, i) => {
          if(bKey === 'timestamp') return;
          
          if(bKey === 'velocity') {
            
            for(var i = 0; i < 4; i++) {
                wheelVelocityPlot.circle({ field: 'timestamp' }, { field: `${bKey}_${i}` }, {
                source: wheelVelocityCommandSource,
                fill_color: wheelVelocityScheme[i],
                line_color: wheelVelocityScheme[i],
                fill_alpha: 0.8,
                legend_label: `${bKey}_command_${i}`,
              });
            }
          }
        });

        wheelVelocityPlot.change.emit();

      }

      if(!lastWheelVelocityCommand) {
        lastWheelVelocityCommand = wheelVelocityMessage;
      } else {
        if(lastWheelVelocityCommand.timestamp === wheelVelocityMessage.timestamp) return;
      }

      lastWheelVelocityCommand = wheelVelocityMessage;

      Object.keys(wheelVelocityMessage).forEach(k => {
        if(k === 'timestamp') return wheelVelocityCommandSource.data.timestamp.push(wheelVelocityMessage.timestamp);
        
        if(k === 'velocity') {
          for(var i = 0; i < 4; i++) {
            wheelVelocityCommandSource.data[`${k}_${i}`].push(wheelVelocityMessage[k][i]);
          }
        }
      });

      wheelVelocityCommandSource.change.emit();
    
    });



  });
}

var container = document.querySelector('main > div.container');
function addPlot(plot, data = {}) {
  var d = document.createElement('div');
 
  d.innerHTML = template('plot', data);

  Bokeh.Plotting.show(plot, d.querySelector('.plot-container'));

  var rect = container.appendChild(d.firstElementChild)
    .querySelector('.plot-container').getBoundingClientRect();
  
  //plot.frame_width = rect.width;

  //plot.properties.height.change.emit();
}
