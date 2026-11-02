import { isTargetEnvironment, PingError } from "./constants.mjs";
import { isEnabled, getInputMode } from "./settings.mjs";
import { isPingGesture } from "./input.mjs";
import { createPingMessage } from "./chat.mjs";
import { copyPoint, tokenCenter } from "./navigation.mjs";

export function canPingToken(token, user) {
  return !!user && token?.isVisible === true && !token.isPreview && !!token.document?.parent
    && (!token.document.hidden || user.isGM === true);
}

export function buildTokenSnapshot(token, user, now = Date.now()) {
  if (!canPingToken(token, user)) throw new PingError("Permission");
  const { name, uuid } = token.document;
  if (typeof name !== "string" || !name.trim() || typeof uuid !== "string" || !uuid
      || typeof user.name !== "string" || !user.name.trim() || !user.id) throw new PingError("MissingData");
  // Token pings never inspect the Actor: names can differ and the Actor may be private.
  return {
    schemaVersion: 1, kind: "token", tokenUuid: uuid, tokenName: name,
    userId: user.id, userName: user.name, createdAt: now
  };
}

export async function emitTokenPing(canvas, user, position, sceneId) {
  if (!canvas?.ready || canvas.scene?.id !== sceneId || !Number.isFinite(position?.x)
      || !Number.isFinite(position?.y) || typeof user?.broadcastActivity !== "function"
      || typeof canvas.controls?.handlePing !== "function") throw new PingError("MapPingFailed");
  const point = { x: position.x, y: position.y };
  // Native Shift-long-click uses the chevron visual. Broadcast pull:false explicitly
  // instead of letting Canvas.ping infer a camera pull from held modifier keys.
  const data = { style: "chevron", pull: false, scene: sceneId, zoom: canvas.stage?.scale?.x ?? 1 };
  user.broadcastActivity({ cursor: point, ping: data });
  const rendered = await canvas.controls.handlePing(user, point, data);
  if (rendered === false) throw new PingError("MapPingFailed");
  return rendered;
}

export async function sendTokenPing(token, { game, ChatMessage, canvas,
  notifyEffectFailure = error => console.warn("Sheet Ping | Canvas ping failed", error) }) {
  const snapshot = buildTokenSnapshot(token, game.user);
  const sceneId = token.document.parent.id;
  // Resolve the rendered center before awaiting chat creation. The click may
  // have landed on an edge of a large token, or the token may later move.
  const center = canvas ? tokenCenter(token) : null;
  const message = await createPingMessage(snapshot, { alias: game.user.name }, { game, ChatMessage });
  if (center) {
    try { await emitTokenPing(canvas, game.user, center, sceneId); }
    catch (error) { notifyEffectFailure(error); }
  }
  return message;
}

export function buildPointSnapshot(canvas, position, user, now = Date.now()) {
  if (!canvas?.ready || typeof canvas.scene?.id !== "string" || !canvas.scene.id
      || !user?.id || typeof user.name !== "string" || !user.name.trim()) throw new PingError("MissingData");
  const point = copyPoint(position);
  if (canvas.dimensions?.rect?.contains(point.x, point.y) === false) throw new PingError("MissingData");
  return { schemaVersion: 1, kind: "point", sceneId: canvas.scene.id, position: point,
    userId: user.id, userName: user.name, createdAt: now };
}

export async function sendPointPing(position, { game, ChatMessage, canvas,
  notifyEffectFailure = error => console.warn("Sheet Ping | Canvas ping failed", error) }) {
  const snapshot = buildPointSnapshot(canvas, position, game.user);
  const message = await createPingMessage(snapshot, { alias: game.user.name }, { game, ChatMessage });
  try { await emitTokenPing(canvas, game.user, snapshot.position, snapshot.sceneId); }
  catch (error) { notifyEffectFailure(error); }
  return message;
}

export function resolveCanvasPoint(event, canvas) {
  if (!canvas?.ready || !canvas.scene?.id || event.target !== canvas.app?.view || canvas.tokens?.active !== true) return null;
  const point = canvas.canvasCoordinatesFromClient({ x: event.clientX, y: event.clientY });
  if (!Number.isFinite(point?.x) || !Number.isFinite(point?.y)
      || canvas.dimensions?.rect?.contains(point.x, point.y) === false) return null;
  return { x: point.x, y: point.y };
}

