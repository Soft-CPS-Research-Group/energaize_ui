import { describe, expect, it } from "vitest";
import { lineMatches, parseLogLine } from "./logLines";

const NOW = Date.parse("2026-10-21T10:30:00Z");

describe("parseLogLine", () => {
  it("reads the log file format as UTC, to the second", () => {
    const entry = parseLogLine("2026-10-20 09:15:02,481 | WARNING | cloud | scheduler | R-H-01 | skipped: no data", NOW);
    expect(new Date(entry.time).toISOString()).toBe("2026-10-20T09:15:02.000Z");
    expect(entry.level).toBe("WARNING");
    expect(entry.logger).toBe("scheduler");
    expect(entry.message).toBe("R-H-01 | skipped: no data");
  });

  it("reads the live stream format and places the time today", () => {
    const entry = parseLogLine("10:29:58 | INFO     | Published forecast for R-H-02", NOW);
    expect(entry.time).toBe("2026-10-21T10:29:58.000Z");
    expect(entry.level).toBe("INFO");
    expect(entry.logger).toBe("");
    expect(entry.message).toBe("Published forecast for R-H-02");
  });

  it("puts a live time later than now on the previous day", () => {
    const entry = parseLogLine("23:59:59 | INFO | late line", Date.parse("2026-10-21T00:00:10Z"));
    expect(entry.time).toBe("2026-10-20T23:59:59.000Z");
  });

  it("keeps lines in other formats as the message", () => {
    const entry = parseLogLine("Traceback (most recent call last):", NOW);
    expect(entry).toMatchObject({ time: "", level: "", logger: "", message: "Traceback (most recent call last):" });
  });
});

describe("lineMatches", () => {
  const entry = parseLogLine("2026-10-20 09:15:02,481 | ERROR | cloud | trainer | R-H-03 failed", NOW);

  it("matches any part of the raw line, ignoring case", () => {
    expect(lineMatches(entry, "r-h-03")).toBe(true);
    expect(lineMatches(entry, "error")).toBe(true);
    expect(lineMatches(entry, "trainer")).toBe(true);
    expect(lineMatches(entry, "R-H-01")).toBe(false);
  });

  it("matches everything when the filter is blank", () => {
    expect(lineMatches(entry, "  ")).toBe(true);
  });
});
