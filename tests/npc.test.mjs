import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { buildSnapshot, canPingActor } from "../scripts/dnd5e.mjs";
import { createInputController, isSupportedSheet } from "../scripts/input.mjs";
import { prepareNPCTargets, readNPCSpellValue } from "../scripts/npc-targets.mjs";
import { formatMessage } from "../scripts/formatter.mjs";
import { sendPing } from "../scripts/chat.mjs";

const languages = {};
for (const lang of ["ko", "en"]) languages[lang] = JSON.parse(await readFile(new URL(`../lang/${lang}.json`, import.meta.url)));
function i18n(lang = "ko") {
  const localize = key => key.split(".").reduce((o, k) => o?.[k], languages[lang]) ?? key;
  return { localize, format: (key, values) => localize(key).replace(/\{(\w+)\}/g, (_, key) => values[key] ?? "") };
}
function fixture() {
  const user = { id: "u1", name: "민수", color: "#123abc" };
  const settings = new Map([["enabled", true], ["zEnabled", true], ["allowObserverPings", true], ["inputMode", "middle"]]);
  const game = { user, version: "13.351", system: { id: "dnd5e", version: "5.3.3" }, i18n: i18n(),
    settings: { get: (module, key) => settings.get(key) } };
  const actor = { uuid: "Actor.goblin", id: "goblin", name: "고블린 주술사", type: "npc", items: new Map(),
    testUserPermission: (u, level) => u === user && level === "OBSERVER", spellcastingClasses: {},
    system: { abilities: { dex: { value: 14, mod: 2, save: { value: 5 } }, int: { value: 16, mod: 3, save: { value: 3 } } },
      skills: { ste: { total: 7 } }, traits: { size: "sm" }, currency: { gp: 2 },
      attributes: { hp: { value: 12, effectiveMax: 24, temp: 5 }, ac: { value: 15 }, init: { total: 4, score: 14 }, prof: 2,
        movement: { walk: 30, fly: 60, hover: true, units: "ft" }, attunement: { value: 1, max: 3 },
        encumbrance: { value: 12.5, max: 120 }, death: { success: 1, failure: 2 }, spellcasting: "int", spell: { attack: 99, dc: 99 } } } };
  const config = { abilities: { dex: { label: "민첩" }, int: { label: "지능" } }, skills: { ste: { label: "은신" } },
    actorSizes: { sm: { label: "소형" } }, currencies: { gp: { label: "금화" } },
    movementTypes: { walk: { label: "보행" }, fly: { label: "비행" }, jump: { label: "도약", hidden: true } },
    movementUnits: { ft: { abbreviation: "ft." } }, weightUnits: { lb: { abbreviation: "lb" } },
    encumbrance: { baseUnits: { default: { imperial: "lb" } } } };
  const snap = target => buildSnapshot({ actor, user, config, localize: game.i18n.localize, allowObservers: true, target });
  const ChatMessage = { canUserCreate: () => true, getSpeaker: ({ actor }) => ({ actor: actor.id }), create: async data => data };
  return { user, game, actor, config, snap, settings, ChatMessage };
}

test("only official sheets with matching character/NPC actor types bind", () => {
  const { game } = fixture();
  class CharacterActorSheet {} class NPCActorSheet {} class ThirdParty extends NPCActorSheet {}
  const api = { applications: { actor: { CharacterActorSheet, NPCActorSheet } } };
  for (const [Sheet, type, expected] of [[NPCActorSheet, "npc", true], [CharacterActorSheet, "character", true],
    [ThirdParty, "npc", false], [CharacterActorSheet, "npc", false], [NPCActorSheet, "character", false], [NPCActorSheet, "vehicle", false]]) {
    assert.equal(isSupportedSheet(Object.assign(new Sheet(), { actor: { type } }), game, api), expected);
  }
});

test("NPC sheets retain owner, GM and optional observer permissions without allowing limited or compendium documents", () => {
  const { actor, user } = fixture();
  assert.equal(canPingActor(actor, user), false);
  assert.equal(canPingActor(actor, user, { allowObservers: true }), true);
  actor.testUserPermission = (u, level) => level === "OWNER";
  assert.equal(canPingActor(actor, user), true);
  actor.testUserPermission = () => false;
  assert.equal(canPingActor(actor, user, { allowObservers: true }), false);
  assert.equal(canPingActor(actor, { ...user, isGM: true }), true);
  actor.limited = true;
  assert.equal(canPingActor(actor, { ...user, isGM: true }), false);
  actor.limited = false; actor.pack = "pack.npcs";
  assert.equal(canPingActor(actor, { ...user, isGM: true }), false);
});

