import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createZKeyTracker } from "../scripts/keyboard.mjs";
import { createInputController, isPingGesture } from "../scripts/input.mjs";
import { buildSnapshot, canPingActor } from "../scripts/dnd5e.mjs";
import { sendPing } from "../scripts/chat.mjs";
import { formatMessage } from "../scripts/formatter.mjs";
import { registerSettings, getInputMode } from "../scripts/settings.mjs";
import { buildTokenSnapshot, canPingToken, resolveCanvasToken, createMapInputController, sendTokenPing } from "../scripts/token.mjs";

const strings = JSON.parse(await readFile(new URL("../lang/ko.json", import.meta.url)));
const localize = key => key.split(".").reduce((o, k) => o?.[k], strings) ?? key;
const format = (key, values) => localize(key).replace(/\{(\w+)\}/g, (_, key) => values[key] ?? "");
const editable = { closest: () => ({}) };
const plain = { closest: () => null };
function emit(root, type, props = {}, target) {
  const event = new Event(type, { cancelable: true });
  Object.assign(event, props);
  if (target) Object.defineProperty(event, "target", { value: target });
  root.dispatchEvent(event);
  return event;
}
const flush = () => new Promise(resolve => setImmediate(resolve));
function environment() {
  const user = { id: "u1", name: "민수", isGM: false, color: "#2468ac" };
  const values = new Map([["enabled", true], ["zEnabled", true], ["allowObserverPings", true], ["inputMode", "zClick"]]);
  const game = { user, version: "13.351", system: { id: "dnd5e", version: "5.3.3" },
    settings: { get: (module, key) => values.get(key) }, i18n: { localize, format } };
  const config = { currencies: { pp: { label: "백금화" }, gp: { label: "금화" }, ep: { label: "호박금화" }, sp: { label: "은화" }, cp: { label: "동화" } } };
  const actor = {
    id: "a1", uuid: "Actor.a1", name: "아르벨", type: "character",
    testUserPermission: (u, level) => u === user && level === "OBSERVER",
    system: { attributes: { inspiration: true }, currency: { pp: 0, gp: 120, ep: 0, sp: 3, cp: 5 } }, items: new Map()
  };
  const snap = target => buildSnapshot({ actor, user, target, config, localize, allowObservers: true });
  return { user, values, game, config, actor, snap };
}
function tokenEnvironment() {
  const base = environment();
  const view = {};
  const scene = { id: "scene1" };
  const token = {
    isVisible: true, isPreview: false,
    center: { x: 15, y: 15 },
    document: { name: "고블린 A", uuid: "Scene.scene1.Token.t1", hidden: false, parent: scene },
    bounds: { contains: (x, y) => x >= 10 && x <= 20 && y >= 10 && y <= 20 }
  };
  Object.defineProperty(token, "actor", { get() { throw new Error("Actor data must not be read"); } });
  const canvas = { ready: true, scene, app: { view }, tokens: { active: true, hover: token },
    canvasCoordinatesFromClient: ({ x, y }) => ({ x: x / 2, y: y / 2 }) };
  const window = new EventTarget();
  let held = true;
  let currentCanvas = canvas;
  const sent = [], notices = [];
  const controller = createMapInputController({ game: base.game, window,
    getCanvas: () => currentCanvas, isZHeld: () => held,
    send: async (token, context) => sent.push(token ? buildTokenSnapshot(token, base.user) : { kind: "point", position: context.position }), notify: key => notices.push(key) });
  const pointer = (type, changes = {}, target = view) => emit(window, type, {
    button: 0, shiftKey: false, pointerId: 1, clientX: 30, clientY: 30, ...changes
  }, target);
  return { ...base, view, scene, token, canvas, window, sent, notices, controller, pointer,
    setHeld: value => { held = value; }, setCanvas: value => { currentCanvas = value; } };
}

test("physical Z key tracks without consuming shortcuts, including keyup in an input", () => {
  const window = new EventTarget(), document = new EventTarget();
  const key = createZKeyTracker({ window, document });
  const event = emit(window, "keydown", { code: "KeyZ", key: "ㅋ" }, plain);
  assert.equal(key.isHeld(), true);
  assert.equal(event.defaultPrevented, false);
  emit(window, "keyup", { code: "KeyZ" }, editable);
  assert.equal(key.isHeld(), false);
  emit(window, "keydown", { code: "KeyA" }, plain);
  assert.equal(key.isHeld(), false);
  key.destroy();
});

