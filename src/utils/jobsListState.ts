export interface JobsListState {
  q: string;
  status: string;
  host: string;
  submitted: string;
}

const DEFAULT_STATE: JobsListState = {
  q: "",
  status: "all",
  host: "all",
  submitted: "all"
};

export function buildJobsListStateFromSearchParams(searchParams: URLSearchParams): JobsListState {
  const q = searchParams.get("q") || "";
  const status = searchParams.get("status") || "all";
  const host = searchParams.get("host") || "all";
  const submitted = searchParams.get("submitted") || "all";

  return {
    q,
    status,
    host,
    submitted
  };
}

export function toJobsListSearchParams(state: JobsListState): URLSearchParams {
  const params = new URLSearchParams();

  if (state.q.trim()) params.set("q", state.q.trim());
  if (state.status !== DEFAULT_STATE.status) params.set("status", state.status);
  if (state.host !== DEFAULT_STATE.host) params.set("host", state.host);
  if (state.submitted !== DEFAULT_STATE.submitted) params.set("submitted", state.submitted);

  return params;
}
