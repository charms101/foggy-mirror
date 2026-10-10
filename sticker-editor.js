(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.StickerKit = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";
  const assets = [
    ["kiss", "Lipstick kiss"], ["disco", "Disco stars"], ["babygirl", "Babygirl"],
    ["just-a-girl", "Just a girl"], ["apple-kitty", "Apple kitty"], ["rose-kitty", "Rose kitty"],
    ["wink-kitty", "Winking kitty"], ["lily", "Red lily"], ["heart-kitty", "Heart sunglasses kitty"], ["stars", "Velvet stars"]
  ].map(([id, name]) => ({ id, name, src: `assets/stickers/${id}.png` }));

  class Scene {
    constructor() { this.items = []; this.selectedId = null; this.nextId = 1; this.width = this.height = 1; }
    get selected() { return this.items.find(item => item.id === this.selectedId); }
    rect(item, width = this.width, height = this.height) {
      const ratio = item.image.naturalWidth / item.image.naturalHeight;
      const w = Math.min(Math.min(width, height) * item.size, width * 0.85, height * 0.8 * ratio);
      const h = w / ratio;
      return { x: item.x * width - w / 2, y: item.y * height - h / 2, width: w, height: h };
    }
    move(item, x, y) {
      const rect = this.rect(item);
      const halfW = rect.width / this.width / 2, halfH = rect.height / this.height / 2;
      item.x = Math.max(halfW, Math.min(1 - halfW, x));
      item.y = Math.max(halfH, Math.min(1 - halfH, y));
    }
    resize(width, height) {
      this.width = Math.max(1, width); this.height = Math.max(1, height);
      for (const item of this.items) this.move(item, item.x, item.y);
    }
    add(asset, image) {
      if (!image.complete || !image.naturalWidth || !image.naturalHeight) return null;
      const offset = (this.items.length % 4) * 0.035;
      const item = { id: this.nextId++, asset, image, x: 0.5 + offset, y: 0.35 + offset, size: 0.3 };
      this.items.push(item); this.selectedId = item.id;
      this.move(item, item.x, item.y);
      return item;
    }
    select(id) {
      const index = this.items.findIndex(item => item.id === id);
      if (index < 0) { this.selectedId = null; return; }
      this.items.push(this.items.splice(index, 1)[0]);
      this.selectedId = id;
    }
    setSize(size) {
      if (!this.selected || !Number.isFinite(size)) return;
      this.selected.size = Math.max(0.12, Math.min(0.7, size));
      this.move(this.selected, this.selected.x, this.selected.y);
    }
    remove() { this.items = this.items.filter(item => item.id !== this.selectedId); this.selectedId = null; }
    clear() { this.items = []; this.selectedId = null; }
    draw(ctx) {
      for (const item of this.items) {
        const rect = this.rect(item);
        ctx.drawImage(item.image, rect.x, rect.y, rect.width, rect.height);
      }
    }
  }

  class Editor {
    constructor({ layer, gallery, sizeInput, removeButton, selectionTools, isEnabled }) {
      Object.assign(this, { layer, gallery, sizeInput, removeButton, selectionTools, isEnabled });
      this.scene = new Scene(); this.editing = false; this.drag = null;
      this.images = new Map(); this.nodes = new Map();
      sizeInput.addEventListener("input", () => {
        if (!this.editing || !this.isEnabled()) return;
        this.scene.setSize(Number(sizeInput.value) / 100); this.layout();
      });
      removeButton.addEventListener("click", () => {
        if (!this.editing || !this.isEnabled()) return;
        this.endDrag(); this.scene.remove(); this.sync();
      });
      layer.addEventListener("pointerdown", event => {
        if (event.target !== layer || !this.editing || !this.isEnabled()) return;
        this.scene.selectedId = null; this.layout();
      });
    }
    buildGallery() {
      if (this.images.size) return;
      for (const asset of assets) {
        const button = document.createElement("button");
        button.type = "button"; button.className = "sticker-choice"; button.disabled = true;
        button.setAttribute("aria-label", `Add ${asset.name}`); button.title = asset.name;
        const image = document.createElement("img");
        image.alt = asset.name; image.draggable = false;
        image.onload = () => { button.disabled = false; };
        image.onerror = () => { button.title = `${asset.name} unavailable`; button.setAttribute("aria-label", `${asset.name} unavailable`); };
        image.src = asset.src;
        button.append(image);
        button.addEventListener("click", () => {
          if (!this.editing || !this.isEnabled()) return;
          if (this.scene.add(asset, image)) this.sync();
        });
        this.images.set(asset.id, image); this.gallery.append(button);
      }
    }
    setEditing(value) {
      this.endDrag(); this.editing = value;
      this.layer.classList.toggle("is-editing", value);
      this.layer.setAttribute("aria-hidden", String(!value));
      if (value) this.buildGallery();
      this.layout();
    }
    endDrag() {
      if (!this.drag) return;
      const { node, pointerId } = this.drag;
      this.drag = null;
      if (node.hasPointerCapture(pointerId)) node.releasePointerCapture(pointerId);
    }
    sync() {
      const ids = new Set(this.scene.items.map(item => item.id));
      for (const [id, node] of this.nodes) if (!ids.has(id)) { node.remove(); this.nodes.delete(id); }
      for (const item of this.scene.items) {
        let node = this.nodes.get(item.id);
        if (!node) {
          node = document.createElement("button"); node.type = "button"; node.className = "placed-sticker";
          node.setAttribute("aria-label", `Move ${item.asset.name} sticker`); node.title = item.asset.name;
          const image = document.createElement("img"); image.src = item.asset.src; image.alt = ""; image.draggable = false;
          node.append(image);
          node.addEventListener("pointerdown", event => {
            if (!this.editing || !this.isEnabled() || this.drag || event.button !== 0) return;
            event.preventDefault(); event.stopPropagation();
            this.scene.select(item.id); this.sync(); node.focus({ preventScroll: true });
            this.drag = { node, pointerId: event.pointerId, item, clientX: event.clientX, clientY: event.clientY, x: item.x, y: item.y };
            node.setPointerCapture(event.pointerId);
          });
          node.addEventListener("pointermove", event => {
            if (!this.drag || this.drag.pointerId !== event.pointerId || !this.isEnabled()) return;
            const bounds = this.layer.getBoundingClientRect();
            const drag = this.drag;
            this.scene.move(drag.item, drag.x + (event.clientX - drag.clientX) / bounds.width, drag.y + (event.clientY - drag.clientY) / bounds.height);
            this.layout();
          });
          for (const type of ["pointerup", "pointercancel", "lostpointercapture"]) node.addEventListener(type, event => {
            if (this.drag?.pointerId === event.pointerId) this.endDrag();
          });
          node.addEventListener("click", () => { if (this.editing && this.isEnabled()) { this.scene.select(item.id); this.sync(); } });
          node.addEventListener("keydown", event => {
            if (!this.editing || !this.isEnabled()) return;
            const steps = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
            if (steps[event.key]) {
              event.preventDefault(); event.stopPropagation(); this.scene.select(item.id);
              const bounds = this.layer.getBoundingClientRect(), step = event.shiftKey ? 20 : 5;
              this.scene.move(item, item.x + steps[event.key][0] * step / bounds.width, item.y + steps[event.key][1] * step / bounds.height);
              this.sync();
            } else if (["Delete", "Backspace"].includes(event.key)) {
              event.preventDefault(); event.stopPropagation(); this.scene.selectedId = item.id; this.scene.remove(); this.sync(); this.layer.focus();
            }
          });
          this.nodes.set(item.id, node);
        }
        this.layer.append(node);
      }
      this.layout();
    }
    layout() {
      const bounds = this.layer.getBoundingClientRect();
      for (const item of this.scene.items) {
        const node = this.nodes.get(item.id);
        if (!node) continue;
        const rect = this.scene.rect(item, bounds.width, bounds.height);
        Object.assign(node.style, { left: `${rect.x}px`, top: `${rect.y}px`, width: `${rect.width}px`, height: `${rect.height}px` });
        node.setAttribute("aria-pressed", String(this.editing && item.id === this.scene.selectedId));
        node.tabIndex = this.editing ? 0 : -1;
      }
      this.selectionTools.hidden = !this.editing || !this.scene.selected;
      this.removeButton.disabled = !this.scene.selected;
      if (this.scene.selected) this.sizeInput.value = Math.round(this.scene.selected.size * 100);
    }
    clear() { this.endDrag(); this.scene.clear(); this.sync(); }
    resize(width, height) { this.endDrag(); this.scene.resize(width, height); this.layout(); }
    draw(ctx) { this.scene.draw(ctx); }
  }
  return { assets, Scene, Editor };
});
