import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { beforeEach, describe, expect, it } from "vitest";
import { server } from "../../test/server";
import { KpiChart, seriesLabel } from "./KpiChart";

describe("seriesLabel", () => {
  it("drops the KPI suffix and the building prefix", () => {
    expect(seriesLabel("building_R-H-01_EnergyCostKPI", "EnergyCostKPI")).toBe("R-H-01");
    expect(seriesLabel("community_EnergyCostKPI", "EnergyCostKPI")).toBe("community");
    expect(seriesLabel("building_R-H-01")).toBe("R-H-01");
  });
});

describe("KpiChart", () => {
  beforeEach(() => {
    server.use(
      http.get("*/kpi-api/api/v1/kpis/metadata", () => HttpResponse.json({ status: "success", data: [
        { name: "EnergyCostKPI", display_name: "Energy cost", unit: "€", type: "scheduled", status: "available", registered: true },
      ] })),
      http.get("*/kpi-api/*", () => HttpResponse.json({ status: "success", data: [] })),
    );
  });

  it("toggles a series from its chip and offers the KPI info", async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <KpiChart
          title="Energy cost"
          kpiName="EnergyCostKPI"
          data={[{ timestamp: "2026-10-01 00:00", "building_A_EnergyCostKPI": 1, "building_B_EnergyCostKPI": 2 }]}
          lines={["building_A_EnergyCostKPI", "building_B_EnergyCostKPI"]}
        />
      </QueryClientProvider>
    );
    const chip = screen.getByRole("button", { name: "A" });
    expect(chip).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(chip);
    expect(chip).toHaveAttribute("aria-pressed", "false");
    expect(await screen.findByRole("button", { name: "About Energy cost" })).toBeInTheDocument();
  });
});
