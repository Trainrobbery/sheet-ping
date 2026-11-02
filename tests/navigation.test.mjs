import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { buildPointSnapshot, sendPointPing, createMapInputController } from "../scripts/token.mjs";
import { focusPingTarget, bindPingNavigation, tokenCenter } from "../scripts/navigation.mjs";
import { formatMessage } from "../scripts/formatter.mjs";

const languages = {};
for (const lang of ["ko", "en"]) languages[lang] = JSON.parse(await readFile(new URL(`../lang/${lang}.json`, import.meta.url)));
const i18n = (lang = "ko") => ({
  format: (key, values) => key.split(".").reduce((o, k) => o?.[k], languages[lang])
    .replace(/\{(\w+)\}/g, (_, key) => values[key] ?? "")
});
const flush = () => new Promise(resolve => setImmediate(resolve));
function fixture() {
  const calls = [], notices = [], view = {};
  const user = { id: "u1", name: "민수", color: "#123abc", isGM: false,
    broadcastActivity: data => calls.push(["activity", structuredClone(data)]) };
  const scene = { id: "s1", active: true, tokens: new Map(), testUserPermission: () => false };
  const token = { isVisible: true, isPreview: false, center: { x: 750, y: 820 },
    document: { id: "t1", name: "큰 괴물", uuid: "Scene.s1.Token.t1", parent: scene, hidden: false },
    bounds: { contains: () => false } };
  Object.defineProperty(token, "actor", { get() { assert.fail("no Actor data may be read"); } });
  scene.tokens.set("t1", token.document);
  const canvas = { ready: true, scene, app: { view }, stage: { scale: { x: 0.75 } },
    dimensions: { rect: { contains: (x, y) => x >= 0 && x <= 3000 && y >= 0 && y <= 3000 } },
    tokens: { active: true, hover: null, get: id => id === "t1" ? token : null },
    canvasCoordinatesFromClient: ({ x, y }) => ({ x: x * 2 + 100, y: y * 2 + 200 }),
    controls: { handlePing: async (user, point, data) => { calls.push(["effect", structuredClone(point), data]); return true; } },
    animatePan: async data => { calls.push(["pan", data]); return true; } };
  const game = { user, scenes: new Map([[scene.id, scene]]), version: "13.351",
    system: { id: "dnd5e", version: "5.3.3" }, i18n: i18n(),
    settings: { get: (module, key) => key === "inputMode" ? "middle" : true } };
  const ChatMessage = { canUserCreate: () => true, create: async data => { calls.push(["chat", data]); return data; } };
  return { user, scene, token, canvas, game, ChatMessage, calls, notices, view, getCanvas: () => canvas };
}
const pointSnapshot = { kind: "point", sceneId: "s1", position: { x: 320, y: 470 } };
const tokenSnapshot = { kind: "token", tokenUuid: "Scene.s1.Token.t1" };

test("point snapshots retain scene coordinates without retaining a mutable point or reading Actor data", () => {
  const { canvas, user } = fixture();
  const position = { x: 320, y: 470 };
  const snap = buildPointSnapshot(canvas, position, user, 100);
  position.x = 0;
  assert.deepEqual(snap, { schemaVersion: 1, kind: "point", sceneId: "s1", position: { x: 320, y: 470 },
    userId: "u1", userName: "민수", createdAt: 100 });
  for (const point of [{ x: NaN, y: 1 }, { x: 1, y: Infinity }, { x: "10", y: 1 }, { x: -1, y: 1 }]) {
    assert.throws(() => buildPointSnapshot(canvas, point, user), /MissingData/);
  }
  canvas.ready = false;
  assert.throws(() => buildPointSnapshot(canvas, { x: 1, y: 1 }, user), /MissingData/);
});

