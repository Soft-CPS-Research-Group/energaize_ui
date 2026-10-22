import type { ReactNode } from "react";
import { Button } from "./Button";
import { Modal } from "./Modal";

interface Props {
  open: boolean;
  title: string;
  message: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  confirmVariant?: "primary" | "secondary" | "danger";
  pending?: boolean;
  onCancel: () => void;
  onConfirm: () => void;
  overlayClassName?: string;
}

export function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  confirmVariant = "danger",
  pending = false,
  onCancel,
  onConfirm,
  overlayClassName
}: Props): JSX.Element {
  return (
    <Modal title={title} open={open} onClose={onCancel} width="sm" overlayClassName={overlayClassName}>
      <section className="confirm-dialog">
        <div>{message}</div>
        <div className="inline-end">
          <Button variant="secondary" onClick={onCancel} disabled={pending}>
            {cancelLabel}
          </Button>
          <Button variant={confirmVariant} onClick={onConfirm} disabled={pending}>
            {pending ? "Please wait..." : confirmLabel}
          </Button>
        </div>
      </section>
    </Modal>
  );
}
