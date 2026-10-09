const video = document.getElementById("camera");
const canvas = document.getElementById("mirror");
const ctx = canvas.getContext("2d", { alpha: false });

const permissionPanel = document.getElementById("permissionPanel");
const startButton = document.getElementById("startButton");
const permissionHint = document.getElementById("permissionHint");
const statusEl = document.getElementById("status");
const breathMeter = document.getElementById("breathMeter");
const breathLabel = document.getElementById("breathLabel");
const shutterButton = document.getElementById("shutterButton");
const fingerTool = document.getElementById("fingerTool");
const palmTool = document.getElementById("palmTool");
const fogButton = document.getElementById("fogButton");
const clearButton = document.getElementById("clearButton");

const fog = document.createElement("canvas");
const fogCtx = fog.getContext("2d", { willReadFrequently: false });
const mask = document.createElement("canvas");
const maskCtx = mask.getContext("2d", { willReadFrequently: false });
const droplets = document.createElement("canvas");
const dropletsCtx = droplets.getContext("2d", { willReadFrequently: false });

const state = {
  width: 0,
  height: 0,
  dpr: Math.min(window.devicePixelRatio || 1, 2),
  brush: "finger",
  pointerDown: false,
  lastPoint: null,
  audioReady: false,
  videoReady: false,
  analyser: null,
  audioData: null,
  breathLevel: 0,
  smoothedBreath: 0,
  fogAmount: 0.22,
  fogDirty: true,
  stream: null,
  lastTime: performance.now(),
  drops: []
};

function setStatus(message) {
  statusEl.textContent = message;
}

function fitCanvases() {
  const rect = canvas.getBoundingClientRect();
  const width = Math.max(1, Math.floor(rect.width * state.dpr));
  const height = Math.max(1, Math.floor(rect.height * state.dpr));
  if (width === state.width && height === state.height) return;

  state.width = width;
  state.height = height;
  [canvas, fog, mask, droplets].forEach((surface) => {
    surface.width = width;
    surface.height = height;
  });

  ctx.setTransform(1, 0, 0, 1, 0, 0);
  fogCtx.setTransform(1, 0, 0, 1, 0, 0);
  maskCtx.setTransform(1, 0, 0, 1, 0, 0);
  dropletsCtx.setTransform(1, 0, 0, 1, 0, 0);
  seedFog();
}

function randomRange(min, max) {
  return min + Math.random() * (max - min);
}

function seedFog() {
  fogCtx.clearRect(0, 0, state.width, state.height);
  maskCtx.clearRect(0, 0, state.width, state.height);
  dropletsCtx.clearRect(0, 0, state.width, state.height);
  state.drops = [];

  maskCtx.fillStyle = `rgba(255,255,255,${state.fogAmount})`;
  maskCtx.fillRect(0, 0, state.width, state.height);

  for (let i = 0; i < 80; i += 1) {
    const x = randomRange(0, state.width);
    const y = randomRange(0, state.height);
    const r = randomRange(18, 92) * state.dpr;
    const alpha = randomRange(0.012, 0.04);
    const gradient = maskCtx.createRadialGradient(x, y, 0, x, y, r);
    gradient.addColorStop(0, `rgba(255,255,255,${alpha})`);
    gradient.addColorStop(1, "rgba(255,255,255,0)");
    maskCtx.fillStyle = gradient;
    maskCtx.beginPath();
    maskCtx.arc(x, y, r, 0, Math.PI * 2);
    maskCtx.fill();
  }

  createDroplets(240);
  markFogDirty();
}

function markFogDirty() {
  state.fogDirty = true;
}

