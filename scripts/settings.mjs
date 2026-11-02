import { MODULE_ID } from "./constants.mjs";

export function registerSettings(game) {
  for (const [key, scope] of [["enabled", "world"], ["zEnabled", "client"], ["allowObserverPings", "world"]]) {
    game.settings.register(MODULE_ID, key, {
      name: `SHEETPING.Settings.${key}.Name`,
      hint: `SHEETPING.Settings.${key}.Hint`,
      scope, config: true, type: Boolean, default: true
    });
  }
  game.settings.register(MODULE_ID, "inputMode", {
    name: "SHEETPING.Settings.inputMode.Name",
    hint: "SHEETPING.Settings.inputMode.Hint",
    scope: "client", config: true, type: String, default: "middle",
    choices: {
      middle: "SHEETPING.Settings.inputMode.Middle",
      zClick: "SHEETPING.Settings.inputMode.ZClick"
    }
  });
}

export function getInputMode(game) {
  return game.settings.get(MODULE_ID, "inputMode") === "zClick" ? "zClick" : "middle";
}

export function isEnabled(game) {
  return game.settings.get(MODULE_ID, "enabled") === true
    && game.settings.get(MODULE_ID, "zEnabled") === true;
}

export function observersAllowed(game) {
  return game.settings.get(MODULE_ID, "allowObserverPings") === true;
}