test("typing, composition and mixed modifier Z keystrokes never arm pings", () => {
  const window = new EventTarget(), document = new EventTarget();
  const key = createZKeyTracker({ window, document });
  emit(window, "keydown", { code: "KeyZ" }, editable);
  assert.equal(key.isHeld(), false);
  for (const change of [{ isComposing: true }, { ctrlKey: true }, { metaKey: true }, { altKey: true }, { shiftKey: true }]) {
    emit(window, "keydown", { code: "KeyZ", ...change }, plain);
    assert.equal(key.isHeld(), false);
  }
  key.destroy();
});

test("blur, input focus, hidden tab, teardown and tracker destruction clear Z", () => {
  const window = new EventTarget(), document = new EventTarget();
  const key = createZKeyTracker({ window, document });
  for (const reset of [() => emit(window, "blur"), () => emit(document, "focusin", {}, editable), () => {
    document.hidden = true; emit(document, "visibilitychange");
  }, key.clear]) {
    emit(window, "keydown", { code: "KeyZ" }, plain);
    assert.equal(key.isHeld(), true);
    reset();
    assert.equal(key.isHeld(), false);
  }
  key.destroy();
  emit(window, "keydown", { code: "KeyZ" }, plain);
  assert.equal(key.isHeld(), false);
});

test("Shift-click and Shift-double-click pass through even while Z is held", async () => {
  const { game, actor } = environment();
  class Official {}
  const app = Object.assign(new Official(), { actor });
  const root = new EventTarget();
  let held = true, native = 0, pings = 0;
  const input = createInputController({ game, systemAPI: { applications: { actor: { CharacterActorSheet: Official } } },
    isZHeld: () => held, resolve: () => ({ kind: "hp" }), send: async () => pings++, notify: () => {} });
  input.bind(app, root);
  root.addEventListener("click", () => native++);
  root.addEventListener("dblclick", () => native++);
  for (const type of ["click", "dblclick"]) {
    assert.equal(emit(root, type, { button: 0, shiftKey: true }).defaultPrevented, false);
  }
  held = false;
  assert.equal(emit(root, "click", { button: 0, shiftKey: true }).defaultPrevented, false);
  assert.equal(isPingGesture({ button: 0, shiftKey: false }, false), false);
  assert.equal(native, 3);
  assert.equal(pings, 0);
  input.unbind(app);
});

test("inspiration reads both boolean states without toggling the Actor", () => {
  const { actor, snap } = environment();
  const before = structuredClone(actor.system);
  const snapshot = snap({ kind: "inspiration" });
  assert.equal(snapshot.available, true);
  assert.match(formatMessage(snapshot, format), /고양감 있음/);
  assert.deepEqual(actor.system, before);
  actor.system.attributes.inspiration = false;
  assert.match(formatMessage(snap({ kind: "inspiration" }), format), /고양감 없음/);
  assert.equal(snapshot.available, true);
  actor.system.attributes.inspiration = 1;
  assert.throws(() => snap({ kind: "inspiration" }), /MissingData/);
});

test("currency pings select an exact denomination or all balances, including zeros", () => {
  const { actor, snap } = environment();
  const selected = snap({ kind: "currency", key: "gp" });
  assert.deepEqual(selected.amounts, [{ code: "gp", amount: 120, label: "금화" }]);
  const all = snap({ kind: "currency" });
  assert.equal(all.amounts.length, 5);
  assert.match(formatMessage(all, format), /0 백금화 \/ 120 금화 \/ 0 호박금화 \/ 3 은화 \/ 5 동화/);
  actor.system.currency.gp = 0;
  assert.equal(selected.amounts[0].amount, 120);
  assert.equal(snap({ kind: "currency", key: "gp" }).amounts[0].amount, 0);
  for (const amount of [NaN, Infinity, -1, "120", null]) {
    actor.system.currency.gp = amount;
    assert.throws(() => snap({ kind: "currency", key: "gp" }), /MissingData/);
  }
  assert.throws(() => snap({ kind: "currency", key: "secret" }), /MissingData/);
});

