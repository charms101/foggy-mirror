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
    globalCompositeOperation: "source-over", erases: 0, paints: 0, clears: 0, images: [],
    save() { stack.push(this.globalCompositeOperation); },
    restore() { this.globalCompositeOperation = stack.pop(); },
    fill() { if (this.globalCompositeOperation === "destination-out") this.erases++; else this.paints++; },
    stroke() { if (this.globalCompositeOperation === "destination-out") this.erases++; else this.paints++; },
    fillRect() { if (this.globalCompositeOperation === "destination-out") this.erases++; },
    clearRect() { this.clears++; }, drawImage(image) { this.images.push(image); this.paints++; }, beginPath() {}, arc() {}, moveTo() {}, lineTo() {}, quadraticCurveTo() {},
    translate() {}, rotate() {}, scale() {},
    createLinearGradient() { return { addColorStop() {} }; },
    createRadialGradient() { return { addColorStop() {} }; }
  };
  const element = { width: 0, height: 0, events: {}, attributes: {}, style: { setProperty() {} }, getContext: () => context,
    addEventListener(type, listener) { this.events[type] = listener; },
    setAttribute(name, value) { this.attributes[name] = value; }, setPointerCapture() {},
    click() { this.clicked = true; }, remove() { this.removed = true; },
    toDataURL(format) { this.format = format; return "data:image/png;base64,test"; },
    getBoundingClientRect: () => ({ width: 1280, height: 720, left: 0, top: 0 }), hasPointerCapture: () => false,
    classList: { add() {}, remove() {}, toggle() {} }, focus() {} };
  surfaces.push({ element, context });
  return element;
}
const elements = new Map();
const downloads = [];
const sandbox = vm.createContext({
  document: { getElementById(id) { if (!elements.has(id)) elements.set(id, surface()); return elements.get(id); }, createElement: surface, addEventListener() {}, querySelectorAll: () => [], body: { append(element) { downloads.push(element); } } },
  window: { addEventListener() {}, devicePixelRatio: 1 }, navigator: {}, performance: { now: () => 1000 },
  requestAnimationFrame() {}, setTimeout() {}, clearTimeout() {}, HandGestures: { classify, mirrorPoint }, BreathDetector: require("./breath-detector.js"), console
});
vm.runInContext(fs.readFileSync(`${__dirname}/lipstick-brush.js`, "utf8"), sandbox);
vm.runInContext(fs.readFileSync(`${__dirname}/app.js`, "utf8"), sandbox);
sandbox.pointing = hand([false, true, true, true]);
sandbox.fist = hand([true, true, true, true]);
sandbox.open = hand([false, false, false, false]);
vm.runInContext("state.running = true; video.videoWidth = 1280; video.videoHeight = 720; handResultGeneration = handGeneration", sandbox);
const feed = name => vm.runInContext(`onHands({multiHandLandmarks:[${name}]}); animateHands(1000, 16)`, sandbox);
feed("pointing");
assert.equal(vm.runInContext("handTracks.get('hand-0').mode", sandbox), "draw");
const eraseCount = () => vm.runInContext("maskCtx.erases", sandbox);
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
elements.get("lipstickTool").events.click();
assert.equal(elements.get("lipstickTool").attributes["aria-pressed"], "true");
assert.equal(elements.get("lipstickPalette").hidden, false, "Lipstick mode shows side shades");
const beforeInk = eraseCount();
vm.runInContext("handResultGeneration = handGeneration", sandbox);
feed("pointing");
assert.ok(vm.runInContext("lipstickCtx.paints", sandbox) > 0, "Index finger paints lipstick");
assert.equal(eraseCount(), beforeInk, "Lipstick drawing leaves fog intact");
const mirror = elements.get("mirror");
mirror.events.pointerdown({ button: 0, pointerId: 1, clientX: 100, clientY: 100, pointerType: "mouse" });
mirror.events.pointermove({ pointerId: 1, clientX: 180, clientY: 160 });
const inkBeforeRelease = vm.runInContext("lipstickCtx.paints", sandbox);
mirror.events.pointerup({ pointerId: 1 });
assert.ok(vm.runInContext("lipstickCtx.paints", sandbox) > inkBeforeRelease, "Touchpad release completes the lipstick stroke");
assert.equal(vm.runInContext("state.pointerId", sandbox), null);
const cherryStamps = vm.runInContext("lipstickCtx.images.length", sandbox);
vm.runInContext("selectShade(3)", sandbox);
assert.equal(vm.runInContext("state.shade.color", sandbox), "#e33a80");
assert.equal(vm.runInContext("lipstickCtx.images.length", sandbox), cherryStamps, "Changing shades preserves existing strokes");
const beforeStationary = vm.runInContext("lipstickCtx.images.length", sandbox);
vm.runInContext("const testStroke = {}; strokeTo({x:400,y:400}, testStroke); strokeTo({x:400,y:400}, testStroke); strokeTo({x:400,y:400}, testStroke); finishStroke(testStroke)", sandbox);
assert.equal(vm.runInContext("lipstickCtx.images.length", sandbox), beforeStationary + 1, "Stationary drawing never piles up pigment");
vm.runInContext("drawFrame(ctx)", sandbox);
assert.equal(vm.runInContext("ctx.images.at(-1) === lipstick", sandbox), true, "Reflection and photo compositor includes lipstick");
elements.get("lipstickTool").events.click();
assert.equal(elements.get("lipstickTool").attributes["aria-pressed"], "false");
assert.equal(elements.get("lipstickPalette").hidden, true, "Fog brush hides shades");
mirror.events.pointerdown({ button: 0, pointerId: 2, clientX: 100, clientY: 100, pointerType: "mouse" });
mirror.events.pointerup({ pointerId: 2 });
assert.ok(eraseCount() > beforeInk, "Turning lipstick off restores fog erasing");
elements.get("lipstickTool").events.click();
elements.get("wipeTool").events.click();
assert.equal(vm.runInContext("state.lipstick", sandbox), false, "Broad wipe exits lipstick mode");
assert.equal(elements.get("lipstickTool").attributes["aria-pressed"], "false");
mirror.getBoundingClientRect = () => ({ width: 900, height: 600 });
vm.runInContext("fitCanvases()", sandbox);
assert.equal(vm.runInContext("lipstick.width", sandbox), 900);
assert.ok(vm.runInContext("lipstickCtx.images.length", sandbox) > 0, "Resize restores the existing lipstick layer");
mirror.getBoundingClientRect = () => ({ width: 1280, height: 720 });
vm.runInContext("fitCanvases()", sandbox);
const paletteFixtures = Array.from({ length: 6 }, (_, index) => {
  const button = surface();
  button.dataset = { shade: String(index) };
  button.getBoundingClientRect = () => ({ left: 1200, right: 1244, top: 200 + index * 48, bottom: 244 + index * 48 });
  return button;
});
sandbox.paletteFixtures = paletteFixtures;
vm.runInContext("shadeButtons.push(...paletteFixtures); state.lipstick = true; handTracks.set('palette-hand', {x:1220,y:416,mode:'draw',lastPoint:null,midpoint:null,wipeCarry:0})", sandbox);
const beforeHover = vm.runInContext("lipstickCtx.images.length", sandbox);
vm.runInContext("hoverHandPalette(1000); hoverHandPalette(1640)", sandbox);
assert.equal(vm.runInContext("state.shade.color", sandbox), "#e33a80", "Brief palette hover cannot switch shade");
vm.runInContext("hoverHandPalette(1710)", sandbox);
assert.equal(vm.runInContext("state.shade.color", sandbox), "#e75a45", "Sustained fingertip hover selects the shade");
assert.equal(paletteFixtures[4].attributes["aria-pressed"], "true");
assert.equal(vm.runInContext("lipstickCtx.images.length", sandbox), beforeHover, "Palette hover never paints lipstick");
assert.equal(vm.runInContext("handTracks.size", sandbox), 0, "Shade changes end old hand strokes");
vm.runInContext("shadeButtons.splice(0); state.lipstick = false", sandbox);
const oldFogClears = vm.runInContext("maskCtx.clears", sandbox);
const oldInkClears = vm.runInContext("lipstickCtx.clears", sandbox);
elements.get("clearButton").events.click();
assert.equal(vm.runInContext("maskCtx.clears", sandbox), oldFogClears + 1, "Clear removes all fog");
assert.equal(vm.runInContext("lipstickCtx.clears", sandbox), oldInkClears + 1, "Clear removes all lipstick");
assert.equal(vm.runInContext("state.lastPoint", sandbox), null, "Clear ends active strokes before clearing");
assert.equal(vm.runInContext("handTracks.size", sandbox), 0, "Clear discards hand stroke history");
elements.get("shutterButton").events.click();
assert.equal(downloads.length, 1, "Shutter initiates one photo download");
assert.match(downloads[0].download, /^foggy-mirror-.*\.png$/);
assert.equal(downloads[0].clicked, true);
assert.equal(downloads[0].removed, true, "Temporary download link is cleaned up");
assert.equal(vm.runInContext("state.shooting", sandbox), false, "Shutter becomes available for another photo");
const photo = surfaces.find(item => item.element.format === "image/png");
assert.ok(photo, "Photo is encoded as PNG");
assert.equal(photo.context.images.at(-1), vm.runInContext("lipstick", sandbox), "Photo includes lipstick, not UI");
console.log("Mirror actions: clearing both layers and composited PNG shutter download passed.");
console.log("Lipstick: toggle, finger and touchpad drawing, stroke completion, compositing, and fog brush restoration passed.");

