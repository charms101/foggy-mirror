"use strict";

const video = document.getElementById("camera");
const canvas = document.getElementById("mirror");
const ctx = canvas.getContext("2d", { alpha: false });
const permissionPanel = document.getElementById("permissionPanel");
const startButton = document.getElementById("startButton");
const permissionHint = document.getElementById("permissionHint");
const statusEl = document.getElementById("status");
const mirrorControls = document.getElementById("mirrorControls");
const brushSize = document.getElementById("brushSize");
const readouts = document.getElementById("readouts");
const flash = document.getElementById("flash");
const micRetry = document.getElementById("micRetry");
const wipeTool = document.getElementById("wipeTool");
const fogTool = document.getElementById("fogTool");
const lipstickTool = document.getElementById("lipstickTool");
const lipstickPalette = document.getElementById("lipstickPalette");
const lipstickCursor = document.getElementById("lipstickCursor");
const howToButton = document.getElementById("howToButton");
const howToDialog = document.getElementById("howToDialog");
const shadeButtons = [...document.querySelectorAll("[data-shade]")];
const breathDetector = new BreathDetector();
const mobile = window.matchMedia?.("(pointer: coarse)").matches || false;
window.lucide?.createIcons();

const mask = document.createElement("canvas");
const maskCtx = mask.getContext("2d");
const lipstick = document.createElement("canvas");
const lipstickCtx = lipstick.getContext("2d");
const frost = document.createElement("canvas");
const frostCtx = frost.getContext("2d");
const puff = document.createElement("canvas");
puff.width = puff.height = 128;
const puffCtx = puff.getContext("2d");
const puffGradient = puffCtx.createRadialGradient(64, 64, 0, 64, 64, 64);
puffGradient.addColorStop(0, "rgba(255,255,255,1)");
puffGradient.addColorStop(0.5, "rgba(255,255,255,0.55)");
puffGradient.addColorStop(1, "rgba(255,255,255,0)");
puffCtx.fillStyle = puffGradient;
puffCtx.fillRect(0, 0, 128, 128);

const state = {
  width: 0, height: 0, dpr: 1,
  running: false, starting: false, videoReady: false, helpOpen: false,
  stream: null, micStream: null, audioContext: null, analyser: null, audioData: null, spectrum: null,
  smoothedBreath: 0, spaceDown: false, manualFog: false, fogTime: 0, lastKeyAt: 0,
  broadWipe: false, lipstick: false, shade: LipstickBrush.shades[0], shooting: false,
  brushRadius: 15, pointerId: null, palm: false,
  lastPoint: null, midpoint: null, wipeCarry: 0,
  debug: false, fps: 0, lastTime: performance.now()
};
let statusTimer;
let shadeHover = -1, shadeHoverSince = 0;
const handTracks = new Map();
const handInput = document.createElement("canvas");
const handInputCtx = handInput.getContext("2d");
let hands = null;
let handSetup = null;
let handBusy = false;
let handLastFrame = -1;
let handLastTime = 0;
let handGeneration = 0;
let handResultGeneration = 0;
let handStatus = "off";
let face = null, faceSetup = null, faceBusy = false, faceLastTime = 0, faceStatus = "off";
let faceResultGeneration = 0;
let mouth = null, mouthSeenAt = 0;
const faceInput = document.createElement("canvas");
const faceInputCtx = faceInput.getContext("2d");
const stickerTool = document.getElementById("stickerTool");
const stickerPanel = document.getElementById("stickerPanel");
const stickerEditor = new StickerKit.Editor({
  layer: document.getElementById("stickerLayer"), gallery: document.getElementById("stickerGallery"),
  sizeInput: document.getElementById("stickerSize"), removeButton: document.getElementById("removeSticker"),
  selectionTools: document.getElementById("stickerSelection"),
  isEnabled: () => state.running && !state.helpOpen && !state.shooting
});

function setStickerMode(enabled) {
  endStroke(); clearHands();
  state.spaceDown = state.manualFog = false;
  stickerEditor.setEditing(enabled);
  stickerPanel.hidden = !enabled;
  lipstickPalette.hidden = enabled || !state.lipstick;
  stickerTool.setAttribute("aria-pressed", String(enabled));
  lipstickCursor.hidden = true;
}
stickerTool.addEventListener("click", () => setStickerMode(!stickerEditor.editing));
document.getElementById("doneStickers").addEventListener("click", () => { setStickerMode(false); stickerTool.focus({ preventScroll: true }); });

function loadScript(src) {
  return new Promise((resolve, reject) => {
    const script = document.createElement("script");
    const timer = setTimeout(() => { script.remove(); reject(new Error("Model loading timed out")); }, 20000);
    script.src = src;
    script.crossOrigin = "anonymous";
    script.onload = () => { clearTimeout(timer); resolve(); };
    script.onerror = () => { clearTimeout(timer); script.remove(); reject(new Error("Model could not load")); };
    document.head.append(script);
  });
}

