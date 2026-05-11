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
          onClick={onClose}
        >
          {/* Flex row — main modal + optional adjacent panel, centered as a unit */}
          <div className="modal-pair-wrapper">
            <motion.div
              className={`modal modal-${width}`}
              initial={{ opacity: 0, y: 10, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 8, scale: 0.99 }}
              transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
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

            {/* Adjacent side panel — glides in/out independently */}
            <AnimatePresence>
              {adjacentPanel ? (
                <motion.div
                  className="modal-side-panel"
                  initial={{ opacity: 0, x: 28 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: 24 }}
                  transition={{
                    enter: { type: "spring", stiffness: 160, damping: 26 },
                    exit:  { duration: 0.16, ease: "easeIn" },
                    default: { type: "spring", stiffness: 160, damping: 26 },
                  }}
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
