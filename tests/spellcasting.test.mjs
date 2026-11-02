import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { buildSnapshot } from "../scripts/dnd5e.mjs";
import { prepareSpellcastingTargets } from "../scripts/targets.mjs";
import { createInputController } from "../scripts/input.mjs";
import { sendPing } from "../scripts/chat.mjs";
import { formatMessage } from "../scripts/formatter.mjs";

const locales = {};
for (const lang of ["ko", "en"]) locales[lang] = JSON.parse(await readFile(new URL(`../lang/${lang}.json`, import.meta.url)));
function i18n(lang = "ko") {
  const localize = key => key.split(".").reduce((o, k) => o?.[k], locales[lang]) ?? key;
  return { localize, format: (key, values) => localize(key).replace(/\{(\w+)\}/g, (_, key) => values[key] ?? "") };
}
function fixture() {
  const user = { id: "u1", name: "민수", color: "#123abc" };
  const values = new Map([["enabled", true], ["zEnabled", true], ["allowObserverPings", true], ["inputMode", "middle"]]);
  const game = { user, i18n: i18n(), version: "13.351", system: { id: "dnd5e", version: "5.3.3" },
    settings: { get: (module, key) => values.get(key) } };
  const config = { abilities: { int: { label: "지능" }, cha: { label: "매력" } } };
  const actor = { uuid: "Actor.a1", id: "a1", name: "아르벨", type: "character", testUserPermission: (u, level) => level === "OBSERVER",
    system: { abilities: { int: { mod: 4 }, cha: { mod: -1 } }, attributes: { spellcasting: "cha", spell: { mod: 99, dc: 99 }, prof: 2 } },
    items: new Map(), spellcastingClasses: {} };
  for (const [id, name, levels, ability, attack, save] of [
    ["warlock", "워락", 2, "cha", 1, 11], ["wizard", "위저드", 8, "int", 9, 18], ["other", "다른 클래스", 1, "int", 7, 16]
  ]) {
    const item = { id, name, uuid: `${actor.uuid}.Item.${id}`, type: "class", parent: actor, testUserPermission: () => true,
      system: { levels, spellcasting: { progression: "full" } }, spellcasting: { progression: "full", ability, attack, save } };
    actor.items.set(id, item); actor.spellcastingClasses[id] = item;
  }
  const snap = (kind, classId = "wizard", key = "int", options = {}) => buildSnapshot({
    actor, user, config, localize: game.i18n.localize, allowObservers: true, target: { kind, classId, key }, ...options
  });
  return { actor, user, game, config, values, snap };
}

test("spellcasting cards retain class IDs in official level order, including same-ability multiclass cards", () => {
  const { actor } = fixture();
  const cards = ["int", "cha", "int"].map(ability => ({ dataset: { ability, sheetPingClassId: "old" } }));
  prepareSpellcastingTargets({ querySelectorAll: () => cards }, actor);
  assert.deepEqual(cards.map(c => c.dataset.sheetPingClassId), ["wizard", "warlock", "other"]);
  actor.items.get("other").system.levels = 10;
  prepareSpellcastingTargets({ querySelectorAll: () => cards }, actor);
  assert.equal(cards.every(c => !c.dataset.sheetPingClassId), true, "mismatching card order clears stale mappings");
  const rerendered = ["int", "int", "cha"].map(ability => ({ dataset: { ability } }));
  prepareSpellcastingTargets({ querySelectorAll: () => rerendered }, actor);
  assert.deepEqual(rerendered.map(c => c.dataset.sheetPingClassId), ["other", "wizard", "warlock"]);
  prepareSpellcastingTargets({ querySelectorAll: () => rerendered.slice(0, 2) }, actor);
  assert.equal(rerendered.slice(0, 2).every(c => !c.dataset.sheetPingClassId), true, "partial/mismatching templates are not guessed");
});

test("spell pings read the selected class's prepared ability, attack and DC rather than the primary class or base arithmetic", () => {
  const { snap, actor } = fixture();
  const before = JSON.stringify(actor.system);
  assert.equal(snap("spellAbility").modifier, 4);
  assert.equal(snap("spellAbility").label, "지능");
  assert.equal(snap("spellAttack").modifier, 9);
  assert.equal(snap("spellDC").value, 18);
  assert.equal(snap("spellAttack", "other").modifier, 7, "same ability, different prepared class bonus");
  assert.equal(snap("spellDC", "other").value, 16);
  assert.equal(snap("spellAbility", "warlock", "cha").modifier, -1);
  assert.equal(JSON.stringify(actor.system), before);
  const snapshot = snap("spellDC");
  actor.items.get("wizard").spellcasting.save = 20;
  assert.equal(snapshot.value, 18, "sent values remain detached from later edits");
});