async function setupFace() {
  if (faceSetup) return faceSetup;
  faceStatus = "loading";
  faceSetup = (async () => {
    const base = "https://cdn.jsdelivr.net/npm/@mediapipe/face_detection@0.4.1646425229/";
    if (!window.FaceDetection) await loadScript(`${base}face_detection.js`);
    face = new window.FaceDetection({ locateFile: file => `${base}${file}` });
    face.setOptions({ model: "short", minDetectionConfidence: 0.5 });
    face.onResults(result => {
      if (!state.running || document.hidden || faceResultGeneration !== handGeneration) return;
      const point = result.detections?.[0]?.landmarks?.[3];
      if (!point || !Number.isFinite(point.x) || !Number.isFinite(point.y)) return;
      const target = HandGestures.mirrorPoint(point, state.width, state.height, video.videoWidth, video.videoHeight);
      mouth = mouth ? { x: mouth.x + (target.x - mouth.x) * 0.4, y: mouth.y + (target.y - mouth.y) * 0.4 } : target;
      mouthSeenAt = performance.now();
    });
    await face.initialize();
    faceStatus = "ready";
  })().catch(error => {
    faceStatus = "unavailable";
    faceSetup = null;
    face?.close().catch(() => {});
    face = null;
    console.warn(error.message);
  });
  return faceSetup;
}

function trackFace(time) {
  if (!face || faceStatus !== "ready" || faceBusy || handBusy || time - faceLastTime < 200 || video.readyState < 2) return;
  faceLastTime = time;
  const generation = handGeneration;
  faceResultGeneration = generation;
  const width = 320, height = Math.round(width * video.videoHeight / video.videoWidth);
  if (faceInput.width !== width || faceInput.height !== height) { faceInput.width = width; faceInput.height = height; }
  faceInputCtx.drawImage(video, 0, 0, width, height);
  faceBusy = true;
  face.send({ image: faceInput }).catch(error => { faceStatus = "unavailable"; mouth = null; console.warn(error.message); }).finally(() => {
    faceBusy = false;
    if (generation !== handGeneration) mouth = null;
  });
}

async function setupHands() {
  if (handSetup) return handSetup;
  handStatus = "loading";
  handSetup = (async () => {
    const base = "https://cdn.jsdelivr.net/npm/@mediapipe/hands@0.4.1675469240/";
    if (!window.Hands) await loadScript(`${base}hands.js`);
    hands = new window.Hands({ locateFile: file => `${base}${file}` });
    hands.setOptions({ maxNumHands: 2, modelComplexity: mobile ? 0 : 1, minDetectionConfidence: 0.6, minTrackingConfidence: 0.6 });
    hands.onResults(onHands);
    await hands.initialize();
    handStatus = "ready";
  })().catch(error => {
    handStatus = "unavailable";
    handSetup = null;
    hands?.close().catch(() => {});
    hands = null;
    if (state.running) setStatus("Hand tracking unavailable. You can still draw with touch or mouse.");
    console.warn(error.message);
  });
  return handSetup;
}

function clearHands() {
  handGeneration++;
  for (const track of handTracks.values()) finishStroke(track);
  handTracks.clear();
  resetShadeHover();
}

function onHands(result) {
  if (!state.running || state.helpOpen || stickerEditor.editing || state.pointerId !== null || handResultGeneration !== handGeneration) return;
  const now = performance.now();
  const seen = new Set();
  (result.multiHandLandmarks || []).forEach((landmarks, index) => {
    const label = result.multiHandedness?.[index]?.label || `hand-${index}`;
    const key = seen.has(label) ? `${label}-${index}` : label;
    seen.add(key);
    const previous = handTracks.get(key);
    const mode = HandGestures.classify(landmarks, video.videoWidth / video.videoHeight, previous?.mode === "draw");
    const finger = HandGestures.mirrorPoint(landmarks[8], state.width, state.height, video.videoWidth, video.videoHeight);
    const palm = [0, 5, 9, 13, 17].reduce((sum, i) => ({ x: sum.x + landmarks[i].x / 5, y: sum.y + landmarks[i].y / 5 }), { x: 0, y: 0 });
    const target = mode === "wipe" ? HandGestures.mirrorPoint(palm, state.width, state.height, video.videoWidth, video.videoHeight) : finger;
    let track = previous;
    if (!track) {
      track = { x: target.x, y: target.y, tx: target.x, ty: target.y, mode, lastPoint: null, midpoint: null, wipeCarry: 0 };
      handTracks.set(key, track);
    }
    const jumped = Math.hypot(target.x - track.tx, target.y - track.ty) > Math.min(state.width, state.height) * 0.3;
    if (track.mode !== mode || now - track.seenAt > 180 || jumped) {
      finishStroke(track);
      track.x = target.x;
      track.y = target.y;
    }
    track.tx = target.x;
    track.ty = target.y;
    track.mode = mode;
    track.palm = mode === "wipe";
    const a = HandGestures.mirrorPoint(landmarks[5], state.width, state.height, video.videoWidth, video.videoHeight);
    const b = HandGestures.mirrorPoint(landmarks[17], state.width, state.height, video.videoWidth, video.videoHeight);
    track.wipeRadius = Math.max(60, Math.min(100, Math.hypot(a.x - b.x, a.y - b.y) * 1.6 / state.dpr));
    track.seenAt = now;
  });
  for (const [key, track] of handTracks) {
    if (!seen.has(key)) {
      finishStroke(track);
      handTracks.delete(key);
    }
  }
}

