import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { buildSnapshot } from "../scripts/dnd5e.mjs";
import { sendPing } from "../scripts/chat.mjs";
import { formatMessage } from "../scripts/formatter.mjs";
import { emitTokenPing, sendTokenPing, createMapInputController } from "../scripts/token.mjs";

const languages = {};
for (const lang of ["ko", "en"]) languages[lang] = JSON.parse(await readFile(new URL(`../lang/${lang}.json`, import.meta.url)));
function i18n(lang = "ko") {
  const localize = key => key.split(".").reduce((o, k) => o?.[k], languages[lang]) ?? key;
  return { localize, format: (key, values) => localize(key).replace(/\{(\w+)\}/g, (_, key) => values[key] ?? "") };
}
function fixture() {
  const user = { id: "u1", name: "민수", color: "#123abc" };
  let metric = false;
  const game = { user, version: "13.351", system: { id: "dnd5e", version: "5.3.3" }, i18n: i18n(),
    settings: { get: (module, key) => module === "dnd5e" && key === "metricWeightUnits" ? metric : key === "inputMode" ? "middle" : true } };
  const actor = { id: "a1", uuid: "Actor.a1", type: "character", name: "아르벨", testUserPermission: () => true,
    system: { abilities: { str: { value: 16, mod: 3 } }, traits: { size: "med" }, attributes: {
      ac: { value: 13 }, encumbrance: { value: 57.8, max: 480, mod: 2 },
      attunement: { value: 2, max: 3 }, exhaustion: 2, death: { success: 1, failure: 2 }
    } }, items: new Map() };
  const config = { abilities: { str: { label: "근력" } }, actorSizes: { med: { label: "중형" } },
    encumbrance: { baseUnits: { default: { imperial: "lb", metric: "kg" } } },
    weightUnits: { lb: { abbreviation: "lb" }, kg: { abbreviation: "kg" } } };
  const snap = (target, options = {}) => buildSnapshot({ actor, user, config, localize: game.i18n.localize, target, ...options });
  return { user, game, actor, config, snap, setMetric: value => { metric = value; } };
}
function mapFixture() {
  const base = fixture();
  const scene = { id: "scene1" }, view = {};
  const token = { isVisible: true, isPreview: false,
    center: { x: 50, y: 50 },
    document: { uuid: "Scene.scene1.Token.t1", name: "토큰 별명", parent: scene },
    bounds: { contains: (x, y) => x >= 0 && x <= 100 && y >= 0 && y <= 100 } };
  const activity = [], draws = [];
  base.user.broadcastActivity = data => activity.push(structuredClone(data));
  const canvas = { ready: true, scene, app: { view }, stage: { scale: { x: 0.75 } },
    tokens: { active: true, hover: token },
    canvasCoordinatesFromClient: ({ x, y }) => ({ x: x / 2 + 10, y: y / 2 + 20 }),
    controls: { handlePing: async (user, point, data) => { draws.push({ user, point: structuredClone(point), data: structuredClone(data) }); return true; } },
    pan: () => assert.fail("map must not pan"), animatePan: () => assert.fail("map must not animate pan") };
  return { ...base, scene, view, token, canvas, activity, draws };
}

test("inventory weight uses prepared totals and configured metric/imperial units", async () => {
  const { actor, game, config, snap, setMetric } = fixture();
  assert.equal(snap({ kind: "weight" }).current, 57.8);
  assert.equal(snap({ kind: "weight" }).maximum, 480);
  assert.equal(snap({ kind: "weight" }).unit, "lb");
  assert.equal(snap({ kind: "weight" }, { metricWeight: true }).unit, "kg");
  setMetric(true);
  Object.assign(actor.system.attributes.encumbrance, { value: 26.3, max: 240 });
  const data = await sendPing(actor, { kind: "weight" }, { game, config,
    ChatMessage: { canUserCreate: () => true, getSpeaker: () => ({}), create: async data => data } });
  assert.match(data.content, /26.3\/240 kg/);
  assert.equal(actor.system.attributes.encumbrance.value, 26.3);
});

