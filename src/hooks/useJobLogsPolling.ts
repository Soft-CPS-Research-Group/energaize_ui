import { useEffect, useRef, useState } from "react";
import { getJobFileLogs, getJobLogsChunk } from "../api/trainingApi";

const DEFAULT_TAIL_LINES = 200;
const DEFAULT_MAX_BYTES = 256 * 1024;
const DEFAULT_MAX_CHARS = 2_000_000;

type UseJobLogsPollingOptions = {
  enabled: boolean;
  pollMs: number;
  tailLines?: number;
  maxBytes?: number;
  maxChars?: number;
};

type UseJobLogsPollingState = {
  text: string;
  loading: boolean;
  fetching: boolean;
  error: Error | null;
  available: boolean;
  message: string | null;
  reset: () => void;
};

export function useJobLogsPolling(jobId: string, options: UseJobLogsPollingOptions): UseJobLogsPollingState {
  const { enabled, pollMs, tailLines = DEFAULT_TAIL_LINES, maxBytes = DEFAULT_MAX_BYTES, maxChars = DEFAULT_MAX_CHARS } =
    options;

  const [text, setText] = useState("");
  const [loading, setLoading] = useState(false);
  const [fetching, setFetching] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const [available, setAvailable] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const offsetRef = useRef<number | null>(null);
  const inFlightRef = useRef(false);
  const mountedRef = useRef(false);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  function reset(): void {
    offsetRef.current = null;
    inFlightRef.current = false;
    if (!mountedRef.current) return;
    setText("");
    setLoading(false);
    setFetching(false);
    setError(null);
    setAvailable(false);
    setMessage(null);
  }

  useEffect(() => {
    if (!enabled || !jobId) {
      reset();
      return;
    }

    reset();
    let cancelled = false;

    const pollOnce = async (): Promise<void> => {
      if (cancelled || inFlightRef.current) return;
      inFlightRef.current = true;
      const isInitial = offsetRef.current === null;
      if (isInitial) setLoading(true);
      setFetching(true);
      try {
        const payload = await getJobLogsChunk(jobId, {
          offset: offsetRef.current === null ? undefined : offsetRef.current,
          tailLines,
          maxBytes
        });
        let textPayload = payload.text || "";
        let nextOffset = payload.next_offset;

        // Fallback: some environments may return an empty first chunk even when
        // file logs already exist. Pull full file once so the modal is not blank.
        if (isInitial && textPayload.trim().length === 0) {
          try {
            const fullLogs = await getJobFileLogs(jobId);
            if (fullLogs.trim().length > 0) {
              textPayload = fullLogs;
              const encodedLen = new TextEncoder().encode(fullLogs).length;
              if (!Number.isFinite(nextOffset) || nextOffset < encodedLen) {
                nextOffset = encodedLen;
              }
            }
          } catch {
            // Keep original chunk payload behavior on fallback failure.
          }
        }

        if (cancelled || !mountedRef.current) return;
        setError(null);
        setAvailable(Boolean(payload.available) || textPayload.trim().length > 0);
        setMessage(textPayload.trim().length > 0 ? null : typeof payload.message === "string" ? payload.message : null);
        if (isInitial) {
          setText(textPayload);
        } else if (textPayload) {
          setText((previous) => {
            const merged = `${previous}${textPayload}`;
            if (merged.length <= maxChars) return merged;
            return merged.slice(merged.length - maxChars);
          });
        }
        offsetRef.current = Number.isFinite(nextOffset) ? nextOffset : payload.next_offset;
      } catch (err) {
        if (cancelled || !mountedRef.current) return;
        const nextError = err instanceof Error ? err : new Error("Could not load logs.");
        setError(nextError);
      } finally {
        inFlightRef.current = false;
        if (!cancelled && mountedRef.current) {
          setLoading(false);
          setFetching(false);
        }
      }
    };

    void pollOnce();
    const timer = window.setInterval(() => {
      void pollOnce();
    }, Math.max(1000, pollMs));

    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [enabled, jobId, pollMs, tailLines, maxBytes, maxChars]);

  return { text, loading, fetching, error, available, message, reset };
}
