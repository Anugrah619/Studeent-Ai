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

  /**
   * Everything is "in view" at once. Motion's `whileInView` and
   * `onViewportEnter` (the kit's Reveal, the charts) construct an
   * IntersectionObserver unguarded, so without one a screen that uses them
   * fails to render at all; with this, they settle to their final state.
   *
   * The `useInView` hook never fires here, and that is expected: it hands the
   * element to motion's `resolveElements`, which tests `instanceof
   * EventTarget` against Node's own EventTarget, and a jsdom element is not
   * one. AnimatedNumber does not depend on it in this run — NumberFlow is not
   * registered, so the plain figure is printed — and in a browser it has a
   * timed fallback of its own.
   */
  class StubIntersectionObserver {
    readonly root = null;
    readonly rootMargin = "0px";
    readonly thresholds = [0];
    private callback: IntersectionObserverCallback;
    constructor(callback: IntersectionObserverCallback) {
      this.callback = callback;
    }
    observe(target: Element) {
      queueMicrotask(() =>
        this.callback(
          [
            {
              target,
              isIntersecting: true,
              intersectionRatio: 1,
              boundingClientRect: target.getBoundingClientRect(),
              intersectionRect: target.getBoundingClientRect(),
              rootBounds: null,
              time: Date.now(),
            } as IntersectionObserverEntry,
          ],
          this as unknown as IntersectionObserver,
        ),
      );
    }
    unobserve() {}
    disconnect() {}
    takeRecords() {
      return [];
    }
  }

  /**
   * React Flow reads the viewport's zoom with `new DOMMatrixReadOnly(transform)`
   * on every measure; jsdom has no DOMMatrix. Only `m22` (the y scale) is read.
   */
  class StubDOMMatrixReadOnly {
    readonly m22: number;
    constructor(transform?: string) {
      const scale = transform?.match(/scale\(([\d.]+)\)/)?.[1];
      this.m22 = scale !== undefined ? Number(scale) : 1;
    }
  }

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

  // React Flow sizes an edge label with getBBox, which jsdom's SVG lacks.
  if (!("getBBox" in window.SVGElement.prototype)) {
    Object.defineProperty(window.SVGElement.prototype, "getBBox", {
      configurable: true,
      writable: true,
      value: () => ({ x: 0, y: 0, width: 40, height: 12 }),
    });
  }

  // AppShell scrolls to the top on a forward navigation. jsdom's scrollTo only
  // logs "not implemented", which buries a real error in the output.
  window.scrollTo = (() => {}) as typeof window.scrollTo;

  // Set on the jsdom window too, not only on globalThis: React Flow reads
  // `window.DOMMatrixReadOnly`, motion reads the bare global.
  Object.assign(window, {
    IntersectionObserver: StubIntersectionObserver,
    DOMMatrixReadOnly: StubDOMMatrixReadOnly,
  });

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
    IntersectionObserver: StubIntersectionObserver,
    DOMMatrixReadOnly: StubDOMMatrixReadOnly,
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