function createDroplets(count) {
  dropletsCtx.clearRect(0, 0, state.width, state.height);
  for (let i = 0; i < count; i += 1) {
    const x = randomRange(0, state.width);
    const y = randomRange(0, state.height);
    const radius = randomRange(0.7, 2.4) * state.dpr;
    const alpha = randomRange(0.16, 0.42);

    dropletsCtx.fillStyle = `rgba(255,255,255,${alpha})`;
    dropletsCtx.beginPath();
    dropletsCtx.ellipse(x, y, radius * randomRange(0.75, 1.4), radius, 0, 0, Math.PI * 2);
    dropletsCtx.fill();

    if (Math.random() > 0.86) {
      const length = randomRange(14, 74) * state.dpr;
      const fade = dropletsCtx.createLinearGradient(x, y, x, y + length);
      fade.addColorStop(0, `rgba(255,255,255,${alpha * 0.45})`);
      fade.addColorStop(1, "rgba(255,255,255,0)");
      dropletsCtx.strokeStyle = fade;
      dropletsCtx.lineWidth = randomRange(0.6, 1.5) * state.dpr;
      dropletsCtx.beginPath();
      dropletsCtx.moveTo(x, y);
      dropletsCtx.bezierCurveTo(x + randomRange(-2, 2) * state.dpr, y + length * 0.4, x + randomRange(-4, 4) * state.dpr, y + length * 0.8, x + randomRange(-2, 2) * state.dpr, y + length);
      dropletsCtx.stroke();
    }
  }
}

function rebuildFogTexture() {
  state.fogDirty = false;
  fogCtx.clearRect(0, 0, state.width, state.height);

  const base = fogCtx.createLinearGradient(0, 0, state.width, state.height);
  base.addColorStop(0, "rgba(237,235,224,0.58)");
  base.addColorStop(0.38, "rgba(214,216,205,0.72)");
  base.addColorStop(0.78, "rgba(244,241,229,0.54)");
  base.addColorStop(1, "rgba(190,194,187,0.62)");
  fogCtx.fillStyle = base;
  fogCtx.fillRect(0, 0, state.width, state.height);

  for (let i = 0; i < 130; i += 1) {
    const x = randomRange(-state.width * 0.1, state.width * 1.1);
    const y = randomRange(-state.height * 0.1, state.height * 1.1);
    const w = randomRange(60, 260) * state.dpr;
    const h = randomRange(18, 90) * state.dpr;
    fogCtx.fillStyle = `rgba(255,255,255,${randomRange(0.012, 0.05)})`;
    fogCtx.beginPath();
    fogCtx.ellipse(x, y, w, h, randomRange(-0.4, 0.4), 0, Math.PI * 2);
    fogCtx.fill();
  }

  fogCtx.globalCompositeOperation = "multiply";
  for (let i = 0; i < 34; i += 1) {
    const x = randomRange(0, state.width);
    const y = randomRange(0, state.height);
    const r = randomRange(40, 160) * state.dpr;
    const gradient = fogCtx.createRadialGradient(x, y, 0, x, y, r);
    gradient.addColorStop(0, "rgba(95,92,84,0.08)");
    gradient.addColorStop(1, "rgba(255,255,255,0)");
    fogCtx.fillStyle = gradient;
    fogCtx.beginPath();
    fogCtx.arc(x, y, r, 0, Math.PI * 2);
    fogCtx.fill();
  }
  fogCtx.globalCompositeOperation = "source-over";

  fogCtx.drawImage(droplets, 0, 0);
  fogCtx.globalCompositeOperation = "destination-in";
  fogCtx.drawImage(mask, 0, 0);
  fogCtx.globalCompositeOperation = "source-over";
}

async function startMirror() {
  permissionHint.textContent = "Requesting camera and microphone access…";
  setStatus("Requesting camera and microphone…");

  try {
    state.stream = await navigator.mediaDevices.getUserMedia({
      video: {
        facingMode: "user",
        width: { ideal: 1280 },
        height: { ideal: 720 }
      },
      audio: {
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false
      }
    });

    video.srcObject = state.stream;
    await video.play();
    state.videoReady = true;
    setupAudio(state.stream);
    permissionPanel.classList.add("is-hidden");
    setStatus("Blow into the mic to fog the mirror. Drag to write; use Palm for broad wipes.");
  } catch (error) {
    permissionPanel.classList.remove("is-hidden");
    permissionHint.textContent = "Permission was blocked or unavailable. You can retry after enabling camera and microphone access.";
    setStatus(`Could not start media: ${error.message}`);
  }
}

