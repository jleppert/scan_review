var dnode         = require('dnode'),
    shoe          = require('shoe'),
    reconnect     = require('reconnect/shoe'),
    progressBar   = require('nprogress'),
    notify        = require('toastify-js'),
    template      = require('resig');

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


var currentTrackerConfig;
function initUI() {
  console.log('init ui');

  var positionPlot, positionSource, xRange, yRange, xAxis, yAxis, xGrid, yGrid;

  remote.getBaseStationConfig(config => {
    currentTrackerConfig = config;

    var dim = 1.397 / 2;

    xRange = new Bokeh.Range1d({ start: dim * -1, end: dim });
    yRange = new Bokeh.Range1d({ start: dim * -1, end: dim });

    positionPlot = new Bokeh.Plot({
      title: '2D Tracked Position',
      x_range: xRange,
      y_range: yRange,
      width: 400,
      height: 400,
      background_fill_color: '#F2F2F7',
    });

    var xPositionPlot = new Bokeh.Plotting.figure({
      title: 'X Axis Position',
      width: 400,
      height: 400,
      background_fill_color: '#F2F2F7'
    });

    var yPositionPlot = new Bokeh.Plotting.figure({
      title: 'Y Axis Position',
      width: 400,
      height: 400,
      background_fill_color: '#F2F2F7'
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

    addPlot(positionPlot);
    addPlot(xPositionPlot);
    addPlot(yPositionPlot);

    remote.on('rover_pose', 100, (key, pose) => {
      positionSource.data.timestamp.push(pose[0]);
      positionSource.data.x.push(pose[2]);
      positionSource.data.y.push(pose[1] * -1);

      xSource.data.x.push(pose[2]);
      xSource.data.timestamp.push(pose[0]);

      ySource.data.y.push(pose[1] * -1);
      ySource.data.timestamp.push(pose[0]);


      positionSource.change.emit();
      xSource.change.emit();
      ySource.change.emit();
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
  
  plot.frame_width = rect.width;

  plot.properties.height.change.emit();
}
