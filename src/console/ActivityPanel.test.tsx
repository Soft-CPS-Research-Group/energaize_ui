import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ActivityPanel, type ActivityItem } from "./ActivityPanel";
const item: ActivityItem = {
  id: "one",
  occurred_at: "2026-10-23T12:00:00Z",
  community_id: "rec",
  site_id: "site",
  resource_id: "asset",
  resource_name: "Grid meter",
  action: "equipment_updated",
  status: "pending",
  actor_status: "unavailable",
  confirmations: [],
};
const page = (items: ActivityItem[], next_cursor: string | null = null) =>
  new Response(
    JSON.stringify({
      items,
      next_cursor,
      source: "inventory_configuration_reviews",
    }),
    { status: 200 },
  );
let fetcher: ReturnType<typeof vi.fn>;
beforeEach(() => {
  fetcher = vi.fn().mockResolvedValue(page([item]));
  vi.stubGlobal("fetch", fetcher);
  HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute("open", "");
  };
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
describe("Activity", () => {
  it("shows only the server verified account name for new changes", async () => {
    fetcher.mockResolvedValueOnce(
      page([{ ...item, actor_status: "verified", actor_name: "Alice" }]),
    );
    render(<ActivityPanel scope={{}} onClose={() => {}} />);
    expect(await screen.findByText("Alice")).toBeInTheDocument();
    expect(
      screen.queryByText("Author unavailable in this historical record"),
    ).not.toBeInTheDocument();
  });
  it("loads the current equipment, keeps actor uncertainty and expands recorded details", async () => {
    render(
      <ActivityPanel
        scope={{
          communityId: "rec",
          siteId: "site",
          resourceId: "asset",
          label: "Battery",
        }}
        onClose={() => {}}
      />,
    );
    expect(await screen.findByText("Grid meter")).toBeInTheDocument();
    const params = new URL(fetcher.mock.calls[0][0], "http://localhost")
      .searchParams;
    expect(params.get("resource_id")).toBe("asset");
    expect(params.get("community_id")).toBe("rec");
    expect(
      screen.getByText("Author unavailable in this historical record"),
    ).toBeInTheDocument();
    await userEvent.click(screen.getByText("Configuration review"));
    expect(screen.getByText(/Review the algorithm/)).toBeVisible();
  });
  it("paginates older entries without duplicating a row and filters open reviews", async () => {
    fetcher
      .mockResolvedValueOnce(page([item], "next"))
      .mockResolvedValueOnce(
        page([item, { ...item, id: "two", resource_name: "Battery" }]),
      )
      .mockResolvedValueOnce(page([]));
    render(<ActivityPanel scope={{}} onClose={() => {}} />);
    await userEvent.click(
      await screen.findByRole("button", { name: /Load older/ }),
    );
    expect(await screen.findByText("Battery")).toBeInTheDocument();
    expect(screen.getAllByText("Grid meter")).toHaveLength(1);
    expect(String(fetcher.mock.calls[1][0])).toContain("cursor=next");
    await userEvent.selectOptions(screen.getByLabelText("Show"), "open");
    expect(await screen.findByText("No recorded activity")).toBeInTheDocument();
    expect(String(fetcher.mock.calls[2][0])).toContain("kind=open");
  });
  it("does not issue invalid custom ranges and includes the selected last day", async () => {
    fetcher.mockImplementation(() => Promise.resolve(page([])));
    render(<ActivityPanel scope={{}} onClose={() => {}} />);
    await screen.findByText("No recorded activity");
    await userEvent.selectOptions(screen.getByLabelText("Period"), "custom");
    expect(fetcher).toHaveBeenCalledTimes(1);
    const recent = new Date();
    recent.setDate(recent.getDate() - 3);
    const key = [
      recent.getFullYear(),
      String(recent.getMonth() + 1).padStart(2, "0"),
      String(recent.getDate()).padStart(2, "0"),
    ].join("-");
    fireEvent.change(screen.getByLabelText("From"), {
      target: { value: key },
    });
    fireEvent.change(screen.getByLabelText("Through"), {
      target: { value: key },
    });
    await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(2));
    const end = new URL(
      fetcher.mock.calls[1][0],
      "http://localhost",
    ).searchParams.get("until");
    recent.setDate(recent.getDate() + 1);
    expect(new Date(end!).getDate()).toBe(recent.getDate());
    fireEvent.change(screen.getByLabelText("From"), {
      target: { value: "2020-01-01" },
    });
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(
      screen.queryByRole("option", { name: "Last 90 days" }),
    ).not.toBeInTheDocument();
  });
  it("hides old data on filter changes and ignores late responses", async () => {
    let resolve!: (response: Response) => void;
    fetcher
      .mockReturnValueOnce(
        new Promise((r) => {
          resolve = r;
        }),
      )
      .mockResolvedValueOnce(page([]));
    render(<ActivityPanel scope={{}} onClose={() => {}} />);
    await userEvent.selectOptions(screen.getByLabelText("Show"), "resolved");
    await screen.findByText("No recorded activity");
    await act(async () => {
      resolve(page([item]));
    });
    expect(screen.queryByText("Grid meter")).not.toBeInTheDocument();
  });
  it("reports unavailable backend honestly and supports retry and closing", async () => {
    fetcher
      .mockResolvedValueOnce(new Response("{}", { status: 404 }))
      .mockResolvedValueOnce(page([]));
    const close = vi.fn();
    render(<ActivityPanel scope={{}} onClose={close} />);
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "backend version",
    );
    await userEvent.click(screen.getByRole("button", { name: "Try again" }));
    await screen.findByText("No recorded activity");
    await userEvent.click(
      screen.getByRole("button", { name: "Close activity" }),
    );
    expect(close).toHaveBeenCalled();
  });
});
