import { Navigate, Route, Routes } from "react-router-dom";
import { AppShell } from "./components/layout/AppShell";
import { AccountPage } from "./pages/AccountPage";
import { CommunitiesPage } from "./pages/CommunitiesPage";
import { Dashboard } from "./pages/kpi-manager/Dashboard";
import { KpiExplorer } from "./pages/kpi-manager/KpiExplorer";
import { ComparePage } from "./pages/kpi-manager/ComparePage";
import { SchedulerPage } from "./pages/kpi-manager/SchedulerPage";
import { KpiLibraryPage } from "./pages/kpi-manager/KpiLibraryPage";
import { DataProfilingPage } from "./pages/kpi-manager/DataProfilingPage";
import { AggregateReportPage } from "./pages/kpi-manager/AggregateReportPage";
import { CorrelationPage } from "./pages/kpi-manager/CorrelationPage";
import { ThresholdPage } from "./pages/kpi-manager/ThresholdPage";
import { LoginPage } from "./pages/LoginPage";
import { LogsPage } from "./pages/LogsPage";
import { NotificationsPage } from "./pages/NotificationsPage";
import { PredictorWorkspacePage } from "./pages/PredictorWorkspacePage";
import { RoleWorkspacePage } from "./pages/RoleWorkspacePage";
import { CommunityDashboardPage } from "./pages/community/CommunityDashboardPage";
import { CommunityLogsPage } from "./pages/community/CommunityLogsPage";
import { CommunityTopologyPage } from "./pages/community/CommunityTopologyPage";
import { ProsumerFlexibilityPage } from "./pages/community/ProsumerFlexibilityPage";
import { ConfigsPage } from "./pages/ai/ConfigsPage";
import { DatasetsPage } from "./pages/ai/DatasetsPage";
import { DeployChartsPage } from "./pages/ai/DeployChartsPage";
import { DeployPage } from "./pages/ai/DeployPage";
import { JobDetailPage } from "./pages/ai/JobDetailPage";
import { JobKpiComparePage } from "./pages/ai/JobKpiComparePage";
import { JobsPage } from "./pages/ai/JobsPage";
import { AppIndexRedirect } from "./routes/AppIndexRedirect";
import { AuthGuard, RoleGuard, RootRedirect } from "./routes/guards";

export default function App(): JSX.Element {
  return (
    <Routes>
      <Route path="/" element={<RootRedirect />} />
      <Route path="/login" element={<LoginPage />} />

      <Route element={<AuthGuard />}>
        <Route path="/communities" element={<CommunitiesPage />} />

        <Route path="/app" element={<AppShell />}>
          <Route index element={<AppIndexRedirect />} />
          <Route path="account" element={<AccountPage />} />
          <Route path="logs" element={<LogsPage />} />
          <Route path="notifications" element={<NotificationsPage />} />
          <Route path="workspace" element={<RoleWorkspacePage />} />

          <Route element={<RoleGuard allowed={["rec_manager", "prosumer"]} />}>
            <Route path="community">
              <Route index element={<Navigate to="dashboard" replace />} />
              <Route path="dashboard" element={<CommunityDashboardPage />} />
              <Route path="topology" element={<CommunityTopologyPage />} />
              <Route path="logs" element={<CommunityLogsPage />} />
              <Route element={<RoleGuard allowed={["prosumer"]} />}>
                <Route path="flexibility" element={<ProsumerFlexibilityPage />} />
              </Route>
            </Route>
          </Route>

          <Route element={<RoleGuard allowed={["ai_manager", "training_manager"]} />}>
            <Route path="ai">
              <Route index element={<Navigate to="jobs" replace />} />
              <Route path="jobs" element={<JobsPage />} />
              <Route path="jobs/compare" element={<JobKpiComparePage />} />
              <Route path="jobs/:jobId" element={<JobDetailPage />} />
              <Route path="datasets" element={<DatasetsPage />} />
              <Route path="configs" element={<ConfigsPage />} />
              <Route element={<RoleGuard allowed={["training_manager"]} />}>
                <Route path="deploy" element={<DeployPage />} />
                <Route path="deploy/:targetId/charts" element={<DeployChartsPage />} />
              </Route>
            </Route>
          </Route>

          <Route element={<RoleGuard allowed={["predictor"]} />}>
            <Route path="predictor/*" element={<PredictorWorkspacePage />} />
          </Route>

          <Route element={<RoleGuard allowed={["kpi_manager"]} />}>
            <Route path="kpi-manager">
              <Route index element={<Navigate to="dashboard" replace />} />
              <Route path="dashboard" element={<Dashboard />} />
              <Route path="explorer" element={<KpiExplorer />} />
              <Route path="compare" element={<ComparePage />} />
              <Route path="scheduler" element={<SchedulerPage />} />
              <Route path="library" element={<KpiLibraryPage />} />
              <Route path="data-health" element={<DataProfilingPage />} />
              <Route path="reports" element={<AggregateReportPage />} />
              <Route path="correlations" element={<CorrelationPage />} />
              <Route path="thresholds" element={<ThresholdPage />} />
            </Route>
          </Route>
        </Route>
      </Route>

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
