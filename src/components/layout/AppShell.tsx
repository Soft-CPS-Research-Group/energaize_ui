import { motion } from "framer-motion";
import { Outlet, useLocation } from "react-router-dom";
import { useAuth } from "../../contexts/AuthContext";
import { CommunityTree } from "./CommunityTree";
import { InstitutionalDock } from "./InstitutionalDock";
import { TopBar } from "./TopBar";
import { ToastStack } from "./ToastStack";

export function AppShell(): JSX.Element {
  const location = useLocation();
  const { session } = useAuth();
  const showTree = session?.role !== "ai_manager";

  return (
    <div className="app-shell">
      <TopBar />

      <div className={`app-body${showTree ? "" : " no-tree"}`}>
        {showTree ? <CommunityTree /> : null}

        <motion.main
          key={location.pathname}
          className="workspace-main"
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.2, ease: "easeOut" }}
        >
          <Outlet />
        </motion.main>
      </div>

      <ToastStack />
      <InstitutionalDock />
    </div>
  );
}
