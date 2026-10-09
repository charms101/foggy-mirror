(function (root) {
  "use strict";
  class BreathDetector {
    constructor() { this.reset(); }
    reset() {
      this.floor = 0.003;
      this.warmup = 0;
      this.held = 0;
      this.level = 0;
      this.rms = 0;
      this.gate = 0.006;
      this.hiss = 0;
      this.wind = 0;
    }
    update(samples, spectrum, sampleRate, elapsed, blocked = false) {
      const dt = Math.min(100, Math.max(0, elapsed));
      let squares = 0;
      for (const value of samples) squares += value * value;
      this.rms = Math.sqrt(squares / Math.max(1, samples.length));
      this.warmup += dt;
      if (this.warmup < 700) {
        this.floor += (this.rms - this.floor) * (1 - Math.exp(-dt / 120));
        return 0;
      }
      let power = 0, logarithms = 0, count = 0, totalPower = 0;
      let windPower = 0, windLogarithms = 0, windCount = 0;
      for (let i = 1; i < spectrum.length; i++) {
        const frequency = i * sampleRate / (spectrum.length * 2);
        const energy = Math.pow(10, spectrum[i] / 10) || 1e-12;
        if (frequency >= 40 && frequency <= 8000) totalPower += energy;
        if (frequency >= 40 && frequency < 700) {
          windPower += energy;
          windLogarithms += Math.log(Math.max(1e-12, energy));
          windCount++;
        }
        if (frequency >= 700 && frequency <= 8000) {
          power += energy;
          logarithms += Math.log(Math.max(1e-12, energy));
          count++;
        }
      }
      this.hiss = count ? Math.exp(logarithms / count) / Math.max(1e-12, power / count) : 0;
      this.wind = windCount ? Math.exp(windLogarithms / windCount) / Math.max(1e-12, windPower / windCount) : 0;
      // Breath can be either airy hiss or low-frequency wind against the microphone.
      const noisy = (this.hiss > 0.08 && power / Math.max(1e-12, totalPower) > 0.08)
        || (this.wind > 0.12 && windPower / Math.max(1e-12, totalPower) > 0.35);
      this.gate = Math.max(0.0015, this.floor * 1.45 + 0.0008);
      const candidate = noisy && this.rms > this.gate && !blocked;
      if (!candidate) this.floor += (this.rms - this.floor) * (1 - Math.exp(-dt / (this.rms < this.floor ? 400 : 12000)));
      this.held = candidate ? this.held + dt : 0;
      if (this.held > 3500) this.floor += (this.rms - this.floor) * (1 - Math.exp(-dt / 4000));
      const target = this.held >= 160 ? Math.min(1, (this.rms - this.gate) / Math.max(0.003, this.gate * 0.7)) : 0;
      this.level += (target - this.level) * (1 - Math.exp(-dt / (target > this.level ? 100 : 80)));
      if (blocked) this.level = 0;
      return this.level;
    }
  }
  if (typeof module !== "undefined" && module.exports) module.exports = BreathDetector;
  else root.BreathDetector = BreathDetector;
})(typeof window !== "undefined" ? window : globalThis);
