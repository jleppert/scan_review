var microtime     = require('microtime'),
    LowPassFilter = require('./LowPassFilter');

function PID(Kp, Ki, Kd, lowPassGain, stabilityThreshold, maximumIntegralSum) {
  this.Kp = Kp;
  this.Ki = Ki;
  this.Kd = Kd;

  this.previousError = 0;
  this.integralSum   = 0;
  this.derivative    = 0;

  this.hasRun = false;

  this.lowPassGain = lowPassGain;
  this.stabilityThreshold = stabilityThreshold;
  this.maximumIntegralSum = maximumIntegralSum;

  this.filter = new LowPassFilter(lowPassGain);
}

PID.prototype = {
  calculate: function(reference = 0.0, state = 0.0) {
    var dt = this.getDT(),
        error = this.calculateError(reference, state),
        derivative = this.calculateDerivative(error, dt);

    console.log('error', error, 'ref', reference, 'state', state);

    this.integrate(error, dt);

    this.previousError = error;

    return error * this.Kp + this.integralSum * this.Ki + derivative * this.Kd;
  },

  getDT: function() {
    if(!this.hasRun) {
      this.hasRun = true;

      this.lastTime = microtime.now();
    }

    var now = microtime.now();

    var dt = now - this.lastTime;

    this.lastTime = now;

    return dt;
  },

  integrate: function(error, dt) {
    if(this.crossOverDetected(error, this.previousError)) this.integralSum = 0;
    if(Math.abs(this.derivative) > this.stabilityThreshold) return;

    this.integralSum += ((error + this.previousError) / 2) * dt;

    if(Math.abs(this.integralSum) > this.maximumIntegralSum) {
      this.integralSum = Math.signum(integralSum) * this.maximumIntegralSum;
    }
  },

  calculateError: function(reference, state) {
    return reference - state;
  },

  calculateDerivative: function(error, dt) {
    this.derivative = (error - this.previousError) / dt;
    
    return this.filter.estimate(this.derivative);
  },

  crossOverDetected: function(error = 0.0, previous = 0.0) {
    if(error > 0 && previous < 0) return true;
    return error < 0 && previous > 0;

  }
};

module.exports = PID;
