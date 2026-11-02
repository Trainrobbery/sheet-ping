import { PingError } from "./constants.mjs";

const PHYSICAL = new Set(["weapon", "equipment", "consumable", "tool", "loot", "container"]);
const FEATURES = new Set(["feat", "class", "subclass", "race", "background"]);

function requiredName(value) {
  if (typeof value !== "string" || !value.trim()) throw new PingError("MissingData");
  return value.trim();
}

function finite(value) {
  if (typeof value !== "number" || !Number.isFinite(value)) throw new PingError("MissingData");
  return value;
}

function count(value) {
  finite(value);
  if (!Number.isInteger(value) || value < 0) throw new PingError("MissingData");
  return value;
}

function configLabel(config, localize) {
  const label = requiredName(typeof config === "string" ? config : config?.label);
  return requiredName(localize(label));
}

export function canPingActor(actor, user, { allowObservers = false } = {}) {
  if (!actor || !["character", "npc"].includes(actor.type) || !user) return false;
  // Compendium documents and limited sheets are outside the public ping workflow.
  if (actor.pack || actor.limited) return false;
  return user.isGM === true || actor.testUserPermission?.(user, "OWNER") === true
    || (allowObservers === true && actor.testUserPermission?.(user, "OBSERVER") === true);
}

export function spellStatus(system, config, localize) {
  if (system.level === 0) return localize("SHEETPING.Status.Cantrip");
  const method = config.spellcasting?.[system.method];
  if (!method) return "";
  if (method.prepares === true) {
    const state = Object.entries(config.spellPreparationStates ?? {})
      .find(([, entry]) => entry.value === system.prepared)?.[0];
    const key = { unprepared: "Unprepared", prepared: "Prepared", always: "Always" }[state];
    return key ? localize(`SHEETPING.Status.${key}`) : "";
  }
  const key = { atwill: "AtWill", innate: "Innate", ritual: "Ritual" }[system.method];
  return key ? localize(`SHEETPING.Status.${key}`) : configLabel(method, localize);
}

export function publicItemName(item, localize) {
  // Even GM pings use the unidentified name. Never read _source.name as a fallback.
  if (item.system?.identified === false) {
    return item.system.unidentified?.name?.trim() || localize("SHEETPING.UnidentifiedItem");
  }
  return requiredName(item.name);
}

function speedSnapshot(movement, config, localize, selectedType) {
  if (!movement) throw new PingError("MissingData");
  let best;
  for (const [type, definition] of Object.entries(config.movementTypes ?? {})) {
    if (selectedType !== undefined && type !== selectedType) continue;
    if (definition.hidden || movement[type] === undefined) continue;
    const value = finite(movement[type]);
    if (value < 0) throw new PingError("MissingData");
    if (!best || value > best.value) best = { type, value, definition };
  }
  if (!best) throw new PingError("MissingData");
  const unitKey = requiredName(movement.units);
  const abbreviation = config.movementUnits?.[unitKey]?.abbreviation ?? unitKey;
  let label = configLabel(best.definition, localize);
  if (best.type === "fly" && movement.hover === true) label += ` (${localize("SHEETPING.Hover")})`;
  return {
    movementType: best.type, label, value: best.value,
    unit: requiredName(localize(requiredName(abbreviation)))
  };
}

function spellcastingSnapshot(actor, target, user, config, localize) {
  if (actor.type === "npc") {
    // NPCActorSheet displays a single card, based on its first spellcasting
    // class or the NPC's ability. Its attack bonus is evaluated during render.
    // Snapshot the read-only display instead of evaluating any Roll on a ping.
    const caster = Object.values(actor.spellcastingClasses ?? {})[0];
    const ability = caster?.spellcasting?.ability ?? actor.system.attributes?.spellcasting ?? "";
    if (ability !== target.key || (caster?.id ?? undefined) !== target.classId) throw new PingError("MissingData");
    const data = { key: ability, source: "", valueSource: "sheetDisplay" };
    if (caster) {
      if (caster.parent?.uuid !== actor.uuid || actor.items?.get(caster.id) !== caster) throw new PingError("MissingData");
      if (caster.testUserPermission?.(user, "OBSERVER") !== true) throw new PingError("Permission");
      data.classUuid = requiredName(caster.uuid);
      data.source = publicItemName(caster, localize);
    }
    const value = finite(target.displayedValue);
    if (target.kind === "spellAbility") {
      data.label = ability ? configLabel(config.abilities?.[ability], localize) : localize("SHEETPING.NoSpellAbility");
      data.modifier = value;
    } else if (target.kind === "spellAttack") data.modifier = value;
    else data.value = value;
    return data;
  }
  const item = actor.items?.get(target.classId);
  if (!item || item.type !== "class" || item.parent?.uuid !== actor.uuid
      || !Object.values(actor.spellcastingClasses ?? {}).some(entry => entry.id === item.id)) throw new PingError("MissingData");
  if (item.testUserPermission?.(user, "OBSERVER") !== true) throw new PingError("Permission");
  const casting = item.spellcasting;
  if (!casting || casting.progression === "none" || casting.ability !== target.key) throw new PingError("MissingData");
  // Mirror CharacterActorSheet._prepareSpellsContext, including subclass naming
  // and prepared per-class attack/save values. Never recalculate from proficiency.
  const source = item.system.spellcasting?.progression === casting.progression ? item : item.subclass;
  if (!source || source.parent?.uuid !== actor.uuid) throw new PingError("MissingData");
  if (source.testUserPermission?.(user, "OBSERVER") !== true) throw new PingError("Permission");
  const data = { classUuid: requiredName(item.uuid), key: requiredName(casting.ability), source: publicItemName(source, localize) };
  if (target.kind === "spellAbility") {
    data.label = configLabel(config.abilities?.[casting.ability], localize);
    data.modifier = finite(actor.system.abilities?.[casting.ability]?.mod);
  } else if (target.kind === "spellAttack") data.modifier = finite(casting.attack);
  else data.value = finite(casting.save);
  return data;
}

