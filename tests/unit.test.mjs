import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { buildSnapshot, canPingActor, spellStatus, publicItemName } from "../scripts/dnd5e.mjs";
import { formatMessage, formatModifier, normalizeUserColor } from "../scripts/formatter.mjs";
import { sendPing, stylePingMessage } from "../scripts/chat.mjs";
import { createInputController, isPingGesture, isSupportedSheet } from "../scripts/input.mjs";
import { isTargetEnvironment, PingError } from "../scripts/constants.mjs";

const translations = {};
for (const lang of ["ko", "en"]) {
  translations[lang] = JSON.parse(await readFile(new URL(`../lang/${lang}.json`, import.meta.url)));
}
function i18n(lang = "ko") {
  const localize = key => key.split(".").reduce((value, part) => value?.[part], translations[lang]) ?? key;
  return { localize, format: (key, values) => localize(key).replace(/\{(\w+)\}/g, (_, key) => values[key] ?? "") };
}
const config = {
  abilities: { str: { label: "근력" }, dex: { label: "민첩" } },
  skills: { ste: { label: "은신" } },
  movementTypes: {
    walk: { label: "이동 속도" }, burrow: { label: "굴 파기" }, climb: { label: "등반" },
    fly: { label: "비행" }, jump: { label: "도약", hidden: true }, swim: { label: "수영" }
  },
  movementUnits: { ft: { abbreviation: "ft." }, m: { abbreviation: "m" } },
  spellcasting: { spell: { prepares: true }, pact: { prepares: true }, innate: {}, atwill: {}, ritual: {} },
  spellPreparationStates: { unprepared: { value: 0 }, prepared: { value: 1 }, always: { value: 2 } }
};
function fixture() {
  const user = { id: "user1", name: "민수", isGM: false, color: { css: "#12AB34" } };
  const actor = {
    id: "actor1", uuid: "Actor.actor1", name: "아르벨", type: "character",
    testUserPermission: (u, level) => u === user && level === "OWNER",
    system: {
      abilities: { str: { value: 16, mod: 3, save: { value: 3 } }, dex: { value: 14, mod: 2, save: { value: 6 } } },
      skills: { ste: { total: 7, mod: 2 } },
      attributes: {
        init: { total: 5, mod: 2 }, prof: 3, ac: { value: 18, base: 10 },
        hp: { value: 22, max: 40, tempmax: 10, effectiveMax: 50, temp: 7 },
        movement: { walk: 30, burrow: 0, climb: 15, fly: 60, jump: 999, swim: 20, units: "ft" }
      }
    }, items: new Map()
  };
  const item = {
    id: "item1", uuid: "Actor.actor1.Item.item1", name: "치유 물약", type: "consumable", parent: actor,
    testUserPermission: () => true, system: { identified: true, quantity: 2, description: { value: "SECRET" } }
  };
  actor.items.set(item.id, item);
  const game = { settings: { get: (module, key) => key === "inputMode" ? "zClick" : true }, version: "13.351", system: { id: "dnd5e", version: "5.3.3" }, user, i18n: i18n() };
  const snap = target => buildSnapshot({ actor, user, target, config, localize: game.i18n.localize, now: 123 });
  return { user, actor, item, game, snap };
}

test("numeric fields use prepared system data, including the 5.3 save.value field", () => {
  const { snap } = fixture();
  assert.equal(snap({ kind: "ability", key: "str" }).score, 16);
  assert.equal(snap({ kind: "ability", key: "str" }).modifier, 3);
  assert.equal(snap({ kind: "skill", key: "ste" }).modifier, 7);
  assert.equal(snap({ kind: "save", key: "dex" }).modifier, 6);
  assert.equal(formatModifier(0), "+0");
  assert.equal(formatModifier(-2), "-2");
});

