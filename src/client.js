require('regenerator-runtime/runtime');
var dnode           = require('dnode'),
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
    qte             = require('quaternion-to-euler');

window.L = L;
require('./L.SimpleGraticule.js');
require('leaflet-rotatedmarker');
require('leaflet-draw');

var flip = -1;

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
      width: initialWidth,
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
        theta: []
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

    velocityPlot.line({ field: 'timestamp' }, { field: 'theta' }, {
      source: velocitySource,
      line_color: velocityScheme[2],
      legend_label: 'velocity_θ',
      line_width: 2,
      y_range_name: 'velocity_theta'
    });

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

    addPlot(positionPlot, positionSource);
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
          maxAcceleration: 0.3,
          maxVelocity: 0.3
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

        var scanPatternType = 'zigzagRows2d';
        modalEl.querySelector('#patternType').addEventListener('input', function(e) {
          scanPatternType = e.target.options[e.target.selectedIndex].value;
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
            zoom: 0,
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
          iconAnchor: [20, 24]
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
        
        scanLayer.addTo(map);

        function updateScanPattern() {
          var layer = scanBoundsLayer;
          if(!layer) return;

          var extent = layer.getBounds().toBBoxString().split(',');

          var minX = parseFloat(extent[1]),
              minY = parseFloat(extent[0]),
              maxX = parseFloat(extent[3]),
              maxY = parseFloat(extent[2]);

          var xSize = Math.abs(maxX - minX),
              ySize = Math.abs(maxY - minY),
              stepSize = resolutionValue * 0.01,
              stepInX = xSize / stepSize,
              stepInY = ySize / stepSize;
          
          var points = [];
          Array.from(gi[scanPatternType](Math.floor(stepInX) + 1, Math.floor(stepInY) + 1)).forEach((point, i) => {
            
            points.push(
              [
                minX + ((point[0] / stepInX) * xSize),
                minY + ((point[1] / stepInY) * ySize)
              ]
            );
          });

          scanLayer.setLatLngs(points);

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

            debugger;

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
        map.fitBounds(bounds);
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

          if(patterns.find(p => p.name === scanPlanningParams.selectedPattern)) {
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

        console.log('traj!!!', trajectory);

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

      headingTrajectorySource.data.timestamp.push(sample.timestamp);
      headingTrajectorySource.data.theta.push(sample.trajectory.pose.rotation.radians);

      var magnitude = Math.hypot(x, y);

      var mSin = 0.0;
      var mCos = 1.0;

      if(magnitude > 1e-6) {
        mCos = x / magnitude;
        mSin = y / magnitude;
      }
      
      velocityTrajectorySource.data.timestamp.push(sample.timestamp);
      velocityTrajectorySource.data.x.push(sample.trajectory.velocity * mCos);
      velocityTrajectorySource.data.y.push(sample.trajectory.velocity * mSin);
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

    var filter = new LowPassFilter(0.5), lastVelocity;
    remote.on('rover_pose_velocity', 100, (key, velocity) => {
      if(!lastVelocity) lastVelocity = velocity;

      velocitySource.data.timestamp.push(velocity.timestamp);
      velocitySource.data.x.push(velocity.pos[0] * flip);

      velocitySource.data.y.push(velocity.pos[1] * flip);

      velocitySource.data.theta.push(filter.estimate(velocity.theta[2] * flip));

      var dt = velocity.timestamp - lastVelocity.timestamp;

      if(dt > 0) {
        accelerationSource.data.timestamp.push(velocity.timestamp);
        accelerationSource.data.x.push(((velocity.pos[0] - lastVelocity.pos[0]) / dt) * flip );
        accelerationSource.data.y.push(((velocity.pos[1] - lastVelocity.pos[1]) / dt) * flip );
        accelerationSource.data.theta.push(((filter.estimate(velocity.theta[2]) - filter.estimate(lastVelocity.theta[2])) / dt) * flip );
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

var container = document.querySelector('main > div.container');
function addPlot(plot, source = []) {
  var d = document.createElement('div');

  source._enableUpdate = false;
 
  d.innerHTML = template('plotTpl', {});

  Bokeh.Plotting.show(plot, d.querySelector('.plot-container'));

  var el = container.appendChild(d.firstElementChild)
    .querySelector('.plot-container');
  
  source = Array.isArray(source) ? source : [source];
  addedPlots.push([el, source]);


  //plot.frame_width = rect.width;

  //plot.properties.height.change.emit();
}
