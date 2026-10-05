import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach, vi } from "vitest";

// Unmounts whatever the previous test rendered so component tests don't
// leak DOM nodes/event listeners into the next one (the integration suite
// doesn't need this -- it never touches a DOM at all).
afterEach(() => {
  cleanup();
});

// This file is in the global setupFiles list (vitest.config.ts), so it runs
// for every test file regardless of environment -- the DOM-only stubs below
// must no-op under the "node" environment the integration suite uses, where
// `Element`/`ResizeObserver` don't exist at all, rather than throwing.
if (typeof Element !== "undefined") {
  // recharts' <ResponsiveContainer> (FIG-603) observes its own size via
  // ResizeObserver, which jsdom doesn't implement -- without a stub it
  // throws "ResizeObserver is not defined" the moment a chart mounts.
  class ResizeObserverStub {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  vi.stubGlobal("ResizeObserver", ResizeObserverStub);

  // jsdom never actually lays out elements, so getBoundingClientRect()
  // always returns all-zero -- ResponsiveContainer reads that as "0x0" and
  // skips rendering its children (bars/slices) entirely, not just the pixel
  // sizing. A fixed non-zero stub is the standard workaround for testing
  // recharts (or any ResizeObserver-driven layout) under jsdom.
  Element.prototype.getBoundingClientRect = () => ({
    width: 500,
    height: 300,
    top: 0,
    left: 0,
    right: 500,
    bottom: 300,
    x: 0,
    y: 0,
    toJSON() {},
  });
}
