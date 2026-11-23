import { fireEvent, render, screen, within } from "@testing-library/react";
import { expect, it } from "vitest";
import { CycleFlow, type Feed } from "./DeploymentFlow";
import { FlexibilityForecasts } from "./DeploymentFlexibility";

const cycle = (second: number) => {
  const timestamp = `2026-11-23T02:00:${second}Z`;
  return {
    id: timestamp,
    timestamp,
    truncated: false,
    payload: {
      entities: {
        meter: {
          parameters: {
            power: {
              parameter_type_id: "power",
              measurement_unit: "kW",
              final_values: [{ value: second }],
            },
          },
        },
      },
    },
  };
};
it("follows new cycles, preserves a pinned reading, and displays the check independently", () => {
  const first = cycle(10),
    second = cycle(25);
  const batch: Feed = {
    site_id: "site",
    checked_at: first.timestamp,
    available: true,
    messages: [first],
    period_seconds: 15,
  };
  const { rerender } = render(<CycleFlow kind="write" batch={batch} />);
  expect(screen.getByText("10 kW")).toBeVisible();
  expect(screen.getByText("15 seconds")).toBeVisible();
  fireEvent.click(
    within(screen.getByRole("navigation")).getAllByRole("button")[1],
  );
  rerender(
    <CycleFlow
      kind="write"
      batch={{
        ...batch,
        checked_at: second.timestamp,
        messages: [second, first],
      }}
    />,
  );
  expect(screen.getByText("10 kW")).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "Follow latest" }));
  expect(screen.getByText("25 kW")).toBeVisible();
  expect(screen.getByText("Original JSON").parentElement).not.toHaveAttribute(
    "open",
  );
});
it("keeps disabled and historical flexibility results distinct for each charger", () => {
  const result = {
    windows: [
      {
        starts_at: "2026-11-23T10:00:00Z",
        ends_at: "2026-11-23T12:00:00Z",
        duration_minutes: 45,
        sample_count: 12,
      },
    ],
    session_count: 14,
  };
  render(
    <FlexibilityForecasts
      rows={[
        {
          id: "a",
          name: "Garage",
          forecast: {
            asset_id: "a",
            state: "disabled",
            jobs: [],
            prediction: null,
          },
        },
        {
          id: "b",
          name: "Outdoor",
          forecast: {
            asset_id: "b",
            state: "completed",
            jobs: [],
            prediction: {
              usable: false,
              generated_at: "2026-11-20T01:00:00Z",
              valid_until: "2026-11-21T01:00:00Z",
              result,
            },
          },
        },
      ]}
    />,
  );
  expect(screen.getByText("Forecasting disabled")).toBeVisible();
  expect(screen.getByText(/Previous forecast/)).toBeVisible();
  expect(screen.getByText("45 min")).toBeVisible();
});
