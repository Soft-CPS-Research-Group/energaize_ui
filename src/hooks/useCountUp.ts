import { useEffect, useRef, useState } from "react";

/**
 * Smoothly animates a numeric value from its previous value to `target`
 * whenever `target` changes. Returns the current display value.
 *
 * @param target   The new target value (can be null = no data yet)
 * @param duration Animation duration in ms (default 600)
 */
export function useCountUp(target: number | null, duration = 600): number | null {
  const [display, setDisplay] = useState<number | null>(target);
  const prevRef  = useRef<number | null>(target);
  const frameRef = useRef<number>(0);

  useEffect(() => {
    if (target == null) { setDisplay(null); prevRef.current = null; return; }

    const start = prevRef.current ?? target;
    const delta = target - start;
    if (delta === 0) return;

    const startTime = performance.now();

    function tick(now: number) {
      const elapsed = now - startTime;
      const t = Math.min(elapsed / duration, 1);
      // ease-out cubic
      const eased = 1 - Math.pow(1 - t, 3);
      setDisplay(start + delta * eased);
      if (t < 1) {
        frameRef.current = requestAnimationFrame(tick);
      } else {
        setDisplay(target);
        prevRef.current = target;
      }
    }

    cancelAnimationFrame(frameRef.current);
    frameRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frameRef.current);
  }, [target, duration]);

  return display;
}
