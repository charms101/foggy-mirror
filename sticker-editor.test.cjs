const assert = require("node:assert/strict");
const { assets, Scene, Editor } = require("./sticker-editor.js");
const image = { complete: true, naturalWidth: 240, naturalHeight: 160 };
const scene = new Scene();
scene.resize(1280, 720);
const kiss = scene.add(assets[0], image);
const disco = scene.add(assets[1], image);
assert.equal(scene.items.length, 2);
assert.equal(scene.selected, disco);
scene.select(kiss.id);
assert.equal(scene.items.at(-1), kiss, "Selected sticker moves to the front");
scene.move(kiss, -10, 20);
let rect = scene.rect(kiss);
assert.ok(rect.x >= 0 && rect.y + rect.height <= 720 + 1e-8, "Dragging is bounded to the glass");
scene.setSize(2);
assert.equal(kiss.size, 0.7, "Oversized input is capped");
scene.resize(390, 844);
rect = scene.rect(kiss);
assert.ok(rect.x >= 0 && rect.x + rect.width <= 390 + 1e-8);
assert.ok(Math.abs(rect.width / rect.height - 1.5) < 1e-8, "Resize preserves the original aspect ratio");
const draws = [];
scene.draw({ drawImage: (...args) => draws.push(args) });
assert.equal(draws.length, 2, "Photo composition includes all stickers");
assert.equal(draws.at(-1)[0], image);
assert.equal(draws.at(-1).length, 5, "Photo rendering draws only the artwork, not selection controls");
scene.remove();
assert.equal(scene.items.length, 1, "Delete removes only the selection");
scene.clear();
assert.equal(scene.items.length, 0);
assert.equal(scene.add(assets[0], { complete: false }), null, "Unloaded assets cannot create broken stickers");

class Element {
  constructor(tag = "div") {
    this.tag = tag; this.children = []; this.events = {}; this.attributes = {}; this.style = {};
    this.classList = { toggle() {} }; this.complete = true; this.naturalWidth = 240; this.naturalHeight = 160;
  }
  set src(value) { this.source = value; this.onload?.(); }
  get src() { return this.source; }
  addEventListener(type, handler) { this.events[type] = handler; }
  setAttribute(name, value) { this.attributes[name] = value; }
  append(child) { child.remove(); child.parent = this; this.children.push(child); }
  remove() { if (this.parent) this.parent.children = this.parent.children.filter(child => child !== this); this.parent = null; }
  getBoundingClientRect() { return { width: 390, height: 844 }; }
  focus() { this.focused = true; }
  setPointerCapture(id) { this.capture = id; }
  hasPointerCapture(id) { return this.capture === id; }
  releasePointerCapture() { this.capture = null; }
}
global.document = { createElement: tag => new Element(tag) };
let enabled = true;
const layer = new Element(), gallery = new Element(), sizeInput = new Element(), removeButton = new Element(), selectionTools = new Element();
const editor = new Editor({ layer, gallery, sizeInput, removeButton, selectionTools, isEnabled: () => enabled });
editor.resize(390, 844);
editor.setEditing(true);
assert.equal(gallery.children.length, assets.length);
assert.equal(layer.attributes["aria-hidden"], "false");
gallery.children[0].events.click();
assert.equal(editor.scene.items.length, 1, "Picker adds the chosen sticker");
const item = editor.scene.selected, node = editor.nodes.get(item.id);
const event = { button: 0, pointerId: 1, clientX: 195, clientY: 295, preventDefault() {}, stopPropagation() {} };
node.events.pointerdown(event);
node.events.pointermove({ ...event, clientX: 260, clientY: 370 });
assert.ok(item.x > 0.5 && item.y > 0.35, "Pointer drag moves the sticker rather than drawing");
node.events.pointerup(event);
assert.equal(editor.drag, null);
assert.equal(node.capture, null);
sizeInput.value = "50"; sizeInput.events.input();
assert.equal(item.size, 0.5, "Size slider updates the selection");
enabled = false;
const count = editor.scene.items.length;
gallery.children[1].events.click(); removeButton.events.click();
assert.equal(editor.scene.items.length, count, "Help and paused mirror lock sticker mutations");
enabled = true;
node.events.keydown({ ...event, key: "ArrowLeft", shiftKey: false });
assert.ok(node.focused, "Pointer selection focuses the sticker for keyboard movement");
removeButton.events.click();
assert.equal(editor.scene.items.length, 0);
assert.equal(selectionTools.hidden, true);
editor.setEditing(false);
assert.equal(layer.attributes["aria-hidden"], "true");
gallery.children[0].events.click();
assert.equal(editor.scene.items.length, 0, "Done disables sticker adding and manipulation");
console.log("Stickers: adding, selection, z-order, pointer and keyboard movement, resizing, boundaries, locks, removal, and photo composition passed.");