function setupAudio(stream) {
  const AudioContextCtor = window.AudioContext || window.webkitAudioContext;
  if (!AudioContextCtor) {
    setStatus("Camera is running, but this browser does not support Web Audio breath detection.");
    return;
  }

  const audioContext = new AudioContextCtor();
  const source = audioContext.createMediaStreamSource(stream);
  const analyser = audioContext.createAnalyser();
  analyser.fftSize = 2048;
  analyser.smoothingTimeConstant = 0.78;
  source.connect(analyser);

  state.analyser = analyser;
  state.audioData = new Uint8Array(analyser.frequencyBinCount);
  state.audioContext = audioContext;
  state.audioReady = true;

  if (audioContext.state === "suspended") {
    audioContext.resume().catch(() => {});
  }
}

function readBreathLevel() {
  if (!state.analyser || !state.audioData) return 0;

  state.analyser.getByteFrequencyData(state.audioData);
  let low = 0;
  let midHigh = 0;
  const lowBins = Math.floor(state.audioData.length * 0.08);
  const highStart = Math.floor(state.audioData.length * 0.12);
  const highEnd = Math.floor(state.audioData.length * 0.62);

  for (let i = 1; i < lowBins; i += 1) low += state.audioData[i];
  for (let i = highStart; i < highEnd; i += 1) midHigh += state.audioData[i];

  const lowAvg = low / Math.max(1, lowBins);
  const hissAvg = midHigh / Math.max(1, highEnd - highStart);
  const raw = Math.max(0, (hissAvg * 1.55 + lowAvg * 0.45 - 22) / 92);
  return Math.min(1, raw);
}

function addFog(strength, x = state.width / 2, y = state.height / 2, spread = Math.max(state.width, state.height) * 0.82) {
  maskCtx.globalCompositeOperation = "source-over";
  const cloudCount = Math.ceil(12 + strength * 38);
  for (let i = 0; i < cloudCount; i += 1) {
    const angle = Math.random() * Math.PI * 2;
    const distance = Math.sqrt(Math.random()) * spread * 0.55;
    const cx = x + Math.cos(angle) * distance;
    const cy = y + Math.sin(angle) * distance;
    const r = randomRange(50, 180) * state.dpr * (0.8 + strength);
    const alpha = randomRange(0.012, 0.032) * (1 + strength * 2.4);
    const gradient = maskCtx.createRadialGradient(cx, cy, 0, cx, cy, r);
    gradient.addColorStop(0, `rgba(255,255,255,${alpha})`);
    gradient.addColorStop(1, "rgba(255,255,255,0)");
    maskCtx.fillStyle = gradient;
    maskCtx.beginPath();
    maskCtx.arc(cx, cy, r, 0, Math.PI * 2);
    maskCtx.fill();
  }

  if (Math.random() < 0.55 + strength * 0.4) {
    createDroplets(Math.ceil(10 + strength * 24));
  }
  markFogDirty();
}

function eraseAt(point, radiusCss) {
  const radius = radiusCss * state.dpr;
  maskCtx.save();
  maskCtx.globalCompositeOperation = "destination-out";
  const gradient = maskCtx.createRadialGradient(point.x, point.y, radius * 0.12, point.x, point.y, radius);
  gradient.addColorStop(0, "rgba(0,0,0,1)");
  gradient.addColorStop(0.55, "rgba(0,0,0,0.86)");
  gradient.addColorStop(1, "rgba(0,0,0,0)");
  maskCtx.fillStyle = gradient;
  maskCtx.beginPath();
  maskCtx.arc(point.x, point.y, radius, 0, Math.PI * 2);
  maskCtx.fill();
  maskCtx.restore();
}

