import { TrainingWorkspaceProvider } from './contexts/TrainingWorkspaceContext';
import { PredictorWorkspaceProvider } from './contexts/PredictorWorkspaceContext';
import './styles/training-workspaces.css';
import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import App from "./App";
import { AuthProvider } from "./contexts/AuthContext";
import { UIProvider } from "./contexts/UIContext";
import "./styles/index.css";
import "./styles/ai-ceramic.css";
import "./styles/predictor-ceramic.css";
import "./styles/profile.css";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      refetchOnWindowFocus: false
    }
  }
});

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <UIProvider>
          <BrowserRouter>
            <TrainingWorkspaceProvider><PredictorWorkspaceProvider><App /></PredictorWorkspaceProvider></TrainingWorkspaceProvider>
          </BrowserRouter>
        </UIProvider>
      </AuthProvider>
    </QueryClientProvider>
  </React.StrictMode>
);