test("NPC core pings use prepared values, distinguish initiative score, and preserve the source", () => {
  const { actor, snap } = fixture(), before = JSON.stringify(actor.system);
  assert.equal(snap({ kind: "hp" }).current, 12); assert.equal(snap({ kind: "hp" }).maximum, 24);
  assert.equal(snap({ kind: "ac" }).value, 15);
  assert.equal(snap({ kind: "initiative" }).modifier, 4);
  assert.equal(snap({ kind: "initiativeScore" }).value, 14);
  assert.equal(snap({ kind: "proficiency" }).modifier, 2);
  assert.equal(snap({ kind: "ability", key: "dex" }).score, 14);
  assert.equal(snap({ kind: "save", key: "dex" }).modifier, 5);
  assert.equal(snap({ kind: "skill", key: "ste" }).modifier, 7);
  assert.equal(snap({ kind: "deathProgress" }).failure, 2);
  assert.equal(JSON.stringify(actor.system), before);
});

test("NPC inventory and size targets reuse weight, currency and attunement data", () => {
  const { snap } = fixture();
  assert.equal(snap({ kind: "weight" }).current, 12.5);
  assert.equal(snap({ kind: "weight" }).unit, "lb");
  assert.equal(snap({ kind: "currency", key: "gp" }).amounts[0].amount, 2);
  assert.equal(snap({ kind: "attunement" }).current, 1);
  assert.equal(snap({ kind: "size" }).label, "소형");
});

test("NPC weapons, features, spells and gear keep item identity, permission and unidentified-name protections", () => {
  const { actor, snap } = fixture();
  const item = { id: "attack1", uuid: "Actor.goblin.Item.attack1", name: "비밀 무기", type: "weapon", parent: actor,
    testUserPermission: () => true, system: { identified: false, unidentified: { name: "녹슨 칼" }, level: 0 } };
  actor.items.set(item.id, item);
  const target = { kind: "item", itemId: item.id };
  for (const [type, kind] of [["weapon", "attack"], ["feat", "feature"], ["spell", "spell"], ["loot", "item"]]) {
    item.type = type;
    assert.equal(snap(target).kind, kind); assert.equal(snap(target).label, "녹슨 칼");
  }
  item.testUserPermission = () => false;
  assert.throws(() => snap(target), /Permission/);
  item.testUserPermission = () => true; item.parent = { uuid: "Actor.other" };
  assert.throws(() => snap(target), /MissingData/);
});

test("NPC movement pills show their selected mode, units and hover rather than the largest speed", () => {
  const { snap } = fixture();
  assert.equal(snap({ kind: "speed", key: "walk" }).value, 30);
  assert.equal(snap({ kind: "speed", key: "walk" }).label, "보행");
  assert.equal(snap({ kind: "speed", key: "fly" }).value, 60);
  assert.match(snap({ kind: "speed", key: "fly" }).label, /정지 비행/);
  assert.equal(snap({ kind: "speed" }).value, 60, "existing character-style highest-speed target remains valid");
  assert.throws(() => snap({ kind: "speed", key: "jump" }), /MissingData/);
});

test("classless NPC spell cards snapshot displayed values without evaluating rolls or using unrelated actor spell totals", () => {
  const { actor, snap, game } = fixture();
  actor.getRollData = () => assert.fail("no formulas or Roll evaluation during a ping");
  for (const [kind, value, key] of [["spellAbility", 3, "modifier"], ["spellAttack", 8, "modifier"], ["spellDC", 17, "value"]]) {
    const snapshot = snap({ kind, key: "int", displayedValue: value });
    assert.equal(snapshot[key], value); assert.equal(snapshot.valueSource, "sheetDisplay");
    const content = formatMessage(snapshot, game.i18n.format);
    assert.doesNotMatch(content, /> 주문|undefined|99/);
  }
  actor.system.attributes.spellcasting = "";
  assert.equal(snap({ kind: "spellAbility", key: "", displayedValue: 0 }).label, "미지정");
});

