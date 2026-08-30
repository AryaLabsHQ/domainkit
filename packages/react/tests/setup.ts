if (typeof window.PointerEvent !== "function") {
  window.PointerEvent = MouseEvent as typeof PointerEvent;
}

Object.assign(globalThis, { BASE_UI_ANIMATIONS_DISABLED: true });
