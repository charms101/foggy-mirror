(function (root) {
  "use strict";
  function classify(landmarks, aspect = 1, wasDrawing = false) {
    if (!landmarks || landmarks.length !== 21 || landmarks.some(p => !Number.isFinite(p.x) || !Number.isFinite(p.y))) return "hover";
    const distance = (a, b) => Math.hypot((a.x - b.x) * aspect, a.y - b.y);
    const wrist = landmarks[0];
    const curled = [8, 12, 16, 20].map(tip => distance(landmarks[tip], wrist) < distance(landmarks[tip - 2], wrist));
    if (curled.every(Boolean)) return "wipe";
    const indexExtended = distance(landmarks[8], wrist) > distance(landmarks[6], wrist) * (wasDrawing ? 1.05 : 1.12);
    return indexExtended && curled.slice(1).filter(Boolean).length >= 2 ? "draw" : "hover";
  }

  // Apply exactly the same cover crop and horizontal flip as the camera renderer.
  function mirrorPoint(point, width, height, videoWidth, videoHeight) {
    const scale = Math.max(width / videoWidth, height / videoHeight);
    const drawWidth = videoWidth * scale;
    const drawHeight = videoHeight * scale;
    return {
      x: width - ((width - drawWidth) / 2 + point.x * drawWidth),
      y: (height - drawHeight) / 2 + point.y * drawHeight
    };
  }

  const api = { classify, mirrorPoint };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.HandGestures = api;
})(typeof window !== "undefined" ? window : globalThis);
