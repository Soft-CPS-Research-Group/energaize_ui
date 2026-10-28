import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, beforeAll, expect, it, vi } from "vitest";
import { DeploymentWorkspace } from "./DeploymentWorkspace";
import {
  graphLayout,
  services,
  type DeploymentMap,
  type Draft,
  type Placement,
} from "./deploymentModel";
vi.mock("./RuntimePanel", () => ({
  RuntimePanel: ({ kind }: { kind: string }) => <div>Configure {kind}</div>,
}));
beforeAll(() => {
  HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute("open", "");
  };
  HTMLDialogElement.prototype.close = function () {
    this.removeAttribute("open");
  };
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
const data: DeploymentMap = {
  site_id: "house",
  revision: "r1",
  destinations: [
    {
      id: "cloud",
      name: "SoftCPS server",
      placement: "cloud",
      registered: true,
      check: { state: "not_checked" },
    },
    {
      id: "pi",
      name: "Raspberry · Leça",
      placement: "local",
      registered: true,
      check: { state: "not_checked" },
    },
  ],
  components: [
    {
      id: "percepta",
      name: "Percepta",
      kind: "percepta",
      destination_id: "pi",
      planned_destination_id: "pi",
      state: "not_deployed",
      planned: true,
      supported: true,
    },
    {
      id: "controller",
      name: "Inference",
      kind: "controller",
      destination_id: "cloud",
      planned_destination_id: "cloud",
      state: "not_deployed",
      planned: true,
      supported: true,
    },
    {
      id: "forecasting",
      name: "Forecasting",
      kind: "forecasting",
      destination_id: "cloud",
      planned_destination_id: "cloud",
      state: "not_deployed",
      planned: true,
      supported: false,
    },
  ],
  links: [],
  warnings: [],
};
const initial: Draft = {
  site_id: "house",
  revision: null,
  base_revision: "r1",
  current_base_revision: "r1",
  updated_at: null,
  stale: false,
  services: { percepta: "local", controller: "cloud", forecasting: "cloud" },
  connections: {},
  launch_available: false,
  blockers: ["Final service contracts are pending."],
};
function mock(map = data, draft = initial) {
  const fetcher = vi.fn(
    async (url: string, options?: RequestInit) =>
      new Response(
        JSON.stringify(
          options?.method === "PUT"
            ? {
                ...draft,
                ...JSON.parse(options.body as string),
                revision: "saved",
                updated_at: "2026-10-28T12:00:00Z",
              }
            : url.endsWith("deployment-draft")
              ? draft
              : map,
        ),
      ),
  );
  vi.stubGlobal("fetch", fetcher);
  return fetcher;
}
const open = async () => {
  render(
    <DeploymentWorkspace siteId="house" siteName="House" navigate={() => {}} />,
  );
  await screen.findByRole("heading", { name: "SoftCPS server" });
};
it("keeps a saved draft separate from runtime and blocks unsupported bundle launch", async () => {
  const fetcher = mock();
  await open();
  fireEvent.click(screen.getByRole("button", { name: /Inference · Draft/ }));
  fireEvent.change(screen.getByLabelText("Destination"), {
    target: { value: "local" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Done" }));
  fireEvent.click(screen.getByRole("button", { name: "Save draft" }));
  await screen.findByText("Draft saved. Running services have not changed.");
  const write = fetcher.mock.calls.find(
    ([, options]) => options?.method === "PUT",
  )!;
  expect(write[0]).toContain("/sites/house/deployment-draft");
  expect(JSON.parse(write[1]!.body as string).services.controller).toBe(
    "local",
  );
  expect(
    fetcher.mock.calls.filter(([, o]) => o?.method === "POST"),
  ).toHaveLength(0);
  fireEvent.click(screen.getByRole("button", { name: /In operation/ }));
  expect(
    screen.queryByRole("button", { name: /Percepta · Draft/ }),
  ).not.toBeInTheDocument();
  expect(
    screen.getAllByText("No services deployed for this house"),
  ).toHaveLength(2);
  fireEvent.click(screen.getByRole("button", { name: /Deployment plan/ }));
  fireEvent.click(screen.getByRole("button", { name: "Review plan" }));
  expect(
    screen.getByRole("button", { name: "Deploy · not available yet" }),
  ).toBeDisabled();
  expect(screen.getByRole("dialog")).toHaveTextContent(
    "Final service contracts are pending.",
  );
});
it("allows editing connection overlays with cancel and save; automatic mode clears overrides", async () => {
  mock();
  await open();
  fireEvent.click(
    screen.getByRole("button", { name: "Edit broker connection" }),
  );
  fireEvent.change(screen.getByLabelText("Connection"), {
    target: { value: "manual" },
  });
  fireEvent.change(screen.getByLabelText("Host or IP"), {
    target: { value: "broker.example" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
  fireEvent.click(
    screen.getByRole("button", { name: "Edit broker connection" }),
  );
  expect(screen.getByLabelText("Connection")).toHaveValue("automatic");
  fireEvent.change(screen.getByLabelText("Connection"), {
    target: { value: "manual" },
  });
  fireEvent.change(screen.getByLabelText("Host or IP"), {
    target: { value: "broker.example" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Update draft" }));
  fireEvent.click(
    screen.getByRole("button", { name: "Edit broker connection" }),
  );
  expect(screen.getByLabelText("Host or IP")).toHaveValue("broker.example");
  fireEvent.change(screen.getByLabelText("Connection"), {
    target: { value: "automatic" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Update draft" }));
  expect(
    screen.getByRole("button", { name: "Edit broker connection" }),
  ).not.toHaveTextContent("edited");
});
it("moves a service by dragging into a house, without saving or launching it", async () => {
  const fetcher = mock();
  vi.stubGlobal("PointerEvent", MouseEvent);
  await open();
  const host = screen.getByRole("region", { name: "Raspberry · Leça" });
  vi.spyOn(host, "getBoundingClientRect").mockReturnValue({
    left: 500,
    right: 1000,
    top: 0,
    bottom: 600,
  } as DOMRect);
  const node = screen.getByRole("button", { name: /Inference · Draft/ });
  fireEvent.pointerDown(node, { button: 0, clientX: 100, clientY: 100 });
  fireEvent.pointerMove(node, { clientX: 700, clientY: 200 });
  fireEvent.pointerUp(node, { clientX: 700, clientY: 200 });
  expect(screen.getByText("Unsaved changes")).toBeInTheDocument();
  expect(fetcher.mock.calls.every(([, o]) => !o?.method)).toBe(true);
  fireEvent.click(screen.getByRole("button", { name: "Review plan" }));
  expect(
    within(screen.getByRole("dialog")).getAllByText("Raspberry · Leça"),
  ).toHaveLength(2);
});
it("checks only on request and retains the last observation with its timestamp", async () => {
  const fetcher = mock({
    ...data,
    destinations: [
      {
        ...data.destinations[0],
        check: {
          state: "online",
          checked_at: "2020-01-01T00:00:00Z",
          architecture: "x86_64",
          message:
            "Docker responds. Application connections are checked separately.",
        },
      },
      data.destinations[1],
    ],
  });
  await open();
  const online = screen.getByText("Online");
  expect(online).toBeInTheDocument();
  const header = online.closest("header")!;
  expect(header).toHaveTextContent("Last checked");
  expect(header.querySelector("time")).toHaveAttribute(
    "dateTime",
    "2020-01-01T00:00:00Z",
  );
  expect(header).toHaveTextContent("x86_64");
  expect(
    screen.queryByText(
      "Docker responds. Application connections are checked separately.",
    ),
  ).not.toBeInTheDocument();
  expect(screen.queryByText("Check expired")).not.toBeInTheDocument();
  expect(fetcher.mock.calls.every(([, o]) => !o?.method)).toBe(true);
  fetcher.mockImplementationOnce(
    async () =>
      new Response(JSON.stringify({ detail: "Machine check unavailable" }), {
        status: 503,
      }),
  );
  fireEvent.click(screen.getByRole("button", { name: "Check machines" }));
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Machine check unavailable",
  );
  expect(fetcher.mock.calls[2][0]).toContain("/sites/house/deployment-check");
});
it("preserves edits when a save fails", async () => {
  const fetcher = mock();
  await open();
  fireEvent.click(screen.getByRole("button", { name: /Inference · Draft/ }));
  fireEvent.change(screen.getByLabelText("Destination"), {
    target: { value: "local" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Done" }));
  fetcher.mockImplementationOnce(
    async () =>
      new Response(
        JSON.stringify({ detail: "Another editor saved this draft" }),
        { status: 409 },
      ),
  );
  fireEvent.click(screen.getByRole("button", { name: "Save draft" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Another editor");
  expect(screen.getByText("Unsaved changes")).toBeInTheDocument();
});
it("ignores late responses after changing houses", async () => {
  const pending: ((r: Response) => void)[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn((url: string) =>
      url.includes("/old/")
        ? new Promise<Response>((r) => pending.push(r))
        : Promise.resolve(
            new Response(
              JSON.stringify(
                url.endsWith("deployment-draft")
                  ? {
                      ...initial,
                      services: {
                        percepta: "cloud",
                        controller: "cloud",
                        forecasting: "cloud",
                      },
                    }
                  : { ...data, destinations: [data.destinations[0]] },
              ),
            ),
          ),
    ),
  );
  const { rerender } = render(
    <DeploymentWorkspace siteId="old" siteName="Old" navigate={() => {}} />,
  );
  rerender(
    <DeploymentWorkspace siteId="new" siteName="New" navigate={() => {}} />,
  );
  await screen.findByRole("heading", { name: "SoftCPS server" });
  pending[0](new Response(JSON.stringify(data)));
  pending[1](new Response(JSON.stringify(initial)));
  await waitFor(() =>
    expect(
      screen.queryByRole("heading", { name: "Raspberry · Leça" }),
    ).not.toBeInTheDocument(),
  );
});
it("keeps all internal connection paths inside their host for all service placement combinations", () => {
  for (let mask = 0; mask < 8; mask++) {
    const placements = Object.fromEntries(
      services.map((s, i) => [s, mask & (1 << i) ? "local" : "cloud"]),
    ) as Record<(typeof services)[number], Placement>;
    const layout = graphLayout(
      data,
      { ...initial, services: placements },
      true,
    );
    expect(layout.width).toBeLessThanOrEqual(936);
    expect(layout.edges.map((e) => e.id)).toEqual([
      "inference",
      "forecasting",
      "broker",
      "mongo",
    ]);
    for (const host of layout.hosts) {
      const members = layout.nodes.filter(
        (n) => n.destination === host.destination.id,
      );
      for (const node of members) {
        expect(node.x).toBeGreaterThan(host.x);
        expect(node.x + node.width).toBeLessThan(host.x + host.width);
        expect(node.y).toBeGreaterThanOrEqual(host.y + 112);
        expect(node.y + node.height).toBeLessThan(host.y + host.height - 20);
        for (const other of members.filter((n) => n !== node)) {
          expect(
            node.x + node.width <= other.x ||
              other.x + other.width <= node.x ||
              node.y + node.height <= other.y ||
              other.y + other.height <= node.y,
          ).toBe(true);
        }
      }
      // Single-column cards have equal space on their left and right.
      if (new Set(members.map((n) => n.x + n.width / 2)).size === 1) {
        expect(members[0].x + members[0].width / 2).toBe(
          host.x + host.width / 2,
        );
      }
    }
    for (const edge of layout.edges.filter((e) => !e.internal)) {
      const [left, right] = layout.hosts;
      expect(edge.x).toBe((left.x + left.width + right.x) / 2);
      // Connection text has its own corridor, clear of both machines.
      expect(edge.x - 60).toBeGreaterThan(left.x + left.width);
      expect(edge.x + 60).toBeLessThan(right.x);
    }
    for (const edge of layout.edges.filter((e) => e.internal)) {
      const source = layout.nodes.find((n) => n.kind === "percepta")!,
        host = layout.hosts.find(
          (h) => h.destination.id === source.destination,
        )!;
      const tokens = edge.path.split(" ");
      let axis = "";
      for (let i = 0; i < tokens.length; i++) {
        if (["M", "H", "V"].includes(tokens[i])) {
          axis = tokens[i];
          continue;
        }
        const n = Number(tokens[i]);
        const horizontal = axis === "H" || axis === "M";
        expect(n).toBeGreaterThanOrEqual(horizontal ? host.x : host.y);
        expect(n).toBeLessThanOrEqual(
          horizontal ? host.x + host.width : host.y + host.height,
        );
        if (axis === "M") axis = "V";
      }
    }
  }
  const operation = graphLayout(data, initial, false);
  expect(operation.edges).toHaveLength(0);
  expect(operation.nodes.map((n) => n.kind)).toEqual(["backend"]);
});
