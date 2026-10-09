const assert = require("node:assert/strict");
const { classify, mirrorPoint } = require("./hand-gestures.js");

function hand(curled) {
  const points = Array.from({ length: 21 }, () => ({ x: 0.5, y: 0.6 }));
  points[0] = { x: 0.5, y: 0.9 };
  [8, 12, 16, 20].forEach((tip, i) => {
    points[tip - 2] = { x: 0.5 + i * 0.02, y: 0.6 };
    points[tip] = { x: 0.5 + i * 0.02, y: curled[i] ? 0.75 : 0.3 };
  });
  return points;
}

assert.equal(classify(hand([false, true, true, true])), "draw", "Index pointing draws without thumb pinch");
assert.equal(classify(hand([true, true, true, true])), "wipe", "A fist wipes and cannot draw");
assert.equal(classify(hand([false, false, false, false])), "hover", "An open palm does not draw");
assert.equal(classify(hand([true, false, true, true])), "hover", "A different extended finger does not draw");
assert.equal(classify([]), "hover");
const invalid = hand([false, true, true, true]);
invalid[8].x = NaN;
assert.equal(classify(invalid), "hover");

const portrait = mirrorPoint({ x: 0.6, y: 0.5 }, 390, 844, 1280, 720);
assert.ok(Math.abs(portrait.x - (195 - 1280 * (844 / 720) * 0.1)) < 0.001, "Portrait crop aligns with mirrored video");
assert.equal(portrait.y, 422);
const left = mirrorPoint({ x: 0, y: 0.5 }, 1280, 720, 1280, 720);
assert.deepEqual(left, { x: 1280, y: 360 }, "Left camera edge is mirrored to the right");
const scaled = hand([false, true, true, true]).map(p => ({ x: p.x * 0.5 + 0.1, y: p.y * 0.5 + 0.1 }));
assert.equal(classify(scaled), "draw", "Gesture detection is independent of hand size");
const vm = require("node:vm");
const fs = require("node:fs");
const surfaces = [];
function surface() {
  const stack = [];
  const context = {
    globalCompositeOperation: "source-over", erases: 0,
    save() { stack.push(this.globalCompositeOperation); },
    restore() { this.globalCompositeOperation = stack.pop(); },
    fill() { if (this.globalCompositeOperation === "destination-out") this.erases++; },
    stroke() { if (this.globalCompositeOperation === "destination-out") this.erases++; },
    fillRect() { if (this.globalCompositeOperation === "destination-out") this.erases++; },
    clearRect() {}, drawImage() {}, beginPath() {}, arc() {}, moveTo() {}, lineTo() {}, quadraticCurveTo() {},
    createRadialGradient() { return { addColorStop() {} }; }
  };
  const element = { width: 0, height: 0, getContext: () => context, addEventListener() {},
    getBoundingClientRect: () => ({ width: 1280, height: 720 }), hasPointerCapture: () => false,
    classList: { add() {}, remove() {} }, focus() {} };
  surfaces.push({ element, context });
  return element;
}
const elements = new Map();
const sandbox = vm.createContext({
  document: { getElementById(id) { if (!elements.has(id)) elements.set(id, surface()); return elements.get(id); }, createElement: surface },
  window: { addEventListener() {}, devicePixelRatio: 1 }, navigator: {}, performance: { now: () => 1000 },
  requestAnimationFrame() {}, setTimeout() {}, clearTimeout() {}, HandGestures: { classify, mirrorPoint }, console
});
vm.runInContext(fs.readFileSync(`${__dirname}/app.js`, "utf8"), sandbox);
sandbox.pointing = hand([false, true, true, true]);
sandbox.fist = hand([true, true, true, true]);
sandbox.open = hand([false, false, false, false]);
vm.runInContext("state.running = true; video.videoWidth = 1280; video.videoHeight = 720; handResultGeneration = handGeneration", sandbox);
const feed = name => vm.runInContext(`onHands({multiHandLandmarks:[${name}]}); animateHands(1000, 16)`, sandbox);
feed("pointing");
assert.equal(vm.runInContext("handTracks.get('hand-0').mode", sandbox), "draw");
const eraseCount = () => surfaces.reduce((sum, item) => sum + item.context.erases, 0);
assert.ok(eraseCount() > 0, "Pointing lands a real eraser stroke");
feed("open");
const afterRelease = eraseCount();
feed("open");
assert.equal(eraseCount(), afterRelease, "Open hands stay idle");
feed("fist");
const stationary = eraseCount();
feed("fist");
assert.equal(eraseCount(), stationary, "A stationary fist does not repeatedly erase");
sandbox.movedFist = sandbox.fist.map(p => ({ x: p.x + 0.12, y: p.y }));
feed("movedFist");
vm.runInContext("for (let i = 0; i < 12; i++) animateHands(1000, 16)", sandbox);
assert.ok(eraseCount() > stationary, "Moving a fist stamps the broad eraser");
vm.runInContext("onHands({multiHandLandmarks:[]})", sandbox);
assert.equal(vm.runInContext("handTracks.size", sandbox), 0, "Tracking loss clears old stroke history");
vm.runInContext("clearHands(); onHands({multiHandLandmarks:[pointing]})", sandbox);
assert.equal(vm.runInContext("handTracks.size", sandbox), 0, "Stale inference results cannot restart a stroke");
console.log("Hand gestures: classification, crop mapping, erasing, idle gestures, tracking loss, and stale results passed.");
