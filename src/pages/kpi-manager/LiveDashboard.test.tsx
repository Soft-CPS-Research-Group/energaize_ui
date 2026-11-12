import { act, render, screen, within } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { server } from "../../test/server";
import { LiveDashboard } from "./LiveDashboard";

class FakeEventSource {
  static last: FakeEventSource | null = null;
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onerror: (() => void) | null = null;
  constructor(public url: string) { FakeEventSource.last = this; }
  close() {}
}

const snapshot = {
  community: "living_lab",
  building: "building_R-H-01",
  timestamp: new Date().toISOString(),
  grid_import_kwh: 0.5, grid_export_kwh: 0, net_grid_kwh: 0.5,
  solar_kwh: 0, non_shiftable_load_kwh: 0.1,
  battery_soc_avg: 0.2, battery_count: 1,
  ev_charging_kw: 0, active_ev_sessions: 0,
  energy_price_eur_kwh: 0.21,
  authenticity_ratio: 0.25, is_physically_valid: true, has_generated_data: true,
};

describe("LiveDashboard", () => {
  beforeEach(() => {
    vi.stubGlobal("EventSource", FakeEventSource);
    server.use(http.get("*/kpi-api/*", () => HttpResponse.json({ status: "success", data: {} })));
  });
  afterEach(() => vi.unstubAllGlobals());

  it("asks for a building when none is selected", () => {
    render(<LiveDashboard community="living_lab" buildings={[]} />);
    expect(screen.getByText("No buildings selected")).toBeInTheDocument();
  });

  it("shows a card per streamed building with its data-quality state", async () => {
    render(<LiveDashboard community="living_lab" buildings={["building_R-H-01"]} />);
    expect(FakeEventSource.last?.url).toContain("/api/v1/live/living_lab/stream");

    act(() => {
      FakeEventSource.last?.onopen?.();
      FakeEventSource.last?.onmessage?.({ data: JSON.stringify([snapshot]) });
    });

    const card = (await screen.findByRole("heading", { name: "building_R-H-01" })).closest("article")!;
    // Low authenticity (25%) marks the reading as degraded, and generated data is flagged
    expect(within(card).getByText(/Degraded/)).toBeInTheDocument();
    expect(within(card).getByText("Generated data")).toBeInTheDocument();
    expect(screen.getByText(/Connected/)).toBeInTheDocument();
  });
});
