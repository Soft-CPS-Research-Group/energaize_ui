import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it } from "vitest";
import { server } from "../../test/server";
import { ThresholdPage } from "./ThresholdPage";

const rule = {
  id: "0123456789abcdef01234567", community: "living_lab", kpi: "EnergyCostKPI", scope: "building_R-H-01",
  condition: "gt", threshold: 1, severity: "critical", message: "", enabled: true,
};

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={["/app/kpi-manager/automation/alerts"]}>
        <ThresholdPage />
      </MemoryRouter>
    </QueryClientProvider>
  );
}

describe("ThresholdPage", () => {
  let patches: Array<{ url: string; body: unknown }>;

  beforeEach(() => {
    patches = [];
    server.use(
      http.get("*/kpi-api/api/v1/communities", () => HttpResponse.json({ status: "success", data: { living_lab: ["building_R-H-01"] } })),
      http.get("*/kpi-api/api/v1/thresholds/*", () => HttpResponse.json({ status: "success", data: [rule] })),
      http.get("*/kpi-api/*", () => HttpResponse.json({ status: "success", data: [] })),
    );
  });

  it("toggles a single rule through its id", async () => {
    server.use(http.patch("*/kpi-api/api/v1/thresholds/*", async ({ request }) => {
      patches.push({ url: new URL(request.url).pathname, body: await request.json() });
      return HttpResponse.json({ status: "success" });
    }));
    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: /Disable .* rule/ }));
    await waitFor(() => expect(patches).toHaveLength(1));
    expect(patches[0].url).toMatch(/by-id\/0123456789abcdef01234567$/);
    expect(patches[0].body).toEqual({ enabled: false });
  });

  it("falls back to the KPI-wide route on an older KPI module", async () => {
    server.use(http.patch("*/kpi-api/api/v1/thresholds/*", async ({ request }) => {
      const url = new URL(request.url).pathname;
      if (url.includes("/by-id/")) return new HttpResponse(null, { status: 405 });
      patches.push({ url, body: await request.json() });
      return HttpResponse.json({ status: "success" });
    }));
    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: /Disable .* rule/ }));
    await waitFor(() => expect(patches).toHaveLength(1));
    expect(patches[0].url).toMatch(/thresholds\/living_lab\/EnergyCostKPI$/);
    expect(patches[0].body).toEqual({ enabled: false, scope: "building_R-H-01" });
  });
});
