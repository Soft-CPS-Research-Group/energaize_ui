import { useEffect, useRef, useState } from "react";

/**
 * Smoothly animates a numeric value from its previous value to `target`
 * whenever `target` changes. Returns the current display value.
 *
 * @param target   The new target value (can be null = no data yet)
 * @param duration Animation duration in ms (default 600)
 */
export function useCountUp(target: number | null, duration = 600): number | null {
  // displayRef tracks the current rendered value so animations start from
  // wherever the number currently sits (not the last *target*).
  const displayRef = useRef<number | null>(null);
  const [display, setDisplayState] = useState<number | null>(null);
  const frameRef = useRef<number>(0);

  const setDisplay = (v: number | null) => {
    displayRef.current = v;
    setDisplayState(v);
  };

  useEffect(() => {
    if (target == null) {
      cancelAnimationFrame(frameRef.current);
      setDisplay(null);
      return;
    }

    // Animate from current displayed value (or 0 on first load)
    const start = displayRef.current ?? 0;
    const delta = target - start;

    if (Math.abs(delta) < Number.EPSILON) {
      setDisplay(target);
      return;
    }

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
      }
    }

    cancelAnimationFrame(frameRef.current);
    frameRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frameRef.current);
  }, [target, duration]);

  return display;
}
