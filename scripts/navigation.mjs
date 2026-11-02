import { MODULE_ID, PingError } from "./constants.mjs";

export function copyPoint(point) {
  if (!Number.isFinite(point?.x) || !Number.isFinite(point?.y)) throw new PingError("MissingData");
  return { x: point.x, y: point.y };
}

export function tokenCenter(token) {
  return copyPoint(token?.center ?? token?.document?.getCenterPoint?.());
}

// No destination data comes from link attributes or a URL. The message snapshot
// identifies the Scene/Token; current permissions and visibility are checked here.
export async function focusPingTarget(snapshot, { game, getCanvas }) {
  let sceneId, tokenUuid, tokenId;
  if (snapshot?.kind === "token") {
    const match = /^Scene\.([^.]+)\.Token\.([^.]+)$/.exec(snapshot.tokenUuid ?? "");
    if (!match) throw new PingError("TargetUnavailable");
    [, sceneId, tokenId] = match;
    tokenUuid = snapshot.tokenUuid;
  } else if (snapshot?.kind === "point") {
    sceneId = snapshot.sceneId;
    copyPoint(snapshot.position);
  } else throw new PingError("TargetUnavailable");

  const scene = game.scenes?.get(sceneId);
  if (!scene) throw new PingError("TargetUnavailable");
  if (!game.user?.isGM && scene.active !== true && scene.testUserPermission?.(game.user, "OBSERVER") !== true) {
    throw new PingError("ScenePermission");
  }
  // Catch deleted/hidden tokens before changing the viewer's Scene. Actor access
  // is not required to locate a visible map token.
  if (tokenId) {
    const document = scene.tokens?.get(tokenId);
    if (!document || (!game.user?.isGM && document.hidden)) throw new PingError("TargetUnavailable");
  }
  if (getCanvas()?.scene?.id !== sceneId) await scene.view();
  const canvas = getCanvas();
  if (!canvas?.ready || canvas.scene?.id !== sceneId || typeof canvas.animatePan !== "function") {
    throw new PingError("CanvasNotReady");
  }
  let position;
  if (tokenId) {
    const token = canvas.tokens?.get(tokenId);
    if (!token || token.isVisible !== true || token.isPreview || token.document?.uuid !== tokenUuid
        || (!game.user?.isGM && token.document.hidden)) throw new PingError("TargetUnavailable");
    position = tokenCenter(token);
  } else position = copyPoint(snapshot.position);
  if (canvas.dimensions?.rect?.contains(position.x, position.y) === false) throw new PingError("TargetUnavailable");
  // Deliberately omit scale: keep the viewer's zoom. Never activate a Scene,
  // control a Token, or broadcast a camera pull to other clients.
  await canvas.animatePan({ ...position, duration: 250 });
}

const bindings = new WeakMap();
export function bindPingNavigation(message, element, { game, getCanvas, notify, report = console.error }) {
  const previous = bindings.get(element);
  if (previous) element.removeEventListener("click", previous, { capture: true });
  let busy = false;
  const listener = event => {
    const link = event.target?.closest?.("a.sheet-ping-map-link");
    if (!link || !element.contains(link) || event.button !== 0) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    if (busy) return;
    busy = true;
    void focusPingTarget(message.getFlag(MODULE_ID, "snapshot"), { game, getCanvas })
      .catch(error => {
        if (!(error instanceof PingError)) report("Sheet Ping | Failed to focus map target", error);
        notify(`SHEETPING.Error.${error instanceof PingError ? error.key : "NavigationFailed"}`);
      }).finally(() => { busy = false; });
  };
  element.addEventListener("click", listener, { capture: true });
  bindings.set(element, listener);
}
