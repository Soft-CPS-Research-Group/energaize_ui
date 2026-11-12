import "@testing-library/jest-dom/vitest";
import { afterAll, afterEach, beforeAll, vi } from "vitest";
import { resetMockState } from "./handlers";
import { server } from "./server";

beforeAll(() => {
  // jsdom has no layout/scroll implementation.
  HTMLElement.prototype.scrollIntoView = vi.fn();
  server.listen({ onUnhandledRequest: "error" });
});

afterEach(() => {
  server.resetHandlers();
  resetMockState();
  localStorage.clear();
  sessionStorage.clear();
});

afterAll(() => server.close());

