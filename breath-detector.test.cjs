const assert = require("node:assert/strict");
const BreathDetector = require("./breath-detector.js");
const samples = amplitude => new Float32Array(2048).fill(amplitude);
const quiet = new Float32Array(1024).fill(-100);
const broadband = new Float32Array(1024).fill(-45);
const voice = new Float32Array(1024).fill(-100);
for (const i of [10, 20, 30, 40]) voice[i] = -15;
function calibrated() {
  const detector = new BreathDetector();
  for (let i = 0; i < 50; i++) detector.update(samples(0.001), quiet, 48000, 20);
  return detector;
}
const detector = calibrated();
for (let i = 0; i < 5; i++) assert.equal(detector.update(samples(0.1), broadband, 48000, 20), 0, "Short transient cannot fog");
detector.update(samples(0.001), quiet, 48000, 20);
for (let i = 0; i < 30; i++) detector.update(samples(0.05), broadband, 48000, 20);
assert.ok(detector.level > 0.8, "Continuous broadband breath builds fog");
assert.equal(detector.update(samples(0.05), broadband, 48000, 20, true), 0, "Writing and keyboard suppression stop fog immediately");
const speech = calibrated();
for (let i = 0; i < 50; i++) assert.equal(speech.update(samples(0.1), voice, 48000, 20), 0, "Voiced speech does not trigger fog");
const fan = new BreathDetector();
for (let i = 0; i < 200; i++) fan.update(samples(0.025), broadband, 48000, 20);
assert.equal(fan.level, 0, "Steady ambient noise is calibrated out");
fan.reset();
assert.equal(fan.level, 0);
assert.equal(fan.warmup, 0);
console.log("Breath detection: sustained breath, speech, clicks, ambient calibration, suppression, and reset passed.");
