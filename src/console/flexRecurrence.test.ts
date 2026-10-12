import { describe, it, expect } from "vitest";
import { expandFlexEvents } from "./flexRecurrence";
const range = [
  new Date("2026-10-01T00:00:00Z"),
  new Date("2026-11-15T00:00:00Z"),
] as const;
describe("recurring flexibility calendar", () => {
  it("preserves Lisbon wall time across daylight saving and respects count", () => {
    const events = expandFlexEvents(
      [
        {
          event_id: "series",
          mode: "recurrent",
          starts_at: "2026-10-24T17:00:00Z",
          ends_at: "2026-10-24T19:00:00Z",
          timezone: "Europe/Lisbon",
          recurrence: { freq: "DAILY", count: 3 },
        },
      ],
      ...range,
    );
    expect(events.map((e) => e.starts_at)).toEqual([
      "2026-10-24T17:00:00.000Z",
      "2026-10-25T18:00:00.000Z",
      "2026-10-26T18:00:00.000Z",
    ]);
    expect(events.every((e) => e.event_id === "series")).toBe(true);
  });
  it("expands selected weekdays and includes overnight overlap", () => {
    const events = expandFlexEvents(
      [
        {
          mode: "recurrent",
          starts_at: "2026-10-05T22:00:00Z",
          ends_at: "2026-10-06T01:00:00Z",
          timezone: "UTC",
          recurrence: {
            freq: "WEEKLY",
            by_day: "MO,WE",
            until: "2026-10-14T22:00:00Z",
          },
        },
      ],
      ...range,
    );
    expect(events).toHaveLength(4);
    expect(events[3].starts_at).toBe("2026-10-14T22:00:00.000Z");
    expect(
      expandFlexEvents(
        events,
        new Date("2026-10-06T00:00:00Z"),
        new Date("2026-10-06T02:00:00Z"),
      ).length,
    ).toBeGreaterThan(0);
  });
  it("keeps predictions as supplied and excludes exclusive end", () => {
    expect(
      expandFlexEvents(
        [
          {
            mode: "forecast",
            starts_at: "2026-10-12T10:00:00Z",
            ends_at: "2026-10-12T11:00:00Z",
          },
        ],
        new Date("2026-10-12T11:00:00Z"),
        new Date("2026-10-13"),
      ),
    ).toEqual([]);
  });
});
