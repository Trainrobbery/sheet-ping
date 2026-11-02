// The official 5.3.3 NPC sheet has a single spellcasting card and movement pills.
export function prepareNPCTargets(root, actor, config = {}) {
  const cards = Array.from(root.querySelectorAll?.("[data-tab='spells'] > .top > .spellcasting.card") ?? []);
  for (const card of cards) {
    delete card.dataset.sheetPingNpcCasting;
    delete card.dataset.sheetPingClassId;
  }
  const caster = Object.values(actor.spellcastingClasses ?? {})[0];
  const ability = caster?.spellcasting?.ability ?? actor.system.attributes?.spellcasting ?? "";
  if (cards.length === 1 && cards[0].dataset.ability === ability) {
    cards[0].dataset.sheetPingNpcCasting = "true";
    if (caster?.id) cards[0].dataset.sheetPingClassId = caster.id;
  }
  const group = root.querySelector?.(".sidebar .pills-group > h3.icon > i.fa-shoe-prints")?.closest(".pills-group");
  const pills = Array.from(group?.querySelectorAll("ul.pills > li.pill") ?? []);
  for (const pill of pills) delete pill.dataset.sheetPingMovementType;
  // NPCActorSheet emits numeric movement modes first in CONFIG order, followed
  // by free text special movement. Do not label the free text as a numeric speed.
  const modes = Object.entries(config.movementTypes ?? {}).filter(([key, definition]) => !definition.hidden && actor.system.attributes?.movement?.[key]);
  if (pills.length >= modes.length && modes.every((_, i) => pills[i].querySelector(".value"))) {
    modes.forEach(([key], i) => { pills[i].dataset.sheetPingMovementType = key; });
  }
}

export function readNPCSpellValue(field) {
  const value = field?.querySelector(".value");
  if (!value || value.querySelector("input, select, textarea, [contenteditable]")) return undefined;
  const text = value.textContent.trim().replace(/\u2212/g, "-");
  if (!/^[+-]?\d+(?:\.\d+)?$/.test(text)) return undefined;
  const number = Number(text);
  return Number.isFinite(number) ? number : undefined;
}

export function resolveNPCTarget(element, root) {
  const card = element.closest("[data-tab='spells'] > .top > .spellcasting.card[data-sheet-ping-npc-casting='true']");
  const field = card && element.closest(".info > .ability, .info > .attack, .info > .save");
  if (field && card.contains(field) && element.closest(".label, .value")) {
    const kind = field.classList.contains("ability") ? "spellAbility" : field.classList.contains("attack") ? "spellAttack" : "spellDC";
    return { kind, key: card.dataset.ability, classId: card.dataset.sheetPingClassId, displayedValue: readNPCSpellValue(field) };
  }
  const header = element.closest(".sheet-header");
  if (header && root.contains(header)) {
    if (element.closest(".meter.hit-points > .progress.hit-points[role='meter']")) return { kind: "hp" };
    if (element.closest(".ac-badge [data-attribution='attributes.ac']")) return { kind: "ac" };
    if (element.closest(".initiative > span")) return { kind: "initiative" };
    if (element.closest(".initiative-score")) return { kind: "initiativeScore" };
    if (element.closest(".proficiency > span, .proficiency > strong")) return { kind: "proficiency" };
    if (element.closest(".creature-size > span")) return { kind: "size" };
    const save = element.closest(".ability-scores .ability-score[data-ability] .save-tab.saving-throw");
    if (save) return { kind: "save", key: save.closest("[data-ability]").dataset.ability };
  }
  const skill = element.closest(".sidebar .pill > a[data-action='roll'][data-type='skill'][data-key]");
  if (skill) return { kind: "skill", key: skill.dataset.key };
  const speed = element.closest(".sidebar .pill[data-sheet-ping-movement-type]");
  if (speed) return { kind: "speed", key: speed.dataset.sheetPingMovementType };
  const gear = element.closest(".sidebar .pill > a[data-action='showDocument'][data-item-id]");
  if (gear) return { kind: "item", itemId: gear.dataset.itemId };
  return null;
}
