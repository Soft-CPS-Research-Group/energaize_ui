import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { describe, expect, it } from "vitest";
import { server } from "../../test/server";
import { JobRuns } from "./JobRuns";

const RUN = {
  run_id: "r1", job_id: "daily_bau_demflex", status: "success",
  started_at: "2026-11-25T04:00:00+00:00", finished_at: "2026-11-25T04:12:00+00:00",
  period_start: "2026-11-24T00:00:00+00:00", period_end: "2026-11-25T00:00:00+00:00",
  communities: { demflex: { buildings: 7, buildings_with_data: 4, windows: 168,
                            community: { EnergyCostKPI: { value: 1.74, unit: "€" } } } },
  bau: { demflex: {
    id: "req-1", state: "completed", outcome: "stored",
    houses: [
      { house: "RH27", site_id: "a", included: 96, expected: 96, reasons: [] },
      { house: "RH02", site_id: "b", included: 0, expected: 96, reasons: ["Missing or ambiguous main grid import channel"] },
    ],
    report: { comparison: { community: { EnergyCostKPI: { real: 1.74, bau: 1.92, unit: "€" } } } },
  } },
};

function renderPanel(jobId: string) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}><JobRuns jobId={jobId} /></QueryClientProvider>);
}

describe("JobRuns", () => {
  it("shows what the selected run did, with the real vs BAU comparison", async () => {
    server.use(
      http.get("*/kpi-api/api/v1/scheduler/jobs/:id/runs", () => HttpResponse.json({ status: "success", data: [RUN] })),
      http.get("*/kpi-api/*", () => HttpResponse.json({ status: "success", data: [] })),
    );
    renderPanel("daily_bau_demflex");

    const panel = await screen.findByRole("region", { name: "Runs of daily_bau_demflex" });
    expect(await within(panel).findByText(/4 of 7 buildings with data · 168 KPI windows stored/)).toBeInTheDocument();
    expect(within(panel).getByText("BAU stored")).toBeInTheDocument();
    expect(within(panel).getByText(/of 2 houses the BAU simulated/)).toBeInTheDocument();
    expect(within(panel).getByText(/1 house left out, and why/)).toBeInTheDocument();
    expect(within(panel).getByText(/1 × Missing or ambiguous main grid import channel/)).toBeInTheDocument();
    // The cost was lower than in the BAU: an improvement
    expect(within(panel).getByTitle("improvement")).toHaveTextContent("-0.180");
  });

  it("says when nothing has been recorded yet", async () => {
    server.use(http.get("*/kpi-api/api/v1/scheduler/jobs/:id/runs", () => HttpResponse.json({ status: "success", data: [] })));
    renderPanel("hourly_kpis");
    expect(await screen.findByText(/No runs recorded yet/)).toBeInTheDocument();
  });
});