test("subclass spellcasting overrides preserve the sheet's source name and permission checks", () => {
  const { actor, snap } = fixture();
  const item = actor.items.get("wizard");
  item.spellcasting.progression = "third";
  item.subclass = { name: "비전 기사", uuid: "Actor.a1.Item.sub", parent: actor, system: {}, testUserPermission: () => true };
  assert.equal(snap("spellAttack").source, "비전 기사");
  item.subclass.testUserPermission = () => false;
  assert.throws(() => snap("spellAttack"), /Permission/);
});

test("missing, stale, foreign and unauthorized spellcasting data never produce guessed values", () => {
  for (const issue of ["missing", "foreign", "notCaster", "abilityChanged", "itemDenied", "classRemoved"]) {
    const { actor, snap } = fixture();
    const item = actor.items.get("wizard");
    if (issue === "missing") actor.items.delete("wizard");
    if (issue === "foreign") item.parent = { uuid: "Actor.other" };
    if (issue === "notCaster") item.spellcasting.progression = "none";
    if (issue === "abilityChanged") item.spellcasting.ability = "cha";
    if (issue === "itemDenied") item.testUserPermission = () => false;
    if (issue === "classRemoved") delete actor.spellcastingClasses.wizard;
    assert.throws(() => snap("spellDC"), /Permission|MissingData/, issue);
  }
  for (const value of [undefined, null, NaN, Infinity, "9"]) {
    const { actor, snap } = fixture();
    actor.items.get("wizard").spellcasting.attack = value;
    actor.items.get("wizard").spellcasting.save = value;
    actor.system.abilities.int.mod = value;
    for (const kind of ["spellAbility", "spellAttack", "spellDC"]) assert.throws(() => snap(kind), /MissingData/);
  }
});

test("spellcasting messages localize escaped source/ability names with signed modifiers and bold character names", () => {
  const { snap, actor } = fixture();
  for (const lang of ["ko", "en"]) {
    for (const kind of ["spellAbility", "spellAttack", "spellDC"]) {
      const snapshot = snap(kind);
      snapshot.source = '<Source> @UUID[secret]';
      const html = formatMessage(snapshot, i18n(lang).format);
      assert.match(html, /<strong>아르벨<\/strong>/);
      assert.match(html, /&lt;Source&gt; &#64;UUID&#91;secret&#93;/);
      assert.doesNotMatch(html, /<Source>|undefined|NaN|@UUID|\[secret\]/);
    }
  }
  assert.match(formatMessage(snap("spellAbility", "warlock", "cha"), i18n().format), /매력\) 수정치 -1/);
  actor.items.get("wizard").spellcasting.attack = 0;
  assert.match(formatMessage(snap("spellAttack"), i18n().format), /주문 공격 수정치 \+0/);
  assert.match(formatMessage(snap("spellDC"), i18n().format), /주문 내성 DC 18/);
});

test("live observer setting applies to spellcasting pings without changing class preparation or Actor data", async () => {
  const env = fixture(), messages = [];
  const before = JSON.stringify(env.actor.system);
  const ChatMessage = { canUserCreate: () => true, getSpeaker: () => ({}), create: async data => { messages.push(data); return data; } };
  const target = { kind: "spellAttack", classId: "wizard", key: "int" };
  await sendPing(env.actor, target, { ...env, ChatMessage });
  assert.equal(messages.length, 1);
  assert.deepEqual(messages[0].rolls, []);
  assert.deepEqual(messages[0].whisper, []);
  env.values.set("allowObserverPings", false);
  await assert.rejects(sendPing(env.actor, target, { ...env, ChatMessage }), /Permission/);
  assert.equal(messages.length, 1);
  assert.equal(JSON.stringify(env.actor.system), before);
});

test("selected spell fields cancel native actions synchronously in both input modes, including a failed ping", async () => {
  for (const mode of ["middle", "zClick"]) {
    const env = fixture(), root = new EventTarget();
    class Official {}
    const app = Object.assign(new Official(), { actor: env.actor });
    env.values.set("inputMode", mode);
    let native = 0, sent = 0;
    const notices = [];
    const input = createInputController({ game: env.game, systemAPI: { applications: { actor: { CharacterActorSheet: Official } } },
      isZHeld: () => true, resolve: () => ({ kind: "spellDC", classId: "wizard", key: "int" }),
      send: async () => { sent++; throw new Error("Creation blocked"); }, report: () => {}, notify: key => notices.push(key) });
    input.bind(app, root);
    const type = mode === "middle" ? "auxclick" : "click";
    root.addEventListener(type, () => native++);
    const event = new Event(type, { cancelable: true });
    Object.assign(event, { button: mode === "middle" ? 1 : 0 });
    root.dispatchEvent(event);
    assert.equal(event.defaultPrevented, true);
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(native, 0); assert.equal(sent, 1); assert.equal(notices.length, 1);
    input.unbind(app);
  }
});