function drawWetEdge(point, radiusCss) {
  const radius = radiusCss * state.dpr;
  dropletsCtx.save();
  dropletsCtx.globalAlpha = radiusCss > 40 ? 0.2 : 0.34;
  dropletsCtx.strokeStyle = "rgba(255,255,255,0.34)";
  dropletsCtx.lineWidth = Math.max(0.8, radius * 0.035);
  dropletsCtx.beginPath();
  dropletsCtx.arc(point.x, point.y, radius * randomRange(0.72, 0.94), Math.random() * Math.PI, Math.random() * Math.PI + Math.PI);
  dropletsCtx.stroke();
  dropletsCtx.restore();
}

function strokeTo(point) {
  const radius = state.brush === "palm" ? 82 : 13;
  const last = state.lastPoint || point;
  const dx = point.x - last.x;
  const dy = point.y - last.y;
  const distance = Math.hypot(dx, dy);
  const steps = Math.max(1, Math.ceil(distance / Math.max(4, radius * state.dpr * 0.22)));

  for (let i = 0; i <= steps; i += 1) {
    const t = i / steps;
    const sample = {
      x: last.x + dx * t,
      y: last.y + dy * t
    };
    eraseAt(sample, radius);
    if (i % 2 === 0) drawWetEdge(sample, radius);
  }

  state.lastPoint = point;
  markFogDirty();
}

function pointFromEvent(event) {
  const rect = canvas.getBoundingClientRect();
  return {
    x: (event.clientX - rect.left) * state.dpr,
    y: (event.clientY - rect.top) * state.dpr
  };
}

function drawMirroredVideo(targetCtx) {
  targetCtx.save();
  targetCtx.fillStyle = "#171412";
  targetCtx.fillRect(0, 0, state.width, state.height);

  if (state.videoReady && video.videoWidth && video.videoHeight) {
    const videoRatio = video.videoWidth / video.videoHeight;
    const canvasRatio = state.width / state.height;
    let drawWidth = state.width;
    let drawHeight = state.height;
    let x = 0;
    let y = 0;

    if (videoRatio > canvasRatio) {
      drawHeight = state.height;
      drawWidth = drawHeight * videoRatio;
      x = (state.width - drawWidth) / 2;
    } else {
      drawWidth = state.width;
      drawHeight = drawWidth / videoRatio;
      y = (state.height - drawHeight) / 2;
    }

    targetCtx.translate(state.width, 0);
    targetCtx.scale(-1, 1);
    targetCtx.filter = "contrast(0.92) saturate(0.82) brightness(0.9)";
    targetCtx.drawImage(video, state.width - x - drawWidth, y, drawWidth, drawHeight);
    targetCtx.filter = "none";
  }

  targetCtx.restore();
}

function drawMirrorSheen(targetCtx) {
  targetCtx.save();
  targetCtx.globalCompositeOperation = "screen";
  const sheen = targetCtx.createLinearGradient(0, 0, state.width, state.height);
  sheen.addColorStop(0, "rgba(255,255,255,0.16)");
  sheen.addColorStop(0.24, "rgba(255,255,255,0.03)");
  sheen.addColorStop(0.55, "rgba(255,255,255,0.10)");
  sheen.addColorStop(1, "rgba(255,255,255,0.02)");
  targetCtx.fillStyle = sheen;
  targetCtx.fillRect(0, 0, state.width, state.height);
  targetCtx.restore();

  targetCtx.save();
  targetCtx.globalCompositeOperation = "multiply";
  const vignette = targetCtx.createRadialGradient(state.width * 0.5, state.height * 0.4, state.width * 0.1, state.width * 0.5, state.height * 0.52, state.width * 0.72);
  vignette.addColorStop(0, "rgba(255,255,255,0)");
  vignette.addColorStop(1, "rgba(0,0,0,0.34)");
  targetCtx.fillStyle = vignette;
  targetCtx.fillRect(0, 0, state.width, state.height);
  targetCtx.restore();
}

