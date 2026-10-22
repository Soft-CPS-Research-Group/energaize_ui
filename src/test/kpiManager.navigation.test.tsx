import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, within } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "../App";
import { AuthProvider } from "../contexts/AuthContext";
import { UIProvider } from "../contexts/UIContext";
import { seedMockSession } from "./handlers";
import { server } from "./server";

function renderApp(initialRoute: string) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <UIProvider>
          <MemoryRouter initialEntries={[initialRoute]}>
            <App />
          </MemoryRouter>
        </UIProvider>
      </AuthProvider>
    </QueryClientProvider>
  );
}

describe("KPI Manager navigation", () => {
  beforeEach(() => {
    seedMockSession({ email: "kpi@energaize.io", name: "KPI Manager", role: "kpi_manager", remember: true });
    // The pages' own data calls are not under test here: answer them with empty results
    server.use(http.get("*/kpi-api/*", () => HttpResponse.json({ status: "success", data: [] })));
    // jsdom has no EventSource or Worker; the alert stream and the chart worker only need to exist
    vi.stubGlobal("EventSource", class { onmessage = null; onerror = null; close() {} });
    vi.stubGlobal("Worker", class {
      onmessage = null;
      postMessage() {}
      terminate() {}
      addEventListener() {}
      removeEventListener() {}
    });
  });

  afterEach(() => vi.unstubAllGlobals());

  it("lists the five visible sections and keeps Scenarios hidden", async () => {
    renderApp("/app/kpi-manager");

    const nav = await screen.findByRole("navigation", { name: "Primary navigation" });
    const labels = within(nav).getAllByRole("link").map((link) => link.textContent);
    expect(labels).toEqual(["Overview", "Analysis", "Data quality", "Automation", "Catalogue"]);
    expect(await screen.findByRole("heading", { level: 1, name: "Overview" })).toBeInTheDocument();
    expect(document.body).toHaveAttribute("data-workspace", "ai");
  });

  it("redirects the old page paths to their new sections", async () => {
    renderApp("/app/kpi-manager/thresholds");

    expect(await screen.findByRole("heading", { level: 1, name: "Alerts" })).toBeInTheDocument();
    const nav = screen.getByRole("navigation", { name: "Primary navigation" });
    expect(within(nav).getByRole("link", { name: "Automation" })).toHaveClass("is-active");
  });

  it("shows the section sub-tabs with the current page active", async () => {
    renderApp("/app/kpi-manager/analysis");

    expect(await screen.findByRole("heading", { level: 1, name: "Compare periods" })).toBeInTheDocument();
    const subnav = screen.getByRole("navigation", { name: "Analysis pages" });
    expect(within(subnav).getAllByRole("link").map((link) => link.textContent))
      .toEqual(["Compare periods", "Correlations", "Reports"]);
    expect(within(subnav).getByRole("link", { name: "Compare periods" })).toHaveClass("is-active");
  });
});
