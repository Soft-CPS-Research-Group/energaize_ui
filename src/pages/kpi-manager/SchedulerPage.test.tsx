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

describe("SchedulerPage", () => {
  let deleted: string[];
  let created: unknown[];

  beforeEach(() => {
    deleted = [];
    created = [];
    server.use(
      http.get("*/kpi-api/api/v1/scheduler/status", () =>
        HttpResponse.json({ status: "success", data: { running: true, jobs: [job("hourly_yaml", "yaml"), job("my_job", "ui")] } })),
      http.delete("*/kpi-api/api/v1/scheduler/jobs/:id", ({ params }) => {
        deleted.push(String(params.id));
        return HttpResponse.json({ status: "success" });
      }),
      http.post("*/kpi-api/api/v1/scheduler/jobs", async ({ request }) => {
        created.push(await request.json());
        return HttpResponse.json({ status: "success" });
      }),
      http.get("*/kpi-api/api/v1/kpis/metadata", () => HttpResponse.json({ status: "success", data: [
        { name: "EnergyCostKPI", display_name: "Energy cost", type: "scheduled", status: "available", registered: true },
      ] })),
      http.get("*/kpi-api/*", () => HttpResponse.json({ status: "success", data: [] })),
    );
  });

  it("only offers edit and delete for jobs created in the UI", async () => {
    renderPage();
    const yamlCard = (await screen.findByRole("heading", { name: /hourly_yaml/ })).closest("article")!;
    const uiCard = screen.getByRole("heading", { name: /my_job/ }).closest("article")!;
    expect(within(yamlCard).queryByRole("button", { name: "Delete" })).not.toBeInTheDocument();
    expect(within(uiCard).getByRole("button", { name: "Delete" })).toBeInTheDocument();
  });

  it("deletes a job after confirming in the app's dialog", async () => {
    renderPage();
    const uiCard = (await screen.findByRole("heading", { name: /my_job/ })).closest("article")!;
    fireEvent.click(within(uiCard).getByRole("button", { name: "Delete" }));
    const dialog = await screen.findByText(/This cannot be undone/);
    fireEvent.click(within(dialog.closest(".modal") as HTMLElement).getByRole("button", { name: "Delete" }));
    await waitFor(() => expect(deleted).toEqual(["my_job"]));
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