export function resolveCanvasToken(event, canvas, user) {
  const point = resolveCanvasPoint(event, canvas);
  if (!point) return null;
  const token = canvas.tokens.hover;
  if (!canPingToken(token, user) || token.document.parent.id !== canvas.scene?.id) return null;
  if (token.bounds?.contains(point.x, point.y) !== true) return null;
  return token;
}

// Capture above PIXI's DOM listeners. No Token methods, controls or targeting are patched.
export function createMapInputController({ game, getCanvas, window, isZHeld, send, notify, report = console.error }) {
  let pending = null;
  let suppressedButton = null;
  const cancel = () => { pending = null; suppressedButton = null; };
  const stop = event => { event.preventDefault(); event.stopImmediatePropagation(); };
  const enabled = () => isTargetEnvironment(game) && isEnabled(game);
  const sendSafely = (token, event, canvas) => {
    void (async () => {
      try {
        const position = token ? tokenCenter(token) : resolveCanvasPoint(event, canvas);
        if (!position) throw new PingError("MissingData");
        await send(token, { canvas, position });
      }
      catch (error) {
        if (!(error instanceof PingError)) report("Sheet Ping | Failed to ping map target", error);
        notify(`SHEETPING.Error.${error instanceof PingError ? error.key : "Unexpected"}`);
      }
    })();
  };
  const pointerdown = event => {
    if (event.button !== 0 && event.button !== 1) return;
    cancel();
    const mode = getInputMode(game);
    if (!enabled() || !isPingGesture(event, isZHeld(), mode)) return;
    const canvas = getCanvas();
    if (!resolveCanvasPoint(event, canvas)) return;
    const token = resolveCanvasToken(event, canvas, game.user);
    stop(event);
    suppressedButton = event.button;
    pending = { token, canvas, sceneId: canvas.scene.id, mode, button: event.button,
      id: event.pointerId, x: event.clientX, y: event.clientY, moved: false };
  };
  const pointermove = event => {
    if (!pending || event.pointerId !== pending.id) return;
    if (Math.hypot(event.clientX - pending.x, event.clientY - pending.y) > 6) pending.moved = true;
    stop(event);
  };
  const pointerup = event => {
    if (!pending || event.pointerId !== pending.id || event.button !== pending.button) return;
    const start = pending;
    pending = null;
    stop(event);
    if (enabled() && getInputMode(game) === start.mode && isPingGesture(event, isZHeld(), start.mode) && !start.moved
        && Math.hypot(event.clientX - start.x, event.clientY - start.y) <= 6
        && getCanvas() === start.canvas
        && start.canvas.scene?.id === start.sceneId && resolveCanvasPoint(event, start.canvas)
        && resolveCanvasToken(event, start.canvas, game.user) === start.token) sendSafely(start.token, event, start.canvas);
  };
  const mouse = event => {
    if ((event.button !== 0 && event.button !== 1) || event.target !== getCanvas()?.app?.view) return;
    if (event.button === suppressedButton) {
      stop(event);
      if (event.type === "click" || event.type === "auxclick") suppressedButton = null;
      return;
    }
    const mode = getInputMode(game);
    if (!enabled() || !isPingGesture(event, isZHeld(), mode)) return;
    const canvas = getCanvas();
    if (!resolveCanvasPoint(event, canvas)) return;
    const token = resolveCanvasToken(event, canvas, game.user);
    stop(event);
    if (event.type === (mode === "middle" ? "auxclick" : "click")) sendSafely(token, event, canvas);
  };
  const pointercancel = event => {
    if (pending && event.pointerId === pending.id) { stop(event); cancel(); }
  };
  const bindings = [
    ["pointerdown", pointerdown], ["pointermove", pointermove], ["pointerup", pointerup],
    ["pointercancel", pointercancel], ["mousedown", mouse], ["mouseup", mouse],
    ["click", mouse], ["auxclick", mouse], ["dblclick", mouse], ["blur", cancel]
  ];
  for (const [type, listener] of bindings) window.addEventListener(type, listener, { capture: true, passive: false });
  return {
    cancel,
    destroy() {
      cancel();
      for (const [type, listener] of bindings) window.removeEventListener(type, listener, { capture: true });
    }
  };
}