test("observer access is controlled live by the GM setting; ownership still works when off", async () => {
  const { game, actor, config, user, values } = environment();
  assert.equal(canPingActor(actor, user), false);
  assert.equal(canPingActor(actor, user, { allowObservers: true }), true);
  const sent = [];
  const ChatMessage = { canUserCreate: () => true, getSpeaker: () => ({}), create: async data => { sent.push(data); return data; } };
  await sendPing(actor, { kind: "inspiration" }, { game, config, ChatMessage });
  values.set("allowObserverPings", false);
  await assert.rejects(sendPing(actor, { kind: "inspiration" }, { game, config, ChatMessage }), /Permission/);
  assert.equal(sent.length, 1);
  actor.testUserPermission = (u, level) => level === "OWNER";
  await sendPing(actor, { kind: "inspiration" }, { game, config, ChatMessage });
  assert.equal(sent.length, 2);
  actor.testUserPermission = () => false;
  assert.equal(canPingActor(actor, user, { allowObservers: true }), false);
  actor.limited = true;
  assert.equal(canPingActor(actor, { ...user, isGM: true }, { allowObservers: true }), false);
});

test("all four settings have correct scope and no legacy Shift setting is registered", () => {
  const entries = new Map();
  registerSettings({ settings: { register: (module, key, value) => entries.set(key, value) } });
  assert.deepEqual([...entries.keys()], ["enabled", "zEnabled", "allowObserverPings", "inputMode"]);
  assert.equal(entries.get("allowObserverPings").scope, "world");
  assert.equal(entries.get("allowObserverPings").default, true);
  assert.equal(entries.get("zEnabled").scope, "client");
  assert.equal(entries.get("inputMode").scope, "client");
  assert.equal(entries.get("inputMode").default, "middle");
  assert.deepEqual(Object.keys(entries.get("inputMode").choices), ["middle", "zClick"]);
});

test("token snapshots use token name and never access private Actor data", () => {
  const { token, user, controller } = tokenEnvironment();
  const snapshot = buildTokenSnapshot(token, user, 100);
  assert.equal(formatMessage(snapshot, format).replace(/<[^>]+>/g, ""), "● 민수님이 고블린 A 지목");
  token.document.name = "Renamed";
  assert.equal(snapshot.tokenName, "고블린 A");
  assert.equal(snapshot.createdAt, 100);
  assert.equal("actorUuid" in snapshot, false);
  controller.destroy();
});

test("token resolution checks visibility, scene, canvas target, bounds and active layer", () => {
  const { token, user, canvas, view, controller } = tokenEnvironment();
  const event = { target: view, clientX: 30, clientY: 30 };
  assert.equal(resolveCanvasToken(event, canvas, user), token);
  assert.equal(resolveCanvasToken({ ...event, clientX: 100 }, canvas, user), null);
  assert.equal(resolveCanvasToken({ ...event, target: {} }, canvas, user), null);
  token.isVisible = false;
  assert.equal(resolveCanvasToken(event, canvas, user), null);
  token.isVisible = true;
  token.document.hidden = true;
  assert.equal(canPingToken(token, user), false);
  assert.equal(canPingToken(token, { ...user, isGM: true }), true);
  token.document.hidden = false;
  canvas.tokens.active = false;
  assert.equal(resolveCanvasToken(event, canvas, user), null);
  canvas.tokens.active = true;
  canvas.scene = { id: "other" };
  assert.equal(resolveCanvasToken(event, canvas, user), null);
  controller.destroy();
});

test("a token pointer cycle emits one ping and consumes compatibility mouse events", async () => {
  const { pointer, sent, window, controller } = tokenEnvironment();
  let native = 0;
  for (const type of ["pointerdown", "pointerup", "mousedown", "mouseup", "click"]) window.addEventListener(type, () => native++);
  for (const type of ["pointerdown", "mousedown", "pointerup", "mouseup", "click"]) {
    assert.equal(pointer(type).defaultPrevented, true);
  }
  await flush();
  assert.equal(sent.length, 1);
  assert.equal(native, 0);
  controller.destroy();
});

test("ordinary and Shift token clicks retain native handling, including when Z is held", () => {
  const { pointer, sent, setHeld, controller } = tokenEnvironment();
  for (const held of [true, false]) {
    setHeld(held);
    for (const type of ["pointerdown", "pointerup", "click"]) assert.equal(pointer(type, { shiftKey: true }).defaultPrevented, false);
  }
  for (const type of ["pointerdown", "pointerup", "click"]) assert.equal(pointer(type).defaultPrevented, false);
  assert.equal(sent.length, 0);
  controller.destroy();
});

