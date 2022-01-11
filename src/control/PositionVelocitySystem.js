function PositionVelocitySystem(
  positionEstimator, 
  velocityEstimator,
  feedForwardController,
  positionFeedbackController,
  velocityFeedbackController
  ) {

    this.positionEstimator = positionEstimator;
    this.velocityEstimator = velocityEstimator;
    this.feedforward       = feedForwardController;
    this.positionFeedback  = positionFeedbackController;
    this.velocityFeedback  = velocityFeedbackController;
}

PositionVelocitySystem.prototype.update = async function(x, v, a) {
  var position = await this.positionEstimator.update();
  var velocity = await this.velocityEstimator.update();

  var feedbackX = this.positionFeedback.calculate(x, position),
      feedbackV = this.positionFeedback.calculate(v, velocity),
      ff        = this.feedforward.calculate(x, v, a);

  
  console.log('v', feedbackX, feedbackV, ff);
      return feedbackX + feedbackV + ff;
}

module.exports = PositionVelocitySystem;