function trackHands(time) {
  if (stickerEditor.editing) return;
  if (!hands || handStatus !== "ready" || handBusy || faceBusy || video.readyState < 2 || video.currentTime === handLastFrame || time - handLastTime < (mobile ? 80 : 50)) return;
  handLastFrame = video.currentTime;
  handLastTime = time;
  const generation = handGeneration;
  handResultGeneration = generation;
  const scale = Math.min(1, (mobile ? 480 : 640) / video.videoWidth);
  const width = Math.round(video.videoWidth * scale);
  const height = Math.round(video.videoHeight * scale);
  if (handInput.width !== width || handInput.height !== height) { handInput.width = width; handInput.height = height; }
  handInputCtx.drawImage(video, 0, 0, width, height);
  handBusy = true;
  hands.send({ image: handInput }).catch(error => {
    handStatus = "unavailable";
    clearHands();
    setStatus("Hand tracking stopped. Touch and mouse still work.");
    console.warn(error.message);
  }).finally(() => {
    handBusy = false;
    if (generation !== handGeneration) clearHands();
  });
}

function animateHands(time, elapsed) {
  let active = false;
  for (const [key, track] of handTracks) {
    if (time - track.seenAt > 180) { finishStroke(track); handTracks.delete(key); continue; }
    const ease = 1 - Math.exp(-elapsed / 67);
    track.x += (track.tx - track.x) * ease;
    track.y += (track.ty - track.y) * ease;
  }
  const paletteHands = hoverHandPalette(time);
  for (const track of handTracks.values()) {
    if (paletteHands.has(track)) continue;
    if (track.mode !== "hover" && state.pointerId === null) {
      strokeTo({ x: track.x, y: track.y }, track);
      active = true;
    }
  }
  return active;
}

function resetShadeHover() {
  shadeHover = -1;
  shadeHoverSince = 0;
  for (const button of shadeButtons) {
    button.classList.remove("is-dwelling");
    button.style.setProperty("--dwell", "0deg");
  }
}

function hoverHandPalette(time) {
  const over = new Set();
  let index = -1;
  if (state.lipstick && state.pointerId === null) {
    const bounds = shadeButtons.map(button => button.getBoundingClientRect());
    for (const track of handTracks.values()) {
      if (track.mode === "wipe") continue;
      const x = track.x / state.dpr, y = track.y / state.dpr;
      const hit = bounds.findIndex(rect => x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom);
      if (hit < 0) continue;
      finishStroke(track);
      over.add(track);
      if (index < 0) index = hit;
    }
  }
  if (index !== shadeHover) {
    resetShadeHover();
    shadeHover = index;
    shadeHoverSince = time;
  }
  if (index >= 0) {
    const progress = Math.min(1, (time - shadeHoverSince) / 700);
    shadeButtons[index].classList.add("is-dwelling");
    shadeButtons[index].style.setProperty("--dwell", `${progress * 360}deg`);
    if (progress === 1 && state.shade !== LipstickBrush.shades[index]) selectShade(index);
  }
  return over;
}

