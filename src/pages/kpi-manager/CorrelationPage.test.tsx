import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it } from "vitest";
import { server } from "../../test/server";
import { CorrelationPage } from "./CorrelationPage";

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={["/app/kpi-manager/analysis/correlations"]}>
        <CorrelationPage />
      </MemoryRouter>
    </QueryClientProvider>
  );
}

describe("CorrelationPage", () => {
  beforeEach(() => {
    server.use(http.get("*/kpi-api/*", () => HttpResponse.json({ status: "success", data: [] })));
  });

  it("requires two KPIs before analysing", () => {
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: "Analyze" }));
    expect(screen.getByRole("alert")).toHaveTextContent("Select both KPIs.");
  });

  it("collapses and expands an analysis with a keyboard-reachable button", () => {
    renderPage();
    const toggle = screen.getByRole("button", { name: /New analysis/ });
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("button", { name: "Analyze" })).not.toBeInTheDocument();
  });

  it("adds and removes analyses", () => {
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: "Add another analysis" }));
    const removes = screen.getAllByRole("button", { name: "Remove New analysis" });
    expect(removes).toHaveLength(2);
    fireEvent.click(removes[0]);
    expect(screen.queryAllByRole("button", { name: "Remove New analysis" })).toHaveLength(0);
  });
});
