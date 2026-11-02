import { resolveNPCTarget } from "./npc-targets.mjs";

// Selectors are limited to official release-5.3.3 Character/NPCActorSheet.
// Do not add a broad [data-item-id] or .rollable fallback: those include controls.
const EXCLUDED = [
  "input", "select", "textarea", "button", "label", "proficiency-cycle",
  "[contenteditable]:not([contenteditable='false'])", ".item-controls", ".item-control",
  ".config-button", ".item-description", ".activity-row", "[data-activity-id]",
  "[data-context-menu]", ".window-header", "nav", "[role='tab']"
].join(",");

export function prepareSpellcastingTargets(root, actor) {
  const cards = Array.from(root.querySelectorAll?.("[data-tab='spells'] > .top > .spellcasting.card") ?? []);
  for (const card of cards) delete card.dataset.sheetPingClassId;
  // The pinned template has no class ID. Reproduce the official sheet's stable
  // level sort, validate the whole card sequence, then retain each Item's ID.
  const classes = Object.values(actor.spellcastingClasses ?? {}).sort((a, b) => b.system.levels - a.system.levels);
  if (cards.length !== classes.length || classes.some((item, i) => !item.id
      || item.parent?.uuid !== actor.uuid || !item.spellcasting?.ability
      || cards[i].dataset.ability !== item.spellcasting.ability)) return;
  cards.forEach((card, i) => { card.dataset.sheetPingClassId = classes[i].id; });
}

export function prepareReadOnlyInspiration(root, actor, localize) {
  root.querySelectorAll?.(".sheet-ping-readonly-status").forEach(element => element.remove());
  for (const [selector, kind, labelKey] of [
    [".sidebar .stats .pips[data-prop='system.attributes.exhaustion']", "exhaustion", "SHEETPING.Target.Exhaustion"],
    [".sidebar .death-saves, .sheet-header .death-saves", "deathProgress", "SHEETPING.Target.DeathProgress"]
  ]) {
    const area = root.querySelector?.(selector);
    if (!area?.querySelector("button:disabled")) continue;
    const label = root.ownerDocument.createElement("span");
    label.className = "sheet-ping-readonly-status";
    label.dataset.sheetPingKind = kind;
    label.textContent = localize(labelKey);
    label.title = localize("SHEETPING.Inspiration.PingHint");
    area.insertAdjacentElement("afterend", label);
  }
  root.querySelectorAll?.(".sheet-ping-inspiration-label").forEach(element => element.remove());
  const button = root.querySelector?.(".sheet-header button.inspiration[data-action='toggleInspiration']");
  if (!button?.matches(":disabled")) return;
  // Browsers suppress click events on disabled buttons. Add a passive target;
  // never enable the native toggle or change the document's edit permissions.
  const label = root.ownerDocument.createElement("span");
  label.className = "sheet-ping-inspiration-label";
  label.textContent = `${localize("SHEETPING.Inspiration.Label")} ${localize(`SHEETPING.Inspiration.${actor.system.attributes.inspiration ? "Available" : "Unavailable"}`)}`;
  label.title = localize("SHEETPING.Inspiration.PingHint");
  button.insertAdjacentElement("afterend", label);
}

