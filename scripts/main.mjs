import { isTargetEnvironment, MODULE_ID } from "./constants.mjs";
import { registerSettings } from "./settings.mjs";
import { createInputController } from "./input.mjs";
import { sendPing, stylePingMessage } from "./chat.mjs";
import { createZKeyTracker } from "./keyboard.mjs";
import { createMapInputController, sendTokenPing, sendPointPing } from "./token.mjs";

let input;
let keyboard;
let tokenInput;

Hooks.once("init", () => registerSettings(game));
Hooks.once("ready", () => {
  if (!isTargetEnvironment(game)) {
    ui.notifications.warn(game.i18n.localize("SHEETPING.Error.Environment"));
    return;
  }
  keyboard = createZKeyTracker({ window, document });
  const notify = key => ui.notifications.warn(game.i18n.localize(key));
  input = createInputController({
    game, systemAPI: game.dnd5e, config: CONFIG.DND5E,
    isZHeld: keyboard.isHeld,
    send: (actor, target) => sendPing(actor, target, {
      game, config: CONFIG.DND5E, ChatMessage: CONFIG.ChatMessage.documentClass
    }),
    notify
  });
  tokenInput = createMapInputController({
    game, window, getCanvas: () => globalThis.canvas, isZHeld: keyboard.isHeld,
    send: (token, context) => {
      const dependencies = { game, ChatMessage: CONFIG.ChatMessage.documentClass, canvas: context.canvas,
        notifyEffectFailure: () => notify("SHEETPING.Error.MapPingFailed") };
      return token ? sendTokenPing(token, dependencies) : sendPointPing(context.position, dependencies);
    }, notify
  });
  // Sheets normally open after ready; include any already-rendered V2 instances.
  const instances = foundry.applications.instances;
  for (const app of instances?.values?.() ?? []) {
    if (app.rendered && app.element) input.bind(app, app.element);
  }
  console.info(`${MODULE_ID} | 0.4.0-alpha.2 ready`);
});

Hooks.on("renderApplicationV2", (app, element) => input?.bind(app, element));
Hooks.on("closeApplicationV2", app => input?.unbind(app));
Hooks.on("renderChatMessageHTML", (message, element) => stylePingMessage(message, element, {
  game, getCanvas: () => globalThis.canvas,
  notify: key => ui.notifications.warn(game.i18n.localize(key))
}));
Hooks.on("canvasTearDown", () => { tokenInput?.cancel(); keyboard?.clear(); });
