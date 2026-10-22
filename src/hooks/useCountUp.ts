import { useLayoutEffect, useRef } from "react";

export interface CountUpOptions {
  /** When this changes (e.g. another house), the new value is shown at once instead of counting. */
  resetKey?: unknown;
  /** Animation duration in ms (default 1500, matching the card flash in CSS). */
  duration?: number;
}

export interface CountUpResult<C extends HTMLElement> {
  /** Attach to the <span> that should display the animated number. */
  ref: React.RefObject<HTMLSpanElement>;
  /** Attach to the card; it gets `kpi--animating-up` or `kpi--animating-down` while counting. */
  cardRef: React.RefObject<C>;
}

const FLASH_CLASSES = ["kpi--animating-up", "kpi--animating-down"];

function prefersReducedMotion(): boolean {
  return typeof window !== "undefined" && !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
}

/**
 * Counts a number to `target` by writing straight to the DOM, so the animation never re-renders
 * the page. The first value, a value after `resetKey` changes and every value under reduced
 * motion are shown at once: only a change of the same series counts and flashes the card.
 *
 * @param target New target value (null → show "—")
 * @param format How to stringify the interpolated value
 */
export function useCountUp<C extends HTMLElement = HTMLDivElement>(
  target: number | null,
  format: (v: number) => string,
  { resetKey, duration = 1500 }: CountUpOptions = {},
): CountUpResult<C> {
  const spanRef = useRef<HTMLSpanElement>(null);
  const cardRef = useRef<C>(null);

  // Stable refs — avoid closing over stale values in rAF callbacks
  const currentValRef = useRef<number | null>(null);
  const resetKeyRef   = useRef(resetKey);
  const frameRef      = useRef<number>(0);
  const formatRef     = useRef(format);
  useLayoutEffect(() => { formatRef.current = format; });

  // Layout effect, so a value that is shown at once never paints the placeholder first.
  useLayoutEffect(() => {
    cancelAnimationFrame(frameRef.current);
    const card = cardRef.current;
    const show = (v: number | null) => {
      if (spanRef.current) spanRef.current.textContent = v == null ? "—" : formatRef.current(v);
    };

    const start = currentValRef.current;
    const reset = resetKeyRef.current !== resetKey;
    resetKeyRef.current = resetKey;

    if (target == null || start == null || reset || prefersReducedMotion()) {
      currentValRef.current = target;
      card?.classList.remove(...FLASH_CLASSES);
      show(target);
      return;
    }

    const delta = target - start;
    // Already there — just make sure the text is correct
    if (Math.abs(delta) < 1e-10) {
      currentValRef.current = target;
      show(target);
      return;
    }

    if (card) {
      // Restart the flash even when the previous change went the same way.
      card.classList.remove(...FLASH_CLASSES);
      void card.offsetWidth;
      card.classList.add(delta > 0 ? FLASH_CLASSES[0] : FLASH_CLASSES[1]);
    }

    const t0 = performance.now();
    function tick(now: number) {
      const t = Math.min((now - t0) / duration, 1);
      // Ease-out cubic — starts fast, decelerates to a smooth stop
      const eased = 1 - Math.pow(1 - t, 3);
      currentValRef.current = t < 1 ? start! + delta * eased : target;
      show(currentValRef.current);
      if (t < 1) {
        frameRef.current = requestAnimationFrame(tick);
      } else {
        card?.classList.remove(...FLASH_CLASSES);
      }
    }

    frameRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frameRef.current);
  }, [target, resetKey, duration]);

  return { ref: spanRef, cardRef };
}
