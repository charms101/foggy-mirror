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
window.lucide?.createIcons();

const mask = document.createElement("canvas");
const maskCtx = mask.getContext("2d");
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
  running: false, starting: false, videoReady: false,
  stream: null, audioContext: null, analyser: null, audioData: null,
  smoothedBreath: 0, spaceDown: false, fogTime: 0,
  brushRadius: 15, pointerId: null, palm: false,
  lastPoint: null, midpoint: null, wipeCarry: 0,
  debug: false, fps: 0, lastTime: performance.now()
};
let statusTimer;

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
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const width = Math.max(1, Math.round(rect.width * dpr));
  const height = Math.max(1, Math.round(rect.height * dpr));
  if (width === state.width && height === state.height && dpr === state.dpr) return;
  endStroke();
  const oldMask = document.createElement("canvas");
  if (state.width) {
    oldMask.width = mask.width;
    oldMask.height = mask.height;
    oldMask.getContext("2d").drawImage(mask, 0, 0);
  }
  state.width = canvas.width = mask.width = width;
  state.height = canvas.height = mask.height = height;
  state.dpr = dpr;
  // Blur a bounded texture, then upscale it; sharp video and strokes stay full resolution.
  const scale = Math.min(1, 960 / Math.max(width, height));
  frost.width = Math.max(1, Math.round(width * scale));
  frost.height = Math.max(1, Math.round(height * scale));
  if (oldMask.width) maskCtx.drawImage(oldMask, 0, 0, width, height);
  else resetFog();
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

function drawFrame(targetCtx) {
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
}

function addFog(strength) {
  const reach = Math.min(state.width, state.height) * 0.43 * (0.6 + strength * 0.7);
  maskCtx.save();
  for (let i = 0; i < 12; i++) {
    const angle = Math.random() * Math.PI * 2;
    const distance = Math.pow(Math.random(), 1.3) * reach;
    const x = state.width / 2 + Math.cos(angle) * distance * 1.45;
    const y = state.height * 0.55 + Math.sin(angle) * distance - distance * 0.18;
    const radius = reach * (0.16 + Math.random() * 0.26);
    maskCtx.globalAlpha = 0.36 * (0.3 + strength * 0.7) * (0.45 + Math.random() * 0.55);
    maskCtx.drawImage(puff, x - radius, y - radius, radius * 2, radius * 2);
  }
  maskCtx.restore();
}

function strokeTo(point) {
  const last = state.lastPoint;
  maskCtx.save();
  maskCtx.globalCompositeOperation = "destination-out";
  if (state.palm) {
    // Stamp by distance, so a stationary hand never keeps removing fog.
    if (last) {
      const distance = Math.hypot(point.x - last.x, point.y - last.y);
      const radius = 82 * state.dpr;
      const spacing = radius * 0.5;
      for (let travel = spacing - state.wipeCarry; travel <= distance; travel += spacing) {
        const t = travel / distance;
        const x = last.x + (point.x - last.x) * t;
        const y = last.y + (point.y - last.y) * t;
        const gradient = maskCtx.createRadialGradient(x, y, radius * 0.4, x, y, radius);
        gradient.addColorStop(0, "rgba(0,0,0,0.34)");
        gradient.addColorStop(1, "rgba(0,0,0,0)");
        maskCtx.fillStyle = gradient;
        maskCtx.fillRect(x - radius, y - radius, radius * 2, radius * 2);
      }
      state.wipeCarry = (state.wipeCarry + distance) % spacing;
    }
  } else {
    const radius = state.brushRadius * state.dpr;
    maskCtx.fillStyle = maskCtx.strokeStyle = "#000";
    maskCtx.lineWidth = radius * 2;
    maskCtx.lineCap = maskCtx.lineJoin = "round";
    maskCtx.beginPath();
    if (!last) {
      maskCtx.arc(point.x, point.y, radius, 0, Math.PI * 2);
      maskCtx.fill();
      state.midpoint = point;
    } else {
      const mid = { x: (point.x + last.x) / 2, y: (point.y + last.y) / 2 };
      maskCtx.moveTo(state.midpoint.x, state.midpoint.y);
      maskCtx.quadraticCurveTo(last.x, last.y, mid.x, mid.y);
      maskCtx.stroke();
      state.midpoint = mid;
    }
  }
  maskCtx.restore();
  state.lastPoint = point;
}

