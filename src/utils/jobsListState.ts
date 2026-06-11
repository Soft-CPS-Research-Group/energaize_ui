export interface JobsListState {
  q: string;
  status: string;
  host: string;
  submitted: string;
}

interface JobsListStateOptions {
  defaultSubmitted?: string | null;
}

const DEFAULT_STATE: JobsListState = {
  q: "",
  status: "all",
  host: "all",
  submitted: "all"
};

export function buildJobsListStateFromSearchParams(
  searchParams: URLSearchParams,
  options: JobsListStateOptions = {}
): JobsListState {
  const q = searchParams.get("q") || "";
  const status = searchParams.get("status") || "all";
  const host = searchParams.get("host") || "all";
  const defaultSubmitted = options.defaultSubmitted?.trim() || DEFAULT_STATE.submitted;
  const submitted = searchParams.get("submitted") || defaultSubmitted;

  return {
    q,
    status,
    host,
    submitted
  };
}

export function toJobsListSearchParams(
  state: JobsListState,
  options: JobsListStateOptions = {}
): URLSearchParams {
  const params = new URLSearchParams();
  const defaultSubmitted = options.defaultSubmitted?.trim() || DEFAULT_STATE.submitted;

  if (state.q.trim()) params.set("q", state.q.trim());
  if (state.status !== DEFAULT_STATE.status) params.set("status", state.status);
  if (state.host !== DEFAULT_STATE.host) params.set("host", state.host);
  if (state.submitted !== defaultSubmitted) params.set("submitted", state.submitted);

  return params;
}
