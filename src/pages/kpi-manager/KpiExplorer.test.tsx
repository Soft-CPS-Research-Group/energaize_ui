import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { beforeEach, describe, expect, it } from "vitest";
import { server } from "../../test/server";
import { KpiExplorer } from "./KpiExplorer";

const kpis = [
  { name: "EnergyCostKPI", display_name: "Energy cost", category: "economic", type: "scheduled", status: "available",
    registered: true, level: "both", formula: "Σ import · price", window: "1h", unit: "€" },
  { name: "SelfSufficiencyKPI", display_name: "Self sufficiency", category: "energy", type: "scheduled", status: "available",
    registered: true, level: "community", window: "1h", unit: "%" },
  { name: "ComfortKPI", display_name: "Comfort", category: "ev", type: "scheduled", status: "pending",
    registered: false, level: "building", pending_reason: "Needs EV targets", window: "1d", unit: "" },
];

function OverviewProbe() {
  const { state } = useLocation();
  return <p>Overview for {(state as { preselectedKpi?: string })?.preselectedKpi}</p>;
}

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={["/app/kpi-manager/catalogue/explorer"]}>
        <Routes>
          <Route path="/app/kpi-manager/catalogue/explorer" element={<KpiExplorer />} />
          <Route path="/app/kpi-manager/overview" element={<OverviewProbe />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  );
}

describe("KpiExplorer", () => {
  beforeEach(() => {
    server.use(
      http.get("*/kpi-api/api/v1/communities", () => HttpResponse.json({ status: "success", data: { living_lab: ["building_R-H-01"] } })),
      http.get("*/kpi-api/api/v1/kpis/metadata", () => HttpResponse.json({ status: "success", data: kpis })),
      http.get("*/kpi-api/*", () => HttpResponse.json({ status: "success", data: [] })),
    );
  });

  it("shows community-level families for a community", async () => {
    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: "Living lab" }));
    expect(screen.getByRole("button", { name: "Living lab" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("heading", { name: "Energy cost" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Self sufficiency" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Comfort" })).not.toBeInTheDocument();
  });

  it("shows building-level KPIs after expanding a community", async () => {
    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: "Expand Living lab" }));
    fireEvent.click(screen.getByRole("button", { name: "R-H-01" }));
    expect(screen.getByRole("heading", { name: "Comfort" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Self sufficiency" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Open Comfort in Overview" })).toBeDisabled();
  });

  it("collapses a family and opens a KPI in Overview", async () => {
    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: "Living lab" }));
    fireEvent.click(screen.getByRole("button", { name: /Energy grid/ }));
    expect(screen.queryByRole("heading", { name: "Self sufficiency" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Open Energy cost in Overview" }));
    expect(await screen.findByText("Overview for EnergyCostKPI")).toBeInTheDocument();
  });
});
