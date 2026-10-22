import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it } from "vitest";
import { server } from "../../test/server";
import { DataProfilingPage } from "./DataProfilingPage";

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={["/app/kpi-manager/data-quality"]}>
        <DataProfilingPage />
      </MemoryRouter>
    </QueryClientProvider>
  );
}

describe("DataProfilingPage", () => {
  beforeEach(() => {
    server.use(
      http.get("*/kpi-api/api/v1/communities", () =>
        HttpResponse.json({ status: "success", data: { living_lab: ["building_R-H-01"] } })),
      http.get("*/kpi-api/api/v1/data/profile/*", () => HttpResponse.json({
        status: "success", community: "living_lab", period: { start: "", end: "" },
        data: {
          "building_R-H-01": {
            actual_payloads: 5760, coverage_ratio: 1, confidence_score: 0.25,
            generated_fields: 30, total_fields: 40, authenticity_ratio: 0.25,
            physically_invalid_count: 0, validity_ratio: 1,
            gap_count: 1, gaps: [{ from: "2026-10-21T10:00:00Z", to: "2026-10-21T11:00:00Z", duration_seconds: 3600 }],
            outlier_counts: { grid_energy_in: 3 },
          },
        },
      })),
      http.get("*/kpi-api/*", () => HttpResponse.json({ status: "success", data: [] })),
    );
  });

  it("profiles the selected building and flags its low confidence", async () => {
    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: "Select buildings…" }));
    fireEvent.click(await screen.findByRole("checkbox", { name: "building_R-H-01" }));
    fireEvent.click(screen.getByRole("button", { name: "Run profile" }));

    const card = (await screen.findByRole("heading", { name: /Building R-H-01/ })).closest("article")!;
    expect(within(card).getByText(/Low · 25.0%/)).toBeInTheDocument();
    expect(within(card).getByRole("meter", { name: "Authenticity (real vs generated)" })).toHaveAttribute("aria-valuenow", "0.25");
    expect(within(card).getByText("1 data gap detected")).toBeInTheDocument();
  });
});
