const EDITABLE = "input, textarea, select, [contenteditable]:not([contenteditable='false'])";

export function isEditableTarget(target) {
  return !!target?.closest?.(EDITABLE) || target?.isContentEditable === true;
}

// Track the physical Z key, including when the Korean keyboard layout is active.
// Never cancel a keyboard event: existing Foundry shortcuts keep their handlers.
export function createZKeyTracker({ window, document }) {
  let held = false;
  const clear = () => { held = false; };
  const keydown = event => {
    if (event.code !== "KeyZ") return;
    held = !event.isComposing && !isEditableTarget(event.target)
      && !event.shiftKey && !event.altKey && !event.ctrlKey && !event.metaKey;
  };
  const keyup = event => { if (event.code === "KeyZ") clear(); };
  const focusin = event => { if (isEditableTarget(event.target)) clear(); };
  const visibility = () => { if (document.hidden) clear(); };
  const bindings = [
    [window, "keydown", keydown], [window, "keyup", keyup], [window, "blur", clear],
    [document, "focusin", focusin], [document, "visibilitychange", visibility]
  ];
  for (const [target, type, listener] of bindings) target.addEventListener(type, listener, { capture: true });
  return {
    isHeld: () => held, clear,
    destroy() {
      clear();
      for (const [target, type, listener] of bindings) target.removeEventListener(type, listener, { capture: true });
    }
  };
}
