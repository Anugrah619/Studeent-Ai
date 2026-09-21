import { JSDOM } from "jsdom";

/**
 * A DOM for the smoke tests. `ResizeObserver` reports a fixed width so the
 * charts take their real SVG branch rather than the zero-width placeholder —
 * the point of these tests is to execute the drawing code, not to skip it.
 */
export const CHART_WIDTH = 640;

export function installDom(url = "http://localhost/"): JSDOM {
  // `pretendToBeVisual` would start jsdom's own animation-frame loop and keep
  // the Node event loop alive after the suite finishes. rAF is stubbed below.
  const dom = new JSDOM("<!doctype html><html><body><div id='root'></div></body></html>", {
    url,
  });

  const { window } = dom;

  class StubResizeObserver {
    private callback: ResizeObserverCallback;
    constructor(callback: ResizeObserverCallback) {
      this.callback = callback;
    }
    observe(target: Element) {
      this.callback(
        [
          {
            target,
            contentRect: { width: CHART_WIDTH, height: 240 },
          } as unknown as ResizeObserverEntry,
        ],
        this as unknown as ResizeObserver,
      );
    }
    unobserve() {}
    disconnect() {}
  }

  Object.defineProperty(window.Element.prototype, "getBoundingClientRect", {
    configurable: true,
    value: () => ({
      width: CHART_WIDTH,
      height: 240,
      top: 0,
      left: 0,
      right: CHART_WIDTH,
      bottom: 240,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    }),
  });

  // Radix primitives reach for APIs jsdom does not implement.
  for (const [name, value] of [
    ["hasPointerCapture", () => false],
    ["setPointerCapture", () => {}],
    ["releasePointerCapture", () => {}],
    ["scrollIntoView", () => {}],
  ] as const) {
    Object.defineProperty(window.Element.prototype, name, {
      configurable: true,
      writable: true,
      value,
    });
  }

  // Copy every constructor and helper jsdom defines (HTMLFormElement, DOMRect,
  // MutationObserver, …) rather than naming them one at a time — Radix reaches
  // for a long tail of them and a missing one surfaces as a render crash.
  for (const key of Object.getOwnPropertyNames(window)) {
    if (key in globalThis) continue;
    const descriptor = Object.getOwnPropertyDescriptor(window, key);
    if (!descriptor) continue;
    Object.defineProperty(globalThis, key, { ...descriptor, configurable: true });
  }

  const globals: Record<string, unknown> = {
    window,
    document: window.document,
    navigator: window.navigator,
    location: window.location,
    history: window.history,
    localStorage: window.localStorage,
    HTMLElement: window.HTMLElement,
    Element: window.Element,
    Node: window.Node,
    Event: window.Event,
    CustomEvent: window.CustomEvent,
    getComputedStyle: window.getComputedStyle.bind(window),
    requestAnimationFrame: (cb: FrameRequestCallback) =>
      setTimeout(() => cb(Date.now()), 0) as unknown as number,
    cancelAnimationFrame: (handle: number) => clearTimeout(handle),
    ResizeObserver: StubResizeObserver,
    matchMedia: (query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    }),
  };

  for (const [key, value] of Object.entries(globals)) {
    Object.defineProperty(globalThis, key, {
      configurable: true,
      writable: true,
      value,
    });
  }

  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
    true;

  return dom;
}

/** Poll the DOM until `predicate` holds, or give up. */
export async function waitFor(
  predicate: () => boolean,
  { timeout = 5000, interval = 25 }: { timeout?: number; interval?: number } = {},
): Promise<void> {
  const deadline = Date.now() + timeout;
  for (;;) {
    if (predicate()) return;
    if (Date.now() > deadline) {
      throw new Error("waitFor timed out");
    }
    await new Promise((resolve) => setTimeout(resolve, interval));
  }
}

export function text(): string {
  return document.body.textContent ?? "";
}
