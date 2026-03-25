import { useUI } from "../contexts/UIContext";

export function useApiFeedback() {
  const { pushNotification } = useUI();

  function notifySuccess(title: string, message: string): void {
    pushNotification({ title, message, severity: "success", source: "api" });
  }

  function notifyError(title: string, error: unknown): void {
    const message = error instanceof Error ? error.message : "Unknown error";
    pushNotification({ title, message, severity: "error", source: "api" });
  }

  function notifyInfo(title: string, message: string): void {
    pushNotification({ title, message, severity: "info", source: "api" });
  }

  return { notifySuccess, notifyError, notifyInfo };
}
