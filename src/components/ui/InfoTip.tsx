import { useRef, useState } from "react";
import { createPortal } from "react-dom";

const GAP = 8;

/**
 * A "?" badge that explains a label on hover or keyboard focus. The popup is portalled
 * to <body> so it is not clipped by scrolling tables or panels.
 */
export function InfoTip({ tip, width = 260 }: { tip: string; width?: number }): JSX.Element {
  const [pos, setPos] = useState<{ left: number; bottom: number } | null>(null);
  const ref = useRef<HTMLSpanElement>(null);

  const show = () => {
    if (!ref.current) return;
    const rect = ref.current.getBoundingClientRect();
    const left = Math.max(8, Math.min(rect.left + rect.width / 2 - width / 2, window.innerWidth - width - 8));
    setPos({ left, bottom: window.innerHeight - rect.top + GAP });
  };
  const hide = () => setPos(null);

  return (
    <>
      <span
        ref={ref}
        className="analysis-infotip"
        tabIndex={0}
        role="img"
        aria-label={tip}
        onMouseEnter={show}
        onMouseLeave={hide}
        onFocus={show}
        onBlur={hide}
      >?</span>
      {pos && createPortal(
        <div
          className="analysis-infotip-popup"
          role="tooltip"
          style={{ position: "fixed", left: pos.left, bottom: pos.bottom, width, pointerEvents: "none" }}
        >{tip}</div>,
        document.body,
      )}
    </>
  );
}
