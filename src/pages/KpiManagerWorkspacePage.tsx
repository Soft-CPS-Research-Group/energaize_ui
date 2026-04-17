import { Outlet } from "react-router-dom";

export function KpiManagerWorkspacePage(): JSX.Element {
  return (
    <div style={{ height: "100%", display: "flex", flexDirection: "column" }}>
      <div style={{ flex: 1, overflow: "auto", position: "relative" }}>
        <Outlet />
      </div>
    </div>
  );
}
