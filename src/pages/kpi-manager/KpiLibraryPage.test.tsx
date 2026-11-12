import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it } from "vitest";
import { server } from "../../test/server";
import { KpiLibraryPage } from "./KpiLibraryPage";

const kpis = [
  { name: "EnergyCostKPI", display_name: "Energy cost", category: "economic", type: "scheduled", status: "available",
    registered: true, description: "Cost of energy bought from the grid", formula: "Σ import · price", window: "1h", unit: "€" },
  { name: "SelfConsumptionKPI", display_name: "Self consumption", category: "energy", type: "streaming", status: "available",
    registered: true, scope: "community_only", description: "Share of local generation used on site", window: "", unit: "%" },
  { name: "ComfortKPI", display_name: "Comfort", category: "ev", type: "scheduled", status: "pending",
    registered: false, pending_reason: "Needs EV targets", window: "1d", unit: "" },
];

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={["/app/kpi-manager/catalogue/library"]}>
        <KpiLibraryPage />
      </MemoryRouter>
    </QueryClientProvider>
  );
}

describe("KpiLibraryPage", () => {
  beforeEach(() => {
    server.use(
      http.get("*/kpi-api/api/v1/kpis/metadata", () => HttpResponse.json({ status: "success", data: kpis })),
      http.get("*/kpi-api/*", () => HttpResponse.json({ status: "success", data: [] })),
    );
  });

  it("lists every KPI with its formula and pending note", async () => {
    renderPage();
    expect(await screen.findByRole("heading", { name: "Energy cost" })).toBeInTheDocument();
    expect(screen.getByText("3 KPIs")).toBeInTheDocument();
    expect(screen.getByText("Σ import · price")).toBeInTheDocument();
    expect(screen.getByText("Community only")).toBeInTheDocument();
    expect(screen.getByText(/Needs EV targets/)).toBeInTheDocument();
  });

  it("filters by search text and status", async () => {
    renderPage();
    await screen.findByRole("heading", { name: "Energy cost" });
    fireEvent.change(screen.getByLabelText("Search"), { target: { value: "local generation" } });
    expect(screen.getByText("1 KPI")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Self consumption" })).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Search"), { target: { value: "" } });
    fireEvent.change(screen.getByLabelText("Status"), { target: { value: "pending" } });
    expect(screen.getByText("1 KPI")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Comfort" })).toBeInTheDocument();
  });

  it("shows an empty state when nothing matches", async () => {
    renderPage();
    await screen.findByRole("heading", { name: "Energy cost" });
    fireEvent.change(screen.getByLabelText("Search"), { target: { value: "nothing like this" } });
    expect(screen.getByText("No KPIs found")).toBeInTheDocument();
  });
});