function drawHandMarkers(time) {
  ctx.save();
  ctx.strokeStyle = "rgba(255,255,255,0.5)";
  ctx.fillStyle = "rgba(255,255,255,0.95)";
  ctx.lineWidth = 1.4 * state.dpr;
  for (const track of handTracks.values()) {
    ctx.save();
    ctx.translate(track.x, track.y);
    if (track.mode === "draw") {
      if (state.lipstick) {
        ctx.rotate(Math.PI / 6);
        ctx.drawImage(LipstickBrush.tube(state.shade), -12 * state.dpr, 0, 24 * state.dpr, 64 * state.dpr);
        ctx.restore();
        continue;
      }
      ctx.rotate(time / 1000 * 0.18);
      const size = 15 * state.dpr;
      ctx.shadowColor = "rgba(255,255,255,0.65)";
      ctx.shadowBlur = size;
      ctx.beginPath();
      for (let i = 0; i < 4; i++) {
        const angle = i * Math.PI / 2;
        ctx.moveTo(0, 0);
        ctx.quadraticCurveTo(Math.cos(angle - 0.35) * size * 0.46, Math.sin(angle - 0.35) * size * 0.46, Math.cos(angle) * size, Math.sin(angle) * size);
        ctx.quadraticCurveTo(Math.cos(angle + 0.35) * size * 0.46, Math.sin(angle + 0.35) * size * 0.46, 0, 0);
      }
      ctx.fill();
    } else {
      ctx.beginPath();
      ctx.arc(0, 0, (track.mode === "wipe" ? track.wipeRadius : 6) * state.dpr, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.restore();
  }
  ctx.restore();
}

function setStatus(message) {
  clearTimeout(statusTimer);
  statusEl.textContent = message;
  statusEl.classList.remove("is-hidden");
  statusTimer = setTimeout(() => statusEl.classList.add("is-hidden"), 2600);
}

function resetFog() {
  maskCtx.clearRect(0, 0, state.width, state.height);
  maskCtx.fillStyle = "rgba(255,255,255,0.55)";
  maskCtx.fillRect(0, 0, state.width, state.height);
}

function fitCanvases() {
  const rect = canvas.getBoundingClientRect();
  const dpr = Math.min(window.devicePixelRatio || 1, 2, Math.sqrt(2500000 / Math.max(1, rect.width * rect.height)));
  const width = Math.max(1, Math.round(rect.width * dpr));
  const height = Math.max(1, Math.round(rect.height * dpr));
  if (width === state.width && height === state.height && dpr === state.dpr) return;
  endStroke();
  clearHands();
  lipstickCursor.hidden = true;
  const oldMask = document.createElement("canvas");
  const oldLipstick = document.createElement("canvas");
  mouth = null;
  if (state.width) {
    oldMask.width = mask.width;
    oldMask.height = mask.height;
    oldMask.getContext("2d").drawImage(mask, 0, 0);
    oldLipstick.width = lipstick.width;
    oldLipstick.height = lipstick.height;
    oldLipstick.getContext("2d").drawImage(lipstick, 0, 0);
  }
  state.width = canvas.width = mask.width = width;
  state.height = canvas.height = mask.height = height;
  lipstick.width = width;
  lipstick.height = height;
  state.dpr = dpr;
  // Blur a bounded texture, then upscale it; sharp video and strokes stay full resolution.
  const scale = Math.min(1, 960 / Math.max(width, height));
  frost.width = Math.max(1, Math.round(width * scale));
  frost.height = Math.max(1, Math.round(height * scale));
  if (oldMask.width) maskCtx.drawImage(oldMask, 0, 0, width, height);
  else resetFog();
  if (oldLipstick.width) lipstickCtx.drawImage(oldLipstick, 0, 0, width, height);
  stickerEditor.resize(width, height);
}

function drawMirroredVideo(targetCtx, width, height) {
  targetCtx.save();
  targetCtx.fillStyle = "#0d0c0b";
  targetCtx.fillRect(0, 0, width, height);
  if (state.videoReady && video.readyState >= 2 && video.videoWidth) {
    const scale = Math.max(width / video.videoWidth, height / video.videoHeight);
    const drawWidth = video.videoWidth * scale;
    const drawHeight = video.videoHeight * scale;
    targetCtx.translate(width, 0);
    targetCtx.scale(-1, 1);
    targetCtx.drawImage(video, (width - drawWidth) / 2, (height - drawHeight) / 2, drawWidth, drawHeight);
  }
  targetCtx.restore();
}

function drawFrame(targetCtx, includeStickers = true) {
  drawMirroredVideo(targetCtx, state.width, state.height);
  frostCtx.clearRect(0, 0, frost.width, frost.height);
  const blur = 18 * state.dpr * frost.width / state.width;
  frostCtx.filter = `blur(${blur}px) brightness(1.18) saturate(0.82)`;
  drawMirroredVideo(frostCtx, frost.width, frost.height);
  frostCtx.filter = "none";
  frostCtx.fillStyle = "rgba(242,238,231,0.62)";
  frostCtx.fillRect(0, 0, frost.width, frost.height);
  frostCtx.globalCompositeOperation = "destination-in";
  frostCtx.drawImage(mask, 0, 0, frost.width, frost.height);
  frostCtx.globalCompositeOperation = "source-over";
  targetCtx.drawImage(frost, 0, 0, state.width, state.height);
  targetCtx.drawImage(lipstick, 0, 0);
  if (includeStickers) stickerEditor.draw(targetCtx);
}

function addFog(strength) {
  const origin = mouth && performance.now() - mouthSeenAt < 700 ? mouth : { x: state.width / 2, y: state.height * 0.45 };
  const reach = Math.min(state.width, state.height) * 0.43 * (0.6 + strength * 0.7);
  maskCtx.save();
  for (let i = 0; i < 12; i++) {
    const angle = Math.random() * Math.PI * 2;
    const distance = Math.pow(Math.random(), 1.3) * reach;
    const x = origin.x + Math.cos(angle) * distance * 1.45;
    const y = origin.y + state.height * 0.1 + Math.sin(angle) * distance - distance * 0.18;
    const radius = reach * (0.16 + Math.random() * 0.26);
    maskCtx.globalAlpha = 0.36 * (0.3 + strength * 0.7) * (0.45 + Math.random() * 0.55);
    maskCtx.drawImage(puff, x - radius, y - radius, radius * 2, radius * 2);
  }
  maskCtx.restore();
}

function strokeTo(point, stroke = state) {
  const last = stroke.lastPoint;
  if (!last) {
    stroke.ink = state.lipstick && !stroke.palm;
    stroke.shade = state.shade;
    stroke.inkRadius = state.brushRadius * state.dpr;
  }
  if (stroke.ink) {
    if (!last) {
      LipstickBrush.dab(lipstickCtx, point, stroke.inkRadius * 0.72, stroke.shade, 0);
      stroke.midpoint = point;
    } else {
      const mid = { x: (point.x + last.x) / 2, y: (point.y + last.y) / 2 };
      LipstickBrush.curve(lipstickCtx, stroke.midpoint, last, mid, stroke.inkRadius, stroke.shade, stroke);
      stroke.midpoint = mid;
    }
    stroke.lastPoint = point;
    return;
  }
  const brushCtx = maskCtx;
  brushCtx.save();
  brushCtx.globalCompositeOperation = stroke.ink ? "source-over" : "destination-out";
  if (stroke.palm) {
    // Stamp by distance, so a stationary hand never keeps removing fog.
    if (last) {
      const distance = Math.hypot(point.x - last.x, point.y - last.y);
      const radius = (stroke.wipeRadius || 82) * state.dpr;
      const spacing = radius * 0.5;
      for (let travel = spacing - stroke.wipeCarry; travel <= distance; travel += spacing) {
        const t = travel / distance;
        const x = last.x + (point.x - last.x) * t;
        const y = last.y + (point.y - last.y) * t;
        const gradient = brushCtx.createRadialGradient(x, y, radius * 0.4, x, y, radius);
        gradient.addColorStop(0, "rgba(0,0,0,0.34)");
        gradient.addColorStop(1, "rgba(0,0,0,0)");
        brushCtx.fillStyle = gradient;
        brushCtx.fillRect(x - radius, y - radius, radius * 2, radius * 2);
      }
      stroke.wipeCarry = (stroke.wipeCarry + distance) % spacing;
    }
  } else {
    const radius = state.brushRadius * state.dpr;
    brushCtx.fillStyle = brushCtx.strokeStyle = stroke.ink ? "#b6376d" : "#000";
    brushCtx.lineWidth = radius * 2;
    brushCtx.lineCap = brushCtx.lineJoin = "round";
    brushCtx.beginPath();
    if (!last) {
      brushCtx.arc(point.x, point.y, radius, 0, Math.PI * 2);
      brushCtx.fill();
      stroke.midpoint = point;
    } else {
      const mid = { x: (point.x + last.x) / 2, y: (point.y + last.y) / 2 };
      brushCtx.moveTo(stroke.midpoint.x, stroke.midpoint.y);
      brushCtx.quadraticCurveTo(last.x, last.y, mid.x, mid.y);
      brushCtx.stroke();
      stroke.midpoint = mid;
    }
  }
  brushCtx.restore();
  stroke.lastPoint = point;
}

function finishStroke(stroke) {
  if (stroke.ink && stroke.lastPoint && stroke.midpoint) {
    LipstickBrush.curve(lipstickCtx, stroke.midpoint, stroke.lastPoint, stroke.lastPoint, stroke.inkRadius, stroke.shade, stroke);
  } else if (stroke.lastPoint && stroke.midpoint && !stroke.palm) {
    const brushCtx = maskCtx;
    brushCtx.save();
    brushCtx.globalCompositeOperation = stroke.ink ? "source-over" : "destination-out";
    brushCtx.strokeStyle = stroke.ink ? "#b6376d" : "#000";
    brushCtx.lineWidth = state.brushRadius * state.dpr * 2;
    brushCtx.lineCap = "round";
    brushCtx.beginPath();
    brushCtx.moveTo(stroke.midpoint.x, stroke.midpoint.y);
    brushCtx.lineTo(stroke.lastPoint.x, stroke.lastPoint.y);
    brushCtx.stroke();
    brushCtx.restore();
  }
  stroke.lastPoint = stroke.midpoint = null;
  stroke.wipeCarry = 0;
  stroke.ink = false;
  stroke.inkCarry = 0;
}

function endStroke() {
  finishStroke(state);
  if (state.pointerId !== null && canvas.hasPointerCapture(state.pointerId)) canvas.releasePointerCapture(state.pointerId);
  state.pointerId = null;
  state.lastPoint = state.midpoint = null;
  state.wipeCarry = 0;
}

function setupAudio(stream) {
  const AudioContextCtor = window.AudioContext || window.webkitAudioContext;
  if (!AudioContextCtor || !stream.getAudioTracks().length) return;
  state.audioContext = new AudioContextCtor();
  state.analyser = state.audioContext.createAnalyser();
  state.analyser.fftSize = 2048;
  state.analyser.smoothingTimeConstant = 0.2;
  state.audioSource = state.audioContext.createMediaStreamSource(stream);
  state.audioSource.connect(state.analyser);
  // Keep audio processing active in browsers requiring an output path, without playing the mic.
  state.audioSink = state.audioContext.createGain();
  state.audioSink.gain.value = 0;
  state.analyser.connect(state.audioSink);
  state.audioSink.connect(state.audioContext.destination);
  state.audioData = new Float32Array(state.analyser.fftSize);
  state.spectrum = new Float32Array(state.analyser.frequencyBinCount);
  breathDetector.reset();
  stream.getAudioTracks()[0].addEventListener("ended", () => {
    state.audioContext?.close().catch(() => {});
    state.audioContext = state.analyser = null;
    breathDetector.reset();
    micRetry.hidden = false;
    if (state.running) setStatus("Microphone disconnected. You can enable it again or use the cloud button.");
  }, { once: true });
}

function readBreathLevel(elapsed, blocked) {
  if (!state.analyser || state.audioContext?.state !== "running") return 0;
  state.analyser.getFloatTimeDomainData(state.audioData);
  state.analyser.getFloatFrequencyData(state.spectrum);
  return breathDetector.update(state.audioData, state.spectrum, state.audioContext.sampleRate, elapsed, blocked);
}

function mediaMessage(error) {
  return ({
    NotAllowedError: "Camera access was denied. Allow the camera in your browser's site settings and try again.",
    NotFoundError: "No camera was found. Connect a camera and try again.",
    NotReadableError: "Your camera is busy. Close other apps using it and try again.",
    OverconstrainedError: "This camera could not use the requested settings. Try another camera.",
    SecurityError: "Open this mirror over HTTPS or localhost to enable the camera."
  })[error.name] || `Camera unavailable (${error.name}). Try Start again.`;
}

async function enableMicrophone() {
  if (!state.running || micRetry.disabled) return;
  micRetry.disabled = true;
  const cameraStream = state.stream;
  try {
    if (state.audioContext && state.analyser) {
      await state.audioContext.resume();
      breathDetector.reset();
      micRetry.hidden = state.audioContext.state === "running";
      return;
    }
    const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false }, video: false });
    if (!state.running || state.stream !== cameraStream) { stream.getTracks().forEach(track => track.stop()); return; }
    state.micStream?.getTracks().forEach(track => track.stop());
    state.micStream = stream;
    await state.audioContext?.close();
    state.audioContext = state.analyser = null;
    setupAudio(stream);
    await state.audioContext?.resume();
    micRetry.hidden = !state.analyser;
    setStatus("Microphone ready");
  } catch (error) { setStatus("Microphone unavailable. Hold the cloud button to fog the glass."); }
  finally { micRetry.disabled = false; }
}