function endStroke() {
  if (state.lastPoint && state.midpoint && !state.palm) {
    maskCtx.save();
    maskCtx.globalCompositeOperation = "destination-out";
    maskCtx.strokeStyle = "#000";
    maskCtx.lineWidth = state.brushRadius * state.dpr * 2;
    maskCtx.lineCap = "round";
    maskCtx.beginPath();
    maskCtx.moveTo(state.midpoint.x, state.midpoint.y);
    maskCtx.lineTo(state.lastPoint.x, state.lastPoint.y);
    maskCtx.stroke();
    maskCtx.restore();
  }
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
  state.analyser.smoothingTimeConstant = 0.78;
  state.audioContext.createMediaStreamSource(stream).connect(state.analyser);
  state.audioData = new Uint8Array(state.analyser.frequencyBinCount);
}

function readBreathLevel() {
  if (!state.analyser) return 0;
  state.analyser.getByteFrequencyData(state.audioData);
  const lowEnd = Math.floor(state.audioData.length * 0.08);
  const highStart = Math.floor(state.audioData.length * 0.12);
  const highEnd = Math.floor(state.audioData.length * 0.62);
  let low = 0, high = 0;
  for (let i = 1; i < lowEnd; i++) low += state.audioData[i];
  for (let i = highStart; i < highEnd; i++) high += state.audioData[i];
  return Math.min(1, Math.max(0, (high / (highEnd - highStart) * 1.55 + low / Math.max(1, lowEnd - 1) * 0.45 - 22) / 92));
}

async function startMirror() {
  if (state.starting || state.running) return;
  state.starting = true;
  startButton.disabled = true;
  permissionHint.textContent = "Opening camera and microphone...";
  try {
    if (!state.stream) state.stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: "user", width: { ideal: 1280 }, height: { ideal: 720 } },
      audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false }
    });
    video.srcObject = state.stream;
    await video.play();
    state.videoReady = true;
    if (!state.audioContext) setupAudio(state.stream);
    await state.audioContext?.resume();
    fitCanvases();
    state.running = true;
    state.lastTime = performance.now();
    permissionPanel.classList.add("is-hidden");
    mirrorControls.hidden = false;
    permissionHint.textContent = "";
    canvas.focus({ preventScroll: true });
    setStatus("Ready");
  } catch (error) {
    state.stream?.getTracks().forEach((track) => track.stop());
    state.stream = null;
    state.videoReady = false;
    state.audioContext?.close().catch(() => {});
    state.audioContext = state.analyser = null;
    permissionHint.textContent = `Camera and microphone unavailable (${error.name}). Allow access in your browser, then try Start again.`;
  } finally {
    state.starting = false;
    startButton.disabled = false;
  }
}

function returnToStart() {
  if (!state.running) return;
  endStroke();
  state.running = state.spaceDown = state.debug = false;
  state.fogTime = state.smoothedBreath = 0;
  readouts.hidden = mirrorControls.hidden = true;
  resetFog();
  permissionPanel.classList.remove("is-hidden");
  statusEl.classList.add("is-hidden");
  startButton.focus({ preventScroll: true });
}

