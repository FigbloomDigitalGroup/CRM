import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

// Unmounts whatever the previous test rendered so component tests don't
// leak DOM nodes/event listeners into the next one (the integration suite
// doesn't need this -- it never touches a DOM at all).
afterEach(() => {
  cleanup();
});