async function startMirror() {
  if (state.starting || state.running) return;
  state.starting = true;
  startButton.disabled = true;
  permissionHint.textContent = "Opening camera and microphone...";
  try {
    if (!state.stream?.getVideoTracks().some(track => track.readyState === "live")) {
      try { state.stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: "user", width: { ideal: 1280 }, height: { ideal: 720 } },
      audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false }
      }); } catch (error) {
        if (!["NotAllowedError", "NotFoundError", "NotReadableError"].includes(error.name)) throw error;
        state.stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "user", width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false });
      }
      state.stream.getVideoTracks()[0].addEventListener("ended", () => {
        returnToStart(); releaseMedia();
        permissionHint.textContent = "Camera disconnected. Connect it and try Start again.";
      }, { once: true });
    }
    video.srcObject = state.stream;
    await video.play();
    state.videoReady = true;
    if (!state.audioContext) setupAudio(state.micStream || state.stream);
    await state.audioContext?.resume();
    fitCanvases();
    state.running = true;
    state.lastTime = performance.now();
    permissionPanel.classList.add("is-hidden");
    mirrorControls.hidden = false;
    permissionHint.textContent = "";
    canvas.focus({ preventScroll: true });
    micRetry.hidden = !!state.analyser;
    breathDetector.reset();
    setStatus(state.analyser ? "Ready" : "Microphone unavailable. Hold the cloud button to fog the glass.");
    // These legacy model loaders share startup globals and must initialize in order.
    setupHands().then(setupFace);
  } catch (error) {
    releaseMedia();
    permissionHint.textContent = mediaMessage(error);
  } finally {
    state.starting = false;
    startButton.disabled = false;
  }
}

