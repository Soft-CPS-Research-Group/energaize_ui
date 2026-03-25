import { useEffect, useRef } from "react";
import type { JobItem } from "../types";
import { prettyJobStatus } from "../utils/jobStatus";
import { useUI } from "../contexts/UIContext";

export function useJobStatusNotifications(jobs: JobItem[] | undefined): void {
  const previousRef = useRef<Record<string, string>>({});
  const { pushNotification } = useUI();

  useEffect(() => {
    if (!jobs || jobs.length === 0) return;

    const previous = previousRef.current;

    jobs.forEach((job) => {
      const current = job.status;
      const prior = previous[job.job_id];

      if (prior && prior !== current) {
        const isImportant = ["finished", "failed", "stopped", "canceled"].includes(current);
        if (isImportant) {
          pushNotification({
            title: `Job ${job.job_id.slice(0, 8)} status changed`,
            message: `${prior} -> ${prettyJobStatus(current)}`,
            severity: current === "failed" ? "error" : "info",
            source: "jobs"
          });
        }
      }

      previous[job.job_id] = current;
    });
  }, [jobs, pushNotification]);
}
