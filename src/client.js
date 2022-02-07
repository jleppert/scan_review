var dnode         = require('dnode'),
    shoe          = require('shoe'),
    reconnect     = require('reconnect/shoe'),
    progressBar   = require('nprogress'),
    notify        = require('toastify-js'),
    template      = require('resig'),
    colorBrewer   = require('colorbrewer'),
    THREE         = require('three'),
    STLLoader     = require('three-stl-loader')(THREE),
    drawHeading   = require('./heading'),
    LowPassFilter = require('./control/LowPassFilter'),
    dat           = require('dat.gui'),
    qte           = require('quaternion-to-euler');

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

    var scene = new THREE.Scene(),
        camera = new THREE.OrthographicCamera(400 / -2, 400 / 2, 400 / 2, 400 / -2, -200, 200),
        renderer = new THREE.WebGLRenderer({ alpha: true });

    var directionalLight = new THREE.DirectionalLight(0xffffff, 1);
    directionalLight.position.set(200, 0, 0);
    directionalLight.name = "directional";
    scene.add(directionalLight);

    var roverLoader = new STLLoader();

    var roverMesh;
    roverLoader.load('rover.stl', geometry => {
      var material = new THREE.MeshNormalMaterial();
      roverMesh = new THREE.Mesh(geometry, material);

      roverMesh.position.y = 0;
      roverMesh.position.x = 0;
      roverMesh.position.z = 0;

      scene.add(roverMesh);
    });

    renderer.setClearColor(0x000000, 0);
    renderer.setPixelRatio(window.devicePixelRatio);

    renderer.setSize(300, 300);
    renderer.domElement.classList.add('rover-visual');
    
    var headingContainer = document.querySelector('.heading-container');
    headingContainer.appendChild(renderer.domElement);

    var headingNumberDegree = document.getElementById('heading-number-degree');
    var headingNumberRadian = document.getElementById('heading-number-radian');

    var heading = document.getElementById('heading');
    drawHeading(heading);

    currentTrackerConfig = config;

    var dim = 1.397 / 2;

    xRange = new Bokeh.Range1d({ start: dim * -1, end: dim });
    yRange = new Bokeh.Range1d({ start: dim * -1, end: dim });

    positionPlot = new Bokeh.Plot({
      title: 'Estimated Position Path & Trajectory Plan',
      x_range: xRange,
      y_range: yRange,
      width: initialWidth,
      height: 500,
      background_fill_color: '#F2F2F7',
      output_backend: 'webgl'
    });

    tools.forEach(t => {
      var tool = new Bokeh[`${toPascal(t)}Tool`]();
      positionPlot.add_tools(tool);
    });

    var xPositionPlot = new Bokeh.Plotting.figure({
      title: 'X Position',
      y_range: new Bokeh.Range1d({ start: dim * -1, end: dim }),
      width: initialWidth,
      height: 400,
      background_fill_color: '#F2F2F7',
      tools: tools,
      //output_backend: 'webgl'
    });

    var yPositionPlot = new Bokeh.Plotting.figure({
      title: 'Y Position',
      y_range: new Bokeh.Range1d({ start: dim * -1, end: dim }),
      width: initialWidth,
      height: 400,
      background_fill_color: '#F2F2F7',
      tools: tools,
      //output_backend: 'webgl'
    });

    var headingPlot = new Bokeh.Plotting.figure({
      title: 'Heading Estimate',
      y_range: new Bokeh.Range1d({ start: -Math.PI, end: Math.PI }),
      width: initialWidth,
      height: 400,
      background_fill_color: '#F2F2F7',
      tools: tools
    });

    var headingSource = new Bokeh.ColumnDataSource({
      data: { timestamp: [], theta: [] }
    });

    var headingScheme = colorBrewer.Spectral[4];

    headingPlot.line({ field: 'timestamp' }, { field: 'theta' }, {
      source: headingSource,
      line_color: "#666699",
      legend_label: 'Estimate',
      line_width: 2
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

    trajectorySource = new Bokeh.ColumnDataSource({
      data: { timestamp: [], x: [], y: [] }
    });

    xSource = new Bokeh.ColumnDataSource({
      data: { timestamp: [], x: [] }
    });

    ySource = new Bokeh.ColumnDataSource({
      data: { timestamp: [], y: [] }
    });

    var xTrajectorySource = new Bokeh.ColumnDataSource({
      data: { timestamp: [], x: [] }
    });

    var yTrajectorySource = new Bokeh.ColumnDataSource({
      data: { timestamp: [], y: [] }
    });

    const xyLine = new Bokeh.Line({
      x: { field: "x" },
      y: { field: "y" },
      line_color: "#666699",
      line_width: 2
    });

    const xyLineTrajectory = new Bokeh.Line({
      x: { field: "x" },
      y: { field: "y" },
      line_color: "#43ac6a",
      line_width: 2
    });

    var xyLineGlyphRenderer = positionPlot.add_glyph(xyLine, positionSource);
    var xyLineTrajectoryGlyphRenderer = positionPlot.add_glyph(xyLineTrajectory, trajectorySource);

    var positionLegend = new Bokeh.Legend({
      items: [
        new Bokeh.LegendItem({ label: { value: 'Estimate' }, renderers: [xyLineGlyphRenderer] }),
        new Bokeh.LegendItem({ label: { value: 'Trajectory' }, renderers: [xyLineTrajectoryGlyphRenderer] })
      ]
    });

    positionPlot.add_layout(positionLegend);

    xPositionPlot.line({ field: 'timestamp' }, { field: 'x' }, {
      source: xSource,
      line_color: "#666699",
      legend_label: 'Estimate',
      line_width: 2
    });

    xPositionPlot.line({ field: 'timestamp' }, { field: 'x', }, {
      source: xTrajectorySource,
      line_color: "#43ac6a",
      line_width: 2,
      legend_label: 'Trajectory'
    });

    yPositionPlot.line({ field: 'timestamp' }, { field: 'y' }, {
      source: ySource,
      line_color: "#666699",
      legend_label: 'Estimate',
      line_width: 2
    });

    yPositionPlot.line({ field: 'timestamp' }, { field: 'x', }, {
      source: yTrajectorySource,
      line_color: "#43ac6a",
      line_width: 2,
      legend_label: 'Trajectory'
    });


    var TAU = Math.PI * 2;
    var velocityPlot = new Bokeh.Plotting.figure({
      title: 'Velocity Estimate',
      y_range: new Bokeh.Range1d({ start: -0.5, end: 0.5 }),
      width: initialWidth,
      height: 400,
      background_fill_color: '#F2F2F7',
      tools: tools,
      extra_y_ranges: {
        velocity_theta: new Bokeh.Range1d({ start: TAU * -1, end: TAU }),
      }
    });

    var velocitySource = new Bokeh.ColumnDataSource({
      data: {
        timestamp: [],
        x: [],
        y: [],
        theta: []
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

    velocityPlot.line({ field: 'timestamp' }, { field: 'theta' }, {
      source: velocitySource,
      line_color: velocityScheme[2],
      legend_label: 'velocity_θ',
      line_width: 2,
      y_range_name: 'velocity_theta'
    });

    velocityPlot.add_layout(new Bokeh.LinearAxis({ y_range_name: 'velocity_theta', axis_label: 'velocity_θ (radian/sec)' }), 'left');

    addPlot(positionPlot, positionSource);
    addPlot(xPositionPlot, xSource);
    addPlot(yPositionPlot, ySource);
    addPlot(velocityPlot, velocitySource);

    addPlot(headingPlot, headingSource);
    
    function rad2Deg(rad) {
      return rad * 180 / Math.PI;
    }

    function deg2Rad(deg) {
      return deg * Math.PI / 180;
    }

    function convertAngle(deg) {
      return deg;
    }

    var paramsGui;

    var paramsConstraints = {
      maxVelocity: [0, 1, 0.1, 'meters/sec'],
      maxAcceleration: [0, 1, 0.01, 'meters/sec^2'],
      maxAngularVelocity: [0, 2 * Math.PI, 0.1, 'radians/sec'],
      maxAngularAcceleration: [0, 2 * Math.PI, 0.1, 'radians/sec^2'],
      trackWidth: [0.001, 1, 0.001, 'meters'],
      wheelBase: [0.001, 1, 0.001, 'meters'],
      wheelDiameter: [0.001, 1, 0.001, 'meters'],
      controllerUpdateRate: [10, 100, 1, 'hz'],
      maxXPosition: [0.1, 1, 0.01, 'meters'],
      maxYPosition: [0.1, 1, 0.01, 'meters'],
      linearTolerance: [0.001, 0.1, 0.001, 'meters'],
      angularTolerance: [2.0 * Math.PI / 360, 2.0 * Math.PI / 90, 'radians'],
      xControllerP: [0.1, 10, 0.001],
      xControllerI: [0, 5, 0.001],
      xControllerD: [0, 5, 0.001],
      yControllerP: [0.1, 10, 0.001],
      yControllerI: [0, 5, 0.001],
      yControllerD: [0, 5, 0.001],
      thetaControllerP: [0.1, 10, 0.001],
      thetaControllerI: [0, 5, 0.001],
      thetaControllerD: [0, 5, 0.001],
    };
    remote.getParameters(params => {
      console.log('current params', params);
      if(paramsGui) paramsGui.destory();

      paramsGui = new dat.gui.GUI({ width: 400 });
      paramsGui.domElement.parentElement.style.top = '110px';

      var tuning = paramsGui.addFolder('Controls Tuning');

      Object.keys(params).forEach(key => {
        if(key === 'timestamp') return;

        var c = paramsConstraints[key];

        tuning.add(params, key).min(c[0]).max(c[1]).step(c[2])
          .onFinishChange(() => {
            console.log('value changed!!');

            remote.setParameters(params, setParams => {
              console.log('set new params', setParams);
            });
          });


      });

      tuning.open();

      //debugger;
    });

    remote.subscribe('rover_trajectory_sample', (key, trajectories) => {
      trajectories.forEach(trajectory => {
        trajectorySource.data.timestamp.push(trajectory.time);
        trajectorySource.data.x.push(trajectory.pose.translation.x);
        trajectorySource.data.y.push(trajectory.pose.translation.y);

        var tX = trajectory.pose.translation.x + (0.01 * Math.cos(trajectory.pose.rotation.radians)),
            tY = trajectory.pose.translation.y + (0.01 * Math.sin(trajectory.pose.rotation.radians));
        
        positionPlot.add_layout(
          new Bokeh.Arrow(
          { end: new Bokeh.VeeHead({ size: 10, fill_alpha: 0.5 }), 
            x_start: trajectory.pose.translation.x, 
            y_start: trajectory.pose.translation.y, 
            x_end: tX,
            y_end: tY
          }));
      });

      trajectorySource.change.emit();

      console.log(key, trajectories);
    });

    remote.on('rover_pose', 100, (key, pose) => {
      positionSource.data.timestamp.push(pose.timestamp);
      positionSource.data.x.push(pose.pos[0] * -1);
      positionSource.data.y.push(pose.pos[1] * -1);

      xSource.data.x.push(pose.pos[0] * -1);
      xSource.data.timestamp.push(pose.timestamp);

      ySource.data.y.push(pose.pos[1] * -1);
      ySource.data.timestamp.push(pose.timestamp);

      var euler = qte(pose.rot);
      headingSource.data.theta.push(euler[2]);
      headingSource.data.timestamp.push(pose.timestamp);

      /*headingSource.change.emit();

      positionSource.change.emit();
      xSource.change.emit();
      ySource.change.emit();*/
      
      if(!roverMesh) return;

      headingNumberDegree.innerText = rad2Deg(convertAngle(euler[2])).toFixed(2) + '°';
      headingNumberRadian.innerText = euler[2].toFixed(2);

      roverMesh.rotation.z = euler[2];

      //renderer.render(scene, camera);
    });

    var filter = new LowPassFilter(0.5);
    remote.on('rover_pose_velocity', 100, (key, velocity) => {
      velocitySource.data.timestamp.push(velocity.timestamp);
      velocitySource.data.x.push(velocity.pos[0] * -1);
      velocitySource.data.y.push(velocity.pos[1] * -1);

      velocitySource.data.theta.push(filter.estimate(velocity.theta[2] * -1));

      //velocitySource.change.emit();
    });

    /*remote.on('rover_pose_velocity2', 100, (key, velocity) => {
      velocitySource2.data.timestamp.push(velocity.timestamp);
      velocitySource2.data.x.push(velocity.x);
      velocitySource2.data.y.push(velocity.y);

      velocitySource2.change.emit();
    });*/

    var initialWidth = window.innerWidth * 0.75;
    var batteryPlot = new Bokeh.Plotting.figure({
      title: 'Battery State',
      width: initialWidth,
      height: 400,
      background_fill_color: '#F2F2F7',
      tools: tools,
      output_backend: 'webgl'
    });

    var wheelEncodersPlot = new Bokeh.Plotting.figure({
      title: 'Wheel Encoders',
      width: initialWidth,
      height: 400,
      background_fill_color: '#F2F2F7',
      tools: tools,
      output_backend: 'webgl'
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

        addPlot(batteryPlot, batterySource);
      } else {
        Object.keys(batteryMessage).forEach(key => {
          if(key === 'timestamp') return batterySource.data.timestamp.push(batteryMessage.timestamp);
          batterySource.data[key].push(batteryMessage[key]);

        });

        //batterySource.change.emit();
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

        addPlot(wheelEncodersPlot, wheelEncodersSource);
      } else {
        Object.keys(wheelEncoderMessage).forEach(k => {
          if(k === 'timestamp') return wheelEncodersSource.data.timestamp.push(wheelEncoderMessage.timestamp);
          
          if(k === 'rpm' || k === 'enc') {
            for(var i = 0; i < 4; i++) {
              wheelEncodersSource.data[`${k}_${i}`].push(wheelEncoderMessage[k][i]);
            }
          }
        });

        //wheelEncodersSource.change.emit();

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
        addPlot(wheelVelocityPlot, wheelVelocityOutputSource);
      } else {
        Object.keys(wheelVelocityMessage).forEach(k => {
          if(k === 'timestamp') return wheelVelocityOutputSource.data.timestamp.push(wheelVelocityMessage.timestamp);
          
          if(k === 'velocity') {
            for(var i = 0; i < 4; i++) {
              wheelVelocityOutputSource.data[`${k}_${i}`].push(wheelVelocityMessage[k][i]);
            }
          }
        });

        //wheelVelocityOutputSource.change.emit();
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

      //wheelVelocityCommandSource.change.emit();
    
    });

    
    function update() {
      addedPlots.forEach(plot => {
        if(plot[1] && plot[1]._enableUpdate) plot[1].change.emit();
      });

      renderer.render(scene, camera);

      requestAnimationFrame(update);
    }

    function isElementInViewport (el) {
      var rect = el.getBoundingClientRect();

      return (
          rect.top >= 0 &&
          rect.left >= 0 &&
          rect.bottom <= (window.innerHeight || document.documentElement.clientHeight) && /* or $(window).height() */
          rect.right <= (window.innerWidth || document.documentElement.clientWidth) /* or $(window).width() */
      );
    }

    function enablePlotRender() {
      addedPlots.forEach(plot => {
        if(isElementInViewport(plot[0])) {
          plot[1]._enableUpdate = true;
        } else {
          plot[1]._enableUpdate = false;
        }
      });
    }

    setInterval(() => {
      enablePlotRender();
    }, 1000);

    update();

  });
}

var addedPlots = [];

var container = document.querySelector('main > div.container');
function addPlot(plot, source) {
  var d = document.createElement('div');

  source._enableUpdate = false;
 
  d.innerHTML = template('plot', {});

  Bokeh.Plotting.show(plot, d.querySelector('.plot-container'));

  var el = container.appendChild(d.firstElementChild)
    .querySelector('.plot-container');
  
  addedPlots.push([el, source]);


  //plot.frame_width = rect.width;

  //plot.properties.height.change.emit();
}