function returnToStart() {
  if (!state.running) return;
  if (state.helpOpen) howToDialog.close();
  setStickerMode(false);
  endStroke();
  clearHands();
  state.running = state.spaceDown = state.manualFog = state.debug = false;
  lipstickCursor.hidden = true;
  mouth = null;
  breathDetector.reset();
  state.audioContext?.suspend().catch(() => {});
  state.fogTime = state.smoothedBreath = 0;
  readouts.hidden = mirrorControls.hidden = true;
  resetFog();
  permissionPanel.classList.remove("is-hidden");
  statusEl.classList.add("is-hidden");
  startButton.focus({ preventScroll: true });
}

function render(time) {
  requestAnimationFrame(render);
  if (!state.running || state.helpOpen || document.hidden) return;
  fitCanvases();
  const elapsed = Math.min(48, time - state.lastTime);
  state.lastTime = time;
  state.fps += (1000 / Math.max(1, elapsed) - state.fps) * 0.08;
  trackFace(time);
  trackHands(time);
  animateHands(time, elapsed);
  const gestureDrawing = [...handTracks.values()].some(track => track.mode === "draw");
  state.smoothedBreath = readBreathLevel(elapsed, stickerEditor.editing || state.pointerId !== null || gestureDrawing || time - state.lastKeyAt < 300);
  micRetry.hidden = !!state.analyser && state.audioContext?.state === "running";
  const manual = state.spaceDown || state.manualFog;
  const fogging = manual || state.smoothedBreath > 0.08;
  if (fogging) {
    state.fogTime += elapsed;
    // Use elapsed time rather than frame count for consistent condensation buildup.
    while (state.fogTime >= 1000 / 30) {
      addFog(manual ? 1 : state.smoothedBreath);
      state.fogTime -= 1000 / 30;
    }
  } else state.fogTime = 0;
  if (state.debug) readouts.textContent = `mic ${breathDetector.rms.toFixed(4)}  gate ${breathDetector.gate.toFixed(4)}  ${fogging ? "FOGGING" : "quiet"}\naudio ${state.audioContext?.state || "unavailable"}  ${Math.round(state.fps)} fps\nhiss ${breathDetector.hiss.toFixed(2)}  wind ${breathDetector.wind.toFixed(2)}\nhands ${handStatus}  ${[...handTracks.values()].map(track => track.mode).join(", ") || "none"}\nface ${mouth && time - mouthSeenAt < 700 ? "locked" : faceStatus}`;
  // Live stickers use the draggable DOM layer; bake them only into saved photos.
  drawFrame(ctx, false);
  if (state.pointerId === null) drawHandMarkers(time);
}