test("token dragging, released Z, pointer cancellation and blur do not create pings", async () => {
  for (const reason of ["drag", "keyup", "cancel", "blur", "outside", "settings", "scene"]) {
    const env = tokenEnvironment();
    env.pointer("pointerdown");
    if (reason === "drag") env.pointer("pointermove", { clientX: 45 });
    if (reason === "keyup") env.setHeld(false);
    if (reason === "cancel") env.pointer("pointercancel");
    if (reason === "blur") emit(env.window, "blur");
    if (reason === "settings") env.values.set("enabled", false);
    if (reason === "scene") env.setCanvas({ ...env.canvas, scene: { id: "new" } });
    env.pointer("pointerup", {}, reason === "outside" ? {} : env.view);
    await flush();
    assert.equal(env.sent.length, 0, reason);
    env.controller.destroy();
  }
});

test("map input accepts empty points and can be destroyed and recreated without duplicates", async () => {
  const env = tokenEnvironment();
  assert.equal(env.pointer("pointerdown", { clientX: 100 }).defaultPrevented, true);
  env.pointer("pointerup", { clientX: 100 });
  env.pointer("click", { clientX: 100 });
  await flush();
  assert.deepEqual(env.sent, [{ kind: "point", position: { x: 50, y: 15 } }]);
  env.controller.destroy();
  assert.equal(env.pointer("pointerdown").defaultPrevented, false);
  assert.equal(env.sent.length, 1);
  const next = createMapInputController({ game: env.game, window: env.window, getCanvas: () => env.canvas,
    isZHeld: () => true, send: async token => env.sent.push(token), notify: () => {} });
  env.pointer("pointerdown"); env.pointer("pointerup"); env.pointer("click");
  await flush();
  assert.equal(env.sent.length, 2);
  next.destroy();
});

