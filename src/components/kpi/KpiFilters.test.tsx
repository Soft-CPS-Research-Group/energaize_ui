import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { CommunityField, DateRangeField, KpiSwitch, communityLabel, toLocalDateString } from "./KpiFilters";

describe("KPI filter components", () => {
  it("labels communities readably", () => {
    expect(communityLabel("living_lab")).toBe("Living lab");
    expect(communityLabel("i-charging_headquarters")).toBe("I charging headquarters");
  });

  it("associates the community label with its select", () => {
    const onChange = vi.fn();
    render(<CommunityField communities={["living_lab", "sao_mamede"]} value="living_lab" onChange={onChange} />);
    fireEvent.change(screen.getByLabelText("Community"), { target: { value: "sao_mamede" } });
    expect(onChange).toHaveBeenCalledWith("sao_mamede");
  });

  it("applies a date preset ending today", () => {
    const onChange = vi.fn();
    render(<DateRangeField start="2026-01-01" end="2026-01-02" onChange={onChange} />);
    fireEvent.click(screen.getByRole("button", { name: "7 days" }));
    const weekAgo = new Date();
    weekAgo.setDate(weekAgo.getDate() - 7);
    expect(onChange).toHaveBeenCalledWith(toLocalDateString(weekAgo), toLocalDateString(new Date()));
  });

  it("exposes the switch as an accessible toggle", () => {
    const onChange = vi.fn();
    render(<KpiSwitch checked={false} onChange={onChange} label="Include community total" />);
    fireEvent.click(screen.getByRole("switch", { name: "Include community total" }));
    expect(onChange).toHaveBeenCalledWith(true);
  });
});
