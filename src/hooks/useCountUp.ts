import { useEffect, useRef, useState } from "react";

export type CountUpDir = "up" | "down" | "idle";

export interface CountUpResult {
  /** Attach to the <span> that should display the animated number. */
  ref: React.RefObject<HTMLSpanElement>;
  /** "up" or "down" while animating, "idle" when at rest. */
  dir: CountUpDir;
}

/**
 * Smoothly animates a number to `target` at 60 fps by writing directly to
 * a DOM ref — bypassing React's render cycle so every frame is truly smooth.
 *
 * @param target   New target value (null → show "—")
 * @param format   How to stringify the interpolated value
 * @param duration Animation duration in ms (default 1500)
 */
export function useCountUp(
  target: number | null,
  format: (v: number) => string,
  duration = 1500,
): CountUpResult {
  const spanRef = useRef<HTMLSpanElement>(null);
  const [dir, setDir] = useState<CountUpDir>("idle");

  // Stable refs — avoid closing over stale values in rAF callbacks
  const currentValRef = useRef<number | null>(null);
  const frameRef      = useRef<number>(0);
  const formatRef     = useRef(format);
  useEffect(() => { formatRef.current = format; });

  useEffect(() => {
    cancelAnimationFrame(frameRef.current);

    if (target == null) {
      currentValRef.current = null;
      setDir("idle");
      if (spanRef.current) spanRef.current.textContent = "—";
      return;
    }

    const start = currentValRef.current ?? 0;
    const delta = target - start;

    // Already there — just make sure the text is correct
    if (Math.abs(delta) < 1e-10) {
      currentValRef.current = target;
      if (spanRef.current) spanRef.current.textContent = formatRef.current(target);
      return;
    }

    setDir(delta > 0 ? "up" : "down");

    const t0 = performance.now();

    function tick(now: number) {
      const elapsed = now - t0;
      const t = Math.min(elapsed / duration, 1);
      // Symmetric ease-in-out cubic (smoothstep cubic)
      const eased = t < 0.5
        ? 4 * t * t * t
        : 1 - Math.pow(-2 * t + 2, 3) / 2;

      const v = start + delta * eased;
      currentValRef.current = v;
      if (spanRef.current) spanRef.current.textContent = formatRef.current(v);

      if (t < 1) {
        frameRef.current = requestAnimationFrame(tick);
      } else {
        currentValRef.current = target;
        if (spanRef.current) spanRef.current.textContent = formatRef.current(target!);
        setDir("idle");
      }
    }

    frameRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frameRef.current);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target, duration]);

  return { ref: spanRef, dir };
}
