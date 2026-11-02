import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import path from "node:path";

const require = createRequire(import.meta.url);
const { chromium } = require(require.resolve("playwright", { paths: [process.cwd(), process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES].filter(Boolean) }));
const root = fileURLToPath(new URL("../", import.meta.url));
const types = { ".mjs": "text/javascript", ".json": "application/json", ".html": "text/html" };
const server = createServer(async (req, res) => {
  try {
    const file = path.resolve(root, `.${decodeURIComponent(new URL(req.url, "http://localhost").pathname)}`);
    if (!file.startsWith(root)) throw new Error("Invalid path");
    res.setHeader("Content-Type", types[path.extname(file)] ?? "text/plain"); res.end(await readFile(file));
  } catch { res.writeHead(404).end(); }
});
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
let browser;
try {
  browser = await chromium.launch({ headless: true, args: ["--no-sandbox"] });
  const page = await browser.newPage();
  await page.goto(`http://127.0.0.1:${server.address().port}/tests/npc-fixture.html`);
  const result = await page.evaluate(async () => {
    const { createInputController } = await import("/scripts/input.mjs");
    const { sendPing } = await import("/scripts/chat.mjs");
    const strings = await (await fetch("/lang/ko.json")).json();
    const localize = key => key.split(".").reduce((o, k) => o?.[k], strings) ?? key;
    const user = { id: "u1", name: "민수", color: "#123abc" }, messages = [], notices = [];
    const values = new Map([["enabled", true], ["zEnabled", true], ["allowObserverPings", true], ["inputMode", "middle"]]);
    const game = { user, version: "13.351", system: { id: "dnd5e", version: "5.3.3" }, settings: { get: (m, k) => values.get(k) },
      i18n: { localize, format: (key, args) => localize(key).replace(/\{(\w+)\}/g, (_, k) => args[k] ?? "") } };
    const actor = { uuid: "Actor.npc", id: "npc", name: "고블린 주술사", type: "npc", testUserPermission: (u, level) => level === "OBSERVER", items: new Map(),
      system: { abilities: { dex: { value: 14, mod: 2, save: { value: 5 } }, int: { mod: 3 } }, skills: { ste: { total: 7 } }, traits: { size: "sm" }, currency: { gp: 2 },
        attributes: { hp: { value: 12, effectiveMax: 24 }, ac: { value: 15 }, init: { total: 4, score: 14 }, prof: 2, movement: { walk: 30, fly: 60, units: "ft" },
          attunement: { value: 1, max: 3 }, encumbrance: { value: 12.5, max: 120 }, death: { success: 1, failure: 2 }, spellcasting: "int" } } };
    for (const [id, type] of [["sword", "weapon"], ["feature", "feat"], ["spell", "spell"]]) actor.items.set(id, { id, type, name: id, parent: actor, uuid: `${actor.uuid}.Item.${id}`, system: { level: 0 }, testUserPermission: () => true });
    const config = { abilities: { dex: { label: "민첩" }, int: { label: "지능" } }, skills: { ste: { label: "은신" } }, actorSizes: { sm: { label: "소형" } }, currencies: { gp: { label: "금화" } },
      movementTypes: { walk: { label: "보행" }, fly: { label: "비행" } }, movementUnits: { ft: { abbreviation: "ft." } }, weightUnits: { lb: { abbreviation: "lb" } }, encumbrance: { baseUnits: { default: { imperial: "lb" } } } };
    const ChatMessage = { canUserCreate: () => true, getSpeaker: () => ({}), create: async data => { messages.push(data); return data; } };
    class NPCActorSheet {}
    const root = document.querySelector("#sheet"), app = Object.assign(new NPCActorSheet(), { actor });
    const input = createInputController({ game, config, systemAPI: { applications: { actor: { NPCActorSheet } } }, isZHeld: () => true,
      send: (actor, target) => sendPing(actor, target, { game, config, ChatMessage }), notify: key => notices.push(key) });
    input.bind(app, root);
    const tick = () => new Promise(resolve => setTimeout(resolve, 0));
    const fire = (id, type, button = 1, shiftKey = false) => {
      const e = new MouseEvent(type, { bubbles: true, cancelable: true, button, shiftKey });
      document.getElementById(id).dispatchEvent(e); return e;
    };
    const check = (ok, label) => { if (!ok) throw new Error(label); };
    const initial = JSON.stringify(actor.system);
    const targets = { hp: "hp", ac: "ac", initiative: "initiative", "initiative-score": "initiativeScore", proficiency: "proficiency", size: "size", ability: "ability", mod: "ability", score: "ability", save: "save", "save-icon": "save", skill: "skill", "skill-label": "skill", walk: "speed", "walk-label": "speed", fly: "speed", gear: "attack", attack: "attack", feature: "feature", spell: "spell", currency: "currency", attunement: "attunement", weight: "weight", death: "deathProgress", "death-success": "deathProgress", "death-failure": "deathProgress", "spell-ability": "spellAbility", "spell-ability-label": "spellAbility", "spell-attack": "spellAttack", "spell-dc": "spellDC" };
    for (const [id, kind] of Object.entries(targets)) {
      const before = messages.length;
      check(fire(id, "auxclick").defaultPrevented, `consume ${id}`); await tick();
      check(messages.length === before + 1 && messages.at(-1).flags["sheet-ping"].snapshot.kind === kind, `target ${id}`);
    }
    check(JSON.stringify(actor.system) === initial, "source data unchanged");
    check(messages.find(m => m.flags["sheet-ping"].snapshot.kind === "spellAttack").flags["sheet-ping"].snapshot.modifier === 8, "displayed NPC attack bonus");
    for (const id of ["config", "hp-input", "death-input", "save-cycle", "legendary", "special-speed", "weapon-image", "description", "currency-input", "spell-select", "spell-level"]) {
      const before = messages.length; check(!fire(id, "auxclick").defaultPrevented, `excluded ${id}`); await tick(); check(messages.length === before, `no ping ${id}`);
    }
    check(!fire("hp", "click", 0).defaultPrevented, "ordinary click preserved");
    values.set("inputMode", "zClick");
    const before = messages.length; check(fire("hp", "click", 0).defaultPrevented, "Z click"); await tick(); check(messages.length === before + 1, "Z sends once");
    check(!fire("hp", "click", 0, true).defaultPrevented, "Shift preserved");
    values.set("allowObserverPings", false);
    fire("hp", "click", 0); await tick(); check(notices.at(-1) === "SHEETPING.Error.Permission", "observer setting");
    input.unbind(app); check(!fire("hp", "click", 0).defaultPrevented, "unbind");
    return { targets: Object.keys(targets).length, status: "passed" };
  });
  assert.equal(result.status, "passed"); console.log(JSON.stringify(result));
} finally { await browser?.close(); await new Promise(resolve => server.close(resolve)); }
