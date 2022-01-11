function FeedForward(Kv, Ka) {
  this.Kv = Kv;
  this.Ka = Ka;
}

FeedForward.prototype = {
  calculate: function(x, v, a) {
    return v * this.Kv + a * this.Ka;
  }
};

module.exports = FeedForward;
