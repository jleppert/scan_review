require('regenerator-runtime/runtime');
var dnode           = require('dnode'),
    path            = require('path'),
    shoe            = require('shoe'),
    reconnect       = require('reconnect/shoe'),
    progressBar     = require('nprogress'),
    notify          = require('toastify-js'),
    template        = require('resig'),
    colorBrewer     = require('colorbrewer'),
    THREE           = require('three'),
    STLLoader       = require('three-stl-loader')(THREE),
    drawHeading     = require('./heading'),
    LowPassFilter   = require('./control/LowPassFilter'),
    dat             = require('dat.gui'),
    L               = require('leaflet'),
    turf            = require('@turf/turf'),
    gi              = require('@thi.ng/grid-iterators'),
    poseIcon        = require('./poseIcon'),
    extend          = require('deep-extend'),
    greinerHormann  = require('greiner-hormann'),
    lineLerp        = require('line-interpolate-points'),
    request         = require('request'),
    Modal           = require('modal-vanilla'),
    
    colorbrewer     = require('colorbrewer'),
    colorLerp       = require('color-interpolate'),
    colorParse      = require('color-parse'),
    smoothstep      = require('smoothstep'),
    ndarray         = require('ndarray'),
    
    qte             = require('quaternion-to-euler');

window.L = L;
require('./L.SimpleGraticule.js');
require('leaflet-rotatedmarker');
require('leaflet-draw');

var BokehNDArray  = Bokeh.require('core/util/ndarray');
var BokehEvents   = Bokeh.require('core/bokeh_events');
var BokehEnums    = Bokeh.require('core/enums');
var BokehTable    = Bokeh.require('models/widgets/tables');

var flip = -1;

const WHEEL_RADIUS = 45;
function rpmToVelocity(rpm) {
  return ((rpm / 60) * (Math.PI * 2) * (WHEEL_RADIUS * 0.001));
}