test("empty point sends one public linked sentence before broadcasting its non-pulling effect", async () => {
  const env = fixture();
  const data = await sendPointPing(pointSnapshot.position, env);
  assert.deepEqual(env.calls.map(c => c[0]), ["chat", "activity", "effect"]);
  assert.equal(data.content.replace(/<[^>]+>/g, ""), "● 민수님이 지도의 한 지점을 지목");
  assert.match(data.content, /지도의 <a [^>]*>한 지점<\/a>을 지목/);
  assert.deepEqual(data.flags["sheet-ping"].snapshot.position, pointSnapshot.position);
  assert.equal(data.flags["sheet-ping"].snapshot.sceneId, "s1");
  assert.deepEqual(data.whisper, []); assert.deepEqual(data.rolls, []);
  assert.equal(env.calls[1][1].ping.pull, false);
  assert.deepEqual(env.calls[2][1], pointSnapshot.position);
  assert.equal(env.calls.some(c => c[0] === "pan"), false);
});

test("point chat failures emit no effect; a scene change after chat success never resends the message", async () => {
  const env = fixture();
  env.ChatMessage.canUserCreate = () => false;
  await assert.rejects(sendPointPing(pointSnapshot.position, env), /ChatPermission/);
  assert.deepEqual(env.calls, []);
  env.ChatMessage.canUserCreate = () => true;
  env.ChatMessage.create = async data => { env.calls.push(["chat", data]); env.canvas.scene = { id: "other" }; return data; };
  await sendPointPing(pointSnapshot.position, { ...env, notifyEffectFailure: error => env.notices.push(error.key) });
  assert.deepEqual(env.calls.map(c => c[0]), ["chat"]);
  assert.deepEqual(env.notices, ["MapPingFailed"]);
});

test("blank map input sends once per middle/Z cycle and cancels drag, layer or in-place scene changes", async () => {
  for (const mode of ["middle", "zClick"]) {
    for (const reason of ["click", "drag", "layer", "scene"]) {
      const env = fixture(), window = new EventTarget(), sent = [];
      env.game.settings.get = (module, key) => key === "inputMode" ? mode : true;
      const controller = createMapInputController({ game: env.game, window, getCanvas: env.getCanvas,
        isZHeld: () => true, send: async (token, context) => sent.push({ token, position: context.position }), notify: assert.fail });
      const pointer = (type, changes = {}) => {
        const e = new Event(type, { cancelable: true });
        Object.assign(e, { button: mode === "middle" ? 1 : 0, pointerId: 1, clientX: 10, clientY: 20, ...changes });
        Object.defineProperty(e, "target", { value: env.view }); window.dispatchEvent(e); return e;
      };
      assert.equal(pointer("pointerdown").defaultPrevented, true);
      pointer("mousedown");
      if (reason === "drag") pointer("pointermove", { clientX: 40 });
      if (reason === "layer") env.canvas.tokens.active = false;
      if (reason === "scene") env.canvas.scene = { id: "other" };
      pointer("pointerup"); pointer("mouseup"); pointer(mode === "middle" ? "auxclick" : "click");
      await flush();
      assert.deepEqual(sent, reason === "click" ? [{ token: null, position: { x: 120, y: 240 } }] : [], `${mode}/${reason}`);
      controller.destroy();
    }
  }
});

test("map links escape token labels and localize just the linked point words in both languages", () => {
  for (const lang of ["ko", "en"]) {
    const html = formatMessage({ kind: "token", userName: "민수", tokenName: '<img onerror="x"> @UUID[secret]' }, i18n(lang).format);
    assert.match(html, /<strong><a class="sheet-ping-map-link" href="#" title="[^"]+">&lt;img/);
    assert.doesNotMatch(html, /<img|@UUID|\[secret\]|data-uuid|javascript:/);
    const point = formatMessage({ ...pointSnapshot, userName: "민수" }, i18n(lang).format);
    assert.match(point, lang === "ko" ? />한 지점<\/a>을 지목/ : />a point<\/a> on the map/);
    assert.equal((point.match(/<a /g) ?? []).length, 1);
  }
});

test("point navigation pans only the local camera to the stored coordinate without changing zoom", async () => {
  const env = fixture();
  await focusPingTarget(pointSnapshot, env);
  assert.deepEqual(env.calls, [["pan", { x: 320, y: 470, duration: 250 }]]);
  assert.equal(env.canvas.stage.scale.x, 0.75);
  for (const snapshot of [{ ...pointSnapshot, position: { x: NaN, y: 1 } }, { ...pointSnapshot, position: { x: -1, y: 1 } }]) {
    await assert.rejects(focusPingTarget(snapshot, env));
  }
  assert.equal(env.calls.length, 1);
});