test("physical items, features and spells use distinct message categories", () => {
  const { item, snap } = fixture();
  for (const [type, kind] of [["weapon", "item"], ["container", "item"], ["feat", "feature"], ["class", "feature"], ["spell", "spell"]]) {
    item.type = type;
    assert.equal(snap({ kind: "item", itemId: item.id }).kind, kind);
  }
  item.type = "facility";
  assert.throws(() => snap({ kind: "item", itemId: item.id }), /Unsupported/);
});

test("5.3.3 spell method/prepared states, cantrips and non-preparing methods", () => {
  const localize = i18n().localize;
  for (const method of ["spell", "pact"]) {
    for (const [prepared, expected] of [[0, "준비 안 됨"], [1, "준비됨"], [2, "항상 준비됨"], [3, ""]]) {
      assert.equal(spellStatus({ level: 1, method, prepared }, config, localize), expected);
    }
  }
  assert.equal(spellStatus({ level: 0, method: "spell", prepared: 0 }, config, localize), "소마법");
  assert.equal(spellStatus({ level: 1, method: "innate", prepared: 0 }, config, localize), "선천적 시전");
  assert.equal(spellStatus({ level: 1, method: "atwill", prepared: 0 }, config, localize), "임의 시전");
  assert.equal(spellStatus({ level: 1, method: "ritual", prepared: 0 }, config, localize), "의식");
  assert.equal(spellStatus({ level: 1, method: "unknown", prepared: 1 }, config, localize), "");
});

test("ownership is checked at send time, including item permissions and actor identity", () => {
  const { actor, user, item, snap } = fixture();
  assert.equal(canPingActor(actor, user), true);
  assert.equal(canPingActor(actor, { ...user, id: "other" }), false);
  assert.equal(canPingActor(actor, { ...user, isGM: true }), true);
  actor.testUserPermission = () => false;
  assert.throws(() => snap({ kind: "ability", key: "str" }), /Permission/);
  actor.testUserPermission = () => true;
  item.testUserPermission = () => false;
  assert.throws(() => snap({ kind: "item", itemId: item.id }), /Permission/);
  item.testUserPermission = () => true;
  item.parent = { uuid: "Actor.other" };
  assert.throws(() => snap({ kind: "item", itemId: item.id }), /MissingData/);
  actor.pack = "some.pack";
  assert.equal(canPingActor(actor, user), false);
});

test("unidentified items never expose a true name, even when a public alias is absent", () => {
  const { item, snap } = fixture();
  item.name = "Secret True Name";
  item._source = { name: "Another Secret" };
  item.system.identified = false;
  item.system.unidentified = { name: "수상한 물약" };
  assert.equal(snap({ kind: "item", itemId: item.id }).label, "수상한 물약");
  item.system.unidentified.name = "";
  assert.equal(publicItemName(item, i18n().localize), "미식별 아이템");
  assert.doesNotMatch(JSON.stringify(snap({ kind: "item", itemId: item.id })), /Secret|description|quantity/);
});

test("missing, NaN and infinite values reject instead of displaying a guessed zero", () => {
  const { actor, snap } = fixture();
  for (const bad of [undefined, null, "7", NaN, Infinity]) {
    actor.system.skills.ste.total = bad;
    assert.throws(() => snap({ kind: "skill", key: "ste" }), /MissingData/);
  }
  assert.throws(() => snap({ kind: "item", itemId: "deleted" }), /MissingData/);
  assert.throws(() => snap({ kind: "save", key: "concentration" }), /MissingData/);
});

test("snapshots are detached from later changes/deletions and only contain selected fields", () => {
  const { actor, item, snap } = fixture();
  item.type = "spell";
  Object.assign(item.system, { level: 1, method: "spell", prepared: 1 });
  const snapshot = snap({ kind: "item", itemId: item.id });
  const before = structuredClone(snapshot);
  item.name = "Changed";
  item.system.prepared = 0;
  actor.name = "Changed actor";
  actor.items.delete(item.id);
  assert.deepEqual(snapshot, before);
  assert.equal(snapshot.status, "준비됨");
  assert.equal(snapshot.createdAt, 123);
});

