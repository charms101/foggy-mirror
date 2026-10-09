(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.LipstickBrush = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";
  const shades = [
    { name: "Cherry", color: "#c9142f", dark: "#71091a", light: "#ff6f76" },
    { name: "Classic red", color: "#d8232a", dark: "#7e0e14", light: "#ff7f66" },
    { name: "Wine", color: "#7c1023", dark: "#3d0611", light: "#c2495a" },
    { name: "Hot pink", color: "#e33a80", dark: "#8a1547", light: "#ff8cc0" },
    { name: "Coral", color: "#e75a45", dark: "#8d281c", light: "#ffa683" },
    { name: "Rosewood", color: "#a2544e", dark: "#552624", light: "#dc958b" }
  ];
  const brushes = new Map();
  const tubes = new Map();
  function sprite(shade) {
    if (brushes.has(shade.color)) return brushes.get(shade.color);
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 96;
    const g = canvas.getContext("2d");
    g.translate(48, 48);
    g.scale(1, 0.72);
    const pigment = g.createRadialGradient(-9, -9, 1, 0, 0, 46);
    pigment.addColorStop(0, shade.color);
    pigment.addColorStop(0.22, shade.color);
    pigment.addColorStop(0.87, shade.color);
    pigment.addColorStop(0.97, `${shade.color}e0`);
    pigment.addColorStop(1, "transparent");
    g.fillStyle = pigment;
    g.beginPath();
    g.arc(0, 0, 46, 0, Math.PI * 2);
    g.fill();
    // Fixed parallel gaps survive overlapping dabs instead of averaging into a solid marker.
    g.globalCompositeOperation = "destination-out";
    for (let i = 0; i < 8; i++) {
      g.globalAlpha = 0.985 + (i % 3) * 0.005;
      g.lineWidth = 4 + i % 3;
      g.beginPath();
      g.moveTo(-46, -31 + i * 9);
      g.lineTo(46, -31 + i * 9);
      g.stroke();
    }
    brushes.set(shade.color, canvas);
    return canvas;
  }
  function dab(ctx, point, radius, shade, angle, alpha = 0.72) {
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.translate(point.x, point.y);
    ctx.rotate(angle);
    ctx.drawImage(sprite(shade), -radius, -radius, radius * 2, radius * 2);
    ctx.restore();
  }
  function curve(ctx, from, control, to, radius, shade, stroke) {
    const length = Math.hypot(control.x - from.x, control.y - from.y) + Math.hypot(to.x - control.x, to.y - control.y);
    const steps = Math.max(1, Math.ceil(length / Math.max(0.5, radius * 0.12)));
    const spacing = Math.max(0.5, radius * 0.12);
    let previous = from;
    for (let i = 1; i <= steps; i++) {
      const t = i / steps, u = 1 - t;
      const point = { x: u * u * from.x + 2 * u * t * control.x + t * t * to.x,
        y: u * u * from.y + 2 * u * t * control.y + t * t * to.y };
      const distance = Math.hypot(point.x - previous.x, point.y - previous.y);
      stroke.inkCarry = (stroke.inkCarry || 0) + distance;
      if (stroke.inkCarry >= spacing) {
        dab(ctx, point, radius, shade, Math.atan2(point.y - previous.y, point.x - previous.x));
        stroke.inkCarry %= spacing;
      }
      previous = point;
    }
  }
  function tube(shade) {
    if (tubes.has(shade.color)) return tubes.get(shade.color);
    const canvas = document.createElement("canvas");
    canvas.width = 72; canvas.height = 192;
    const g = canvas.getContext("2d");
    const wax = g.createLinearGradient(15, 0, 57, 0);
    wax.addColorStop(0, shade.dark); wax.addColorStop(0.4, shade.light); wax.addColorStop(0.65, shade.color); wax.addColorStop(1, shade.dark);
    g.fillStyle = wax;
    g.beginPath();
    g.moveTo(15, 84); g.lineTo(15, 24);
    g.quadraticCurveTo(15, 12, 28, 7); g.lineTo(48, 1);
    g.quadraticCurveTo(57, 0, 57, 12); g.lineTo(57, 84);
    g.fill();
    const metal = g.createLinearGradient(8, 0, 64, 0);
    metal.addColorStop(0, "#747474"); metal.addColorStop(0.3, "#fafafa"); metal.addColorStop(0.6, "#a5a5a5"); metal.addColorStop(1, "#ededed");
    g.fillStyle = metal; g.fillRect(9, 72, 54, 38);
    const casing = g.createLinearGradient(5, 0, 67, 0);
    casing.addColorStop(0, "#090909"); casing.addColorStop(0.28, "#444444"); casing.addColorStop(0.46, "#161616"); casing.addColorStop(1, "#050505");
    g.fillStyle = casing; g.fillRect(5, 108, 62, 80);
    g.fillStyle = "#a5a5a5"; g.fillRect(5, 110, 62, 2);
    tubes.set(shade.color, canvas);
    return canvas;
  }
  return { shades, sprite, dab, curve, tube };
});