describe("JobRunsPanel with unexpected data", () => {
  it("shows runs recorded in another shape instead of breaking the page", async () => {
    const odd = { ...RUN, communities: { demflex: { windows: "many", community: null } },
                  bau: { demflex: { outcome: "stored", error: { code: 500 }, houses: [{ house: "RH27", reasons: null }],
                                    report: { comparison: { community: { EnergyCostKPI: { real: "1.7", bau: null } } } } } } };
    server.use(
      http.get("*/kpi-api/api/v1/scheduler/jobs/:id/runs", () => HttpResponse.json({ status: "success", data: [odd] })),
      http.get("*/kpi-api/*", () => HttpResponse.json({ status: "success", data: [] })),
    );
    renderPanel("daily_bau_demflex");
    const panel = await screen.findByRole("region", { name: "Runs of daily_bau_demflex" });
    expect(await within(panel).findByText("BAU stored")).toBeInTheDocument();
    expect(within(panel).getByText('{"code":500}')).toBeInTheDocument();
  });

  it("explains an answer that is not a list of runs", async () => {
    server.use(http.get("*/kpi-api/api/v1/scheduler/jobs/:id/runs", () => HttpResponse.json({ detail: "Not Found" })));
    renderPanel("daily_bau_demflex");
    expect(await screen.findByText(/did not return the runs/)).toBeInTheDocument();
  });

  it("shows a BAU request that came without its house list (houses: null)", async () => {
    // As the KPI module returns a request stored before houses were recorded: the page went blank on this
    const stored = { ...RUN, bau: { demflex: { id: "req-1", state: "completed", outcome: "stored", error: null,
                                              houses: null, report: null, from_ts: null, until_ts: null } } };
    server.use(
      http.get("*/kpi-api/api/v1/scheduler/jobs/:id/runs", () => HttpResponse.json({ status: "success", data: [stored] })),
      http.get("*/kpi-api/*", () => HttpResponse.json({ status: "success", data: [] })),
    );
    renderPanel("daily_bau_demflex");
    const panel = await screen.findByRole("region", { name: "Runs of daily_bau_demflex" });
    expect(await within(panel).findByText("BAU stored")).toBeInTheDocument();
    expect(within(panel).queryByText(/could not be shown/)).not.toBeInTheDocument();
  });

  it("shows only the job's KPIs in the comparison, also for runs that carry every BAU KPI", async () => {
    const all = { ...RUN, bau: { demflex: { ...RUN.bau.demflex, report: { comparison: {
      community: { EnergyCostKPI: { real: 1.74, bau: 1.92, unit: "€" }, RampingKPI: { real: 1, bau: 2, unit: "kW" } },
      building_demflex_rh27: { RampingKPI: { real: 1, bau: 2, unit: "kW" } },
    } } } } };
    server.use(
      http.get("*/kpi-api/api/v1/scheduler/jobs/:id/runs", () => HttpResponse.json({ status: "success", data: [all] })),
      http.get("*/kpi-api/*", () => HttpResponse.json({ status: "success", data: [] })),
    );
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(<QueryClientProvider client={client}><JobRuns jobId="daily_bau_demflex" kpis={["EnergyCostKPI"]} /></QueryClientProvider>);
    const panel = await screen.findByRole("region", { name: "Runs of daily_bau_demflex" });
    expect(await within(panel).findByText("Real vs BAU")).toBeInTheDocument();
    expect(within(panel).queryByText(/Ramping/)).not.toBeInTheDocument();
    // The house has only a KPI that is not the job's: it says so instead of showing it
    fireEvent.change(within(panel).getByRole("combobox"), { target: { value: "building_demflex_rh27" } });
    expect(within(panel).getByText(/No BAU comparison of this job's KPIs for this house/)).toBeInTheDocument();
  });

  it("shows any house of the run, its real values and its comparison with the BAU", async () => {
    const run = { ...RUN, communities: { demflex: { ...RUN.communities.demflex,
      by_building: { "building_demflex-rh27": { EnergyCostKPI: { value: 0.42, unit: "€" } } } } },
      bau: { demflex: { ...RUN.bau.demflex, report: { comparison: {
        community: { EnergyCostKPI: { real: 1.74, bau: 1.92, unit: "€" } },
        "building_demflex-rh27": { EnergyCostKPI: { real: 0.4, bau: 0.5, unit: "€" } },
      } } } } };
    server.use(
      http.get("*/kpi-api/api/v1/scheduler/jobs/:id/runs", () => HttpResponse.json({ status: "success", data: [run] })),
      http.get("*/kpi-api/*", () => HttpResponse.json({ status: "success", data: [] })),
    );
    renderPanel("daily_bau_demflex");
    const panel = await screen.findByRole("region", { name: "Runs of daily_bau_demflex" });
    fireEvent.change(await within(panel).findByRole("combobox", { name: "Scope of demflex" }),
                     { target: { value: "building_demflex-rh27" } });
    expect(within(panel).getByText("KPI (demflex-rh27)")).toBeInTheDocument();
    expect(within(panel).getByText(/0[.,]42 €/)).toBeInTheDocument();
    expect(within(panel).getByTitle("improvement")).toHaveTextContent("-0.100");
  });
});