function render(time) {
  requestAnimationFrame(render);
  if (!state.running) return;
  fitCanvases();
  const elapsed = Math.min(48, time - state.lastTime);
  state.lastTime = time;
  state.smoothedBreath += (readBreathLevel() - state.smoothedBreath) * (1 - Math.exp(-elapsed / 84));
  state.fps += (1000 / Math.max(1, elapsed) - state.fps) * 0.08;
  const fogging = state.spaceDown || (state.smoothedBreath > 0.34 && state.pointerId === null);
  if (fogging) {
    state.fogTime += elapsed;
    // Use elapsed time rather than frame count for consistent condensation buildup.
    while (state.fogTime >= 1000 / 30) {
      addFog(state.spaceDown ? 1 : Math.min(1, (state.smoothedBreath - 0.28) * 1.7));
      state.fogTime -= 1000 / 30;
    }
  } else state.fogTime = 0;
  if (state.debug) readouts.textContent = `mic ${state.smoothedBreath.toFixed(3)}  ${fogging ? "FOGGING" : "quiet"}\naudio ${state.audioContext?.state || "unavailable"}  ${Math.round(state.fps)} fps`;
  drawFrame(ctx);
}

function captureSnapshot() {
  if (!state.running) return;
  const output = document.createElement("canvas");
  output.width = state.width;
  output.height = state.height;
  drawFrame(output.getContext("2d", { alpha: false }));
  try {
    const link = document.createElement("a");
    link.download = `foggy-mirror-${new Date().toISOString().replace(/[:.]/g, "-")}.png`;
    link.href = output.toDataURL("image/png");
    link.click();
    flash.classList.remove("pop");
    void flash.offsetWidth;
    flash.classList.add("pop");
    setStatus("Photo ready. Check your downloads.");
  } catch (error) {
    setStatus(`Could not save photo: ${error.message}`);
  }
}

function pointFromEvent(event) {
  const rect = canvas.getBoundingClientRect();
  return { x: (event.clientX - rect.left) * state.dpr, y: (event.clientY - rect.top) * state.dpr };
}
canvas.addEventListener("pointerdown", (event) => {
  if (!state.running || state.pointerId !== null || event.button !== 0) return;
  state.pointerId = event.pointerId;
  state.palm = event.shiftKey || event.altKey || (event.pointerType === "touch" && event.width > 48);
  canvas.setPointerCapture(event.pointerId);
  strokeTo(pointFromEvent(event));
});
canvas.addEventListener("pointermove", (event) => {
  if (event.pointerId !== state.pointerId) return;
  const samples = event.getCoalescedEvents?.();
  for (const sample of samples?.length ? samples : [event]) strokeTo(pointFromEvent(sample));
});
canvas.addEventListener("pointerup", (event) => { if (event.pointerId === state.pointerId) endStroke(); });
canvas.addEventListener("pointercancel", endStroke);
canvas.addEventListener("lostpointercapture", () => { state.pointerId = null; state.lastPoint = state.midpoint = null; state.wipeCarry = 0; });
startButton.addEventListener("click", startMirror);
brushSize.addEventListener("input", () => { state.brushRadius = Number(brushSize.value); });
document.getElementById("shutterButton").addEventListener("click", captureSnapshot);
window.addEventListener("resize", fitCanvases);
window.addEventListener("keydown", (event) => {
  if (!state.running || event.ctrlKey || event.metaKey || event.altKey) return;
  if (event.key === "Escape") { returnToStart(); return; }
  if (event.target.closest("button, input, a")) return;
  if (event.code === "Space") { event.preventDefault(); state.spaceDown = true; }
  else if (!event.repeat) {
    switch (event.key.toLowerCase()) {
      case "c": maskCtx.clearRect(0, 0, state.width, state.height); break;
      case "s": captureSnapshot(); break;
      case "d": state.debug = !state.debug; readouts.hidden = !state.debug; break;
    }
  }
});
window.addEventListener("keyup", (event) => { if (event.code === "Space") state.spaceDown = false; });
window.addEventListener("blur", () => { state.spaceDown = false; endStroke(); });
window.addEventListener("pagehide", () => {
  state.stream?.getTracks().forEach((track) => track.stop());
  state.audioContext?.close().catch(() => {});
});
fitCanvases();
requestAnimationFrame(render);
if (!navigator.mediaDevices?.getUserMedia) {
  permissionHint.textContent = "Camera and microphone require a supported browser on localhost or HTTPS.";
  startButton.disabled = true;
}
