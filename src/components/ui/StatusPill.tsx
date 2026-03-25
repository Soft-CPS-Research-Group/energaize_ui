import type { JobStatus } from "../../types";
import { jobStatusTone } from "../../utils/jobStatus";
import { Badge } from "./Badge";

export function StatusPill({ status }: { status: JobStatus }): JSX.Element {
  const tone = jobStatusTone(status);
  const badgeTone =
    tone === "error" ? "danger" : tone === "warning" ? "warning" : tone === "success" ? "success" : "info";

  return <Badge tone={badgeTone}>{status || "unknown"}</Badge>;
}
