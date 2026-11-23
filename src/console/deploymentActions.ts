import {
  runtimeRequest,
  runtimeRequestId,
  type RuntimeHost,
  type RuntimeInstance,
  type RuntimeOperation,
  type RuntimeSnapshot,
} from "../api/runtimeApi";
import { type Component, type Draft } from "./deploymentModel";

async function waitOperation(op: RuntimeOperation) {
  for (
    let attempt = 0;
    ["pending", "running"].includes(op.status) && attempt < 120;
    attempt++
  ) {
    await new Promise((resolve) => setTimeout(resolve, 1000));
    op = await runtimeRequest<RuntimeOperation>(
      "/api/runtime/operations/" + op.id,
    );
  }
  if (op.status !== "succeeded")
    throw Error(
      op.error ||
        "The operation is still unconfirmed. Check the service before retrying.",
    );
}
export async function bindModel(site: string, draft: Draft, model: string) {
  const base = `/api/runtime/sites/${site}`;
  const body = { draft_revision: draft.revision, model_id: model };
  const instance = await runtimeRequest<RuntimeInstance>(
    base + "/inference-instance",
    { method: "POST", body: JSON.stringify(body) },
  );
  if (instance.active_operation || instance.observed_state !== "running") {
    const op = instance.active_operation
      ? await runtimeRequest<RuntimeOperation>(
          "/api/runtime/operations/" + instance.active_operation,
        )
      : await runtimeRequest<RuntimeOperation>(
          "/api/runtime/instances/" + instance.id + "/operations",
          {
            method: "POST",
            body: JSON.stringify({
              request_id: runtimeRequestId(),
              action: ["created", "exited"].includes(instance.observed_state)
                ? "start"
                : "deploy",
            }),
          },
        );
    await waitOperation(op);
  }
  return runtimeRequest<Draft>(base + "/inference-binding", {
    method: "PUT",
    signal: AbortSignal.timeout(120000),
    body: JSON.stringify({ ...body, activate_if_needed: true }),
  });
}
export async function applyCollector(
  site: string,
  draft: Draft,
  active: Component,
) {
  if (!active.managed || !active.container_id || !active.instance_id)
    throw Error(
      "This collector is externally managed. Its running configuration was preserved.",
    );
  const hosts = await runtimeRequest<RuntimeHost[]>("/api/runtime/hosts");
  const host = hosts.find((h) => h.id === draft.percepta_host_id);
  const image = host?.percepta_collection_image;
  if (!host || !image || !draft.revision)
    throw Error("The destination needs an approved collector image.");
  const base = `/api/runtime/percepta/sites/${site}`;
  const params = new URLSearchParams({
    host_id: host.id,
    image,
    draft_revision: draft.revision,
  });
  const preview = await runtimeRequest<RuntimeSnapshot>(
    base + "/preview?" + params,
    { method: "POST" },
  );
  if (!preview.executable)
    throw Error(
      "Review the house’s collection configuration before applying the route.",
    );
  const result = await runtimeRequest<{ operation: RuntimeOperation }>(
    base + "/launch",
    {
      method: "POST",
      body: JSON.stringify({
        version: preview.version,
        request_id: runtimeRequestId(),
        host_id: host.id,
        image,
        draft_revision: draft.revision,
        replace_instance_id: active.instance_id,
        replace_container_id: active.container_id,
      }),
    },
  );
  await waitOperation(result.operation);
}