function captureSnapshot() {
  if (!state.running || state.helpOpen || state.shooting) return;
  state.shooting = true;
  try {
    endStroke(); clearHands();
    stickerEditor.endDrag();
    const output = document.createElement("canvas");
    output.width = state.width;
    output.height = state.height;
    drawFrame(output.getContext("2d", { alpha: false }));
    const link = document.createElement("a");
    link.download = `foggy-mirror-${new Date().toISOString().replace(/[:.]/g, "-")}.png`;
    link.href = output.toDataURL("image/png");
    document.body.append(link);
    link.click();
    link.remove();
    flash.classList.remove("pop");
    void flash.offsetWidth;
    flash.classList.add("pop");
    setStatus("Photo ready. Check your downloads.");
  } catch (error) {
    setStatus(`Could not save photo: ${error.message}`);
  } finally { state.shooting = false; }
}

function clearMirror() {
  if (!state.running || state.helpOpen || state.shooting) return;
  endStroke(); clearHands();
  maskCtx.clearRect(0, 0, state.width, state.height);
  lipstickCtx.clearRect(0, 0, state.width, state.height);
  stickerEditor.clear();
  lipstickCursor.hidden = true;
  setStatus("Mirror cleared");
}

function openInstructions() {
  if (!state.running || state.helpOpen) return;
  howToDialog.showModal();
  document.getElementById("howToBody").scrollTop = 0;
  state.helpOpen = true;
  stickerEditor.endDrag();
  endStroke(); clearHands();
  state.spaceDown = state.manualFog = false;
  lipstickCursor.hidden = true;
}
howToButton.addEventListener("click", openInstructions);
document.getElementById("closeHowTo").addEventListener("click", () => howToDialog.close());
howToDialog.addEventListener("close", () => {
  state.helpOpen = false;
  state.lastTime = performance.now();
  state.fogTime = 0;
  breathDetector.reset();
  howToButton.focus({ preventScroll: true });
});
howToDialog.addEventListener("click", event => {
  if (event.target !== howToDialog) return;
  const rect = howToDialog.getBoundingClientRect();
  if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) howToDialog.close();
});

