import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import path from "node:path";

// Use an installed Playwright, or the primary runtime's installation when present.
const require = createRequire(import.meta.url);
const playwrightPath = require.resolve("playwright", {
  paths: [process.cwd(), process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES].filter(Boolean)
});
const { chromium } = require(playwrightPath);
const root = fileURLToPath(new URL("../", import.meta.url));
const types = { ".mjs": "text/javascript", ".json": "application/json", ".css": "text/css", ".html": "text/html" };
const server = createServer(async (req, res) => {
  try {
    const pathname = decodeURIComponent(new URL(req.url, "http://localhost").pathname);
    const file = path.resolve(root, `.${pathname}`);
    if (!file.startsWith(root)) throw new Error("Invalid path");
    res.setHeader("Content-Type", types[path.extname(file)] ?? "text/plain");
    res.end(await readFile(file));
  } catch { res.writeHead(404).end(); }
});
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
let browser;
try {
  browser = await chromium.launch({ headless: true, args: ["--no-sandbox"] });
  const page = await browser.newPage();
  const pageErrors = [];
  page.on("pageerror", error => pageErrors.push(error.message));
  await page.goto(`http://127.0.0.1:${server.address().port}/tests/fixture.html`);
  const result = await page.evaluate(async () => {
    const passed = [];
    function check(condition, name) {
      if (!condition) throw new Error(name);
      passed.push(name);
    }
    const strings = await (await fetch("/lang/ko.json")).json();
    const localize = key => key.split(".").reduce((o, k) => o?.[k], strings) ?? key;
    const registered = new Map();
    const handlers = new Map();
    const emit = (name, ...args) => { for (const fn of handlers.get(name) ?? []) fn(...args); };
    globalThis.Hooks = {
      on(name, fn) { const list = handlers.get(name) ?? []; list.push(fn); handlers.set(name, list); },
      once(name, fn) { this.on(name, fn); }
    };
    const notices = [];
    globalThis.ui = { notifications: { warn: text => notices.push(text) } };
    const messages = [];
    let cancelCreate = false;
    const user = { id: "u1", name: "민수", isGM: false, color: "#12ab34" };
    class Official {}
    const instances = new Map();
    const systemAPI = { applications: { actor: { CharacterActorSheet: Official } } };
    globalThis.game = {
      version: "13.351", system: { id: "dnd5e", version: "5.3.3" }, user, dnd5e: systemAPI,
      i18n: { localize, format: (key, values) => localize(key).replace(/\{(\w+)\}/g, (_, k) => values[k] ?? "") },
      settings: { register: (module, key, options) => registered.set(key, options.default), get: (module, key) => registered.get(key) }
    };
    const config = {
      actorSizes: { med: { label: "중형" } },
      encumbrance: { baseUnits: { default: { imperial: "lb", metric: "kg" } } },
      weightUnits: { lb: { abbreviation: "lb" }, kg: { abbreviation: "kg" } },
      currencies: { gp: { label: "금화" }, cp: { label: "동화" } },
      abilities: { str: { label: "근력" }, dex: { label: "민첩" }, int: { label: "지능" }, cha: { label: "매력" } }, skills: { ste: { label: "은신" } },
      movementTypes: { walk: { label: "이동 속도" }, fly: { label: "비행" }, jump: { label: "도약", hidden: true } },
      movementUnits: { ft: { abbreviation: "ft." } },
      spellcasting: { spell: { prepares: true } },
      spellPreparationStates: { unprepared: { value: 0 }, prepared: { value: 1 }, always: { value: 2 } }
    };
    const ChatMessage = {
      canUserCreate: () => true,
      getSpeaker: ({ actor }) => ({ actor: actor.id }),
      async create(data) {
        if (cancelCreate) return null;
        messages.push(structuredClone(data));
        const li = document.createElement("li");
        li.className = "chat-message";
        li.innerHTML = '<header class="message-header"><img alt="portrait"><span class="message-sender">민수</span><time class="message-timestamp">12:34</time><a class="message-delete">Delete</a></header><div class="message-content"></div>';
        li.querySelector(".message-content").innerHTML = data.content;
        emit("renderChatMessageHTML", { getFlag: (module, key) => data.flags[module][key] }, li);
        document.querySelector("#chat").append(li);
        return data;
      }
    };
    globalThis.CONFIG = { DND5E: config, ChatMessage: { documentClass: ChatMessage } };
    globalThis.foundry = { applications: { instances } };
    const map = document.querySelector("#map");
    const scene = { id: "scene1", active: true, tokens: new Map() };
    const mapToken = { isVisible: true, isPreview: false, center: { x: 50, y: 50 }, document: { id: "t1", name: "고블린 A", uuid: "Scene.scene1.Token.t1", parent: scene }, bounds: { contains: (x, y) => x >= 0 && x < 100 && y >= 0 && y < 100 } };
    scene.tokens.set("t1", mapToken.document);
    game.scenes = new Map([[scene.id, scene]]);
    const mapActivities = [], mapDraws = [], mapPans = [];
    user.broadcastActivity = data => mapActivities.push(structuredClone(data));
    globalThis.canvas = { ready: true, app: { view: map }, scene, tokens: { active: true, hover: mapToken, get: id => id === "t1" ? mapToken : null }, canvasCoordinatesFromClient: point => point,
      controls: { handlePing: async (user, point, data) => { mapDraws.push({ user, point, data }); return true; } },
      pan: () => { throw new Error("Unexpected camera pan"); }, animatePan: async data => { mapPans.push(data); return true; } };
    const actor = {
      id: "a1", uuid: "Actor.a1", name: "아르벨", type: "character", allowed: true,
      testUserPermission(user, level) { return this.allowed || (this.observer && level === "OBSERVER"); },
      system: {
        traits: { size: "med" },
        currency: { gp: 120, cp: 5 },
        abilities: { str: { value: 16, mod: 3 }, dex: { save: { value: 6 } }, int: { mod: 4 }, cha: { mod: -1 } }, skills: { ste: { total: 7 } },
        attributes: {
          hp: { value: 22, max: 40, effectiveMax: 50, tempmax: 10, temp: 7 }, inspiration: true,
          encumbrance: { value: 57.8, max: 480, mod: 2 }, attunement: { value: 2, max: 3 }, exhaustion: 2, death: { success: 1, failure: 2 },
          init: { total: 5 }, prof: 3, ac: { value: 18 }, movement: { walk: 30, fly: 60, jump: 999, units: "ft" }
        }
      },
      items: new Map()
    };
    for (const [id, type, name] of [["potion", "consumable", "치유 물약"], ["feature", "feat", "교활한 행동"], ["spell", "spell", "방패"], ["twin", "consumable", "치유 물약"], ["bag", "container", "모험가의 가방"]]) {
      actor.items.set(id, {
        id, uuid: `${actor.uuid}.Item.${id}`, name, type, parent: actor, testUserPermission: () => true,
        system: { quantity: 2, identified: true, level: 1, method: "spell", prepared: 1, description: { value: "SECRET" } }
      });
    }
    actor.spellcastingClasses = {};
    for (const [id, name, levels, ability, attack, save] of [["warlock", "워락", 2, "cha", 1, 11], ["wizard", "위저드", 8, "int", 9, 18]]) {
      const item = { id, name, type: "class", uuid: `${actor.uuid}.Item.${id}`, parent: actor, testUserPermission: () => true,
        system: { levels, spellcasting: { progression: "full" } }, spellcasting: { ability, attack, save, progression: "full" } };
      actor.items.set(id, item); actor.spellcastingClasses[id] = item;
    }
    let root = document.querySelector("#sheet");
    const app = Object.assign(new Official(), { actor, rendered: true, element: root });
    instances.set("app1", app);
    let native = 0;
    let hpEdits = 0;
    // A target capture listener models native system item-use/roll handlers.
    const bindNative = node => {
      node.querySelectorAll("a, .title, button, input, proficiency-cycle, .bonus, .score, .mod, .item-image, .subtitle, .tags, select, .passive, .item-description span, [contenteditable], .stats .lozenge, .ac-badge, .progress.hit-points")
        .forEach(element => element.addEventListener("click", () => native++, { capture: true }));
      node.querySelector(".progress.hit-points").addEventListener("click", () => {
        hpEdits++;
        node.querySelector("#hp-input").hidden = false;
      });
    };
    bindNative(root);
    await import("/scripts/main.mjs");
    emit("init"); emit("ready");
    check(registered.get("inputMode") === "middle", "new client input defaults to middle click");
    registered.set("inputMode", "zClick");
    const settle = () => new Promise(resolve => setTimeout(resolve, 0));
    const zKey = held => window.dispatchEvent(new KeyboardEvent(held ? "keydown" : "keyup", { code: "KeyZ", key: "z", bubbles: true }));
    async function click(id, options = {}, node = root) {
      const { zHeld = true, ...modifiers } = options;
      zKey(zHeld);
      const event = new MouseEvent("click", { bubbles: true, cancelable: true, button: 0, shiftKey: false, ...modifiers });
      node.querySelector(`[id='${id}']`).dispatchEvent(event);
      await settle();
      return event;
    }
    const initialData = JSON.stringify([...actor.items.values()].map(i => i.system));
    const initialActorData = JSON.stringify(actor.system);
    for (const [id, kind] of [["casting-ability", "spellAbility"], ["casting-ability-label", "spellAbility"], ["spell-attack", "spellAttack"], ["spell-attack-label", "spellAttack"], ["spell-dc", "spellDC"], ["spell-dc-label", "spellDC"], ["warlock-ability", "spellAbility"], ["warlock-attack", "spellAttack"], ["warlock-dc", "spellDC"]]) {
      const before = messages.length;
      const event = await click(id);
      check(event.defaultPrevented && messages.length === before + 1 && messages.at(-1).flags["sheet-ping"].snapshot.kind === kind, `spellcasting ${id}: exact card ping`);
    }
    check(messages.at(-1).flags["sheet-ping"].snapshot.source === "워락" && messages.at(-1).flags["sheet-ping"].snapshot.value === 11, "multiclass spell DC uses clicked card");
    for (const [id, kind] of [["ability", "ability"], ["skill", "skill"], ["save", "save"], ["item", "item"], ["feature", "feature"], ["spell", "spell"], ["initiative", "initiative"], ["speed", "speed"], ["proficiency-bonus", "proficiency"], ["ac", "ac"], ["inspiration", "inspiration"], ["currency-gp", "currency"], ["currency-all", "currency"], ["inventory-weight", "weight"], ["inventory-strength", "ability"], ["inventory-size", "size"], ["inventory-multiplier", "sizeMultiplier"], ["container-icon", "item"], ["container-capacity", "item"], ["attunement-icon", "attunement"], ["attunement-value", "attunement"], ["exhaustion-pip", "exhaustion"], ["death-success", "deathProgress"], ["death-failure", "deathProgress"], ["death-roll", "deathProgress"], ["hp-current", "hp"]]) {
      const before = messages.length;
      const event = await click(id);
      check(messages.length === before + 1 && event.defaultPrevented && native === 0 && messages.at(-1).flags["sheet-ping"].snapshot.kind === kind, `${kind}: one ping and native action blocked`);
    }
    check(JSON.stringify([...actor.items.values()].map(i => i.system)) === initialData, "item quantity, uses and spell preparation remain unchanged");
    check(JSON.stringify(actor.system) === initialActorData, "weight, attunement, exhaustion and death progress pings never modify Actor data");
    check(messages.every(data => data.content.includes("<strong>아르벨</strong>")), "all sheet messages bold the character name");
    check(actor.system.attributes.inspiration === true && actor.system.currency.gp === 120, "inspiration and money pings do not toggle or edit their source data");
    check(hpEdits === 0 && root.querySelector("#hp-input").hidden, "HP ping does not enter native HP editing");
    check(messages.at(-1).flags["sheet-ping"].snapshot.current === 22 && messages.at(-1).flags["sheet-ping"].snapshot.maximum === 50, "HP ping uses saved current/effective maximum without temporary HP or unsaved input");
    for (const id of ["ability-mod", "ability-score", "skill-bonus", "save-bonus", "item-child", "initiative-label", "speed-label", "proficiency-label", "hp-maximum", "hp-max-bonus", "hp-display"]) {
      const before = messages.length;
      await click(id);
      check(messages.length === before + 1 && native === 0, `${id}: displayed value or child resolves`);
    }
    const beforeHPEdit = messages.length;
    await click("hp-current", { zHeld: false });
    check(messages.length === beforeHPEdit && hpEdits === 1 && !root.querySelector("#hp-input").hidden, "ordinary HP click still opens the native editor");
    for (const change of [{ zHeld: false }, { shiftKey: true }, { altKey: true }, { ctrlKey: true }, { metaKey: true }, { button: 1 }, { button: 2 }]) {
      const before = messages.length, oldNative = native;
      const event = await click("ability", change);
      check(messages.length === before && !event.defaultPrevented && native > oldNative, `ordinary gesture preserved: ${JSON.stringify(change)}`);
    }
    for (const id of ["ability-input", "ability-config", "proficiency", "skill-select", "skill-config", "passive", "quantity", "equip", "prepare", "delete", "menu", "item-image", "subtitle", "tags", "description", "activity", "tab", "editable", "hp-input", "temporary-hp", "hp-config", "initiative-config", "speed-config", "ac-config", "hit-dice", "currency-input", "attunement-input", "death-tab", "spell-primary", "spell-prepared"]) {
      const before = messages.length;
      const event = await click(id);
      check(messages.length === before && !event.defaultPrevented, `control excluded: ${id}`);
    }
    const beforeRebind = messages.length;
    for (let i = 0; i < 5; i++) emit("renderApplicationV2", app, root);
    await click("skill");
    check(messages.length === beforeRebind + 1, "five rerenders still produce one message");
    await click("twin");
    check(messages.at(-1).flags["sheet-ping"].snapshot.itemUuid.endsWith(".Item.twin"), "duplicate item names resolve by ID");
    const beforeDenied = messages.length, nativeBeforeDenied = native;
    actor.allowed = false;
    await click("item");
    check(messages.length === beforeDenied && native === nativeBeforeDenied && notices.at(-1).includes("권한"), "revoked ownership blocks both ping and native use");
    actor.allowed = true;
    const concentrationEvent = await click("concentration");
    check(messages.length === beforeDenied && !concentrationEvent.defaultPrevented, "concentration keeps its native action outside the supported scope");
    actor.system.skills.ste.total = NaN;
    await click("skill");
    check(messages.length === beforeDenied && notices.at(-1).includes("데이터"), "missing prepared value cancels safely");
    actor.system.skills.ste.total = 7;
    cancelCreate = true;
    const oldNative = native;
    await click("item");
    check(messages.length === beforeDenied && native === oldNative && notices.at(-1).includes("생성되지"), "failed ChatMessage creation never falls through to item use");
    cancelCreate = false;
    const stored = structuredClone(messages.at(-1));
    actor.items.get("spell").system.prepared = 0;
    actor.items.get("spell").name = "Renamed";
    check(JSON.stringify(messages.at(-1)) === JSON.stringify(stored), "past chat snapshot remains unchanged");
    registered.set("zEnabled", false);
    const disabledNative = native;
    await click("skill");
    check(messages.length === beforeDenied && native > disabledNative, "client disable restores normal input");
    registered.set("zEnabled", true);
    registered.set("enabled", false);
    await click("skill");
    check(messages.length === beforeDenied, "world disable stops pings");
    registered.set("enabled", true);

    // New root, same app: verify stale listener removal rather than only rebinding in place.
    const previous = root;
    root = previous.cloneNode(true);
    previous.after(root);
    app.element = root;
    bindNative(root);
    emit("renderApplicationV2", app, root);
    await click("ability", {}, previous);
    check(messages.length === beforeDenied, "replaced sheet root loses its old listener");
    await click("ability");
    check(messages.length === beforeDenied + 1, "replacement root handles pings");
    previous.remove();

    // Multiple simultaneous sheets use their own Actor, independent of selected tokens.
    const secondRoot = root.cloneNode(true);
    root.after(secondRoot);
    const secondActor = { ...actor, id: "a2", uuid: "Actor.a2", name: "두 번째 캐릭터" };
    const secondApp = Object.assign(new Official(), { actor: secondActor, element: secondRoot });
    emit("renderApplicationV2", secondApp, secondRoot);
    await click("ability", {}, secondRoot);
    check(messages.at(-1).flags["sheet-ping"].snapshot.actorUuid === "Actor.a2" && messages.at(-1).speaker.actor === "a2", "two sheets retain the clicked Actor");
    emit("closeApplicationV2", secondApp);
    const afterClose = messages.length;
    await click("ability", {}, secondRoot);
    check(messages.length === afterClose, "close hook removes listener");
    secondRoot.remove();
    class ThirdParty extends Official {}
    const otherRoot = root.cloneNode(true); root.after(otherRoot);
    emit("renderApplicationV2", Object.assign(new ThirdParty(), { actor }), otherRoot);
    await click("ability", {}, otherRoot);
    check(messages.length === afterClose, "third-party sheet subclasses are excluded");
    otherRoot.remove();
    actor.allowed = false; actor.observer = true;
    root.querySelector("#inspiration").disabled = true;
    for (const id of ["exhaustion-pip", "death-success", "death-failure", "death-roll"]) root.querySelector(`#${id}`).disabled = true;
    emit("renderApplicationV2", app, root);
    const readOnlyInspiration = root.querySelector(".sheet-ping-inspiration-label");
    check(root.querySelectorAll(".sheet-ping-readonly-status").length === 2, "read-only exhaustion and death progress receive passive ping targets");
    check(readOnlyInspiration && root.querySelector("#inspiration").disabled, "disabled inspiration keeps its native toggle disabled and gets a passive ping target");
    readOnlyInspiration.id = "observer-inspiration";
    let beforeObserver = messages.length;
    await click("observer-inspiration");
    check(messages.length === beforeObserver + 1, "observer sheet pings are enabled by default");
    registered.set("allowObserverPings", false);
    beforeObserver = messages.length;
    await click("observer-inspiration");
    check(messages.length === beforeObserver && notices.at(-1).includes("권한"), "GM observer setting disables observer pings immediately");
    actor.allowed = true; registered.set("allowObserverPings", true);
    let nativeTokenDown = 0;
    map.addEventListener("pointerdown", () => nativeTokenDown++, { capture: true });
    const mapEvent = (type, button = 0) => {
      const event = type.startsWith("pointer")
        ? new PointerEvent(type, { bubbles: true, cancelable: true, button, pointerId: 1, clientX: 30, clientY: 30 })
        : new MouseEvent(type, { bubbles: true, cancelable: true, button, clientX: 30, clientY: 30 });
      map.dispatchEvent(event);
      return event;
    };
    const beforeToken = messages.length;
    zKey(true);
    for (const type of ["pointerdown", "mousedown", "pointerup", "mouseup", "click"]) check(mapEvent(type).defaultPrevented, `canvas ${type} is consumed`);
    await settle();
    check(messages.length === beforeToken + 1 && messages.at(-1).flags["sheet-ping"].snapshot.tokenName === "고블린 A" && nativeTokenDown === 0, "canvas token emits one public name ping before native input");
    check(mapActivities.length === 1 && mapDraws.length === 1 && mapActivities[0].ping.pull === false && mapActivities[0].ping.style === "chevron", "token ping broadcasts one native chevron without a camera pull");
    check(mapDraws[0].user === user && mapDraws[0].point.x === 50 && mapDraws[0].point.y === 50, "native ping uses the sender and the token center");
    check(mapPans.length === 0, "creating a ping does not move the camera");
    mapToken.center = { x: 120, y: 160 };
    document.querySelector("#chat .chat-message:last-child a.sheet-ping-map-link").click();
    await settle();
    check(mapPans.length === 1 && mapPans[0].x === 120 && mapPans[0].y === 160 && !("scale" in mapPans[0]), "chat token link follows the current center without changing zoom");
    zKey(false);
    check(!mapEvent("pointerdown").defaultPrevented && nativeTokenDown === 1, "ordinary canvas pointerdown stays native");
    registered.set("inputMode", "middle");
    const beforeMiddle = messages.length;
    const hpEditsBeforeMiddle = hpEdits;
    for (const type of ["pointerdown", "mousedown", "pointerup", "mouseup", "auxclick"]) {
      const event = type.startsWith("pointer")
        ? new PointerEvent(type, { bubbles: true, cancelable: true, button: 1, pointerId: 1 })
        : new MouseEvent(type, { bubbles: true, cancelable: true, button: 1 });
      root.querySelector("#hp-current").dispatchEvent(event);
      check(event.defaultPrevented, `middle sheet ${type} blocks default browser actions`);
    }
    await settle();
    check(messages.length === beforeMiddle + 1 && hpEdits === hpEditsBeforeMiddle, "middle sheet cycle sends once without HP editing or Z");
    const beforeMiddleToken = messages.length;
    for (const type of ["pointerdown", "mousedown", "pointerup", "mouseup", "auxclick"]) check(mapEvent(type, 1).defaultPrevented, `middle canvas ${type} is consumed`);
    await settle();
    check(messages.length === beforeMiddleToken + 1 && nativeTokenDown === 1, "middle token cycle sends once without native selection or Z");
    canvas.tokens.hover = null;
    const beforePoint = messages.length;
    for (const type of ["pointerdown", "mousedown", "pointerup", "mouseup", "auxclick"]) mapEvent(type, 1);
    await settle();
    check(messages.length === beforePoint + 1 && messages.at(-1).flags["sheet-ping"].snapshot.kind === "point", "empty map point sends one message");
    const pointLink = document.querySelector("#chat .chat-message:last-child a.sheet-ping-map-link");
    check(pointLink.textContent === "한 지점" && !pointLink.querySelector(".sheet-ping-map-icon"), "point link shows its label without a movement symbol");
    pointLink.click(); await settle();
    check(mapPans.length === 2 && mapPans[1].x === 30 && mapPans[1].y === 30, "point link pans to stored coordinates");
    const flagged = document.querySelector(".sheet-ping-message");
    check(getComputedStyle(flagged.querySelector(".sheet-ping-user-dot")).color === "rgb(18, 171, 52)", "player marker matches the user's assigned color");
    const normal = document.querySelector("#ordinary-message");
    check(getComputedStyle(flagged).backgroundColor === "rgb(238, 232, 220)" && getComputedStyle(flagged).borderTopWidth === "0px", "flagged chat has an opaque light background without a border");
    document.body.classList.add("theme-dark");
    check(getComputedStyle(flagged).backgroundColor === "rgb(43, 46, 54)" && getComputedStyle(flagged).color === "rgb(241, 241, 237)", "dark theme has an opaque background and light text");
    document.body.classList.remove("theme-dark");
    check(getComputedStyle(normal).borderTopWidth === "2px" && getComputedStyle(normal).backgroundColor === "rgb(90, 70, 50)", "ordinary chat styling stays unchanged");
    check(getComputedStyle(flagged.querySelector(".message-header")).width === "1px", "header hidden at rest");
    check(flagged.querySelector(".message-delete") && flagged.title === "12:34", "native management control and timestamp retained");
    return { checks: passed.length, passed, messages: messages.length, notices: notices.length };
  });
  assert.equal(pageErrors.length, 0, pageErrors.join("\n"));
  // Actual pointer hover, independent of synthetic event tests.
  const firstPing = page.locator(".sheet-ping-message").first();
  await firstPing.hover();
  assert.equal(await firstPing.locator(".message-header").evaluate(element => getComputedStyle(element).clipPath), "none");
  assert.equal(await firstPing.locator(".message-sender").evaluate(element => getComputedStyle(element).display), "none");
  const lastPing = page.locator(".sheet-ping-message").last();
  await lastPing.locator(".message-content").evaluate(element => { element.textContent = "길게 지목한 캐릭터와 아이템 이름 ".repeat(15); });
  assert.equal(await lastPing.evaluate(element => element.scrollWidth <= element.clientWidth), true);
  console.log(JSON.stringify({ ...result, pointerHover: "passed", narrowChat: "passed", pageErrors }, null, 2));
} finally {
  await browser?.close();
  await new Promise(resolve => server.close(resolve));
}
