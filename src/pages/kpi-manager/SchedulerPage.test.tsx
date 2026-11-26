import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it } from "vitest";
import { server } from "../../test/server";
import { SchedulerPage } from "./SchedulerPage";

const job = (id: string, source: "yaml" | "ui") => ({
  id, source, kpis: ["EnergyCostKPI"], community: "*", buildings: ["*"], cron: "5 * * * *", lookback: "1h",
  next_run_time: null, last_run_time: null, last_run_status: "never",
});

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={["/app/kpi-manager/automation/scheduler"]}>
        <SchedulerPage />
      </MemoryRouter>
    </QueryClientProvider>
  );
}

const jobList = () => screen.findByRole("navigation", { name: "Jobs" });
const openJob = async (id: string) =>
  // The name may wrap after its underscores (<wbr>), which the accessible name can space out
  fireEvent.click(within(await jobList()).getByRole("button", { name: (n) => n.replace(/\s/g, "").startsWith(id) }));

describe("SchedulerPage", () => {
  let deleted: string[];
  let created: unknown[];
  let triggered: string[];

  beforeEach(() => {
    deleted = [];
    created = [];
    triggered = [];
    server.use(
      http.get("*/kpi-api/api/v1/scheduler/status", () =>
        HttpResponse.json({ status: "success", data: { running: true, jobs: [job("hourly_yaml", "yaml"), job("my_job", "ui")] } })),
      http.delete("*/kpi-api/api/v1/scheduler/jobs/:id", ({ params }) => {
        deleted.push(String(params.id));
        return HttpResponse.json({ status: "success" });
      }),
      http.post("*/kpi-api/api/v1/scheduler/jobs/:id/trigger", ({ params }) => {
        triggered.push(String(params.id));
        return HttpResponse.json({ status: "success" });
      }),
      http.post("*/kpi-api/api/v1/scheduler/jobs", async ({ request }) => {
        created.push(await request.json());
        return HttpResponse.json({ status: "success" });
      }),
      http.get("*/kpi-api/api/v1/scheduler/jobs/:id/runs", () => HttpResponse.json({ status: "success", data: [] })),
      http.get("*/kpi-api/api/v1/kpis/metadata", () => HttpResponse.json({ status: "success", data: [
        { name: "EnergyCostKPI", display_name: "Energy cost", type: "scheduled", status: "available", registered: true },
      ] })),
      http.get("*/kpi-api/*", () => HttpResponse.json({ status: "success", data: [] })),
    );
  });

  it("opens the first job, and shows its KPIs and configuration in the Overview tab", async () => {
    renderPage();
    const overview = await screen.findByRole("region", { name: "Overview of hourly_yaml" });
    expect(within(overview).getByText("Energy cost")).toBeInTheDocument();
    expect(within(overview).getByText(/Defined in kpi_schedule.yaml/)).toBeInTheDocument();
    expect(within(overview).queryByRole("button", { name: "Delete" })).not.toBeInTheDocument();
  });

  it("only offers edit and delete for jobs created in the UI, and deletes after confirming", async () => {
    renderPage();
    await openJob("my_job");
    const overview = await screen.findByRole("region", { name: "Overview of my_job" });
    fireEvent.click(within(overview).getByRole("button", { name: "Delete" }));
    const dialog = await screen.findByText(/This cannot be undone/);
    fireEvent.click(within(dialog.closest(".modal") as HTMLElement).getByRole("button", { name: "Delete" }));
    await waitFor(() => expect(deleted).toEqual(["my_job"]));
  });

  it("runs a job from its button in the sidebar, and every job with Run all", async () => {
    renderPage();
    fireEvent.click(within(await jobList()).getByRole("button", { name: "Run my_job now" }));
    await waitFor(() => expect(triggered).toEqual(["my_job"]));
    fireEvent.click(screen.getByRole("button", { name: "Run all" }));
    const dialog = await screen.findByText(/Run all 2 jobs now/);
    fireEvent.click(within(dialog.closest(".modal") as HTMLElement).getByRole("button", { name: "Run all" }));
    await waitFor(() => expect(triggered).toEqual(["my_job", "hourly_yaml", "my_job"]));
  });

  it("shows the runs of the open job in the Runs tab", async () => {
    renderPage();
    await openJob("my_job");
    fireEvent.click(await screen.findByRole("tab", { name: "Runs" }));
    const runs = await screen.findByRole("region", { name: "Runs of my_job" });
    expect(await within(runs).findByText(/No runs recorded yet/)).toBeInTheDocument();
  });

  it("creates a weekly job with a lookback string, not as one day", async () => {
    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: "Add job" }));
    fireEvent.change(screen.getByLabelText(/Job ID/), { target: { value: "weekly_costs" } });
    fireEvent.change(screen.getByLabelText(/Lookback/), { target: { value: "1w" } });
    fireEvent.click(screen.getByRole("button", { name: "Select KPIs…" }));
    fireEvent.click(await screen.findByRole("checkbox", { name: "Energy cost" }));
    fireEvent.click(screen.getByRole("button", { name: "Create job" }));
    await waitFor(() => expect(created).toHaveLength(1));
    expect(created[0]).toMatchObject({ id: "weekly_costs", kpis: ["EnergyCostKPI"], lookback: "1w" });
    expect(created[0]).not.toHaveProperty("lookback_days");
  });
});