test("token messages are public, escape names, and do not identify a private speaker Actor", async () => {
  const { token, game, controller } = tokenEnvironment();
  token.document.name = '<img onerror="boom"> @UUID[secret] [[1d20]]';
  const data = await sendTokenPing(token, { game, ChatMessage: { canUserCreate: () => true, create: async data => data } });
  assert.deepEqual(data.whisper, []);
  assert.deepEqual(data.rolls, []);
  assert.equal(data.blind, false);
  assert.deepEqual(data.speaker, { alias: "민수" });
  assert.doesNotMatch(data.content, /<img|@UUID|\[\[/);
  assert.match(data.content, /&lt;img/);
  assert.equal("actorName" in data.flags["sheet-ping"].snapshot, false);
  assert.equal(data.flags["sheet-ping"].snapshot.userColor, "#2468ac");
  assert.match(data.content, /style="color: #2468ac"/);
  controller.destroy();
});

test("unconfigured clients default to middle click without Z and preserve other gestures", () => {
  const { game, values } = environment();
  values.delete("inputMode");
  assert.equal(getInputMode(game), "middle");
  assert.equal(isPingGesture({ button: 1 }, false, getInputMode(game)), true);
  assert.equal(isPingGesture({ button: 0 }, true, getInputMode(game)), false);
  for (const change of [{ button: 0 }, { button: 2 }, { shiftKey: true }, { altKey: true }, { ctrlKey: true }, { metaKey: true }]) {
    assert.equal(isPingGesture({ button: 1, ...change }, false, "middle"), false);
  }
  values.set("inputMode", "zClick");
  assert.equal(isPingGesture({ button: 1 }, true, getInputMode(game)), false);
  assert.equal(isPingGesture({ button: 0 }, true, getInputMode(game)), true);
});

test("middle sheet cycle blocks autoscroll on down and sends only on auxclick", async () => {
  const { game, actor, values } = environment();
  values.delete("inputMode");
  class Official {}
  const app = Object.assign(new Official(), { actor });
  const root = new EventTarget();
  let pings = 0, native = 0, supported = true;
  const input = createInputController({ game, systemAPI: { applications: { actor: { CharacterActorSheet: Official } } },
    isZHeld: () => false, resolve: () => supported ? { kind: "hp" } : null,
    send: async () => pings++, notify: () => {} });
  input.bind(app, root);
  const types = ["pointerdown", "mousedown", "pointerup", "mouseup", "click", "auxclick"];
  for (const type of [...types, "wheel"]) root.addEventListener(type, () => native++);
  for (const type of types) {
    assert.equal(emit(root, type, { button: 1 }).defaultPrevented, true, type);
    assert.equal(pings, type === "auxclick" ? 1 : 0, type);
  }
  await flush();
  assert.equal(pings, 1);
  assert.equal(native, 0);
  assert.equal(emit(root, "wheel").defaultPrevented, false, "wheel scrolling stays native");
  supported = false;
  assert.equal(emit(root, "mousedown", { button: 1 }).defaultPrevented, false, "unregistered targets stay native");
  input.unbind(app);
  assert.equal(emit(root, "auxclick", { button: 1 }).defaultPrevented, false);
  assert.equal(pings, 1);
});

test("input method changes apply on an open sheet and the inactive gesture passes through", async () => {
  const { game, actor, values } = environment();
  class Official {}
  const app = Object.assign(new Official(), { actor });
  const root = new EventTarget();
  let pings = 0;
  const input = createInputController({ game, systemAPI: { applications: { actor: { CharacterActorSheet: Official } } },
    isZHeld: () => true, resolve: () => ({ kind: "hp" }), send: async () => pings++, notify: () => {} });
  input.bind(app, root);
  values.set("inputMode", "middle");
  assert.equal(emit(root, "click", { button: 0 }).defaultPrevented, false);
  emit(root, "auxclick", { button: 1 });
  assert.equal(pings, 1);
  values.set("inputMode", "zClick");
  assert.equal(emit(root, "auxclick", { button: 1 }).defaultPrevented, false);
  emit(root, "click", { button: 0 });
  assert.equal(pings, 2);
  for (const key of ["enabled", "zEnabled"]) {
    values.set(key, false);
    assert.equal(emit(root, "click", { button: 0 }).defaultPrevented, false);
    values.set(key, true);
  }
  assert.equal(pings, 2);
  input.unbind(app);
});

test("a failed middle sheet ping cannot fall through to native actions", async () => {
  const { game, actor, values } = environment();
  values.set("inputMode", "middle");
  class Official {}
  const app = Object.assign(new Official(), { actor });
  const root = new EventTarget();
  const notices = [];
  let native = 0;
  const input = createInputController({ game, systemAPI: { applications: { actor: { CharacterActorSheet: Official } } },
    resolve: () => ({ kind: "hp" }), send: async () => { throw new Error("Failure"); },
    notify: key => notices.push(key), report: () => {} });
  input.bind(app, root);
  root.addEventListener("auxclick", () => native++);
  assert.equal(emit(root, "auxclick", { button: 1 }).defaultPrevented, true);
  await flush();
  assert.equal(native, 0);
  assert.deepEqual(notices, ["SHEETPING.Error.Unexpected"]);
  input.unbind(app);
});

test("middle token pointer and auxclick cycle produces one ping without holding Z", async () => {
  const env = tokenEnvironment();
  env.values.delete("inputMode");
  env.setHeld(false);
  let native = 0;
  for (const type of ["pointerdown", "mousedown", "pointerup", "mouseup", "auxclick"]) env.window.addEventListener(type, () => native++);
  for (const type of ["pointerdown", "mousedown", "pointerup", "mouseup", "auxclick"]) {
    assert.equal(env.pointer(type, { button: 1 }).defaultPrevented, true, type);
  }
  await flush();
  assert.equal(env.sent.length, 1);
  assert.equal(native, 0);
  env.setHeld(true);
  assert.equal(env.pointer("pointerdown", { button: 0 }).defaultPrevented, false, "Z-left-click stays native in middle mode");
  env.controller.destroy();
});

test("middle token drags and changing input mode during a press cancel the ping", async () => {
  for (const action of ["drag", "mode", "shift"]) {
    const env = tokenEnvironment();
    env.values.set("inputMode", "middle");
    env.setHeld(false);
    env.pointer("pointerdown", { button: 1 });
    if (action === "drag") env.pointer("pointermove", { button: -1, clientX: 50 });
    if (action === "mode") env.values.set("inputMode", "zClick");
    env.pointer("pointerup", { button: 1, shiftKey: action === "shift" });
    env.pointer("auxclick", { button: 1 });
    await flush();
    assert.equal(env.sent.length, 0, action);
    env.controller.destroy();
  }
});
