import {
  act,
  cleanup,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  FlexibilityCalendar,
  type CalendarEquipment,
  type CalendarOccurrence,
} from "./FlexibilityCalendar";
import type {
  ChosenFlexibility,
  SelectionPolicy,
} from "../api/flexibilitySelection";
const equipment: CalendarEquipment[] = [
  {
    id: "ev",
    name: "Home charger",
    kind: "ev_charger",
    canEdit: true,
    cycles: [],
  },
  {
    id: "washer",
    name: "Laundry",
    kind: "appliance",
    canEdit: true,
    cycles: [{ id: "eco", name: "Eco" }],
  },
];
const occurrence: CalendarOccurrence = {
  occurrence_id: "occ",
  event_id: "event",
  asset_id: "ev",
  starts_at: "2026-11-01T18:00:00Z",
  ends_at: "2026-11-02T08:00:00Z",
  occurrence_at: "2026-11-01T18:00:00Z",
  revision: 3,
  exception_revision: 0,
  recurrence: { freq: "DAILY" },
  created_by: "alice",
  status: "active",
  resolution: "eligible",
  title: "EV",
  type_specific_data: { soc_at_departure: 0.8 },
};
let rows: CalendarOccurrence[],
  result: ChosenFlexibility,
  policy: SelectionPolicy,
  fetcher: ReturnType<typeof vi.fn>;