export function buildSnapshot({ actor, target, user, config, localize, allowObservers = false, metricWeight = false, now = Date.now() }) {
  if (!canPingActor(actor, user, { allowObservers })) throw new PingError("Permission");
  const snapshot = {
    schemaVersion: 1, kind: target.kind, actorUuid: requiredName(actor.uuid),
    actorName: requiredName(actor.name), userId: requiredName(user.id),
    userName: requiredName(user.name), createdAt: now
  };

  if (target.kind === "item") {
    const item = actor.items?.get(target.itemId);
    if (!item || item.parent?.uuid !== actor.uuid) throw new PingError("MissingData");
    if (item.testUserPermission?.(user, "OBSERVER") !== true) throw new PingError("Permission");
    snapshot.itemUuid = requiredName(item.uuid);
    snapshot.label = publicItemName(item, localize);
    if (item.type === "spell") {
      snapshot.kind = "spell";
      snapshot.status = spellStatus(item.system, config, localize);
    } else if (FEATURES.has(item.type)) snapshot.kind = "feature";
    else if (actor.type === "npc" && item.type === "weapon") snapshot.kind = "attack";
    else if (PHYSICAL.has(item.type)) snapshot.kind = "item";
    else throw new PingError("Unsupported");
    return snapshot;
  }

  const attributes = actor.system.attributes;
  switch (target.kind) {
    case "spellAbility":
    case "spellAttack":
    case "spellDC":
      return Object.assign(snapshot, spellcastingSnapshot(actor, target, user, config, localize));
    case "weight": {
      snapshot.current = finite(attributes?.encumbrance?.value);
      snapshot.maximum = finite(attributes?.encumbrance?.max);
      const units = config.encumbrance?.baseUnits?.[actor.type] ?? config.encumbrance?.baseUnits?.default;
      const unitKey = requiredName(units?.[metricWeight ? "metric" : "imperial"]);
      snapshot.unit = requiredName(localize(requiredName(config.weightUnits?.[unitKey]?.abbreviation)));
      return snapshot;
    }
    case "size":
      snapshot.label = configLabel(config.actorSizes?.[actor.system.traits?.size], localize);
      return snapshot;
    case "sizeMultiplier":
      snapshot.value = finite(attributes?.encumbrance?.mod);
      return snapshot;
    case "attunement":
      snapshot.current = count(attributes?.attunement?.value);
      snapshot.maximum = count(attributes?.attunement?.max);
      return snapshot;
    case "exhaustion":
      snapshot.value = count(attributes?.exhaustion);
      return snapshot;
    case "deathProgress":
      snapshot.success = count(attributes?.death?.success);
      snapshot.failure = count(attributes?.death?.failure);
      snapshot.maximum = 3; // CharacterActorSheet 5.3.3 renders three pips for each track.
      if (snapshot.success > 3 || snapshot.failure > 3) throw new PingError("MissingData");
      return snapshot;
    case "inspiration":
      if (typeof attributes?.inspiration !== "boolean") throw new PingError("MissingData");
      snapshot.available = attributes.inspiration;
      snapshot.status = localize(`SHEETPING.Inspiration.${snapshot.available ? "Available" : "Unavailable"}`);
      return snapshot;
    case "currency": {
      const codes = target.key === undefined ? Object.keys(config.currencies ?? {}) : [target.key];
      if (!codes.length) throw new PingError("MissingData");
      snapshot.amounts = codes.map(code => {
        const definition = config.currencies?.[code];
        if (!definition) throw new PingError("MissingData");
        const amount = finite(actor.system.currency?.[code]);
        if (amount < 0) throw new PingError("MissingData");
        return { code, amount, label: configLabel(definition, localize) };
      });
      return snapshot;
    }
    case "hp":
      snapshot.current = finite(attributes?.hp?.value);
      snapshot.maximum = finite(attributes?.hp?.effectiveMax);
      return snapshot;
    case "initiative":
      snapshot.modifier = finite(attributes?.init?.total);
      return snapshot;
    case "initiativeScore":
      snapshot.value = finite(attributes?.init?.score);
      return snapshot;
    case "proficiency":
      snapshot.modifier = finite(attributes?.prof);
      return snapshot;
    case "ac":
      snapshot.value = finite(attributes?.ac?.value);
      return snapshot;
    case "speed":
      return Object.assign(snapshot, speedSnapshot(attributes?.movement, config, localize, target.key));
  }

  snapshot.key = requiredName(target.key);
  if (target.kind === "skill") {
    const skill = actor.system.skills?.[target.key];
    snapshot.label = configLabel(config.skills?.[target.key], localize);
    snapshot.modifier = finite(skill?.total);
  } else if (target.kind === "ability" || target.kind === "save") {
    const ability = actor.system.abilities?.[target.key];
    snapshot.label = configLabel(config.abilities?.[target.key], localize);
    if (target.kind === "ability") {
      snapshot.score = finite(ability?.value);
      snapshot.modifier = finite(ability?.mod);
    } else snapshot.modifier = finite(ability?.save?.value);
  } else throw new PingError("Unsupported");
  return snapshot;
}
