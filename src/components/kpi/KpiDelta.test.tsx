import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { KpiDelta } from "./KpiDelta";

describe("KpiDelta", () => {
  it("marks an increase as an improvement for higher-is-better KPIs", () => {
    render(<KpiDelta absolute={2} relativePct={10} />);
    expect(screen.getByTitle("improvement")).toHaveClass("kpi-text-ok");
    expect(screen.getByText("(+10.0%)")).toBeInTheDocument();
  });

  it("marks an increase as worse when lower is better (e.g. cost)", () => {
    render(<KpiDelta absolute={0.5} relativePct={null} lowerIsBetter />);
    expect(screen.getByTitle("worse")).toHaveClass("kpi-text-danger");
  });

  it("shows a dash when there is nothing to compare", () => {
    render(<KpiDelta absolute={null} relativePct={null} />);
    expect(screen.getByText("—")).toBeInTheDocument();
  });
});
