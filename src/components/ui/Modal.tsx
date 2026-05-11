import { X } from "lucide-react";
import { AnimatePresence, motion } from "framer-motion";
import { createPortal } from "react-dom";
import type { ReactNode } from "react";

interface Props {
  title: string;
  open: boolean;
  onClose: () => void;
  children: ReactNode;
  width?: "sm" | "md" | "lg";
  /** Optional panel that floats to the right of the modal, animating in/out independently. */
  adjacentPanel?: ReactNode;
}

export function Modal({ title, open, onClose, children, width = "md", adjacentPanel }: Props): JSX.Element {
  return createPortal(
    <AnimatePresence>
      {open ? (
        <motion.div
          className="modal-overlay"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.18 }}
          onClick={onClose}
        >
          {/* Wrapper is position:relative — modal stays centered always;
              the side panel hangs off the right side via absolute positioning
              so the main modal NEVER repositions. */}
          <div className="modal-pair-wrapper">
            <motion.div
              className={`modal modal-${width}`}
              initial={{ opacity: 0, y: 14, scale: 0.97 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 10, scale: 0.98 }}
              transition={{
                opacity: { duration: 0.2 },
                y:       { type: "spring", stiffness: 300, damping: 28 },
                scale:   { duration: 0.2, ease: [0.16, 1, 0.3, 1] },
              }}
              onClick={(event) => event.stopPropagation()}
            >
              <header className="modal-head">
                <h3>{title}</h3>
                <button className="icon-btn" type="button" onClick={onClose} aria-label="Close">
                  <X size={16} />
                </button>
              </header>
              <div className="modal-body">{children}</div>
            </motion.div>

            {/* Side panel — absolutely positioned to the right of the modal.
                The modal never moves; the panel slides in/out on its own. */}
            <AnimatePresence>
              {adjacentPanel ? (
                <motion.div
                  className="modal-side-panel"
                  initial={{ opacity: 0, x: 18 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: 18 }}
                  transition={{ type: "spring", stiffness: 220, damping: 30 }}
                  onClick={(e) => e.stopPropagation()}
                >
                  {adjacentPanel}
                </motion.div>
              ) : null}
            </AnimatePresence>
          </div>
        </motion.div>
      ) : null}
    </AnimatePresence>,
    document.body
  );
}
