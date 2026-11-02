import { isTargetEnvironment, PingError } from "./constants.mjs";
import { isEnabled, getInputMode } from "./settings.mjs";
import { resolveTarget, prepareReadOnlyInspiration, prepareSpellcastingTargets } from "./targets.mjs";
import { prepareNPCTargets } from "./npc-targets.mjs";

export function isPingGesture(event, zHeld = false, mode = "middle") {
  return (mode === "middle" ? event.button === 1 : event.button === 0 && zHeld === true)
    && !event.shiftKey && !event.altKey && !event.ctrlKey && !event.metaKey;
}

const SHEET_EVENTS = ["pointerdown", "mousedown", "pointerup", "mouseup", "auxclick", "click", "dblclick"];

export function isSupportedSheet(app, game, systemAPI) {
  const Official = systemAPI?.applications?.actor?.[{ character: "CharacterActorSheet", npc: "NPCActorSheet" }[app?.actor?.type]];
  return isTargetEnvironment(game) && typeof Official === "function"
    && app?.constructor === Official;
}

export function createInputController({ game, systemAPI, config, send, notify, isZHeld = () => false, report = console.error, resolve = resolveTarget }) {
  const bindings = new WeakMap();
  const handled = new WeakSet();

  function unbind(app) {
    const old = bindings.get(app);
    if (!old) return;
    for (const type of SHEET_EVENTS) old.root.removeEventListener(type, old.listener, { capture: true });
    bindings.delete(app);
  }

  function bind(app, root) {
    unbind(app);
    if (!isSupportedSheet(app, game, systemAPI) || !root?.addEventListener) return false;
    prepareReadOnlyInspiration(root, app.actor, key => game.i18n.localize(key));
    if (app.actor.type === "npc") prepareNPCTargets(root, app.actor, config);
    else prepareSpellcastingTargets(root, app.actor);
    const listener = event => {
      const mode = getInputMode(game);
      if (!isEnabled(game) || !isPingGesture(event, isZHeld(), mode)) return;
      // Z mode retains the original click handling; middle mode additionally
      // blocks down events to prevent browser autoscroll / clipboard paste.
      if (mode === "zClick" && event.type !== "click" && event.type !== "dblclick") return;
      const target = resolve(event.target, root, app.actor);
      if (!target) return;
      // Synchronous capture-phase cancellation must precede permission/data checks.
      // A failed ping must never fall through to rolling or consuming an item.
      event.preventDefault();
      event.stopImmediatePropagation();
      const sendEvent = mode === "middle" ? "auxclick" : "click";
      if (handled.has(event) || event.type !== sendEvent) return;
      handled.add(event);
      void (async () => {
        try { await send(app.actor, target); }
        catch (error) {
          if (!(error instanceof PingError)) report("Sheet Ping | Failed to create ping", error);
          notify(`SHEETPING.Error.${error instanceof PingError ? error.key : "Unexpected"}`);
        }
      })();
    };
    for (const type of SHEET_EVENTS) root.addEventListener(type, listener, { capture: true, passive: false });
    bindings.set(app, { root, listener });
    return true;
  }

  return { bind, unbind };
}
