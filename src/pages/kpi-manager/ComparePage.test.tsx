import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it } from "vitest";
import { server } from "../../test/server";
import { ComparePage } from "./ComparePage";

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={["/app/kpi-manager/analysis/compare"]}>
        <ComparePage />
      </MemoryRouter>
    </QueryClientProvider>
  );
}

describe("ComparePage", () => {
  beforeEach(() => {
    server.use(http.get("*/kpi-api/*", () => HttpResponse.json({ status: "success", data: [] })));
  });

  it("starts with guidance and labels both periods", () => {
    renderPage();
    expect(screen.getByText("Choose two periods to compare")).toBeInTheDocument();
    expect(screen.getByRole("group", { name: "Baseline period" })).toBeInTheDocument();
    expect(screen.getByRole("group", { name: "Comparison period" })).toBeInTheDocument();
  });

  it("asks for a building before comparing", () => {
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: "Compare" }));
    expect(screen.getByRole("alert")).toHaveTextContent("Please select at least one building.");
  });
});