export function resolveTarget(target, root, actor) {
  const element = target?.nodeType === 1 ? target : target?.parentElement;
  if (!element?.closest || !root.contains(element)) return null;

  // Explicit exceptions: ping these controls without toggling inspiration or opening money management.
  // Currency inputs remain editable; the coin icons/labels are the ping targets.
  if (!element.closest("input, select, textarea, [contenteditable]:not([contenteditable='false'])")) {
    const passive = element.closest(".sidebar .sheet-ping-readonly-status[data-sheet-ping-kind], .sheet-header .sheet-ping-readonly-status[data-sheet-ping-kind]");
    if (passive && ["exhaustion", "deathProgress"].includes(passive.dataset.sheetPingKind)) {
      return { kind: passive.dataset.sheetPingKind };
    }
    if (element.closest(".sidebar .stats .pips[data-prop='system.attributes.exhaustion']")) {
      return { kind: "exhaustion" };
    }
    if (actor?.type === "npc" && element.closest(".sheet-header .death-saves button.death-save[data-action='roll'][data-type='deathSave'], .sheet-header .death-saves .results .success, .sheet-header .death-saves .results .failure")) {
      return { kind: "deathProgress" };
    }
    if (element.closest(".sidebar .death-saves .pips[data-prop='system.attributes.death.success'], .sidebar .death-saves .pips[data-prop='system.attributes.death.failure'], .sidebar .death-saves button.death-save[data-action='roll'][data-type='deathSave']")) {
      return { kind: "deathProgress" };
    }
    if (element.closest(".sheet-header button.inspiration[data-action='toggleInspiration'], .sheet-header .sheet-ping-inspiration-label")) {
      return { kind: "inspiration" };
    }
    const currency = element.closest("dnd5e-inventory section.currency");
    if (currency && root.contains(currency)) {
      const label = element.closest("label");
      const name = label?.querySelector("input[name^='system.currency.']")?.name;
      if (name && /^system\.currency\.[a-zA-Z0-9_-]+$/.test(name)) {
        return { kind: "currency", key: name.slice("system.currency.".length) };
      }
      if (element === currency || element.closest("button[data-action='currency']")) {
        return { kind: "currency" };
      }
    }
  }
  if (element.closest(EXCLUDED)) return null;
  if (actor?.type === "npc") {
    const npc = resolveNPCTarget(element, root);
    if (npc) return npc;
  }

  const spellcasting = actor?.type !== "npc" && element.closest("[data-tab='spells'] > .top > .spellcasting.card[data-sheet-ping-class-id]");
  if (spellcasting && root.contains(spellcasting) && element.closest(".info > .ability > .label, .info > .ability > .value, .info > .attack > .label, .info > .attack > .value, .info > .save > .label, .info > .save > .value")) {
    const field = element.closest(".info > .ability, .info > .attack, .info > .save");
    const kind = field?.classList.contains("ability") ? "spellAbility"
      : field?.classList.contains("attack") ? "spellAttack" : "spellDC";
    return { kind, classId: spellcasting.dataset.sheetPingClassId, key: spellcasting.dataset.ability };
  }

  const inventory = element.closest("[data-tab='inventory']");
  if (inventory && root.contains(inventory)) {
    const container = element.closest(".containers li.container[data-item-id] a[data-action='showDocument']");
    if (container) return { kind: "item", itemId: container.closest("[data-item-id]").dataset.itemId };
    if (element.closest(".attunement")) return { kind: "attunement" };
    if (element.closest(".encumbrance .info .strength")) return { kind: "ability", key: "str" };
    if (element.closest(".encumbrance .info .size")) return { kind: "size" };
    if (element.closest(".encumbrance .info .multiplier")) return { kind: "sizeMultiplier" };
    if (element.closest(".encumbrance > .meter[role='meter']")) {
      return { kind: "weight" };
    }
  }

  const stats = element.closest(".sidebar .stats");
  if (stats && root.contains(stats)) {
    // The editable input and configuration buttons have already been excluded.
    // Capture the HP display before the system's click-to-edit meter listener.
    if (element.closest(".meter.hit-points > .progress.hit-points[role='meter']")) {
      return { kind: "hp" };
    }
    if (element.closest(".ac-badge [data-attribution='attributes.ac']")) return { kind: "ac" };

    const lozenge = element.closest(".lozenges > .lozenge");
    if (lozenge && stats.contains(lozenge) && element.closest(".value, .label")) {
      if (lozenge.dataset.type === "initiative") return { kind: "initiative" };
      if (lozenge.dataset.attribution === "attributes.movement") return { kind: "speed" };
      // The third unmarked lozenge is proficiency in the pinned official template.
      const row = lozenge.parentElement;
      if (row.children.length === 3 && row.children[2] === lozenge
          && row.children[0].dataset.type === "initiative"
          && row.children[1].dataset.attribution === "attributes.movement"
          && !lozenge.hasAttribute("data-action") && !lozenge.hasAttribute("data-attribution")) {
        return { kind: "proficiency" };
      }
    }
  }

  const skill = element.closest(".skills li[data-key]");
  if (skill && root.contains(skill) && element.closest(".skill-name, .bonus")) {
    return { kind: "skill", key: skill.dataset.key };
  }

  const save = element.closest(".saves li[data-ability]");
  if (save && save.dataset.ability !== "concentration"
      && root.contains(save) && element.closest(".saving-throw, .bonus")) {
    return { kind: "save", key: save.dataset.ability };
  }

  const ability = element.closest(".ability-scores .ability-score[data-ability]");
  if (ability && root.contains(ability) && element.closest(".ability-check, .score, .mod")) {
    return { kind: "ability", key: ability.dataset.ability };
  }

  // Only the title text is a target; images, tags, activities and other columns are excluded.
  const title = element.closest(".item-name > .name > .title");
  const row = title?.closest("dnd5e-inventory li.item[data-item-id]");
  if (row && root.contains(row)) return { kind: "item", itemId: row.dataset.itemId };
  return null;
}
