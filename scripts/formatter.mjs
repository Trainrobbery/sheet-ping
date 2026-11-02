export function escapeHTML(value) {
  return String(value ?? "").replace(/[&<>"']/g, char => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  })[char]);
}

export function formatModifier(number) {
  return `${number >= 0 ? "+" : ""}${number}`;
}

export function normalizeUserColor(color) {
  // Foundry v13 uses Color objects; accept their public CSS representation.
  const value = typeof color === "string" ? color : color?.css;
  const css = typeof value === "string" ? value.trim() : "";
  if (/^#[0-9a-f]{6}$/i.test(css)) return css.toLowerCase();
  if (/^#[0-9a-f]{3}$/i.test(css)) return "#" + [...css.slice(1)].map(c => c + c).join("").toLowerCase();
  return "currentColor";
}

export function formatMessage(snapshot, format) {
  const marker = `<span class="sheet-ping-user-dot" style="color: ${normalizeUserColor(snapshot.userColor)}" aria-hidden="true">●</span>`;
  const link = text => `<a class="sheet-ping-map-link" href="#" title="${escapeHTML(format("SHEETPING.Link.Focus", {}))}">${text}</a>`;
  const values = {
    player: `${marker} ${escapeHTML(snapshot.userName)}`, actor: `<strong>${escapeHTML(snapshot.actorName)}</strong>`,
    label: escapeHTML(snapshot.label), score: escapeHTML(snapshot.score),
    source: snapshot.source ? `${escapeHTML(snapshot.source)} ` : "",
    value: escapeHTML(snapshot.value), unit: escapeHTML(snapshot.unit),
    current: escapeHTML(snapshot.current), maximum: escapeHTML(snapshot.maximum),
    success: escapeHTML(snapshot.success), failure: escapeHTML(snapshot.failure),
    token: snapshot.kind === "token" ? link(escapeHTML(snapshot.tokenName)) : escapeHTML(snapshot.tokenName),
    point: snapshot.kind === "point" ? link(escapeHTML(format("SHEETPING.Target.MapPoint", {}))) : "",
    money: (snapshot.amounts ?? []).map(entry => `${escapeHTML(entry.amount)} ${escapeHTML(entry.label)}`).join(" / "),
    modifier: escapeHTML(formatModifier(snapshot.modifier)),
    status: snapshot.status ? ` (${escapeHTML(snapshot.status)})` : "",
    state: escapeHTML(snapshot.status)
  };
  const sentence = format(`SHEETPING.Message.${snapshot.kind}`, values);
  // Block Foundry enrichers in names as well as HTML. &#64; still displays as @.
  // Otherwise a label such as @UUID[...] or [[1d20]] could become a live control.
  return `<p class="sheet-ping-text">${sentence.replace(/@/g, "&#64;")
    .replace(/\[/g, "&#91;").replace(/\]/g, "&#93;")}</p>`;
}