test("both locales format all fourteen categories and escape HTML and Foundry enrichers", () => {
  const { snap } = fixture();
  for (const language of ["ko", "en"]) {
    for (const kind of ["item", "feature", "spell", "ability", "skill", "save", "initiative", "speed", "proficiency", "ac", "hp", "inspiration", "currency", "token"]) {
      const base = snap({ kind: "ability", key: "str" });
      const content = formatMessage({ ...base, kind, status: "준비됨", value: 30, unit: "ft.", current: 22, maximum: 50, tokenName: "고블린", amounts: [{ amount: 5, label: "금화" }] }, i18n(language).format);
      assert.match(content, /<strong>/);
      assert.doesNotMatch(content, /SHEETPING|undefined|NaN|\{\w+\}/);
    }
  }
  const content = formatMessage({ kind: "item", userName: '<img src=x onerror="alert(1)">', actorName: "@UUID[SECRET]", label: "[[1d20]] & <script>x</script>" }, i18n().format);
  assert.doesNotMatch(content, /<img|<script|@UUID|\[\[/);
  assert.match(content, /&lt;img/);
  assert.match(content, /&#64;UUID/);
});

test("sidebar pings use prepared initiative, proficiency and AC instead of base values", () => {
  const { snap } = fixture();
  assert.equal(snap({ kind: "initiative" }).modifier, 5);
  assert.equal(snap({ kind: "proficiency" }).modifier, 3);
  assert.equal(snap({ kind: "ac" }).value, 18);
});

test("HP snapshots use displayed effective maximum and exclude temporary HP", () => {
  const { actor, snap } = fixture();
  const before = structuredClone(actor.system.attributes.hp);
  const snapshot = snap({ kind: "hp" });
  assert.equal(snapshot.current, 22);
  assert.equal(snapshot.maximum, 50);
  assert.deepEqual(actor.system.attributes.hp, before);
  assert.equal("temp" in snapshot, false);
  assert.equal("tempmax" in snapshot, false);
  actor.system.attributes.hp.value = 3;
  actor.system.attributes.hp.effectiveMax = 30;
  assert.equal(snapshot.current, 22);
  assert.equal(snapshot.maximum, 50);
  assert.equal(snap({ kind: "hp" }).maximum, 30);
  Object.assign(actor.system.attributes.hp, { value: 0, effectiveMax: 0 });
  assert.equal(snap({ kind: "hp" }).current, 0);
  assert.equal(snap({ kind: "hp" }).maximum, 0);
});

test("speed matches the highest visible movement mode, with units, ties and hover", () => {
  const { actor, snap } = fixture();
  const movement = actor.system.attributes.movement;
  const speed = snap({ kind: "speed" });
  assert.equal(speed.value, 60);
  assert.equal(speed.movementType, "fly");
  assert.equal(speed.label, "비행");
  assert.equal(speed.unit, "ft.");
  movement.hover = true;
  assert.equal(snap({ kind: "speed" }).label, "비행 (정지 비행)");
  Object.assign(movement, { fly: 30, climb: 30, units: "m" });
  assert.equal(snap({ kind: "speed" }).movementType, "walk");
  assert.equal(snap({ kind: "speed" }).unit, "m");
  for (const type of ["walk", "burrow", "climb", "fly", "swim"]) movement[type] = 0;
  assert.equal(snap({ kind: "speed" }).value, 0);
  assert.equal(snap({ kind: "speed" }).movementType, "walk");
  assert.equal(speed.value, 60, "later movement updates do not change past snapshots");
});

test("new statistic pings reject absent or invalid values instead of inventing defaults", () => {
  for (const [kind, objectKey, field] of [["initiative", "init", "total"], ["ac", "ac", "value"], ["hp", "hp", "value"], ["hp", "hp", "effectiveMax"], ["speed", "movement", "walk"]]) {
    for (const value of [null, "0", NaN, Infinity]) {
      const { actor, snap } = fixture();
      actor.system.attributes[objectKey][field] = value;
      assert.throws(() => snap({ kind }), /MissingData/);
    }
  }
  const { actor, snap } = fixture();
  actor.system.attributes.prof = undefined;
  assert.throws(() => snap({ kind: "proficiency" }), /MissingData/);
  delete actor.system.attributes.hp.effectiveMax;
  assert.throws(() => snap({ kind: "hp" }), /MissingData/, "do not fall back to the unadjusted maximum");
  actor.system.attributes.movement = { units: "ft" };
  assert.throws(() => snap({ kind: "speed" }), /MissingData/);
});

test("new Korean sentences contain the requested values and signed bonuses", () => {
  const { snap } = fixture();
  const plain = kind => formatMessage(snap({ kind }), i18n().format).replace(/<[^>]+>/g, "");
  assert.equal(plain("hp"), "● 민수님이 아르벨의 HP가 22/50라고 지목");
  assert.equal(plain("initiative"), "● 민수님이 아르벨의 우선권 수정치 +5 지목");
  assert.equal(plain("proficiency"), "● 민수님이 아르벨의 숙련 보너스 +3 지목");
  assert.equal(plain("ac"), "● 민수님이 아르벨의 AC 18 지목");
  assert.equal(plain("speed"), "● 민수님이 아르벨의 비행 60 ft. 지목");
});

test("HP Z-click sends one saved snapshot without entering native HP editing", async () => {
  const { game, actor } = fixture();
  game.settings = { get: (module, key) => key === "inputMode" ? "zClick" : true };
  class Official {}
  const app = Object.assign(new Official(), { actor });
  const root = new EventTarget();
  let edits = 0;
  const messages = [];
  const before = structuredClone(actor.system.attributes.hp);
  const ChatMessage = {
    canUserCreate: () => true, getSpeaker: () => ({ actor: actor.id }),
    create: async data => { messages.push(data); return data; }
  };
  let zHeld = true;
  const controller = createInputController({ game, isZHeld: () => zHeld,
    systemAPI: { applications: { actor: { CharacterActorSheet: Official } } },
    resolve: () => ({ kind: "hp" }),
    send: (actor, target) => sendPing(actor, target, { game, config, ChatMessage }),
    notify: () => assert.fail("valid HP ping should not notify")
  });
  controller.bind(app, root);
  root.addEventListener("click", () => edits++);
  for (const held of [true, false]) {
    zHeld = held;
    const event = new Event("click", { cancelable: true });
    Object.assign(event, { button: 0, shiftKey: false });
    root.dispatchEvent(event);
    await Promise.resolve();
    assert.equal(event.defaultPrevented, held);
  }
  assert.equal(messages.length, 1);
  assert.equal(edits, 1, "only ordinary click enters native editing");
  assert.deepEqual(actor.system.attributes.hp, before);
  assert.equal(messages[0].flags["sheet-ping"].snapshot.maximum, 50);
  controller.unbind(app);
});

test("sendPing only creates one public ChatMessage and preserves an explicit sheet actor", async () => {
  const { game, actor } = fixture();
  const before = JSON.stringify(actor.system);
  const calls = [];
  const ChatMessage = {
    canUserCreate: () => true,
    getSpeaker: ({ actor }) => ({ actor: actor.id }),
    create: async (data, options) => { calls.push({ data, options }); return data; }
  };
  await sendPing(actor, { kind: "save", key: "dex" }, { game, config, ChatMessage });
  assert.equal(calls.length, 1);
  const { data, options } = calls[0];
  assert.equal(data.user, game.user.id);
  assert.equal(data.speaker.actor, actor.id);
  assert.deepEqual(data.whisper, []);
  assert.deepEqual(data.rolls, []);
  assert.equal(data.blind, false);
  assert.equal(options.chatBubble, false);
  assert.equal(data.flags["sheet-ping"].snapshot.modifier, 6);
  assert.equal(data.flags["sheet-ping"].snapshot.userColor, "#12ab34");
  assert.match(data.content, /class="sheet-ping-user-dot" style="color: #12ab34"/);
  game.user.color.css = "#ffffff";
  assert.equal(data.flags["sheet-ping"].snapshot.userColor, "#12ab34");
  assert.equal(JSON.stringify(actor.system), before);
  ChatMessage.canUserCreate = () => false;
  await assert.rejects(sendPing(actor, { kind: "save", key: "dex" }, { game, config, ChatMessage }), /ChatPermission/);
  assert.equal(calls.length, 1);
});

test("player markers support Foundry Color values and reject CSS or HTML injection", () => {
  assert.equal(normalizeUserColor({ css: "#A1B2C3" }), "#a1b2c3");
  assert.equal(normalizeUserColor("#000000"), "#000000");
  assert.equal(normalizeUserColor("#f80"), "#ff8800");
  for (const color of [undefined, null, "red; background:url(x)", '#fff" onmouseover="evil', "<img>", { css: "" }]) {
    assert.equal(normalizeUserColor(color), "currentColor");
    const html = formatMessage({ kind: "token", userName: "<Player>", userColor: color, tokenName: "Token" }, i18n().format);
    assert.match(html, /style="color: currentColor"/);
    assert.equal((html.match(/sheet-ping-user-dot/g) ?? []).length, 1);
    assert.doesNotMatch(html, /onmouseover|background:url|<img>|<Player>/);
    assert.match(html, /&lt;Player&gt;/);
  }
});

test("cancelled message creation is reported as a failed ping", async () => {
  const { game, actor } = fixture();
  const ChatMessage = { canUserCreate: () => true, getSpeaker: () => ({}), create: async () => null };
  await assert.rejects(sendPing(actor, { kind: "ability", key: "str" }, { game, config, ChatMessage }), error => error instanceof PingError && error.key === "CreateFailed");
});

test("plain clicks and mixed modifiers are not gestures; only the exact official class binds", () => {
  const { game } = fixture();
  class Official {}
  class ThirdParty extends Official {}
  const app = Object.assign(new Official(), { actor: { type: "character" } });
  const api = { applications: { actor: { CharacterActorSheet: Official } } };
  assert.equal(isTargetEnvironment(game), true);
  assert.equal(isSupportedSheet(app, game, api), true);
  assert.equal(isSupportedSheet(Object.assign(new ThirdParty(), { actor: app.actor }), game, api), false);
  assert.equal(isSupportedSheet(app, { ...game, version: "14.367" }, api), false);
  assert.equal(isSupportedSheet(app, { ...game, system: { id: "dnd5e", version: "5.2.5" } }, api), false);
  const event = { button: 0, shiftKey: false };
  assert.equal(isPingGesture(event, true, "zClick"), true);
  assert.equal(isPingGesture(event, false, "zClick"), false);
  for (const change of [{ shiftKey: true }, { button: 1 }, { button: 2 }, { altKey: true }, { ctrlKey: true }, { metaKey: true }]) {
    assert.equal(isPingGesture({ ...event, ...change }, true, "zClick"), false);
  }
});

test("chat styling leaves ordinary messages alone and retains metadata", () => {
  const classes = [];
  const element = { classList: { add: value => classes.push(value) }, querySelector: () => ({ textContent: " 12:34 " }) };
  stylePingMessage({ getFlag: () => false }, element);
  assert.deepEqual(classes, []);
  stylePingMessage({ getFlag: () => true }, element);
  assert.deepEqual(classes, ["sheet-ping-message"]);
  assert.equal(element.title, "12:34");
});

test("input cancels synchronously, ignores mixed modifiers, and cleans up replaced roots", async () => {
  const { game, actor } = fixture();
  game.settings = { get: (module, key) => key === "inputMode" ? "zClick" : true };
  class Official {}
  const app = Object.assign(new Official(), { actor });
  const root1 = new EventTarget(), root2 = new EventTarget();
  const systemAPI = { applications: { actor: { CharacterActorSheet: Official } } };
  let sends = 0;
  const notices = [];
  const controller = createInputController({
    game, systemAPI, isZHeld: () => true,
    resolve: () => ({ kind: "skill", key: "ste" }),
    send: async () => { sends++; throw new PingError("Permission"); },
    notify: key => notices.push(key)
  });
  const click = (root, changes = {}) => {
    const event = new Event("click", { cancelable: true });
    Object.assign(event, { button: 0, shiftKey: false, ...changes });
    root.dispatchEvent(event);
    return event;
  };
  for (let i = 0; i < 5; i++) assert.equal(controller.bind(app, root1), true);
  const event = click(root1);
  assert.equal(event.defaultPrevented, true, "cancellation happens before async notification");
  assert.equal(sends, 1);
  await Promise.resolve();
  assert.deepEqual(notices, ["SHEETPING.Error.Permission"]);
  assert.equal(click(root1, { ctrlKey: true }).defaultPrevented, false);
  assert.equal(sends, 1);
  controller.bind(app, root2);
  assert.equal(click(root1).defaultPrevented, false);
  assert.equal(sends, 1);
  assert.equal(click(root2).defaultPrevented, true);
  assert.equal(sends, 2);
  controller.unbind(app);
  assert.equal(click(root2).defaultPrevented, false);
  assert.equal(sends, 2);
});

test("a stopped native listener cannot run after a supported ping or a failed send", async () => {
  const { game, actor } = fixture();
  let enabled = true;
  game.settings = { get: (module, key) => key === "inputMode" ? "zClick" : enabled };
  class Official {}
  const app = Object.assign(new Official(), { actor });
  const root = new EventTarget();
  const systemAPI = { applications: { actor: { CharacterActorSheet: Official } } };
  let native = 0, sends = 0;
  const controller = createInputController({ game, systemAPI, isZHeld: () => true,
    resolve: () => ({ kind: "ability", key: "str" }),
    send: () => { sends++; throw new PingError("MissingData"); }, notify: () => {} });
  controller.bind(app, root);
  root.addEventListener("click", () => native++);
  const dispatch = type => {
    const event = new Event(type, { cancelable: true });
    Object.assign(event, { button: 0, shiftKey: false });
    root.dispatchEvent(event);
    return event;
  };
  assert.equal(dispatch("click").defaultPrevented, true);
  assert.equal(native, 0);
  assert.equal(sends, 1);
  assert.equal(dispatch("dblclick").defaultPrevented, true);
  assert.equal(sends, 1, "double-click event adds no extra ping");
  enabled = false;
  assert.equal(dispatch("click").defaultPrevented, false);
  assert.equal(native, 1);
  assert.equal(sends, 1);
  controller.unbind(app);
});

test("localization keys are identical and every declared manifest resource exists", async () => {
  const flatten = (data, prefix = "") => Object.entries(data).flatMap(([key, value]) => typeof value === "object" ? flatten(value, `${prefix}${key}.`) : [`${prefix}${key}`]);
  assert.deepEqual(flatten(translations.ko).sort(), flatten(translations.en).sort());
  const manifest = JSON.parse(await readFile(new URL("../module.json", import.meta.url)));
  assert.equal(manifest.id, "sheet-ping");
  assert.equal(manifest.compatibility.maximum, "13.351");
  for (const path of [...manifest.esmodules, ...manifest.styles, ...manifest.languages.map(lang => lang.path), manifest.readme]) {
    assert.ok((await readFile(new URL(`../${path}`, import.meta.url))).length > 0);
  }
});
