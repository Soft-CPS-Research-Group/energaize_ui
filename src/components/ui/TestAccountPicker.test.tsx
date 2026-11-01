import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { TestAccountPicker } from "./TestAccountPicker";
import type { TestAccount, TestAccountContext } from "../../api/testAccounts";
const context: TestAccountContext = {
  role: "prosumer",
  community_id: "rec",
  community_name: "Testing",
  site_id: "office",
  site_name: "Existing office",
  equipment_count: 1,
};
const resident: TestAccount = {
  id: "resident",
  email: "resident@example.com",
  name: "Existing resident",
  contexts: [
    context,
    { ...context, site_id: "home", site_name: "Existing home" },
  ],
};
const rows: TestAccount[] = [
  resident,
  {
    id: "manager",
    email: "manager@example.com",
    name: "REC Manager",
    contexts: [
      { ...context, role: "rec_manager", site_id: null, site_name: null },
    ],
  },
  {
    id: "predictor",
    email: "predictor@example.com",
    name: "Predictor",
    contexts: [
      {
        ...context,
        role: "predictor",
        site_id: null,
        site_name: null,
        community_id: null,
        community_name: null,
      },
    ],
  },
];
let fetcher: ReturnType<typeof vi.fn>;
beforeEach(() => {
  fetcher = vi.fn(async () => new Response(JSON.stringify({ accounts: rows })));
  vi.stubGlobal("fetch", fetcher);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
it("groups existing consumers by community/home and selects an exact account context", async () => {
  const select = vi.fn(),
    user = userEvent.setup();
  render(<TestAccountPicker onSelect={select} />);
  expect(await screen.findByRole("heading", { name: "Testing" })).toBeVisible();
  expect(screen.getByRole("button", { name: /Existing home/ })).toBeVisible();
  expect(
    screen.queryByText("REC Manager", { exact: true }),
  ).not.toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: /Existing office/ }));
  expect(select).toHaveBeenCalledWith({ account: resident, context });
  expect(fetcher).toHaveBeenCalledWith(
    "/community-api/api/identity/test-accounts",
    expect.objectContaining({ signal: expect.any(AbortSignal) }),
  );
});
it("separates managers and other profiles and searches by community and home", async () => {
  const user = userEvent.setup();
  render(<TestAccountPicker onSelect={() => {}} />);
  await screen.findByText("Existing home");
  await user.type(screen.getByRole("searchbox"), "office");
  expect(screen.queryByText("Existing home")).not.toBeInTheDocument();
  await user.clear(screen.getByRole("searchbox"));
  await user.click(
    screen.getByRole("button", { name: "REC Managers" }),
  );
  expect(
    screen.getByRole("button", { name: /REC Manager manager@example.com/ }),
  ).toBeVisible();
  await user.click(
    screen.getByRole("button", { name: "Other profiles" }),
  );
  expect(screen.getByRole("heading", { name: "predictor" })).toBeVisible();
  expect(
    screen.queryByText("Testing", { exact: true }),
  ).not.toBeInTheDocument();
});
it("does not invent consumers or retain a static login list if the API fails", async () => {
  fetcher.mockResolvedValue(new Response("{}", { status: 503 }));
  render(<TestAccountPicker onSelect={() => {}} />);
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "could not be loaded",
  );
  expect(screen.queryByText("Existing resident")).not.toBeInTheDocument();
});
it("reports an empty community consumer directory and an unmatched search", async () => {
  const user = userEvent.setup();
  fetcher.mockResolvedValue(new Response('{"accounts":[]}'));
  render(<TestAccountPicker onSelect={() => {}} />);
  expect(await screen.findByText(/No demonstration consumers/)).toBeVisible();
  await user.type(screen.getByRole("searchbox"), "home");
  expect(screen.getByText("No matching accounts.")).toBeVisible();
});
it("aborts a directory read when the picker closes", async () => {
  fetcher.mockImplementation(() => new Promise(() => {}));
  const view = render(<TestAccountPicker onSelect={() => {}} />);
  await waitFor(() => expect(fetcher).toHaveBeenCalled());
  const signal = fetcher.mock.calls[0][1].signal;
  view.unmount();
  expect(signal.aborted).toBe(true);
});