function pointFromEvent(event) {
  const rect = canvas.getBoundingClientRect();
  return { x: (event.clientX - rect.left) * state.dpr, y: (event.clientY - rect.top) * state.dpr };
}
function moveLipstickCursor(event) {
  lipstickCursor.hidden = !state.running || stickerEditor.editing || !state.lipstick || state.broadWipe || (state.pointerId !== null && state.palm) || event.pointerType === "touch";
  lipstickCursor.style.left = `${event.clientX}px`;
  lipstickCursor.style.top = `${event.clientY}px`;
}
canvas.addEventListener("pointerdown", (event) => {
  if (!state.running || state.helpOpen || stickerEditor.editing || state.pointerId !== null || event.button !== 0) return;
  clearHands();
  state.pointerId = event.pointerId;
  state.audioContext?.resume().catch(() => {});
  state.palm = state.broadWipe || event.shiftKey || event.altKey || (event.pointerType === "touch" && event.width > 48);
  moveLipstickCursor(event);
  if (state.palm) lipstickCursor.hidden = true;
  canvas.setPointerCapture(event.pointerId);
  strokeTo(pointFromEvent(event));
});
canvas.addEventListener("pointermove", (event) => {
  moveLipstickCursor(event);
  if (event.pointerId !== state.pointerId) return;
  const samples = event.getCoalescedEvents?.();
  for (const sample of samples?.length ? samples : [event]) strokeTo(pointFromEvent(sample));
});
canvas.addEventListener("pointerup", (event) => { if (event.pointerId === state.pointerId) endStroke(); });
canvas.addEventListener("pointercancel", endStroke);
canvas.addEventListener("pointerleave", () => { lipstickCursor.hidden = true; });
canvas.addEventListener("lostpointercapture", () => { state.pointerId = null; state.lastPoint = state.midpoint = null; state.wipeCarry = 0; });
startButton.addEventListener("click", startMirror);
brushSize.addEventListener("input", () => { state.brushRadius = Number(brushSize.value); });
document.getElementById("shutterButton").addEventListener("click", captureSnapshot);
document.getElementById("clearButton").addEventListener("click", clearMirror);
micRetry.addEventListener("click", enableMicrophone);
wipeTool.addEventListener("click", () => {
  endStroke(); clearHands();
  state.broadWipe = !state.broadWipe;
  state.lipstick = false;
  syncLipstickTool();
  lipstickTool.setAttribute("aria-pressed", "false");
  wipeTool.setAttribute("aria-pressed", String(state.broadWipe));
});
lipstickTool.addEventListener("click", () => {
  endStroke(); clearHands();
  state.lipstick = !state.lipstick;
  state.broadWipe = false;
  wipeTool.setAttribute("aria-pressed", "false");
  syncLipstickTool();
});
function syncLipstickTool() {
  lipstickTool.setAttribute("aria-pressed", String(state.lipstick));
  canvas.classList.toggle("lipstick-active", state.lipstick && !state.broadWipe);
  lipstickPalette.hidden = !state.lipstick;
  lipstickCursor.hidden = true;
}
function selectShade(index) {
  if (!LipstickBrush.shades[index]) return;
  endStroke(); clearHands();
  state.shade = LipstickBrush.shades[index];
  for (const button of shadeButtons) button.setAttribute("aria-pressed", String(Number(button.dataset.shade) === index));
  lipstickTool.style.setProperty("--lipstick-color", state.shade.color);
  lipstickCursor.style.setProperty("--lipstick-color", state.shade.color);
  LipstickBrush.sprite(state.shade);
}
for (const button of shadeButtons) button.addEventListener("click", () => selectShade(Number(button.dataset.shade)));
fogTool.addEventListener("pointerdown", event => { if (!state.running) return; event.preventDefault(); state.manualFog = true; fogTool.setPointerCapture(event.pointerId); });
for (const type of ["pointerup", "pointercancel", "lostpointercapture"]) fogTool.addEventListener(type, () => { state.manualFog = false; });
fogTool.addEventListener("keydown", event => { if (state.running && ["Space", "Enter"].includes(event.code)) { event.preventDefault(); state.manualFog = true; } });
fogTool.addEventListener("keyup", () => { state.manualFog = false; });
fogTool.addEventListener("blur", () => { state.manualFog = false; });
window.addEventListener("resize", fitCanvases);
window.addEventListener("keydown", (event) => {
  if (!state.running || state.helpOpen || event.ctrlKey || event.metaKey || event.altKey) return;
  if (event.key === "Escape") { if (stickerEditor.editing) setStickerMode(false); else returnToStart(); return; }
  if (event.target.closest("button, input, a")) return;
  state.lastKeyAt = performance.now();
  if (event.code === "Space") { event.preventDefault(); state.spaceDown = true; }
  else if (!event.repeat) {
    switch (event.key.toLowerCase()) {
      case "c": clearMirror(); break;
      case "s": captureSnapshot(); break;
      case "d": state.debug = !state.debug; readouts.hidden = !state.debug; break;
    }
  }
});
window.addEventListener("keyup", (event) => { if (event.code === "Space") state.spaceDown = false; });
window.addEventListener("blur", () => { state.spaceDown = state.manualFog = false; endStroke(); clearHands(); stickerEditor.endDrag(); });
document.addEventListener("visibilitychange", () => {
  state.spaceDown = state.manualFog = false;
  endStroke(); clearHands(); mouth = null;
  stickerEditor.endDrag();
  state.lastTime = performance.now();
  breathDetector.reset();
  if (document.hidden) state.audioContext?.suspend().catch(() => {});
  else if (state.running) state.audioContext?.resume().catch(() => {});
});
function releaseMedia() {
  state.stream?.getTracks().forEach((track) => track.stop());
  state.micStream?.getTracks().forEach(track => track.stop());
  state.audioContext?.close().catch(() => {});
  state.stream = state.micStream = state.audioContext = state.analyser = null;
  state.audioSource = state.audioSink = null;
  state.videoReady = false;
  video.srcObject = null;
}
window.addEventListener("pagehide", () => { returnToStart(); releaseMedia(); });
fitCanvases();
requestAnimationFrame(render);
if (!navigator.mediaDevices?.getUserMedia) {
  permissionHint.textContent = "Camera and microphone require a supported browser on localhost or HTTPS.";
  startButton.disabled = true;
}