test("inventory strength, size and size multiplier match their prepared sheet data", () => {
  const { actor, snap } = fixture();
  assert.equal(snap({ kind: "ability", key: "str" }).score, 16);
  assert.equal(snap({ kind: "size" }).label, "중형");
  assert.equal(snap({ kind: "sizeMultiplier" }).value, 2);
  actor.system.attributes.encumbrance.mod = 0.5;
  assert.equal(snap({ kind: "sizeMultiplier" }).value, 0.5);
});

test("attunement shows used/max without clamping or modifying the source", () => {
  const { actor, snap } = fixture();
  const snapshot = snap({ kind: "attunement" });
  assert.equal(snapshot.current, 2);
  assert.equal(snapshot.maximum, 3);
  Object.assign(actor.system.attributes.attunement, { value: 4, max: 3 });
  assert.equal(snap({ kind: "attunement" }).current, 4);
  assert.equal(actor.system.attributes.attunement.value, 4);
  Object.assign(actor.system.attributes.attunement, { value: 0, max: 0 });
  assert.equal(snap({ kind: "attunement" }).maximum, 0);
  assert.equal(snapshot.current, 2);
});

test("exhaustion and death saves are progress snapshots, never a roll or toggle", () => {
  const { actor, snap } = fixture();
  const before = structuredClone(actor.system.attributes);
  assert.equal(snap({ kind: "exhaustion" }).value, 2);
  const death = snap({ kind: "deathProgress" });
  assert.equal(death.success, 1); assert.equal(death.failure, 2); assert.equal(death.maximum, 3);
  assert.deepEqual(actor.system.attributes, before);
  actor.system.attributes.exhaustion = 0;
  Object.assign(actor.system.attributes.death, { success: 0, failure: 3 });
  assert.equal(snap({ kind: "exhaustion" }).value, 0);
  assert.equal(snap({ kind: "deathProgress" }).failure, 3);
  assert.equal(death.failure, 2);
});

test("inventory containers retain item permissions and unidentified-name protection", () => {
  const { actor, snap } = fixture();
  const item = { uuid: "Actor.a1.Item.bag", name: "Secret bag", type: "container", parent: actor,
    system: { identified: false, unidentified: { name: "낡은 가방" } }, testUserPermission: () => true };
  actor.items.set("bag", item);
  assert.equal(snap({ kind: "item", itemId: "bag" }).label, "낡은 가방");
  item.testUserPermission = () => false;
  assert.throws(() => snap({ kind: "item", itemId: "bag" }), /Permission/);
});

test("missing and invalid counters cannot be displayed as invented progress", () => {
  for (const [kind, key, field] of [["weight", "encumbrance", "value"], ["attunement", "attunement", "max"], ["deathProgress", "death", "success"]]) {
    for (const value of [undefined, null, NaN, Infinity, "2"]) {
      const { actor, snap } = fixture();
      actor.system.attributes[key][field] = value;
      assert.throws(() => snap({ kind }), /MissingData/);
    }
  }
  const { actor, snap } = fixture();
  actor.system.attributes.exhaustion = -1;
  assert.throws(() => snap({ kind: "exhaustion" }), /MissingData/);
  actor.system.attributes.death.success = 4;
  assert.throws(() => snap({ kind: "deathProgress" }), /MissingData/);
  actor.system.attributes.attunement.value = 1.5;
  assert.throws(() => snap({ kind: "attunement" }), /MissingData/);
});

test("all actor message types bold the escaped character name in both languages", () => {
  for (const lang of ["ko", "en"]) {
    for (const kind of Object.keys(languages[lang].SHEETPING.Message)) {
      const html = formatMessage({ kind, actorName: "<Arvel & Co>", userName: "민수", tokenName: "Goblin",
        value: 2, current: 1, maximum: 3, success: 1, failure: 2, score: 16, modifier: 3,
        unit: "lb", label: "Test", source: "Class", amounts: [{ amount: 5, label: "GP" }], status: "State" }, i18n(lang).format);
      if (!["token", "point"].includes(kind)) assert.match(html, /<strong>&lt;Arvel &amp; Co&gt;<\/strong>/, `${lang}/${kind}`);
      assert.doesNotMatch(html, /<Arvel|undefined|NaN|SHEETPING|\{\w+\}/, `${lang}/${kind}`);
    }
  }
});