async function testMediaAndFace() {
  sandbox.window.Hands = class {
    setOptions() {} onResults() {} async initialize() {} async close() {}
  };
  sandbox.window.FaceDetection = class {
    setOptions() {} onResults(callback) { this.results = callback; } async initialize() {} async close() {}
  };
  let requests = 0;
  const track = { readyState: "live", addEventListener() {}, stop() { this.readyState = "ended"; } };
  const cameraStream = { getTracks: () => [track], getVideoTracks: () => [track], getAudioTracks: () => [] };
  sandbox.navigator.mediaDevices = { async getUserMedia(options) {
    requests++;
    if (options.audio) throw Object.assign(new Error("Denied"), { name: "NotAllowedError" });
    return cameraStream;
  } };
  elements.get("camera").play = async () => {};
  vm.runInContext("state.running = false; startButton.disabled = false", sandbox);
  await vm.runInContext("startMirror()", sandbox);
  assert.equal(requests, 2, "Microphone denial retries with camera only");
  assert.equal(vm.runInContext("state.running", sandbox), true);
  assert.equal(elements.get("micRetry").hidden, false, "Camera-only mode offers microphone retry");
  await vm.runInContext("handSetup", sandbox);
  await vm.runInContext("faceSetup", sandbox);
  vm.runInContext("faceResultGeneration = handGeneration; face.results({detections:[{landmarks:[{}, {}, {}, {x:0.6,y:0.5}]}]})", sandbox);
  assert.equal(vm.runInContext("mouth.y", sandbox), 360);
  assert.ok(Math.abs(vm.runInContext("mouth.x", sandbox) - 512) < 0.001, "Mouth is mirrored into the camera crop");
  vm.runInContext("returnToStart()", sandbox);
  assert.equal(vm.runInContext("mouth", sandbox), null, "Pause discards mouth tracking");
  vm.runInContext("releaseMedia()", sandbox);
  assert.equal(track.readyState, "ended", "Leaving releases camera tracks");
  sandbox.navigator.mediaDevices.getUserMedia = async () => { throw Object.assign(new Error("Denied"), { name: "NotAllowedError" }); };
  await vm.runInContext("startMirror()", sandbox);
  assert.equal(vm.runInContext("state.running", sandbox), false);
  assert.equal(elements.get("startButton").disabled, false, "Denied access leaves Start retryable");
  assert.match(elements.get("permissionHint").textContent, /Camera access was denied/);
  console.log("Media recovery: camera-only fallback, mouth coordinates, pause, track release, and denial retry passed.");
}
testMediaAndFace().catch(error => { console.error(error); process.exitCode = 1; });
