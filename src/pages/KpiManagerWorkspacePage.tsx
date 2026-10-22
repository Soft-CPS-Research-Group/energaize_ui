import { Outlet } from "react-router-dom";

export function KpiManagerWorkspacePage(): JSX.Element {
  return (
    <div className="kpi-workspace">
      <div className="kpi-workspace-content">
        <Outlet />
      </div>
    </div>
  );
}