const action = vi.fn();
const props = {
  equipment,
  actorId: "alice",
  initialDay: "2026-11-01",
  onAction: action,
};
beforeEach(() => {
  rows = [{ ...occurrence }];
  policy = {
    asset_id: "ev",
    revision: 2,
    settings: {
      forecast_enabled: true,
      timezone: "Europe/Lisbon",
      selection: {
        base_window_kind: "habitual",
        required_departure_time: null,
        default_soc_at_departure: null,
        default_cycle_id: null,
      },
    },
  };
  result = {
    asset_id: "ev",
    computed_at: "2026-11-01T12:00:00Z",
    policy_revision: 2,
    forecast_state: "usable",
    forecast: {
      prediction_id: "forecast-1",
      request_id: "request-1",
      revision: 1,
      generated_at: "2026-11-01T11:00:00Z",
      valid_until: "2026-11-03T11:00:00Z",
      model_version: "simulated-v1",
      simulated: true,
    },
    forecast_windows: [
      { starts_at: "2026-11-01T20:00:00Z", ends_at: "2026-11-02T07:00:00Z" },
    ],
    offers: [
      {
        need_id: "need",
        created_by: "alice",
        asset_id: "ev",
        event_id: "event",
        occurrence_at: "2026-11-01T18:00:00+00:00",
        event_revision: 3,
        exception_revision: 0,
        session_type: "ev_charging",
        status: "resolved",
        semantics: "availability",
        starts_at: "2026-11-01T20:00:00Z",
        ends_at: "2026-11-02T07:00:00Z",
        soc_at_arrival: 0.4,
        soc_at_departure: 0.8,
        cycle: null,
        earliest_start: null,
        latest_start: null,
        origins: {
          starts_at: {
            source: "forecast",
            reference_id: "forecast-1",
            revision: 1,
          },
          ends_at: {
            source: "forecast",
            reference_id: "forecast-1",
            revision: 1,
          },
          soc_at_departure: {
            source: "recurrent",
            reference_id: "event",
            revision: 3,
          },
        },
        reasons: [],
        simulated: true,
        execution_ready: false,
      },
    ],
    decision_id: null,
  };
  fetcher = vi.fn(async (url: string, init: RequestInit = {}) => {
    if (url.endsWith("/effective")) {
      const ids = JSON.parse(init.body as string).asset_ids;
      return new Response(
        JSON.stringify({
          occurrences: rows.filter((o) => ids.includes(o.asset_id)),
        }),
      );
    }
    if (url.includes("/policy")) {
      if (init.method === "PUT")
        policy = {
          ...policy,
          revision: 3,
          settings: JSON.parse(init.body as string).settings,
        };
      return new Response(JSON.stringify(policy));
    }
    if (url.includes("/exceptions")) return new Response("{}");
    return new Response(
      JSON.stringify(
        url.includes("/assets/washer/")
          ? {
              ...result,
              asset_id: "washer",
              forecast: null,
              forecast_windows: [],
              offers: [],
            }
          : result,
      ),
    );
  });
  vi.stubGlobal("fetch", fetcher);
  action.mockClear();
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
const agenda = () =>
  screen.getByRole("complementary", { name: "Flexibility for selected day" });
describe("Flexibility calendar", () => {
  it("starts independent reads together and keeps a visible loader until the calendar is ready", async () => {
    let declared!: (response: Response) => void;
    let chosen!: (response: Response) => void;
    fetcher.mockImplementation(
      (url: string) =>
        new Promise<Response>((resolve) => {
          if (url.endsWith("/effective")) declared = resolve;
          else chosen = resolve;
        }),
    );
    render(<FlexibilityCalendar {...props} equipment={[equipment[0]]} />);
    // A slow availability response must not delay starting the selection read.
    await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(2));
    expect(screen.getByRole("status")).toHaveTextContent(
      "Loading your flexibility",
    );
    expect(
      within(agenda()).queryByText("No plans for this day"),
    ).not.toBeInTheDocument();
    await act(async () =>
      declared(new Response(JSON.stringify({ occurrences: rows }))),
    );
    expect(
      screen.getByRole("region", { name: "Flexibility calendar" }),
    ).toHaveAttribute("aria-busy", "true");
    expect(screen.getByRole("status")).toBeVisible();
    await act(async () => chosen(new Response(JSON.stringify(result))));
    expect(await within(agenda()).findByText("Window in use")).toBeVisible();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    expect(
      screen.getByRole("region", { name: "Flexibility calendar" }),
    ).toHaveAttribute("aria-busy", "false");
  });
  it("aborts every old-scope read and ignores late results when equipment changes", async () => {
    const original = fetcher.getMockImplementation()!;
    const pending: Array<{
      url: string;
      init: RequestInit;
      resolve: (response: Response) => void;
    }> = [];
    let hold = true;
    fetcher.mockImplementation((url: string, init: RequestInit = {}) =>
      hold
        ? new Promise<Response>((resolve) =>
            pending.push({ url, init, resolve }),
          )
        : original(url, init),
    );
    const view = render(<FlexibilityCalendar {...props} />);
    await waitFor(() => expect(pending).toHaveLength(3));
    hold = false;
    view.rerender(
      <FlexibilityCalendar {...props} equipment={[equipment[1]]} />,
    );
    expect(
      await within(agenda()).findByText("No plans for this day"),
    ).toBeVisible();
    expect(pending.every(({ init }) => init.signal?.aborted)).toBe(true);
    // Simulate a transport which completes despite cancellation.
    await act(async () => {
      for (const p of pending) p.resolve(await original(p.url, p.init));
    });
    expect(
      within(agenda()).queryByRole("heading", { name: "Home charger" }),
    ).not.toBeInTheDocument();
    expect(
      within(agenda()).queryByText("Window in use"),
    ).not.toBeInTheDocument();
    expect(within(agenda()).getByText("No plans for this day")).toBeVisible();
  });
  it("ends loading and reports an unavailable calendar when declared availability fails", async () => {
    const original = fetcher.getMockImplementation()!;
    fetcher.mockImplementation((url: string, init: RequestInit = {}) =>
      url.endsWith("/effective")
        ? Promise.resolve(
            new Response('{"detail":"Unavailable"}', { status: 503 }),
          )
        : original(url, init),
    );
    render(<FlexibilityCalendar {...props} />);
    expect(
      await within(agenda()).findByText("Calendar unavailable"),
    ).toBeVisible();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    expect(
      within(agenda()).queryByText("Window in use"),
    ).not.toBeInTheDocument();
  });
  it("defaults to all equipment and shows forecast and recurring contributions from backend origins", async () => {
    const { container } = render(<FlexibilityCalendar {...props} />);
    expect(await within(agenda()).findByText("Window in use")).toBeVisible();
    expect(
      screen.getByRole("button", { name: "All equipment 2 connected" }),
    ).toHaveAttribute("aria-pressed", "true");
    expect(agenda().querySelector('[data-source="forecast"]')).toHaveAttribute(
      "data-selected",
      "true",
    );
    expect(agenda().querySelector('[data-source="recurrent"]')).toHaveAttribute(
      "data-selected",
      "true",
    );
    expect(within(agenda()).getByText("charge target")).toBeVisible();
    const today = container.querySelector(".availability-day.is-current")!;
    expect(today.querySelectorAll('[data-calendar-asset="ev"]')).toHaveLength(
      1,
    );
    expect(today).not.toHaveTextContent(/Recurring|Prediction/);
    expect(
      screen.queryByRole("button", {
        name: /request history|rules & predictions|refresh|approve/i,
      }),
    ).not.toBeInTheDocument();
    expect(
      fetcher.mock.calls.every(
        ([url]) => !url.includes("simulated-predictions"),
      ),
    ).toBe(true);
  });
  it("opens just the clicked equipment, while the day number restores the whole day", async () => {
    rows.push({
      ...occurrence,
      occurrence_id: "washer-occ",
      asset_id: "washer",
      event_id: "washer-event",
    });
    const user = userEvent.setup();
    render(<FlexibilityCalendar {...props} />);
    await within(agenda()).findByText("Window in use");
    expect(within(agenda()).getAllByRole("heading", { level: 3 })).toHaveLength(
      2,
    );
    const cell = screen.getByRole("region", { name: "Flexibility calendar" });
    await user.click(
      within(cell).getByRole("button", {
        name: "Home charger · Sunday 1 November",
      }),
    );
    expect(
      within(agenda()).getByRole("heading", { name: "Home charger" }),
    ).toBeVisible();
    expect(
      within(agenda()).queryByRole("heading", { name: "Laundry" }),
    ).not.toBeInTheDocument();
    expect(
      within(agenda()).getByText("Prediction", { exact: true }),
    ).toBeVisible();
    expect(
      within(agenda()).getByText("Recurring", { exact: true }),
    ).toBeVisible();
    // A calendar click narrows the inspector, not the equipment filter or the month.
    expect(
      screen.getByRole("button", { name: "All equipment 2 connected" }),
    ).toHaveAttribute("aria-pressed", "true");
    expect(
      within(cell).getByRole("button", {
        name: "Laundry · Sunday 1 November",
      }),
    ).toBeVisible();
    await user.click(
      within(agenda()).getByRole("button", { name: "Plan something" }),
    );
    expect(action).toHaveBeenLastCalledWith({
      action: "create",
      day: "2026-11-01",
      assetId: "ev",
      occurrence: undefined,
    });
    await user.click(
      within(cell).getByRole("button", {
        name: "Sunday 1 November",
      }),
    );
    expect(within(agenda()).getAllByRole("heading", { level: 3 })).toHaveLength(
      2,
    );
    await user.click(
      within(cell).getByRole("button", {
        name: "Home charger · Sunday 1 November",
      }),
    );
    await user.click(
      within(agenda()).getByRole("button", {
        name: "All equipment for this day",
      }),
    );
    expect(within(agenda()).getAllByRole("heading", { level: 3 })).toHaveLength(
      2,
    );
  });
  it("bounds the day list and uses a searchable equipment chooser for a large inventory", async () => {
    const many = Array.from({ length: 12 }, (_, i) => ({
      ...equipment[0],
      id: `charger-${i + 1}`,
      name: `Charger ${i + 1}`,
    }));
    rows = many.map((a) => ({
      ...occurrence,
      asset_id: a.id,
      occurrence_id: a.id,
      event_id: a.id,
    }));
    const user = userEvent.setup();
    const { container } = render(
      <FlexibilityCalendar {...props} equipment={many} />,
    );
    await within(agenda()).findByRole("heading", { name: "Charger 12" });
    const current = container.querySelector(
      ".availability-day.is-current",
    ) as HTMLElement;
    expect(current.querySelectorAll("[data-calendar-asset]")).toHaveLength(4);
    expect(
      within(current).getByRole("button", { name: "+8 equipment" }),
    ).toBeVisible();
    const filter = screen.getByRole("group", {
      name: "Filter flexibility by equipment",
    });
    expect(within(filter).getAllByRole("button")).toHaveLength(2);
    await user.click(
      within(filter).getByRole("button", {
        name: "Choose equipment",
      }),
    );
    const dialog = screen.getByRole("dialog", { name: "Choose equipment" });
    expect(
      within(dialog).getByRole("searchbox", { name: "Search equipment" }),
    ).toHaveFocus();
    await user.type(within(dialog).getByRole("searchbox"), "Charger 12");
    expect(
      within(dialog).queryByRole("button", { name: "Charger 1" }),
    ).not.toBeInTheDocument();
    await user.click(
      within(dialog).getByRole("button", { name: "Charger 12" }),
    );
    await waitFor(() =>
      expect(
        within(agenda()).getAllByRole("heading", { level: 3 }),
      ).toHaveLength(1),
    );
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    const requests = fetcher.mock.calls.filter(([url]) =>
      url.endsWith("/effective"),
    );
    expect(
      JSON.parse(requests[requests.length - 1][1].body as string).asset_ids,
    ).toEqual(["charger-12"]);
    await user.click(
      within(filter).getByRole("button", { name: "Charger 12" }),
    );
    await user.type(screen.getByRole("searchbox"), "unknown");
    expect(screen.getByText("No equipment found.")).toBeVisible();
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(
      within(filter).getByRole("button", { name: "Charger 12" }),
    ).toHaveFocus();
    await user.click(
      within(filter).getByRole("button", {
        name: "All equipment 12 connected",
      }),
    );
    await waitFor(() =>
      expect(
        within(agenda()).getAllByRole("heading", { level: 3 }),
      ).toHaveLength(12),
    );
  });
  it("does not select a forecast when the backend chose a dated request", async () => {
    rows[0] = {
      ...occurrence,
      exception_action: "modify",
      exception_revision: 1,
    };
    result.offers[0].origins = {
      starts_at: { source: "punctual", reference_id: "event", revision: 3 },
      ends_at: { source: "punctual", reference_id: "event", revision: 3 },
    };
    render(<FlexibilityCalendar {...props} />);
    await within(agenda()).findByText("Window in use");
    expect(agenda().querySelector('[data-source="punctual"]')).toHaveAttribute(
      "data-selected",
      "true",
    );
    expect(agenda().querySelector('[data-source="forecast"]')).toHaveAttribute(
      "data-selected",
      "false",
    );
  });
  it("equipment filters update the API scope, and navigation uses the selected day for creation", async () => {
    const user = userEvent.setup();
    render(<FlexibilityCalendar {...props} />);
    await within(agenda()).findByText("Window in use");
    await user.click(screen.getByRole("button", { name: "Laundry Appliance" }));
    await within(agenda()).findByText("No plans for this day");
    expect(
      agenda().querySelector('[data-source="forecast"]'),
    ).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Monday 2 November" }));
    await user.click(screen.getByRole("button", { name: "Plan something" }));
    expect(action).toHaveBeenCalledWith({
      action: "create",
      assetId: "washer",
      day: "2026-11-02",
      occurrence: undefined,
    });
    const requests = fetcher.mock.calls.filter(([url]) =>
      url.endsWith("/effective"),
    );
    expect(
      JSON.parse(requests[requests.length - 1][1].body as string).asset_ids,
    ).toEqual(["washer"]);
  });
  it("keeps draft preferences and the selected day during automatic refresh; saves with the current revision", async () => {
    const user = userEvent.setup(),
      target = document.createElement("div");
    render(<FlexibilityCalendar {...props} refreshTarget={target} />);
    await within(agenda()).findByText("Window in use");
    await user.click(
      screen.getByRole("button", { name: "Availability preferences" }),
    );
    const form = await screen.findByRole("form", {
      name: "Availability preferences",
    });
    await user.type(
      await within(form).findByLabelText("Car needed by · optional"),
      "07:00",
    );
    const before = fetcher.mock.calls.length;
    act(() => {
      target.dispatchEvent(new CustomEvent("flex-calendar-refresh"));
    });
    await waitFor(() =>
      expect(fetcher.mock.calls.length).toBeGreaterThan(before),
    );
    expect(within(form).getByLabelText("Car needed by · optional")).toHaveValue(
      "07:00",
    );
    await user.type(
      within(form).getByLabelText("Usual charge target (%)"),
      "85",
    );
    await user.click(
      within(form).getByRole("button", { name: "Save preferences" }),
    );
    await within(form).findByText("Preferences saved.");
    const saved = fetcher.mock.calls.find(
      ([url, init]) => url.includes("/policy") && init.method === "PUT",
    )!;
    expect(JSON.parse(saved[1].body as string)).toMatchObject({
      expected_revision: 2,
      settings: {
        selection: {
          required_departure_time: "07:00",
          default_soc_at_departure: 0.85,
        },
      },
    });
    expect(
      fetcher.mock.calls.some(
        ([url, init]) => url.includes("/selection") && init.method === "POST",
      ),
    ).toBe(true);
  });
  it("keeps author checks, and restores the date-specific change with revision protection", async () => {
    rows[0] = {
      ...occurrence,
      exception_revision: 2,
      exception_action: "cancel",
      resolution: "cancelled",
    };
    result.offers[0].status = "unavailable";
    const user = userEvent.setup();
    const view = render(<FlexibilityCalendar {...props} />);
    await within(agenda()).findByText("Remove date-specific change");
    await user.click(
      within(agenda()).getByRole("button", {
        name: "Remove date-specific change",
      }),
    );
    await waitFor(() =>
      expect(
        fetcher.mock.calls.some(([url]) => url.includes("/exceptions")),
      ).toBe(true),
    );
    const sent = fetcher.mock.calls.find(([url]) =>
      url.includes("/exceptions"),
    )!;
    expect(JSON.parse(sent[1].body as string)).toMatchObject({
      action: "restore",
      expected_event_revision: 3,
      expected_exception_revision: 2,
    });
    view.rerender(<FlexibilityCalendar {...props} actorId="manager" />);
    expect(
      within(agenda()).queryByRole("button", {
        name: "Remove date-specific change",
      }),
    ).not.toBeInTheDocument();
  });
  it("shows an expired prediction as a source without marking it as selected", async () => {
    result.forecast_state = "expired";
    result.offers[0].origins = {
      starts_at: { source: "recurrent", reference_id: "event", revision: 3 },
    };
    render(<FlexibilityCalendar {...props} />);
    await within(agenda()).findByText("Expired");
    expect(agenda().querySelector('[data-source="forecast"]')).toHaveAttribute(
      "data-selected",
      "false",
    );
    expect(agenda().querySelector('[data-source="forecast"]')).toHaveClass(
      "is-inactive",
    );
  });
  it("keeps the calendar usable if one selection endpoint fails, without inventing a chosen source", async () => {
    const original = fetcher.getMockImplementation()!;
    fetcher.mockImplementation((url: string, init: RequestInit = {}) =>
      url.includes("/assets/ev/selection")
        ? Promise.resolve(
            new Response('{"detail":"Unavailable"}', { status: 503 }),
          )
        : original(url, init),
    );
    render(<FlexibilityCalendar {...props} />);
    await screen.findByText(/selected plan is temporarily unavailable/);
    expect(agenda().querySelector('[data-source="recurrent"]')).toHaveAttribute(
      "data-selected",
      "false",
    );
    expect(
      within(agenda()).queryByText("Window in use"),
    ).not.toBeInTheDocument();
  });
  it("manager consultation has no source edit actions or preference save action", async () => {
    const user = userEvent.setup();
    render(
      <FlexibilityCalendar
        {...props}
        actorId="manager"
        equipment={equipment.map((a) => ({ ...a, canEdit: false }))}
      />,
    );
    await within(agenda()).findByText("Window in use");
    expect(
      within(agenda()).queryByRole("button", { name: "Edit" }),
    ).not.toBeInTheDocument();
    expect(
      within(agenda()).queryByRole("button", { name: "Plan something" }),
    ).not.toBeInTheDocument();
    await user.click(
      within(agenda()).getByRole("button", {
        name: "Availability preferences",
      }),
    );
    expect(await screen.findByLabelText("Recurring times")).toBeDisabled();
    expect(
      screen.queryByRole("button", { name: "Save preferences" }),
    ).not.toBeInTheDocument();
  });
  it("shows the fixed washer programme and an infeasible window without editable duration fields", async () => {
    rows = [{ ...occurrence, asset_id: "washer" }];
    result = {
      ...result,
      asset_id: "washer",
      forecast: null,
      forecast_windows: [],
    };
    result.offers[0] = {
      ...result.offers[0],
      asset_id: "washer",
      session_type: "appliance",
      status: "infeasible",
      semantics: "expected_usage",
      cycle: {
        id: "eco",
        name: "Eco",
        duration_minutes: 90,
        energy_consumption_kwh: 0.6,
      },
    };
    fetcher.mockImplementation(
      async (url: string) =>
        new Response(
          JSON.stringify(
            url.endsWith("/effective") ? { occurrences: rows } : result,
          ),
        ),
    );
    render(<FlexibilityCalendar {...props} equipment={[equipment[1]]} />);
    expect(
      await within(agenda()).findByText("Eco · 90 min · 0.6 kWh"),
    ).toBeVisible();
    expect(
      within(agenda()).getByText("The time window cannot meet the requirement"),
    ).toBeVisible();
    expect(
      screen.queryByLabelText(/duration|cycle length/i),
    ).not.toBeInTheDocument();
  });
  it("ignores an old equipment response after the filter changes", async () => {
    const original = fetcher.getMockImplementation()!;
    let resolveOld: (response: Response) => void = () => {};
    fetcher.mockImplementation((url: string, init: RequestInit = {}) =>
      url.includes("/assets/ev/selection")
        ? new Promise<Response>((resolve) => {
            resolveOld = resolve;
          })
        : original(url, init),
    );
    const user = userEvent.setup();
    render(<FlexibilityCalendar {...props} />);
    await waitFor(() =>
      expect(
        fetcher.mock.calls.some(([url]) =>
          url.includes("/assets/ev/selection"),
        ),
      ).toBe(true),
    );
    await user.click(screen.getByRole("button", { name: "Laundry Appliance" }));
    await within(agenda()).findByText("No plans for this day");
    await act(async () => {
      resolveOld(new Response(JSON.stringify(result)));
    });
    expect(
      within(agenda()).queryByText("Home charger"),
    ).not.toBeInTheDocument();
    expect(
      within(agenda()).queryByText("Window in use"),
    ).not.toBeInTheDocument();
  });
});