test("AC uses the requested compact Korean sentence", () => {
  const { snap } = fixture();
  const html = formatMessage(snap({ kind: "ac" }), i18n().format);
  assert.match(html, /<strong>아르벨<\/strong>의 <strong>AC 13<\/strong> 지목/);
  assert.equal(html.replace(/<[^>]+>/g, ""), "● 민수님이 아르벨의 AC 13 지목");
});

test("native map ping broadcasts a user-colored chevron with pull explicitly disabled", async () => {
  const { canvas, user, activity, draws } = mapFixture();
  await emitTokenPing(canvas, user, { x: 24, y: 47 }, "scene1");
  assert.deepEqual(activity, [{ cursor: { x: 24, y: 47 }, ping: { style: "chevron", pull: false, scene: "scene1", zoom: 0.75 } }]);
  assert.equal(draws.length, 1);
  assert.equal(draws[0].user, user);
  assert.equal(draws[0].user.color, "#123abc");
  assert.equal(draws[0].data.pull, false);
  assert.deepEqual(draws[0].point, { x: 24, y: 47 });
  canvas.controls.handlePing = async () => false;
  await assert.rejects(emitTokenPing(canvas, user, { x: 24, y: 47 }, "scene1"), /MapPingFailed/);
});

test("map effects cannot be emitted into a changed or unready scene", async () => {
  const { canvas, user, activity, draws } = mapFixture();
  await assert.rejects(emitTokenPing(canvas, user, { x: NaN, y: 10 }, "scene1"), /MapPingFailed/);
  await assert.rejects(emitTokenPing(canvas, user, { x: 10, y: 10 }, "scene2"), /MapPingFailed/);
  canvas.ready = false;
  await assert.rejects(emitTokenPing(canvas, user, { x: 10, y: 10 }, "scene1"), /MapPingFailed/);
  assert.equal(activity.length, 0); assert.equal(draws.length, 0);
});

test("token effects run after successful chat creation, and effect failure never duplicates chat", async () => {
  const env = mapFixture();
  const calls = [], failures = [];
  const ChatMessage = { canUserCreate: () => true, create: async data => { calls.push(data); return data; } };
  await sendTokenPing(env.token, { game: env.game, ChatMessage, canvas: env.canvas, position: { x: 15, y: 25 } });
  assert.equal(calls.length, 1); assert.equal(env.activity.length, 1); assert.equal(env.draws.length, 1);
  assert.deepEqual(env.draws[0].point, { x: 50, y: 50 }, "effect uses token center, not the supplied click coordinate");
  env.canvas.controls.handlePing = async () => { throw new Error("Animation unavailable"); };
  const result = await sendTokenPing(env.token, { game: env.game, ChatMessage, canvas: env.canvas,
    position: { x: 16, y: 26 }, notifyEffectFailure: error => failures.push(error) });
  assert.equal(calls.length, 2); assert.equal(result, calls[1]); assert.equal(failures.length, 1);
  ChatMessage.canUserCreate = () => false;
  await assert.rejects(sendTokenPing(env.token, { game: env.game, ChatMessage, canvas: env.canvas,
    position: { x: 15, y: 25 } }), /ChatPermission/);
  assert.equal(env.activity.length, 2, "a denied chat does not produce a map effect");
});

test("token input forwards token center even when clicked away from the center", async () => {
  const env = mapFixture();
  const window = new EventTarget(), contexts = [];
  const input = createMapInputController({ game: env.game, window, getCanvas: () => env.canvas,
    isZHeld: () => false, send: async (token, context) => contexts.push(context), notify: () => {} });
  for (const type of ["pointerdown", "pointerup", "auxclick"]) {
    const event = new Event(type, { cancelable: true });
    Object.assign(event, { button: 1, pointerId: 1, clientX: 28, clientY: 54 });
    Object.defineProperty(event, "target", { value: env.view });
    window.dispatchEvent(event);
  }
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(contexts.length, 1);
  assert.equal(contexts[0].canvas, env.canvas);
  assert.deepEqual(contexts[0].position, { x: 50, y: 50 });
  input.destroy();
});