function velocityToRPM(speed) {
  return ((60 * speed) / ((WHEEL_RADIUS * 0.001 * Math.PI) * 2));
}

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

  var currentRoverPoseMapMarker,
      tools = ['pan', 'crosshair', 'wheel_zoom', 'box_zoom', 'reset', 'save'];
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

    var xRange = new Bokeh.Range1d({ start: dim * -1, end: dim });
    var yRange = new Bokeh.Range1d({ start: dim * -1, end: dim });

    var positionPlot = new Bokeh.Plot({
      title: 'Estimated Position Path & Trajectory Plan',
      x_range: xRange,
      y_range: yRange,
      width: initialWidth,
      height: 500,
      background_fill_color: '#F2F2F7',
      output_backend: 'webgl'
    });

    var lineScanSource = new Bokeh.ColumnDataSource({data: {
      timestamp: [],
      scanId: [],
      dataPath: [],
      fileName: [],
      patternIndex: [],
      lineIndex: [],
      plannedSampleCount: [],
      actualSampleCount: [],
      processStatus: [],
      scanStatus: []
    }});

    var lineScanTable = new BokehTable.DataTable({
      width: initialWidth,
      height: 300,
      source: lineScanSource,
      index_position: null,
      selectable: true,
      columns: ['scanId', 'dataPath', 'fileName', 'patternIndex', 'lineIndex', 'plannedSampleCount', 'actualSampleCount', 'processStatus', 'scanStatus'].map((field) => new BokehTable.TableColumn({title: field, field}))
    });

    var selectedLineSourceIndex;
    lineScanSource.connect(
      lineScanSource.selected.change, () => {
        selectedLineSourceIndex = null;
        if(!lineScanSource.selected.indices.length) return; 
        var idx = lineScanSource.selected.indices[0];

        if(lineScanSource.data.processStatus[idx] === 'complete') {
          lineScanTableContainer.querySelector('.view-scan-button').classList.remove('hide');
          selectedLineSourceIndex = idx;
        } else {
          lineScanTableContainer.querySelector('.view-scan-button').classList.add('hide');
          selectedLineSourceIndex = null;
        }
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


    var xAxis = new Bokeh.LinearAxis({ axis_line_color: null });
    var yAxis = new Bokeh.LinearAxis({ axis_line_color: null });

    positionPlot.add_layout(xAxis, 'below');
    positionPlot.add_layout(yAxis, 'left');

    var xGrid = new Bokeh.Grid({ ticker: xAxis.ticker, dimension: 0 });
    var yGrid = new Bokeh.Grid({ ticker: yAxis.ticker, dimension: 1 });
   
    positionPlot.add_layout(xGrid);
    positionPlot.add_layout(yGrid);

    var positionSource = new Bokeh.ColumnDataSource({
      data: { timestamp: [], x: [], y: [] }
    });

    var radarSampleSource = new Bokeh.ColumnDataSource({
      data: { timestamp: [], x: [], y: [] }
    });

    var trajectorySource = new Bokeh.ColumnDataSource({
      data: { timestamp: [], x: [], y: [] }
    });

    var xSource = new Bokeh.ColumnDataSource({
      data: { timestamp: [], x: [] }
    });

    var ySource = new Bokeh.ColumnDataSource({
      data: { timestamp: [], y: [] }
    });

    var xTrajectorySource = new Bokeh.ColumnDataSource({
      data: { timestamp: [], x: [] }
    });

    var yTrajectorySource = new Bokeh.ColumnDataSource({
      data: { timestamp: [], y: [] }
    });

    var headingTrajectorySource = new Bokeh.ColumnDataSource({
      data: { timestamp: [], theta: [] }
    });

    var velocityTrajectorySource = new Bokeh.ColumnDataSource({
      data: { timestamp: [], x: [], y: [] } //theta: [] }
    });

    const xyLine = new Bokeh.Line({
      x: { field: "x" },
      y: { field: "y" },
      line_color: "#666699",
      line_width: 2
    });

    const radarSamplePoint = new Bokeh.Circle({
      x: { field: "x" },
      y: { field: "y" },
      fill_color: '#000',
    });

    const xyLineTrajectory = new Bokeh.Line({
      x: { field: "x" },
      y: { field: "y" },
      line_color: "#43ac6a",
      line_width: 2
    });

    var xyLineGlyphRenderer = positionPlot.add_glyph(xyLine, positionSource);
    var xyLineTrajectoryGlyphRenderer = positionPlot.add_glyph(xyLineTrajectory, trajectorySource);
    var radarSamplePointGlyphRenderer = positionPlot.add_glyph(radarSamplePoint, radarSampleSource);

    var positionLegend = new Bokeh.Legend({
      items: [
        new Bokeh.LegendItem({ label: { value: 'Estimate' }, renderers: [xyLineGlyphRenderer] }),
        new Bokeh.LegendItem({ label: { value: 'Trajectory' }, renderers: [xyLineTrajectoryGlyphRenderer] }),
        new Bokeh.LegendItem({ label: { value: 'Radar Sample Point' }, renderers: [radarSamplePointGlyphRenderer] })
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

    yPositionPlot.line({ field: 'timestamp' }, { field: 'y', }, {
      source: yTrajectorySource,
      line_color: "#43ac6a",
      line_width: 2,
      legend_label: 'Trajectory'
    });

    headingPlot.line({ field: 'timestamp' }, { field: 'theta' }, {
      source: headingTrajectorySource,
      line_color: "#43ac6a",
      legend_label: 'Trajectory',
      line_width: 2
    });

    var TAU = Math.PI * 2;
    var velocityPlot = new Bokeh.Plotting.figure({
      title: 'Velocity Estimate',
      y_range: new Bokeh.Range1d({ start: -0.5, end: 0.5 }),
      width: 1500,
      height: 400,
      background_fill_color: '#F2F2F7',
      tools: tools,
      extra_y_ranges: {
        velocity_theta: new Bokeh.Range1d({ start: TAU * -1, end: TAU }),
      }
    });

    var accelerationPlot = new Bokeh.Plotting.figure({
      title: 'Acceleration Estimate',
      y_range: new Bokeh.Range1d({ start: -0.5, end: 0.5 }),
      width: initialWidth,
      height: 400,
      background_fill_color: '#F2F2F7',
      tools: tools,
      extra_y_ranges: {
        acceleration_theta: new Bokeh.Range1d({ start: TAU * -1, end: TAU }),
      }
    });

    var velocitySource = new Bokeh.ColumnDataSource({
      data: {
        timestamp: [],
        x: [],
        y: [],
        //theta: []
      }
    });

    var velocityScheme = colorBrewer.Spectral[4];

    var accelerationSource = new Bokeh.ColumnDataSource({
      data: {
        timestamp: [],
        x: [],
        y: [],
        theta: []
      }
    });

    var accelerationScheme = colorBrewer.Spectral[5];

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

    /*velocityPlot.line({ field: 'timestamp' }, { field: 'theta' }, {
      source: velocitySource,
      line_color: velocityScheme[2],
      legend_label: 'velocity_θ',
      line_width: 2,
      y_range_name: 'velocity_theta'
    });*/

    velocityPlot.line({ field: 'timestamp' }, { field: 'x' }, {
      source: velocityTrajectorySource,
      line_color: velocityScheme[3],
      legend_label: 'trajectory_velocity_x',
      line_width: 2
    });

    
    velocityPlot.line({ field: 'timestamp' }, { field: 'y' }, {
      source: velocityTrajectorySource,
      line_color: velocityScheme[4],
      legend_label: 'trajectory_velocity_y',
      line_width: 2
    });

    velocityPlot.add_layout(new Bokeh.LinearAxis({ y_range_name: 'velocity_theta', axis_label: 'velocity_θ (radian/sec)' }), 'left');

    accelerationPlot.line({ field: 'timestamp' }, { field: 'x' }, {
      source: accelerationSource,
      line_color: accelerationScheme[0],
      legend_label: 'accel_x',
      line_width: 2
    });

    accelerationPlot.line({ field: 'timestamp' }, { field: 'y' }, {
      source: accelerationSource,
      line_color: accelerationScheme[1],
      legend_label: 'accel_y',
      line_width: 2
    });

    accelerationPlot.line({ field: 'timestamp' }, { field: 'theta' }, {
      source: accelerationSource,
      line_color: accelerationScheme[2],
      legend_label: 'accel_θ',
      line_width: 2,
      y_range_name: 'acceleration_theta'
    });

    accelerationPlot.add_layout(new Bokeh.LinearAxis({ y_range_name: 'acceleration_theta', axis_label: 'accel_θ (radian/sec)' }), 'left');

    addPlot(positionPlot, [positionSource, radarSampleSource]);
    
    window.lineScanTable = lineScanTable;
    var lineScanTableContainer = addPlot(lineScanTable, [], 'tableTpl');
    lineScanTableContainer.querySelector('.view-scan-button').addEventListener('click', () => {
     
      //var selectedDataPath = '/home/johnathan/4-bg.hdf5';
      var selectedDataPath = path.join(lineScanSource.data.dataPath[selectedLineSourceIndex], lineScanSource.data.fileName[selectedLineSourceIndex]);
      debugger;
      remote.getScanProfile(selectedDataPath, (data, props) => {
         
        var container = document.createElement('div');
        container.innerHTML = template('plotModal', {});
        
        var canvas = document.createElement('canvas');
        canvas.width = props.sampleCount;
        canvas.height = props.profileCount;

        canvas.style.width = canvas.width + 'px';
        canvas.style.height = canvas.height + 'px';

        var ctx = canvas.getContext('2d');
        ctx.imageSmoothingEnabled = false;

        var imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);

        var buf = new ArrayBuffer(imageData.data.length);
        var buf8 = new Uint8ClampedArray(buf);
        var buf32 = new Uint32Array(buf);


          var palette =   ['#000000',
          '#2b2b2b',
          '#555555',
          '#808080',
          '#aaaaaa',
          '#d5d5d5',
          '#ffffff'];


        //var palette = ['#820300', '#dc0a00', '#f95d5e', '#fefdfd', '#5c5cff', '#2100cd', '#08005a'].reverse();

        var colormap = colorLerp(palette, smoothstep);


        for(var p = 0; p < props.profileCount; p++) {

          for(var i = 0; i < props.sampleCount; i++) {

            var c = colorParse(colormap((data.field[p * props.sampleCount + i] - props.vmin) / (props.vmax - props.vmin))).values;

            buf32[p * props.sampleCount + i] =
              (255 << 24) |
              (c[2] << 16) |
              (c[1] << 8) |
              c[0];
          }
        }

        imageData.data.set(buf8)
        ctx.putImageData(imageData, 0, 0);

        var initialWidth = window.innerWidth * 0.75;

        var renderCanvas = document.createElement('canvas');
        renderCanvas.width = initialWidth;
        renderCanvas.height = 800;

        var rCtx = renderCanvas.getContext('2d');
        rCtx.imageSmoothingEnabled = false;

        rCtx.drawImage(canvas, 0, 0, canvas.width, canvas.height, 0, 0, renderCanvas.width, renderCanvas.height);
        rCtx.globalCompositeOperation = 'copy';

        rCtx.setTransform(
          0,  renderCanvas.height / renderCanvas.width,
          -(renderCanvas.width / renderCanvas.height),  0,
          renderCanvas.height * (renderCanvas.width / renderCanvas.height),
          0,
        );

        rCtx.drawImage(renderCanvas, 0, 0);

        // need to flip y axis for bokeh
        rCtx.resetTransform();
        rCtx.scale(1, -1);
        rCtx.drawImage(renderCanvas, 0, renderCanvas.height * -1);

        //container.appendChild(renderCanvas);

        var bScanPlot = new Bokeh.Plotting.figure({
          title: 'B Scan',
          width: initialWidth / 2,
          height: renderCanvas.height,
          background_fill_color: '#F2F2F7',
          tools: tools.filter(t => t !== 'crosshair'),
          x_range: new Bokeh.Range1d({ start: 0, end: props.profileCount * props.xStepSize }),
          y_range: new Bokeh.Range1d({ start: (props.dt - 2) * 0.1, end: (-2 * 0.1) }),
          extra_x_ranges: {
            image: new Bokeh.Range1d({ start: 0, end: renderCanvas.width }),
            profile: new Bokeh.Range1d({ start: 0, end: props.profileCount })
          },
          extra_y_ranges: {
            image: new Bokeh.Range1d({ start: 0, end: renderCanvas.height })
          },
          x_axis_label: 'Profile Distance (meters)',
          y_axis_label: 'Depth (meters)',
          output_backend: 'webgl'
        });

        var aScanPlot = new Bokeh.Plotting.figure({
          title: 'A Scan',
          x_range: new Bokeh.Range1d({ end: (props.dt - 2) * 0.1, start: (-2 * 0.1) }),
          extra_x_ranges: {
            depth: new Bokeh.Range1d({ start: 0, end: props.sampleCount * props.dt }),
          },
          y_range: new Bokeh.Range1d({ start: props.vmin, end: props.vmax }),
          width: initialWidth,
          height: 400,
          background_fill_color: '#F2F2F7',
          tools: tools
        });

        var activeProfileSource = new Bokeh.ColumnDataSource({
          data: { timestamp: [], field: [] }
        });

        aScanPlot.line({ field: 'timestamp' }, { field: 'field', }, {
          source: activeProfileSource,
          line_color: "#43ac6a",
          line_width: 2,
          x_range_name: 'depth'
        });

        var fData = new BokehNDArray.Uint8NDArray(rCtx.getImageData(0, 0, renderCanvas.width, renderCanvas.height).data,
          [renderCanvas.height, renderCanvas.width]);

        bScanPlot.image_rgba({
          image: [fData],
          x: 0,
          y: 0,
          level: 'image',
          dw: renderCanvas.width,
          dh: renderCanvas.height,
          x_range_name: 'image',
          y_range_name: 'image'
        });

        var profileSource = new Bokeh.ColumnDataSource({
          data: {
            x: [...new Array(props.profileCount)].map((v, i) => i + 0.5),
            y: [...new Array(props.profileCount)].map(() => renderCanvas.height),
            color: [...new Array(props.profileCount)].map((v, i) => 'rgba(255, 255, 255, 0.5)'),
          }
        });

        var vbar = bScanPlot.vbar({
          source: profileSource,
          x: { field: 'x' },
          top: { field: 'y' },
          line_width: 0.5,
          x_range_name: 'profile',
          y_range_name: 'image',
          width: 1,
          bottom: 0,
          line_color: 'rgba(0, 0, 0, 0.5)',
          fill_color: { field: 'color' },
          legend_label: 'Show Profile',
          visible: false
        });

        //bScanPlot.add_tools(new Bokeh.HoverTool({ mode: 'vline'}));
        /*bScanPlot.add_tools(
          new Bokeh.CrosshairTool(
            {
              dimensions: 'height',
              line_width: renderCanvas.width / props.profileCount,
              line_color: 'rgba(255, 255, 255, 0.2)'
            }
          )
        );*/

        bScanPlot.js_event_callbacks['mousemove'] = [
          {
            execute: (e) => {
              //var profile = profileSource
              var profileIndex = Math.round((e.x / props.xStepSize) - 0.5);

              console.log('got here', profileIndex);
              profileSource.data.color = profileSource.data.color.map(() => 'rgba(255, 255, 255, 0)');
              if(profileSource.data.x[profileIndex]) {
                profileSource.data.color[profileIndex] = 'rgba(255, 255, 255, 0.5)';

                var startIndex = profileIndex * props.sampleCount,
                    endIndex   = (profileIndex * props.sampleCount) + props.sampleCount;

                activeProfileSource.data.field = data.field.slice(startIndex, endIndex);
                activeProfileSource.data.timestamp = [...new Array(props.sampleCount)].map((v, i) => i * props.dt);
              }

              activeProfileSource.change.emit();
              profileSource.change.emit();
            }
          }
        ];

        bScanPlot.legend.click_policy = 'hide';

        debugger;

        var colorMapper = new Bokeh.LinearColorMapper({ palette: [...new Array(renderCanvas.height)].map((v, i) => {
          return colormap(i / renderCanvas.height);
        }), low: props.vmin, high: props.vmax });
        var colorBar = new Bokeh.ColorBar({ title: 'Field strength (V/m)', color_mapper: colorMapper, label_standoff: 12, title_standoff: 12 });

        bScanPlot.add_layout(colorBar, 'right');

        var bScanEl = document.createElement('div'),
            aScanEl = document.createElement('div');

        Bokeh.Plotting.show(bScanPlot, container.querySelector('.b-scan'));
        Bokeh.Plotting.show(aScanPlot, container.querySelector('.a-scan'));

        var scanModal = new Modal({
          content: container,
          footer: false,
          header: false,
          animate: false
        });

        scanModal.show();

      });
    });

    addPlot(xPositionPlot, [xSource, xTrajectorySource]);
    addPlot(yPositionPlot, [ySource, yTrajectorySource]);
    addPlot(velocityPlot, [velocitySource, velocityTrajectorySource]);

    addPlot(accelerationPlot, accelerationSource);

    addPlot(headingPlot, [headingSource, headingTrajectorySource]);
   
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
      maxVelocity: [0, 4, 0.01, 'meters/sec'],
      maxAcceleration: [0, 3, 0.01, 'meters/sec^2'],
      maxAngularVelocity: [0, 2 * Math.PI, 0.1, 'radians/sec'],
      maxAngularAcceleration: [0, 2 * Math.PI, 0.1, 'radians/sec^2'],
      trackWidth: [0.001, 1, 0.001, 'meters'],
      wheelBase: [0.001, 1, 0.001, 'meters'],
      wheelDiameter: [0.001, 1, 0.001, 'meters'],
      controllerUpdateRate: [10, 100, 1, 'hz'],
      maxXPosition: [0.1, 1, 0.01, 'meters'],
      maxYPosition: [0.1, 1, 0.01, 'meters'],
      linearTolerance: [0.001, 0.1, 0.001, 'meters'],
      angularTolerance: [(2.0 * Math.PI / 360), (2.0 * Math.PI / 90), (2.0 * Math.PI / 360),'radians'],
      poseToleranceX: [0.001, 0.1, 0.001, 'meters'],
      poseToleranceY: [0.001, 0.1, 0.001, 'meters'],
      poseToleranceTheta: [0.009, 0.26, 0.01, 'radians'],
      xControllerP: [0.1, 10, 0.001],
      xControllerI: [0, 5, 0.001],
      xControllerD: [0, 5, 0.001],
      yControllerP: [0.1, 10, 0.001],
      yControllerI: [0, 5, 0.001],
      yControllerD: [0, 5, 0.001],
      thetaControllerP: [0.1, 10, 0.001],
      thetaControllerI: [0, 5, 0.001],
      thetaControllerD: [0, 5, 0.001],
      frontLeftWheelControllerD: [0, 10, 0.001],
      frontLeftWheelControllerI: [0, 10, 0.001],
      frontLeftWheelControllerP: [0, 10, 0.001],
      frontRightWheelControllerD: [0, 10, 0.001],
      frontRightWheelControllerI: [0, 10, 0.001],
      frontRightWheelControllerP: [0, 10, 0.001],
      backLeftWheelControllerD: [0, 10, 0.001],
      backLeftWheelControllerI: [0, 10, 0.001],
      backLeftWheelControllerP: [0, 10, 0.001],
      backRightWheelControllerD: [0, 10, 0.001],
      backRightWheelControllerI: [0, 10, 0.001],
      backRightWheelControllerP: [0, 10, 0.001],
      minWheelVoltage: [-32768, 32768, 1],
      maxWheelVoltage: [-32768, 32768, 1],
      wheelMotorFeedforwardkA: [0, 1000, 0.000001],
      wheelMotorFeedforwardkS: [0, 1000, 0.0001],
      wheelMotorFeedforwardkV: [0, 1000, 0.001]
    };

    var radarParamsConstraints = {
      startFrequency: [23.5, 6000, 1, 'MHz'],
      stepFrequency: [1, 100, 1, 'MHz'],
      frequencyCount: [10, 501, 1],
      intermediateFreq: [1, 50, 1, 'MHz'],
      transmitPower: [-30, 15, 1, 'dbM'],
      loPower: [-30, 15, 1, 'dbM'],
      sampleCount: [1024, 16384, 8],
      channelCount: [2, 2, 1],
      settlingTimeInMicro: [100, 500000, 1, 'microseconds'],
      bufferSampleDelay: [0, 16384, 16, 'bytes'],
      sampleTimeInMicro: [1, 1000, 1, 'microseconds'],
      stepTriggerTimeInMicro: [1, 1000, 1, 'microseconds'],
      synthWarmupTimeInMicro: [1000, 10000000, 100, 'microseconds']
    };

    var scanPlanningParams = {
      selectedPattern: null,
      
      patterns: [],
      createNewPattern: function() {
        scanPlanningParams.selectedPattern = null;
        scanPlanning.onSelectedPattern();
        scanPlanningParams.createOrEdit();
      },

      createOrEdit: function() {
        var d = document.createElement('div');

        d.innerHTML = template('scanPatternModalTpl', {});

        var modal = document.body.appendChild(d.firstElementChild),
            modalBody = modal.querySelector('.modal-body'),
            modalEl = document.getElementById('scanPatternModal');
      
        var trajectory = {
          waypoints: [],
          maxAcceleration: 0.1,
          maxVelocity: 0.05
        };

        var pattern = {
          name: '',
          createdAt: null,
          updatedAt: null,
          trajectory: trajectory,
          geojson: {}
        };

        modalBody.style.width = `${window.innerWidth / 2}px`;
        modalBody.style.height = `${window.innerHeight / 2}px`;

        function closeModal() {
          if(map) map.remove();
          if(modalEl) modalEl.remove();

          map = null;
          currentRoverPoseMapMarker = null;
        }

        modalEl.querySelectorAll('.close-modal').forEach(el => {
          el.addEventListener('click', closeModal);
        });

        var resolutionValue = 5; // in cm
        modalEl.querySelector('#resolutionRange').addEventListener('input', function() {
          resolutionValue = this.value;
          modalEl.querySelector('.resolution-label').innerText = `${resolutionValue} cm`;
          updateScanPattern();
        });

        var sampleResolutionValue = 5; // in cm
        modalEl.querySelector('#sampleResolutionRange').addEventListener('input', function() {
          sampleResolutionValue = this.value;
          modalEl.querySelector('.sample-resolution-label').innerText = `${sampleResolutionValue} cm`;
          updateScanPattern();
        });


        var scanPatternTypeEl = modalEl.querySelector('#patternType');
        debugger;

        var scanPatternTypeOptions = {
          'ZigZag Columns & Rows': ['zigzagRows2d', 'zigzagColumns2d'],
          'ZigZag Columns': ['zigzagColumns2d'],
          'ZigZag Rows': ['zigzagRows2d'],
          'ZigZag Diagonal': ['zigzagDiagonal2d'],
          'Columns': ['columns2d'],
          'Rows': ['rows2d'],
          'Interleave Columns': ['interleaveColumns2d'],
          'Interleave Rows': ['interleaveRows2d'],
          'Outward Spiral': ['spiral2d'],
          'Hilbert': ['hilbert2d']
        };

        var scanPatternTypeOrder = {
          'zigzagRows2d': 1,
          'zigzagColumns2d': 0,
          'columns2d': -1,
          'rows2d': -1,
          'interleaveColumns2d': -1,
          'interleaveRows2d': -1,
          'spiral2d': -1,
          'hilbert2d': -1
        };

        Object.keys(scanPatternTypeOptions).forEach(key => {
          var optionEl = document.createElement('option');
          optionEl.innerText = key;
          optionEl.value = encodeURIComponent(JSON.stringify(scanPatternTypeOptions[key]));

          scanPatternTypeEl.appendChild(optionEl);
        });



        var scanPatternType = JSON.parse(decodeURIComponent(scanPatternTypeEl.options[scanPatternTypeEl.selectedIndex].value));
        scanPatternTypeEl.addEventListener('input', function(e) {
          scanPatternType = JSON.parse(decodeURIComponent(e.target.options[e.target.selectedIndex].value));
          debugger;
          updateScanPattern();
        });

        modalEl.querySelector('#savePattern').addEventListener('click', () => {
          var name = modalEl.querySelector('#patternName').value;

          if(!name.length) {
            alert('Scan pattern name is required');
            return;
          }
          
          if(pattern.createdAt) {
            pattern.updatedAt = (new Date).getTime();
          } else {
            pattern.createdAt = (new Date).getTime();
            pattern.updatedAt = (new Date).getTime();
          }

          pattern.name = name;

          var i = scanPlanningParams.patterns.findIndex(p => p.name === name);
          if(i === -1) {
            scanPlanningParams.patterns.unshift(pattern);
          } else {
            scanPlanningParams.patterns[i] = pattern;
          }

          debugger;

          remote.set('rover_scan_patterns', JSON.stringify(scanPlanningParams.patterns), () => {
            debugger;
            scanPlanningParams.selectedPattern = pattern.name;
            initScanPatternUI();
          });
        });

        var map = L.map(
          modalBody,
          {
            center: [0, 0],
            zoom: 10,
            crs: L.Util.extend(L.CRS.Simple, {
	            //transformation: new L.Transformation(-1,0,-1,0)
            }) 
          });

        var editableLayers;
        if(scanPlanningParams.selectedPattern) {
          var selectedPattern = scanPlanningParams.patterns.find(p => p.name === scanPlanningParams.selectedPattern);

          if(selectedPattern) editableLayers = L.geoJSON(selectedPattern.scanPatterngeojson);
          modalEl.querySelector('#patternName').value = selectedPattern.name;
        } else {
          editableLayers = new L.FeatureGroup();
        }

        var roverPoseMarker = L.divIcon({
          html: poseIcon,
          className: 'rover-pose-map-icon',
          iconSize: [40, 48],
          iconAnchor: [40, 48/2]
        });

        currentRoverPoseMapMarker = L.marker([0, 0], { 
          icon: roverPoseMarker,
          rotationOrigin: 'center center',
          rotationAngle: 45
        }).addTo(map);
        window.currentRoverPoseMarker = currentRoverPoseMapMarker;

        map.addLayer(editableLayers);

        L.drawLocal = extend(L.drawLocal, {
          draw: {
            toolbar: {
              buttons: {
                polyline: 'Draw a line scan',
                polygon: 'Draw a polygon scan area',
                rectangle: 'Draw a rectangular scan area'
              }
            },
            handlers: {
              polygon: {
                tooltip: {
                  start: 'Click to start drawing scan area',
                  cont: 'Click to continue drawing scan area',
                  end: 'Click first point to close scan area'
                }
              },
              polyline: {
                error: '<strong>Error:</strong> shape edges cannot cross!',
                tooltip: {
                  start: 'Click to start drawing line scan',
                  cont: 'Click to continue drawing line scan',
                  end: 'Click last point to finish line scan'
                }
              },
              rectangle: {
                tooltip: {
                  start: 'Click and drag to draw scan area'
                }
              },
            }
          }
        });

        var _readableArea = L.GeometryUtil.readableArea;
        L.GeometryUtil = L.extend(L.GeometryUtil, {
          geodesicArea: function(latLngs) {
            var X = latLngs.map(l => l.lng),
                Y = latLngs.map(l => l.lat),
                numPoints = latLngs.length;

            var area = 0;
            var j = numPoints - 1;

            for (var i = 0; i < numPoints; i++) { 
              area = area + (X[j]+X[i]) * (Y[j]-Y[i]);
              j = i;
            }
  
            return (area / 2);
          },
          readableArea: function(area, isMetric, precision) {
            return _readableArea(area, isMetric, {
              m: 2,
              yd: 2,
              ft: 1
             });
          }
        });

        var drawControl = new L.Control.Draw({
          position: 'topright',
          draw: {
            toolbar: {
              buttons: {
                polyline: 'Draw a line scan area',
                polygon: 'Draw a polygon scan area',
                rectangle: 'Draw a rectangular scan area'
              }
            },
            polygon: {
              metric: true,
              showArea: true,
              allowIntersection: false,
              drawError: {
                color: '#e1e100',
                message: 'Invalid shape'
              },
              shapeOptions: {
                color: '#bada55'
              }
            },
            rectangle: {
              metric: true,
              showArea: true,
              shapeOptions: {
                clickable: false
              }
            },
            polyline: {
              metric: true,
              showLength: true,
              shapeOptions: {
                color: '#f357a1',
                weight: 10
              }
            },
            circle: false,
            marker: false,
            circlemarker: false,
          },
          edit: {
            featureGroup: editableLayers,
            remove: true
          }
        });

        map.addControl(drawControl);
       
        var scanBoundsLayer;
        var scanLayer = L.polyline([], { color: 'red' });
        var radarSampleLayer = L.layerGroup();
        
        radarSampleLayer.addTo(map);
        scanLayer.addTo(map);

        window.radarSampleLayer = radarSampleLayer;

        function getLinearDistance(points) {
          var distance = 0;
          
          points.forEach((pt, i) => {
            if(i === (points.length - 1)) return;
            var a = pt, b = points[i + 1];

            distance += Math.sqrt(
              Math.pow(
                Math.abs(a[0] - b[0]), 
              2) + 
              Math.pow(
                Math.abs(a[1] - b[1]),
              2)
            ); 
          });

          return distance;
        }

        function updateScanPattern() {
          var layer = scanBoundsLayer;
          if(!layer) return;

          var extent = layer.getBounds().toBBoxString().split(',');

          var minY = parseFloat(extent[1]),
              minX = parseFloat(extent[0]),
              maxY = parseFloat(extent[3]),
              maxX = parseFloat(extent[2]);

          var xSize = Math.abs(maxX - minX),
              ySize = Math.abs(maxY - minY),
              stepSize = resolutionValue * 0.01,
              stepInX = xSize / stepSize,
              stepInY = ySize / stepSize;
          
          radarSampleLayer.clearLayers();

          var patternPoints = [];
          var patternSamplePoints = [];

          pattern.trajectory.samplePoints = [];

          scanPatternType.forEach(patternType => {
            var points = [];

            Array.from(gi[patternType](Math.floor(stepInX) + 1, Math.floor(stepInY) + 1)).forEach((point, i) => {
              
              points.push(
                [
                  minX + ((point[0] / stepInX) * xSize),
                  minY + ((point[1] / stepInY) * ySize)
                ]
              );
            });

            var minPoint = 
              [
                Math.min.apply(Math, points.map(pt => pt[0])),
                Math.min.apply(Math, points.map(pt => pt[1]))
              ],
              maxPoint = 
              [
                Math.max.apply(Math, points.map(pt => pt[0])),
                Math.max.apply(Math, points.map(pt => pt[1]))
              ];

            var patternSize = [
              maxPoint[0] - minPoint[0],
              maxPoint[1] - minPoint[1]
            ];

            var patternBoxDelta = [
              xSize - patternSize[0],
              ySize - patternSize[1]
            ];

            points = points.map(pt => [pt[0] + (patternBoxDelta[0] / 2), pt[1] + (patternBoxDelta[1] / 2)]);

            function filterPoints(points, stride = 0) {
              if(stride === -1) return [points];

              var lineSegments = [];

              points.forEach((pt, i) => {
                if(i === 0) return lineSegments.push([pt]);

                var lastPt = points[i - 1];

                if((Math.abs(lastPt[0] - pt[0]) > 0) && stride === 0) return lineSegments.push([pt]);
                if((Math.abs(lastPt[1] - pt[1]) > 0) && stride === 1) return lineSegments.push([pt]);
                
                lineSegments[lineSegments.length - 1].push(pt);
              });

              return lineSegments;
            }

            var lineSegments = filterPoints(points, scanPatternTypeOrder[patternType]);
            
            lineSegments.forEach(pts => {
              var distance = getLinearDistance(pts);
            
              var linearSampleRate = sampleResolutionValue * 0.01;
              console.log(pts, distance / linearSampleRate, 0, linearSampleRate);
              var samplePoints = lineLerp(pts, Math.ceil(distance / linearSampleRate), 0, linearSampleRate);
           
              patternSamplePoints.push([samplePoints]); 
              samplePoints.forEach(point => {
                radarSampleLayer.addLayer(L.circleMarker([point[1], point[0]], {
                  radius: 2
                }));
              });
            });

            //patternSamplePoints.push(lineSegments);
            patternPoints = patternPoints.concat(points);
          });

          scanLayer.setLatLngs(patternPoints.map(p => [p[1], p[0]]));

          if(type === 'polygon') {
            // TODO: joins, hole support
            
            const clone = (items) => items.map(item => Array.isArray(item) ? clone(item) : item);

            scanLayer.setLatLngs(greinerHormann.intersection(
              scanLayer.getLatLngs().map(l => [l.lng, l.lat]),
              clone(layer.getLatLngs()).pop().map(l => [l.lng, l.lat])
            ).map(s => {
              return s.map(p => [p[1], p[0]]);
            }));
          }

          pattern.trajectory.waypoints = scanLayer.getLatLngs().flat().map(l => { 
            return {
              rotation: { radians: 0 },
              translation: { x: l.lng, y: l.lat }
            };
          });

          pattern.trajectory.samplePoints.push(patternSamplePoints);

          console.log(pattern);
          
          scanLayer.addTo(map);
        }

        map.on(L.Draw.Event.CREATED, function (e) {
          var type = e.layerType,
              layer = e.layer;

          if (type === 'polyline') {
            layer.getLatLngs().forEach(point => {
              pattern.trajectory.waypoints.push({
                rotation: { radians: 0 },
                translation: { x: point.lng, y: point.lat }
              });
            });

            getDistance(layer.getLatLngs().map(point => [point.lng, point.lat]));

            pattern.scanPatterngeojson = layer.toGeoJSON();
          } else if(type === 'rectangle' || type === 'polygon') {
            scanBoundsLayer = layer;
            layer.layerType = type;
            updateScanPattern();
            
            pattern.scanPatterngeojson = scanLayer.toGeoJSON();

          }
          
          pattern.scanBoundsgeojson = layer.toGeoJSON();
          editableLayers.addLayer(layer);

          //remote.publish('rover_trajectory', JSON.stringify(trajectory));
        });

        map.on(L.Draw.Event.EDITED, function(e) {
          pattern.trajectory.waypoints = [];

          e.layers.eachLayer((layer) => {
            var type = layer.layerType;

            if (type === 'polyline') {
              layer.getLatLngs().forEach(point => {
                pattern.trajectory.waypoints.push({
                  rotation: { radians: 0 },
                  translation: { x: point.lng, y: point.lat }
                });
              });
            } else if(type === 'rectangle' || type === 'polygon') {
              scanBoundsLayer = layer;
              updateScanPattern(); 
            }
            
            pattern.scanBoundsgeojson = layer.toGeoJSON();
            pattern.scanPatterngeojson = scanLayer.toGeoJSON();
          });

        });
        
        //L.marker([-10,-10]).addTo(map).bindPopup('y=0.1,x=0.1', {autoClose:false}).openPopup();
        L.Control.Scale.include({
          _updateMetric: function(maxMeters) {
            var maxMilliMeters = maxMeters * 1000,
                milliMeters = this._getRoundNum(maxMilliMeters);

            var label;
            if(milliMeters > 1000) {
              label = `${milliMeters / 1000} m`;
            } else if(milliMeters < 1000 && milliMeters >= 100) {
              label = `${milliMeters / 10} cm`;
            } else {
              label = `${milliMeters} mm`;
            }

            this._updateScale(this._mScale, label, milliMeters / maxMilliMeters);
          }
        });

        L.control.scale({
          position: 'bottomright',
          metric: true,
          imperial: false
        }).addTo(map);

        window.map = map;

        var southWest = L.CRS.Simple.unproject({x: -1, y: -1});
        var northEast = L.CRS.Simple.unproject({x: 1, y: 1});
        var bounds = new L.LatLngBounds(southWest, northEast); 

        map.setMaxBounds(bounds);
        //map.fitBounds(bounds);
        
        map.fitBounds([
          [-0.4, -0.4],
          [0.4, 0.4]
        ]);

        L.simpleGraticule({ 
          interval: 0.2,
          showOriginLabel: true, redraw: 'move' }).addTo(map);
      },
      generateTrajectory: function() {
        if(scanPlanningParams.selectedPattern) {
          var selectedPattern = scanPlanningParams.patterns.find(p => p.name === scanPlanningParams.selectedPattern);
          
          /*selectedPattern.trajectory.waypoints = lineLerp(selectedPattern.trajectory.waypoints.map(p => [p.translation.x, p.translation.y]), 
            selectedPattern.trajectory.waypoints.length * 4
          ).map(p => { return { rotation: { radians: 0 }, translation: { x: p[0], y: p[1] } }; });*/
          
          remote.publish('rover_trajectory', JSON.stringify(selectedPattern.trajectory));

          //debugger;
        }


      },
      run: function() {
        remote.publish('rover_command', JSON.stringify({ command: 'RUN_ACTIVE_TRAJECTORY' }));
      }
    };
    
    var roverParams = {}; 
    remote.getParameters(params => {
      console.log('current params', params);
      roverParams = params;
      if(paramsGui) paramsGui.destory();

      paramsGui = new dat.gui.GUI({ width: 400 });
      paramsGui.domElement.parentElement.style.top = '110px';

      var tuning = paramsGui.addFolder('Controls Tuning');

      Object.keys(params).forEach(key => {
        if(key === 'timestamp') return;

        var c = paramsConstraints[key];
        
        params[key] = params[key] || 0;

        tuning.add(params, key).min(c[0]).max(c[1]).step(c[2])
          .onFinishChange(() => {
            console.log('value changed!!');

            remote.setParameters(params, 'rover_parameters', (setParams) => {
              console.log('set new params', setParams);
            });
          });
      });

      tuning.open();

      remote.getRadarParameters(radarParams => {
        var radar = paramsGui.addFolder('Radar Parameters');

        Object.keys(radarParams).forEach(key => {
          if(key === 'timestamp') return;

          var c = radarParamsConstraints[key];

          radarParams[key] = radarParams[key] || 0;

          radar.add(radarParams, key).min(c[0]).max(c[1]).step(c[2])
            .onFinishChange(() => {
              
              remote.setParameters(radarParams, 'radar_parameters', (setRadarParams) => {
                console.log('set new radar params', setRadarParams);

                remote.restartRadarProcess((err, result) => {
                  console.log('restarted radar process', err, result);
                });
              });
            });
        });

        radar.open();
      });

      initScanPatternUI();
    });

    var scanPlanning;
    function initScanPatternUI() {
      remote.get('rover_scan_patterns', (patterns) => {
        if(scanPlanning) paramsGui.removeFolder(scanPlanning);

        scanPlanning = paramsGui.addFolder('Scan Pattern');
        scanPlanning.add(scanPlanningParams, 'createNewPattern').name('Create New Pattern');
        
        var selectedPatternName;
        if(patterns) {
          try {
            patterns = JSON.parse(patterns);
          } catch(e) {
            console.log('Exception parsing rover_scan_patterns', e.toString());
          }

          patterns = patterns.sort((a, b) => {
            return b.createdAt - a.createdAt;
          });

          scanPlanningParams.patterns = patterns || [];
          selectedPatternName = scanPlanning.add(scanPlanningParams, 'selectedPattern', patterns.map(p => p.name)).name('Selected Pattern')
            .onFinishChange(() => {
              scanPlanning.onSelectedPattern();
            });
        }

        patterns = patterns || [];

        var createOrEdit, generateTrajectory, runPattern;
        scanPlanning.onSelectedPattern = function() {
          if(createOrEdit) {
            createOrEdit.remove();
            createOrEdit = null;
          }
          if(generateTrajectory) {
             generateTrajectory.remove();
             generateTrajectory = null;
          }
          if(runPattern) {
            runPattern.remove();
            runPattern = null;
          }
          
          var selectedPattern;
          if(selectedPattern = patterns.find(p => p.name === scanPlanningParams.selectedPattern)) {
            var patternParams = {
              maxVelocity: selectedPattern.trajectory.maxVelocity || roverParams.maxVelocity,
              maxAcceleration: selectedPattern.trajectory.maxAcceleration || roverParams.maxAcceleration
            };
            
            
            scanPlanning.add(patternParams, 'maxVelocity').min(paramsConstraints.maxVelocity[0]).max(paramsConstraints.maxVelocity[1]).step(paramsConstraints.maxVelocity[2]).onFinishChange(() => {
              selectedPattern.trajectory.maxVelocity = patternParams.maxVelocity;
              remote.set('rover_scan_patterns', JSON.stringify(patterns), () => { });
            });
            scanPlanning.add(patternParams, 'maxAcceleration').min(paramsConstraints.maxAcceleration[0]).max(paramsConstraints.maxAcceleration[1]).step(paramsConstraints.maxAcceleration[2]).onFinishChange(() => {
              selectedPattern.trajectory.maxAcceleration = patternParams.maxAcceleration;
              remote.set('rover_scan_patterns', JSON.stringify(patterns), () => { });
            });

             
            createOrEdit = scanPlanning.add(scanPlanningParams, 'createOrEdit').name('Edit Pattern');
            generateTrajectory = scanPlanning.add(scanPlanningParams, 'generateTrajectory').name('Generate Trajectory Path');
            runPattern = scanPlanning.add(scanPlanningParams, 'run').name('Run Pattern');
          }

          selectedPatternName.updateDisplay();
        }
        scanPlanning.onSelectedPattern();

        scanPlanning.open();
      });
    }

    remote.subscribe('rover_trajectory_profile', (key, trajectories) => {
      trajectories.forEach(trajectory => {

        //console.log('traj!!!', trajectory);

        trajectorySource.data.timestamp.push(trajectory.time);
        trajectorySource.data.x.push(trajectory.pose.translation.x);
        trajectorySource.data.y.push(trajectory.pose.translation.y);

        return;

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

    remote.subscribe('rover_trajectory_sample', (key, sample) => {
      var x = sample.trajectory.pose.translation.x;
      var y = sample.trajectory.pose.translation.y;

      xTrajectorySource.data.timestamp.push(sample.timestamp);
      xTrajectorySource.data.x.push(x);

      yTrajectorySource.data.timestamp.push(sample.timestamp);
      yTrajectorySource.data.y.push(y);

      //headingTrajectorySource.data.timestamp.push(sample.timestamp);
      //headingTrajectorySource.data.theta.push(sample.trajectory.pose.rotation.radians);

      var magnitude = Math.hypot(x, y);

      var mSin = 0.0;
      var mCos = 1.0;

      if(magnitude > 1e-6) {
        mCos = x / magnitude;
        mSin = y / magnitude;
      }
      
      /*velocityTrajectorySource.data.timestamp.push(sample.timestamp);
      velocityTrajectorySource.data.x.push(sample.trajectory.velocity * mCos * flip);
      velocityTrajectorySource.data.y.push(sample.trajectory.velocity * mSin * flip);*/
    });

    var currentPoseArrow;
    remote.on('rover_pose', 100, (key, pose) => {
      positionSource.data.timestamp.push(pose.timestamp);
      positionSource.data.x.push(pose.pos[0] * flip);
      positionSource.data.y.push(pose.pos[1] * flip);

      xSource.data.x.push(pose.pos[0] * flip);
      xSource.data.timestamp.push(pose.timestamp);

      ySource.data.y.push(pose.pos[1] * flip);
      ySource.data.timestamp.push(pose.timestamp);

      var euler = qte(pose.rot);
      headingSource.data.theta.push(euler[2]);
      headingSource.data.timestamp.push(pose.timestamp);

      if(!currentPoseArrow) {
        currentPoseArrow = new Bokeh.Arrow(
          { end: new Bokeh.VeeHead({ fill_color: '#f9e816', size: 20, fill_alpha: 0.4 }), 
              x_start: 0,
              y_start: 0,
              x_end: 0,
              y_end: 0
        });

        window.currentPoseArrow = currentPoseArrow;

        positionPlot.add_layout(currentPoseArrow);

      } else {
        currentPoseArrow.properties.x_start.set_value(pose.pos[0] * flip);
        currentPoseArrow.properties.y_start.set_value(pose.pos[1] * flip);
  
        currentPoseArrow.properties.x_end.set_value(((Math.cos(euler[2] + Math.PI) * 0.0001) +  pose.pos[0]) * flip );
        currentPoseArrow.properties.y_end.set_value(((Math.sin(euler[2] + Math.PI) * 0.0001) +  pose.pos[1]) * flip );

        currentPoseArrow.change.emit();
      }

      headingNumberDegree.innerText = rad2Deg(convertAngle(euler[2])).toFixed(2) + '°';
      headingNumberRadian.innerText = euler[2].toFixed(2) + 'r';

      if(!roverMesh) return;
      roverMesh.rotation.z = euler[2];

      if(currentRoverPoseMapMarker) {
        currentRoverPoseMapMarker.setLatLng([pose.pos[1] * flip, pose.pos[0] * flip]);
        currentRoverPoseMapMarker.setRotationAngle(rad2Deg((Math.PI / 2) - euler[2]));
      }

    });

    remote.subscribe('radar_sample_point', (key, samplePoint) => {
      radarSampleSource.data.timestamp.push(samplePoint.timestamp);
      radarSampleSource.data.x.push(samplePoint.pos[0] * flip);
      radarSampleSource.data.y.push(samplePoint.pos[1] * flip);
    }, true);

    var lastTimestamp = 0;
    var filter = new LowPassFilter(0.5), lastVelocity;
    remote.on('rover_pose_velocity', 100, (key, velocity) => {
      if(!lastVelocity) lastVelocity = velocity;

      /*velocitySource.data.timestamp.push(lastTimestamp);
      velocitySource.data.x.push(velocity.pos[0] * flip);

      velocitySource.data.y.push(velocity.pos[1] * flip);

      velocitySource.data.theta.push(filter.estimate(velocity.theta[2]));*/

      var dt = velocity.timestamp - lastVelocity.timestamp;

      if(dt > 0) {
        accelerationSource.data.timestamp.push(velocity.timestamp);
        accelerationSource.data.x.push(((velocity.pos[0] - lastVelocity.pos[0]) / dt));
        accelerationSource.data.y.push(((velocity.pos[1] - lastVelocity.pos[1]) / dt));
        accelerationSource.data.theta.push(((filter.estimate(velocity.theta[2]) - filter.estimate(lastVelocity.theta[2])) / dt));
      }

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

    var frontLeftWheelPlot = new Bokeh.Plotting.figure({
      title: 'Front Left Wheel',
      width: initialWidth,
      height: 400,
      background_fill_color: '#F2F2F7',
      tools: tools,
      //output_backend: 'webgl'
    });

    var frontRightWheelPlot = new Bokeh.Plotting.figure({
      title: 'Front Right Wheel',
      width: initialWidth,
      height: 400,
      background_fill_color: '#F2F2F7',
      tools: tools,
      //output_backend: 'webgl'
    });

    var backLeftWheelPlot = new Bokeh.Plotting.figure({
      title: 'Back Left Wheel',
      width: initialWidth,
      height: 400,
      background_fill_color: '#F2F2F7',
      tools: tools,
      //output_backend: 'webgl'
    });

    var backRightWheelPlot = new Bokeh.Plotting.figure({
      title: 'Back Right Wheel',
      width: initialWidth,
      height: 400,
      background_fill_color: '#F2F2F7',
      tools: tools,
      //output_backend: 'webgl'
    });

    var scheme = colorBrewer.Spectral;

    function wheelStatusYRangeMapping() {

      return {
        //angle: new Bokeh.Range1d({ start: 0, end: 8191 }),
        velocity: new Bokeh.Range1d({ start: -1, end: 1 }),
        velocityTarget: new Bokeh.Range1d({ start: -1, end: 1 }),
        output: new Bokeh.Range1d({ start: -1, end: 1 }),
        voltage: new Bokeh.Range1d({ start: -30000, end: 30000 }),
        //torque: new Bokeh.Range1d({ start: -100, end: 100 }),
        //temperature: new Bokeh.Range1d({ start: 0, end: 100 }),
      };
    }

    frontLeftWheelPlot.extra_y_ranges  = wheelStatusYRangeMapping();
    frontRightWheelPlot.extra_y_ranges = wheelStatusYRangeMapping();
    backLeftWheelPlot.extra_y_ranges   = wheelStatusYRangeMapping();
    backRightWheelPlot.extra_y_ranges  = wheelStatusYRangeMapping();

    var frontLeftWheelStatus = new Bokeh.ColumnDataSource({
      data: {
        timestamp: [],
        velocity: [],
      }
    });

    var frontRightWheelStatus = new Bokeh.ColumnDataSource({
      data: {
        timestamp: [],
        velocity: [],
      }
    });

    var backLeftWheelStatus = new Bokeh.ColumnDataSource({
      data: {
        timestamp: [],
        velocity: [],
      }
    });
   
    var backRightWheelStatus = new Bokeh.ColumnDataSource({
      data: {
        timestamp: [],
        velocity: [],
      }
    });

    var frontLeftWheelState = new Bokeh.ColumnDataSource({
      data: {
        timestamp: [],
        velocityTarget: [],
        output: [],
      }
    });

    var frontRightWheelState = new Bokeh.ColumnDataSource({
      data: {
        timestamp: [],
        velocityTarget: [],
        output: []
      }
    });

    var backLeftWheelState = new Bokeh.ColumnDataSource({
      data: {
        timestamp: [],
        velocityTarget: [],
        output: []
      }
    });
   
    var backRightWheelState = new Bokeh.ColumnDataSource({
      data: {
        timestamp: [],
        velocityTarget: [],
        output: []
      }
    });

    var frontLeftWheelVoltage = new Bokeh.ColumnDataSource({
      data: {
        timestamp: [],
        voltage: []
      }
    });

    var frontRightWheelVoltage = new Bokeh.ColumnDataSource({
      data: {
        timestamp: [],
        voltage: []
      }
    });

    var backLeftWheelVoltage = new Bokeh.ColumnDataSource({
      data: {
        timestamp: [],
        voltage: []
      }
    });
   
    var backRightWheelVoltage = new Bokeh.ColumnDataSource({
      data: {
        timestamp: [],
        voltage: []
      }
    });

    // error

    var wheelPlots = [
      [frontLeftWheelPlot, [frontLeftWheelStatus, frontLeftWheelState, frontLeftWheelVoltage]],
      [frontRightWheelPlot, [frontRightWheelStatus, frontRightWheelState, frontRightWheelVoltage]],
      [backLeftWheelPlot, [backLeftWheelStatus, backLeftWheelState, backLeftWheelVoltage]],
      [backRightWheelPlot, [backRightWheelStatus, backRightWheelState, backRightWheelVoltage]]
    ];
    
    var wheelStatusScheme = colorBrewer.Spectral[5];
    var wheelStateScheme = colorBrewer.Spectral[5];


      wheelPlots.forEach(wheelPlot => {
        wheelPlot[0].add_layout(new Bokeh.LinearAxis({ y_range_name: 'velocity', axis_label: 'velocity' }), 'left');
        
        wheelPlot[0].line({ field: 'timestamp' }, { field: 'velocity' }, {
          source: wheelPlot[1][0],
          line_color: wheelStatusScheme[0],
          line_width: 2,
          legend_label: 'velocity',
          y_range_name: 'velocity'
        });

        wheelPlot[0].add_layout(new Bokeh.LinearAxis({ y_range_name: 'velocityTarget', axis_label: 'velocityTarget' }), 'left');
        
        wheelPlot[0].line({ field: 'timestamp' }, { field: 'velocityTarget' }, {
          source: wheelPlot[1][1],
          line_color: wheelStateScheme[2],
          line_width: 2,
          legend_label: 'velocityTarget',
          y_range_name: 'velocityTarget'
        });

        wheelPlot[0].add_layout(new Bokeh.LinearAxis({ y_range_name: 'output', axis_label: 'output' }), 'left');
        
        wheelPlot[0].line({ field: 'timestamp' }, { field: 'output' }, {
          source: wheelPlot[1][1],
          line_color: wheelStateScheme[4],
          line_width: 2,
          legend_label: 'output',
          y_range_name: 'output'
        });


        wheelPlot[0].add_layout(new Bokeh.LinearAxis({ y_range_name: 'voltage', axis_label: 'voltage' }), 'left');
        
        wheelPlot[0].line({ field: 'timestamp' }, { field: 'voltage' }, {
          source: wheelPlot[1][2],
          line_color: wheelStateScheme[3],
          line_width: 2,
          legend_label: 'voltage',
          y_range_name: 'voltage'
        });


      });

    wheelPlots.forEach((wheelPlot, i) => {
      addPlot(wheelPlot[0], wheelPlot[1]);
    });

    remote.on('rover_wheel_status', 100, (key, wheelStatusMessage) => {
      //console.log(wheelStatusMessage);
      Object.keys(wheelStatusMessage).forEach(k => {
        if(k === 'timestamp') {
          wheelPlots.forEach(wheelPlot => {
            wheelPlot[1][0].data.timestamp.push(wheelStatusMessage.timestamp);
          });

          return;
        }
        
        if(k === 'angle*' || k === 'velocity' || k === 'torque*' || k === 'temperature*') {
          // wheel data is
          // 3 - back left
          // 2 - front left
          // 0 - back right
          // 1 - front right

          backRightWheelStatus.data[k].push(rpmToVelocity(wheelStatusMessage[k][0]));
          frontRightWheelStatus.data[k].push(rpmToVelocity(wheelStatusMessage[k][1]));
          frontLeftWheelStatus.data[k].push(rpmToVelocity(wheelStatusMessage[k][2]));
          backLeftWheelStatus.data[k].push(rpmToVelocity(wheelStatusMessage[k][3]));
        }
      });
    });

    /*remote.on('rover_wheel_voltage_output', 50, (key, message) => {
      backRightWheelVoltage.data.timestamp.push(message.timestamp);
      frontRightWheelVoltage.data.timestamp.push(message.timestamp);
      frontLeftWheelVoltage.data.timestamp.push(message.timestamp);
      backLeftWheelVoltage.data.timestamp.push(message.timestamp);

      console.log('voltage', message);
  // 0 - back right
    // 1 - front right
    // 2 - front left
    // 3 - back left 

      backRightWheelVoltage.data.voltage.push(message.voltage[0]);
      frontRightWheelVoltage.data.voltage.push(message.voltage[1]);
      frontLeftWheelVoltage.data.voltage.push(message.voltage[2]);
      backLeftWheelVoltage.data.voltage.push(message.voltage[3]);
    });*/

    /*
frontLeftMotorOutput,
    frontRightMotorOutput,
    backLeftMotorOutput,
    backRightMotorOutput





    */
    
    var dataPollingIntervalId = 0;

    const regex = /(\d)+-bg.hdf5/gm; 

    function parseFileName(str) {
      let m;

      var parsed = {
        valid: false,
        patternIndex: 0,
        lineIndex: 0,
        filename: ''
      };

      while ((m = regex.exec(str)) !== null) {
        if (m.index === regex.lastIndex) {
          regex.lastIndex++;
        }

        m.forEach((match, groupIndex) => {
          if(groupIndex === 1) {
            parsed.valid = true;
            parsed.lineIndex = parseInt(match);
            parsed.filename = str; 
          }
        });
      }

      return parsed;
    }


    function updateLineProcessStatus(scanId) {
      remote.getLineProcessStatus(scanId, (err, status = []) => {
        if(err) return console.log(err);

        status.forEach(file => {
          var parsed = parseFileName(file.name);

          if(parsed.valid) {
            lineScanSource.data.scanId.forEach((scanId, idIndex) => {
              if(scanId === scanId) {
                lineScanSource.data.processStatus = lineScanSource.data.processStatus.map((v, pIndex) => {
                  if(pIndex == idIndex && lineScanSource.data.lineIndex[idIndex] === parsed.lineIndex) {
                    lineScanSource.data.fileName[idIndex] = file.name;
                    
                    return 'complete';
                  }
                  return v;
                });
              }
            });
          }
        });

        lineScanSource.selected.indices = lineScanSource.selected.indices;
        lineScanSource.change.emit();


        console.log('updated line process status!', status);
      });
    }

    window.lineScanSource = lineScanSource;

    remote.subscribe('radar_process_line', (key, message) => {
      if(!message.scanComplete) {
        remote.getDataProcessingStatus((err, status) => {
          if(err) return console.log(err);
          
          if(!dataPollingIntervalId) {
            dataPollingIntervalId = setInterval(() => {
              updateLineProcessStatus(status.start_time);
            }, 1000);
          }

          lineScanSource.data.scanId.push(status.start_time);
          lineScanSource.data.dataPath.push(status.image_dir);
          lineScanSource.data.timestamp.push(message.timestamp);
          lineScanSource.data.patternIndex.push(message.patternIndex);
          lineScanSource.data.lineIndex.push(message.lineIndex);
          lineScanSource.data.plannedSampleCount.push(message.plannedSamples);
          lineScanSource.data.actualSampleCount.push(message.actualSamples);
          lineScanSource.data.fileName.push('');
          lineScanSource.data.scanStatus.push('in_progress');
          lineScanSource.data.processStatus.push('processing');

          lineScanSource.change.emit();
        });
      } else {
        lineScanSource.data.scanStatus = lineScanSource.data.scanStatus.map(v => 'complete');
        lineScanSource.selected.indices = lineScanSource.selected.indices; 
        
        lineScanSource.change.emit();
        clearInterval(dataPollingIntervalId);
        dataPollingIntervalId = 0;
      }
      console.log('got process line!', message);
    }, true);

    remote.subscribe('rover_control_state', (key, message) => {
      //console.log('rover_control_state', message);
      lastTimestamp = message.timestamp;
      backRightWheelVoltage.data.timestamp.push(message.timestamp);
      frontRightWheelVoltage.data.timestamp.push(message.timestamp);
      frontLeftWheelVoltage.data.timestamp.push(message.timestamp);
      backLeftWheelVoltage.data.timestamp.push(message.timestamp);

      backRightWheelState.data.timestamp.push(message.timestamp);
      frontRightWheelState.data.timestamp.push(message.timestamp);
      frontLeftWheelState.data.timestamp.push(message.timestamp);
      backLeftWheelState.data.timestamp.push(message.timestamp);

      
      backRightWheelState.data.output.push(message.backRightOutput);
      frontRightWheelState.data.output.push(message.frontRightOutput);
      frontLeftWheelState.data.output.push(message.frontLeftOutput);
      backLeftWheelState.data.output.push(message.backLeftOutput);

      velocitySource.data.timestamp.push(message.timestamp);
      velocitySource.data.x.push(message.velocityX * -1);
      velocitySource.data.y.push(message.velocityY * -1);

      velocityTrajectorySource.data.timestamp.push(message.timestamp);
      velocityTrajectorySource.data.x.push(message.targetChassisVelocityX);
      velocityTrajectorySource.data.y.push(message.targetChassisVelocityY);

      /*console.log('outputs!!');
      console.log(message.backRightOutput);
      console.log(message.frontRightOutput);
      console.log(message.frontLeftOutput);
      console.log(message.backLeftOutput);*/
      
      backRightWheelVoltage.data.voltage.push(message.backRightMotorOutput);
      frontRightWheelVoltage.data.voltage.push(message.frontRightMotorOutput);
      frontLeftWheelVoltage.data.voltage.push(message.frontLeftMotorOutput);
      backLeftWheelVoltage.data.voltage.push(message.backLeftMotorOutput);


      backRightWheelState.data.velocityTarget.push(message.wheelRearRightSetpoint);
      frontRightWheelState.data.velocityTarget.push(message.wheelFrontRightSetpoint);
      frontLeftWheelState.data.velocityTarget.push(message.wheelFrontLeftSetpoint);
      backLeftWheelState.data.velocityTarget.push(message.wheelRearLeftSetpoint);
    }, true);

    function update() {
      addedPlots.forEach(plot => {
        if(plot[1]) {
          plot[1].forEach(s => {
            if(s._enableUpdate) s.change.emit();
          });
        }
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
          plot[1].forEach(s => { s._enableUpdate = true; });
        } else {
          plot[1].forEach(s => { s._enableUpdate = false; });
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

window.addedPlots = addedPlots;
var container = document.querySelector('main > div.container');
function addPlot(plot, source = [], templateName = 'plotTpl') {
  var d = document.createElement('div');

  console.log(templateName);
  d.innerHTML = template(templateName, {});

  Bokeh.Plotting.show(plot, d.querySelector('.plot-container'));

  var el = container.appendChild(d.firstElementChild);
  
  var plotEl = el.querySelector('.plot-container');
  
  source = Array.isArray(source) ? source : [source];
  
  source.forEach(source => {
    source._enableUpdate = false;
  });

  addedPlots.push([plotEl, source]);

  return el;
  //plot.frame_width = rect.width;

  //plot.properties.height.change.emit();
}