function render(time) {
  fitCanvases();
  const elapsed = Math.min(48, time - state.lastTime);
  state.lastTime = time;

  const breath = readBreathLevel();
  state.smoothedBreath += (breath - state.smoothedBreath) * 0.18;
  breathMeter.style.width = `${Math.round(state.smoothedBreath * 100)}%`;
  breathLabel.textContent = state.smoothedBreath > 0.38 ? "Fogging" : "Listening";

  if (state.smoothedBreath > 0.34) {
    const strength = Math.min(1, (state.smoothedBreath - 0.28) * 1.7);
    state.fogAmount = Math.min(0.9, state.fogAmount + strength * elapsed * 0.00018);
    addFog(strength * 0.18, state.width * randomRange(0.35, 0.65), state.height * randomRange(0.28, 0.7), Math.max(state.width, state.height) * 0.92);
  } else if (Math.random() < 0.012) {
    markFogDirty();
  }

  if (state.fogDirty) rebuildFogTexture();

  drawMirroredVideo(ctx);
  ctx.save();
  ctx.globalCompositeOperation = "source-over";
  ctx.drawImage(fog, 0, 0);
  ctx.restore();
  drawMirrorSheen(ctx);

  requestAnimationFrame(render);
}

function setBrush(brush) {
  state.brush = brush;
  const isFinger = brush === "finger";
  fingerTool.classList.toggle("is-active", isFinger);
  palmTool.classList.toggle("is-active", !isFinger);
  fingerTool.setAttribute("aria-pressed", String(isFinger));
  palmTool.setAttribute("aria-pressed", String(!isFinger));
  setStatus(isFinger ? "Finger mode: drag to write through the fog." : "Palm mode: drag broad soft wipes across the glass.");
}

function captureSnapshot() {
  if (state.fogDirty) rebuildFogTexture();

  const output = document.createElement("canvas");
  output.width = state.width;
  output.height = state.height;
  const outputCtx = output.getContext("2d", { alpha: false });
  drawMirroredVideo(outputCtx);
  outputCtx.drawImage(fog, 0, 0);
  drawMirrorSheen(outputCtx);

  const link = document.createElement("a");
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  link.download = `foggy-mirror-${timestamp}.png`;
  link.href = output.toDataURL("image/png");
  link.click();
  setStatus("Snapshot saved as a PNG.");
}

canvas.addEventListener("pointerdown", (event) => {
  state.pointerDown = true;
  canvas.setPointerCapture(event.pointerId);
  const oldBrush = state.brush;
  if (event.pointerType === "touch" && event.width > 48) state.brush = "palm";
  state.lastPoint = pointFromEvent(event);
  strokeTo(state.lastPoint);
  state.brush = oldBrush;
});

canvas.addEventListener("pointermove", (event) => {
  if (!state.pointerDown) return;
  const oldBrush = state.brush;
  if (event.shiftKey || event.altKey || (event.pointerType === "touch" && event.width > 48)) {
    state.brush = "palm";
  }
  strokeTo(pointFromEvent(event));
  state.brush = oldBrush;
});

canvas.addEventListener("pointerup", (event) => {
  state.pointerDown = false;
  state.lastPoint = null;
  if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
});

canvas.addEventListener("pointercancel", () => {
  state.pointerDown = false;
  state.lastPoint = null;
});

startButton.addEventListener("click", startMirror);
fingerTool.addEventListener("click", () => setBrush("finger"));
palmTool.addEventListener("click", () => setBrush("palm"));
fogButton.addEventListener("click", () => {
  addFog(0.8);
  setStatus("Added a fresh layer of condensation.");
});
clearButton.addEventListener("click", () => {
  maskCtx.clearRect(0, 0, state.width, state.height);
  markFogDirty();
  setStatus("The mirror is clear. Blow into the mic or tap + to fog it again.");
});
shutterButton.addEventListener("click", captureSnapshot);
window.addEventListener("resize", fitCanvases);

if (!navigator.mediaDevices?.getUserMedia) {
  permissionHint.textContent = "This browser does not support camera and microphone access.";
  setStatus("Media devices are not available in this browser.");
} else {
  fitCanvases();
  seedFog();
  requestAnimationFrame(render);
  startMirror();
}
