import { MODULE_ID, PingError } from "./constants.mjs";
import { buildSnapshot } from "./dnd5e.mjs";
import { formatMessage, normalizeUserColor } from "./formatter.mjs";
import { observersAllowed } from "./settings.mjs";
import { bindPingNavigation } from "./navigation.mjs";

export async function sendPing(actor, target, { game, config, ChatMessage }) {
  if (!ChatMessage.canUserCreate(game.user)) throw new PingError("ChatPermission");
  const snapshot = buildSnapshot({
    actor, target, user: game.user, config,
    allowObservers: observersAllowed(game),
    metricWeight: target.kind === "weight" && game.settings.get("dnd5e", "metricWeightUnits") === true,
    localize: key => game.i18n.localize(key)
  });
  // All reads and formatting happen before the first await: this is a snapshot.
  return createPingMessage(snapshot, ChatMessage.getSpeaker({ actor, token: actor.token ?? null, alias: snapshot.actorName }), { game, ChatMessage });
}

export async function createPingMessage(snapshot, speaker, { game, ChatMessage }) {
  if (!ChatMessage.canUserCreate(game.user)) throw new PingError("ChatPermission");
  snapshot = { ...snapshot, userColor: normalizeUserColor(game.user.color) };
  const content = formatMessage(snapshot, (key, values) => game.i18n.format(key, values));
  const message = await ChatMessage.create({
    user: game.user.id, content, speaker,
    whisper: [], blind: false, rolls: [],
    flags: { [MODULE_ID]: { ping: true, snapshot } }
  }, { chatBubble: false });
  if (!message) throw new PingError("CreateFailed");
  return message;
}

export function stylePingMessage(message, element, navigation) {
  if (message.getFlag(MODULE_ID, "ping") !== true) return;
  element.classList.add("sheet-ping-message");
  // Older messages contain the removed map-link symbol. Clean their rendered
  // content too, without rewriting stored chat messages.
  for (const icon of element.querySelectorAll?.("a.sheet-ping-map-link > .sheet-ping-map-icon") ?? []) {
    const previous = icon.previousSibling;
    if (previous?.nodeType === 3) previous.textContent = previous.textContent.replace(/ $/, "");
    icon.remove();
  }
  const timestamp = element.querySelector(".message-timestamp")?.textContent?.trim();
  if (timestamp) element.title = timestamp;
  if (navigation) bindPingNavigation(message, element, navigation);
  // Keep the native header in the DOM for context-menu management and metadata.
  // It becomes visible on hover/focus via CSS.
}