test("token navigation follows its current rendered center and never falls back to an old or hidden location", async () => {
  const env = fixture();
  env.token.center = { x: 960, y: 1200 };
  await focusPingTarget({ ...tokenSnapshot, position: { x: 1, y: 2 } }, env);
  assert.deepEqual(env.calls, [["pan", { x: 960, y: 1200, duration: 250 }]]);
  for (const condition of ["hidden", "unseen", "deleted", "preview", "wrongUuid"]) {
    const next = fixture();
    if (condition === "hidden") next.token.document.hidden = true;
    if (condition === "unseen") next.token.isVisible = false;
    if (condition === "deleted") next.scene.tokens.clear();
    if (condition === "preview") next.token.isPreview = true;
    if (condition === "wrongUuid") next.token.document.uuid = "Scene.s1.Token.other";
    await assert.rejects(focusPingTarget(tokenSnapshot, next), /TargetUnavailable/);
    assert.deepEqual(next.calls, [], condition);
  }
  assert.deepEqual(tokenCenter({ document: { getCenterPoint: () => ({ x: 40, y: 90, elevation: 10 }) } }), { x: 40, y: 90 });
});

test("links may view an accessible scene locally, but never activate or pull other players", async () => {
  const env = fixture();
  const targetScene = { id: "s2", active: false, testUserPermission: (user, level) => user === env.user && level === "OBSERVER",
    view: async () => { env.calls.push(["view"]); env.canvas.scene = targetScene; } };
  env.game.scenes.set("s2", targetScene);
  await focusPingTarget({ ...pointSnapshot, sceneId: "s2" }, env);
  assert.deepEqual(env.calls, [["view"], ["pan", { x: 320, y: 470, duration: 250 }]]);
  targetScene.testUserPermission = () => false;
  await assert.rejects(focusPingTarget({ ...pointSnapshot, sceneId: "s2" }, env), /ScenePermission/);
  assert.equal(env.calls.length, 2);
  env.user.isGM = true;
  await focusPingTarget({ ...pointSnapshot, sceneId: "s2" }, env);
  assert.equal(env.calls.length, 3);
});

test("unready, missing and concurrently changed scenes cannot pan", async () => {
  const env = fixture();
  await assert.rejects(focusPingTarget({ ...pointSnapshot, sceneId: "missing" }, env), /TargetUnavailable/);
  await assert.rejects(focusPingTarget({ kind: "item" }, env), /TargetUnavailable/);
  env.canvas.ready = false;
  await assert.rejects(focusPingTarget(pointSnapshot, env), /CanvasNotReady/);
  env.canvas.ready = true;
  env.canvas.scene = { id: "other" };
  env.scene.view = async () => {};
  await assert.rejects(focusPingTarget(pointSnapshot, env), /CanvasNotReady/);
  assert.deepEqual(env.calls, []);
});

test("chat link binding prevents anchor jumps, survives re-render without duplicates, and reports stale targets", async () => {
  const env = fixture(), element = new EventTarget();
  const link = {}, target = { closest: selector => selector === "a.sheet-ping-map-link" ? link : null };
  element.contains = node => node === link;
  const message = { getFlag: () => pointSnapshot };
  const options = { ...env, notify: key => env.notices.push(key) };
  bindPingNavigation(message, element, options);
  bindPingNavigation(message, element, options);
  const click = (button = 0, otherTarget = target) => {
    const e = new Event("click", { cancelable: true }); Object.assign(e, { button });
    Object.defineProperty(e, "target", { value: otherTarget }); element.dispatchEvent(e); return e;
  };
  assert.equal(click().defaultPrevented, true);
  click(); // Busy double-click: only one pan while the first is pending.
  await flush();
  assert.equal(env.calls.length, 1);
  assert.equal(click(2).defaultPrevented, false);
  assert.equal(click(0, { closest: () => null }).defaultPrevented, false);
  bindPingNavigation({ getFlag: () => ({ ...pointSnapshot, sceneId: "missing" }) }, element, options);
  click(); await flush();
  assert.deepEqual(env.notices, ["SHEETPING.Error.TargetUnavailable"]);
  assert.equal(env.calls.length, 1);
});
