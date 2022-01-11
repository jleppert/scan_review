function LowPassFilter(gain = 1.0) {
  this.gain = gain;

  this.previousEstimate = 0;
}

LowPassFilter.prototype.estimate = function(measurement = 0.0) {
  var estimate = this.gain * this.previousEstimate + (1 - this.gain) * measurement;

  this.previousEstimate = estimate;

  return estimate;
}

module.exports = LowPassFilter;