test("NPC spell cards with classes use the first class and reject stale class/ability connections", () => {
  const { actor, snap } = fixture();
  const caster = { id: "caster", uuid: "Actor.goblin.Item.caster", parent: actor, name: "위저드", system: {},
    spellcasting: { ability: "int" }, testUserPermission: () => true };
  actor.items.set(caster.id, caster); actor.spellcastingClasses = { caster };
  const target = { kind: "spellAttack", key: "int", classId: "caster", displayedValue: 8 };
  assert.equal(snap(target).source, "위저드");
  assert.equal(snap(target).classUuid, caster.uuid);
  caster.testUserPermission = () => false;
  assert.throws(() => snap(target), /Permission/);
  caster.testUserPermission = () => true; caster.spellcasting.ability = "dex";
  assert.throws(() => snap(target), /MissingData/);
});

test("NPC spell display parsing accepts signed/zero values and rejects editors, formulas and malformed data", () => {
  const field = (text, editor = false) => ({ querySelector: () => ({ textContent: text, querySelector: () => editor ? {} : null }) });
  for (const [text, value] of [["+8", 8], [" −2 ", -2], ["0", 0], ["17", 17]]) assert.equal(readNPCSpellValue(field(text)), value);
  for (const text of ["", "—", "1d20", "[[1d20]]", "NaN", "Infinity", "8+2", "17 DC"]) assert.equal(readNPCSpellValue(field(text)), undefined);
  assert.equal(readNPCSpellValue(field("8", true)), undefined);
  const { snap } = fixture();
  assert.throws(() => snap({ kind: "spellAttack", key: "int", displayedValue: undefined }), /MissingData/);
});

test("NPC render preparation maps numeric movement pills and single spell cards without class assumptions", () => {
  const { actor, config } = fixture();
  const card = { dataset: { ability: "int", sheetPingClassId: "old" } };
  const pills = [true, true, false].map(numeric => ({ dataset: { sheetPingMovementType: "old" }, querySelector: () => numeric ? {} : null }));
  const group = { querySelectorAll: () => pills };
  const root = { querySelectorAll: () => [card], querySelector: () => ({ closest: () => group }) };
  prepareNPCTargets(root, actor, config);
  assert.equal(card.dataset.sheetPingNpcCasting, "true"); assert.equal(card.dataset.sheetPingClassId, undefined);
  assert.deepEqual(pills.map(p => p.dataset.sheetPingMovementType), ["walk", "fly", undefined]);
  actor.system.attributes.spellcasting = "dex";
  prepareNPCTargets(root, actor, config);
  assert.equal(card.dataset.sheetPingNpcCasting, undefined);
});

test("NPC pings honor the live observer setting and cannot fall through to native actions after failure", async () => {
  for (const mode of ["middle", "zClick"]) {
    const env = fixture(), root = new EventTarget(), notices = [];
    class NPCActorSheet {}
    env.settings.set("inputMode", mode);
    const app = Object.assign(new NPCActorSheet(), { actor: env.actor });
    const input = createInputController({ ...env, systemAPI: { applications: { actor: { NPCActorSheet } } },
      isZHeld: () => true, resolve: () => ({ kind: "hp" }),
      send: (actor, target) => sendPing(actor, target, env), notify: key => notices.push(key) });
    assert.equal(input.bind(app, root), true);
    env.settings.set("allowObserverPings", false);
    const type = mode === "middle" ? "auxclick" : "click";
    let native = 0; root.addEventListener(type, () => native++);
    const event = new Event(type, { cancelable: true }); Object.assign(event, { button: mode === "middle" ? 1 : 0 });
    root.dispatchEvent(event); await new Promise(resolve => setImmediate(resolve));
    assert.equal(event.defaultPrevented, true); assert.equal(native, 0);
    assert.deepEqual(notices, ["SHEETPING.Error.Permission"]);
    input.unbind(app);
  }
});

test("NPC snapshots support synthetic token actors and escape names in both languages", async () => {
  const env = fixture();
  env.actor.uuid = "Scene.s1.Token.t1.Actor.goblin";
  env.actor.name = '<Goblin> @UUID[secret]';
  const message = await sendPing(env.actor, { kind: "hp" }, env);
  assert.deepEqual(message.rolls, []); assert.deepEqual(message.whisper, []);
  assert.equal(message.flags["sheet-ping"].snapshot.actorUuid, env.actor.uuid);
  for (const lang of ["ko", "en"]) {
    const html = formatMessage(env.snap({ kind: "hp" }), i18n(lang).format);
    assert.match(html, /<strong>&lt;Goblin&gt; &#64;UUID&#91;secret&#93;<\/strong>/);
    assert.doesNotMatch(html, /<Goblin>|@UUID/);
  }
});
