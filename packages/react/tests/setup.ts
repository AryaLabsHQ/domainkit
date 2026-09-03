if (typeof window.PointerEvent !== "function") {
  window.PointerEvent = MouseEvent as typeof PointerEvent;
}

// jsdom ships neither observer, and the positioning layer falls back to polling without them.
class NoopObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
  takeRecords() {
    return [];
  }
}
if (typeof globalThis.ResizeObserver !== "function") {
  globalThis.ResizeObserver = NoopObserver as unknown as typeof ResizeObserver;
}
if (typeof globalThis.IntersectionObserver !== "function") {
  globalThis.IntersectionObserver = NoopObserver as unknown as typeof IntersectionObserver;
}

Object.assign(globalThis, { BASE_UI_ANIMATIONS_DISABLED: true });
