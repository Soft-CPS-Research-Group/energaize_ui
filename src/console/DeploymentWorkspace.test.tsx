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
  placements,
  services,
  type DeploymentMap,
  type Draft,
  type Placement,
} from "./deploymentModel";
import { receivedForecasts, recent } from "./DeploymentFlow";
vi.mock("./PerceptaSetup", () => ({
  PerceptaSetup: () => <p>Configure collection inputs</p>,
}));
vi.mock("./PerceptaMessages", () => ({
  PerceptaMessages: () => <p>House messages</p>,
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

function setup(map = data, draft = initial, fail = false) {
  const calls = vi.fn(async (url: string, init?: RequestInit) => {
    const path = new URL(url, "http://localhost").pathname;
    const empty = {
      site_id: "house",
      messages: [],
      checked_at: new Date().toISOString(),
      available: false,
      lanes: [],
      ev_chargers: [],
      points: [],
    };
    if (path === "/access-api/api/health" || path === "/ai-training-api/health")
      return Response.json({ status: "ok" });
    if (path.endsWith("/deployment-draft") && init?.method === "PUT") {
      if (fail)
        return new Response(
          JSON.stringify({ detail: "Another editor saved this draft" }),
          { status: 409 },
        );
      draft = {
        ...draft,
        ...JSON.parse(String(init.body)),
        revision: "updated",
      };
      return Response.json(draft);
    }
    return Response.json(
      path.endsWith("/deployment-view") || path.endsWith("/deployment-check")
        ? map
        : path.endsWith("/deployment-draft")
          ? draft
          : empty,
    );
  });
  vi.stubGlobal("fetch", calls);
  render(
    <DeploymentWorkspace
      siteId="house"
      siteName="RH01"
      communityName="LivingLab"
      navigate={() => {}}
    />,
  );
  return calls;
}
it("shows one map including all house services, and does not write on entry", async () => {
  const calls = setup();
  const host = await screen.findByRole("region", { name: "Raspberry · Leça" });
  for (const kind of ["Percepta", "Inference", "Fail-safe supervisor"])
    expect(
      within(host).getByRole("button", { name: new RegExp("^" + kind + " ·") }),
    ).toBeVisible();
  expect(screen.queryByText("Live services")).not.toBeInTheDocument();
  expect(screen.queryByText("Check machines")).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: /^Community ·/ }));
  expect(screen.getByRole("dialog")).toHaveTextContent("LivingLab");
  expect(calls.mock.calls.every(([, init]) => !init?.method)).toBe(true);
});
it("preserves saved placements and puts all services on a cloud-only site", () => {
  expect(placements(data, { ...initial, revision: "old" })).toEqual(
    initial.services,
  );
  const cloudOnly = { ...data, destinations: [data.destinations[0]] };
  expect(
    new Set(
      graphLayout(cloudOnly, { ...initial, revision: "old" }).nodes.map(
        (n) => n.destination,
      ),
    ),
  ).toEqual(new Set(["cloud"]));
});
it("keeps observed instances and distinguishes a pending move from a running service", () => {
  const c = {
    ...data.components[0],
    planned: false,
    state: "running",
    destination_id: "cloud",
  };
  const map = { ...data, components: [c] };
  expect(placements(map, initial).percepta).toBe("cloud");
  const node = graphLayout(map, { ...initial, revision: "saved" }).nodes.find(
    (n) => n.kind === "percepta",
  );
  expect(node).toMatchObject({
    destination: "pi",
    state: "Move pending",
    component: c,
  });
});
it("saves a move with automatic connections and the current revisions", async () => {
  const calls = setup();
  const card = await screen.findByRole("button", { name: /^Forecasting ·/ });
  fireEvent.keyDown(card, { key: "F10", shiftKey: true });
  fireEvent.change(screen.getByLabelText("Machine"), {
    target: { value: "local" },
  });
  await waitFor(() =>
    expect(
      within(
        screen.getByRole("region", { name: "Raspberry · Leça" }),
      ).getByRole("button", { name: /^Forecasting ·/ }),
    ).toBeVisible(),
  );
  const put = calls.mock.calls.find(([, init]) => init?.method === "PUT")!;
  expect(JSON.parse(String(put[1]?.body))).toMatchObject({
    included_services: services,
    services: { forecasting: "local" },
    connections: {},
    base_revision: "r1",
    expected_revision: null,
  });
});
it("keeps the prior topology on a revision conflict", async () => {
  setup(data, initial, true);
  const card = await screen.findByRole("button", { name: /^Forecasting ·/ });
  fireEvent.contextMenu(card);
  fireEvent.change(screen.getByLabelText("Machine"), {
    target: { value: "local" },
  });
  expect(await screen.findByRole("alert")).toHaveTextContent("Another editor");
  expect(
    within(screen.getByRole("region", { name: "SoftCPS server" })).getByRole(
      "button",
      { name: /^Forecasting ·/ },
    ),
  ).toBeVisible();
});
it("only checks the machine whose refresh button was pressed", async () => {
  const calls = setup();
  fireEvent.click(
    await screen.findByRole("button", { name: "Refresh Raspberry · Leça" }),
  );
  await waitFor(() =>
    expect(
      calls.mock.calls
        .filter(([, init]) => init?.method === "POST")
        .map(([url]) => url),
    ).toEqual([
      "/runtime-api/api/runtime/sites/house/deployment-check?host_id=pi",
    ]),
  );
});
it("exposes model selection, forecast settings and collection setup from the map", async () => {
  setup();
  fireEvent.click(await screen.findByRole("button", { name: /^Inference ·/ }));
  expect(screen.getByLabelText("Algorithm")).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "Close" }));
  fireEvent.click(screen.getByRole("button", { name: /^Forecasting ·/ }));
  expect(
    screen.getByRole("region", { name: "House forecast plan" }),
  ).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "Close" }));
  fireEvent.click(screen.getByRole("button", { name: /^Percepta ·/ }));
  expect(screen.getByText("Configure collection inputs")).toBeVisible();
});
it("opens cycle, forecast, decision and archive evidence without exposing an address editor", async () => {
  setup();
  await screen.findByRole("heading", { name: "Deployment" });
  for (const [label, empty] of [
    [
      /Inference → Percepta/,
      "No recorded inference response in the latest cycles.",
    ],
    [/RabbitMQ → Percepta/, "No received forecasts in the latest cycles."],
    [/Telemetry → MongoDB/, "No recorded cycles for this house."],
  ] as const) {
    fireEvent.click(await screen.findByRole("button", { name: label }));
    expect(await screen.findByText(empty)).toBeVisible();
    expect(screen.queryByLabelText("Host or IP")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
  }
});
it("draws the telemetry archive only when it is the writer and preserves service placements", () => {
  for (let mask = 0; mask < 8; mask++) {
    const assigned = Object.fromEntries(
      services.map((s, i) => [s, mask & (1 << i) ? "local" : "cloud"]),
    ) as Record<(typeof services)[number], Placement>;
    for (const owner of ["runtime", "telemetry"]) {
      const layout = graphLayout(
        data,
        { ...initial, revision: "saved", services: assigned },
        owner,
      );
      expect(layout.edges.find((e) => e.id === "archive")?.target).toBe(
        owner === "telemetry" ? owner : undefined,
      );
      expect(layout.edges.find((e) => e.id === "write")?.source).toBe(
        owner === "telemetry" ? owner : undefined,
      );
      expect(
        layout.nodes.find((n) => n.kind === "supervisor")?.destination,
      ).toBe(layout.nodes.find((n) => n.kind === "percepta")?.destination);
      for (const node of layout.nodes) {
        const h = layout.hosts.find(
          (h) => h.destination.id === node.destination,
        )!;
        expect(node.x).toBeGreaterThan(h.x);
        expect(node.y + node.height).toBeLessThan(h.y + h.height);
      }
    }
  }
});
it("rejects stale evidence and generated forecasts", () => {
  const now = Date.now();
  const message = {
    id: "cycle",
    timestamp: new Date(now - 100000).toISOString(),
    truncated: false,
    payload: {
      entities: {
        forecast: {
          entity_type_id: "forecast_service",
          parameters: {
            solar: {
              generated: true,
              final_values: [{ value: 0, period_start: "a", period_end: "b" }],
            },
          },
        },
      },
    },
  };
  expect(recent(message, 15, now)).toBe(false);
  expect(receivedForecasts(message)).toEqual([]);
  message.payload.entities.forecast.parameters.solar.generated = false;
  expect(receivedForecasts(message)[0].intervals[0].value).toBe(0);
});

it("uses the available width and keeps the complete backend group inside the server", () => {
  const map = { ...data, destinations: [data.destinations[0]] };
  for (const width of [600, 960, 1440]) {
    const layout = graphLayout(map, initial, "telemetry", width);
    expect(layout.width).toBe(width);
    expect(layout.hosts[0].width).toBeGreaterThan(width - 10);
    const group = layout.group!;
    for (const kind of [
      "access",
      "community",
      "runtime",
      "telemetry",
      "flexibility",
      "training",
    ]) {
      const node = layout.nodes.find((n) => n.kind === kind)!;
      expect(node.x).toBeGreaterThan(group.x);
      expect(node.y + node.height).toBeLessThan(group.y + group.height);
    }
    expect(
      layout.edges
        .filter((e) => e.step)
        .map((e) => [e.step, e.source, e.target]),
    ).toEqual([
      [1, "sensors", "percepta"],
      [1, "broker", "percepta"],
      [2, "percepta", "controller"],
      [3, "controller", "percepta"],
      [4, "percepta", "supervisor"],
      [5, "supervisor", "percepta"],
      [6, "percepta", "actuators"],
    ]);
    expect(
      layout.terminals.every((t) => t.y + t.height < layout.hosts[0].y),
    ).toBe(true);
    expect(layout.edges.filter((e) => e.planned).map((e) => e.step)).toEqual([
      4, 5, 6,
    ]);
    expect(layout.nodes.find((n) => n.kind === "kpi")).toBeUndefined();
    expect(
      layout.edges.some((e) =>
        [e.source, e.target].some((k) =>
          ["access", "runtime", "training"].includes(k),
        ),
      ),
    ).toBe(false);
  }
});

it("uses platform health for the compact services and keeps unverified dispatch explicit", async () => {
  setup();
  const training = await screen.findByRole("button", {
    name: /^AI Training ·/,
  });
  await waitFor(() =>
    expect(training).toHaveAttribute("title", "Service available"),
  );
  expect(
    screen.getByRole("button", { name: /^Access Control ·/ }),
  ).toHaveAttribute("data-active", "true");
  fireEvent.click(screen.getByRole("button", { name: /Percepta → Actuators/ }));
  expect(screen.getByText(/No device dispatch is confirmed/)).toBeVisible();
});

it("previews the control sequence for a house without inference and sends no operations", async()=>{
  const calls=setup();
  fireEvent.click(await screen.findByRole("button",{name:/Inference → Percepta/}));
  fireEvent.click(await screen.findByRole("button",{name:"Preview example"}));
  const preview=screen.getByRole("region",{name:"Simulated control cycle"});
  for(const name of ["2 · Cycle","3 · Proposal","4 · Review","5 · Verdict","6 · Command"]){
    fireEvent.click(within(preview).getByRole("button",{name}));
    expect(within(preview).getByRole("button",{name})).toHaveAttribute("aria-current","step");
  }
  expect(within(preview).getByText("Simulated only")).toBeVisible();
  expect(calls.mock.calls.filter(([,init])=>init?.method && init.method!=="GET")).toHaveLength(0);
});
