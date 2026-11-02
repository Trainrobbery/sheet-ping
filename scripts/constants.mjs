export const MODULE_ID = "sheet-ping";
export const TARGET = Object.freeze({ foundry: "13.351", system: "5.3.3" });

export function isTargetEnvironment(game) {
  return game?.version === TARGET.foundry && game?.system?.id === "dnd5e"
    && game.system.version === TARGET.system;
}

export class PingError extends Error {
  constructor(key) {
    super(key);
    this.name = "PingError";
    this.key = key;
  }
}
