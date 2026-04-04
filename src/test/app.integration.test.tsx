import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";
import App from "../App";
import { API_BASE_URL } from "../api/client";
import { AuthProvider } from "../contexts/AuthContext";
import { UIProvider } from "../contexts/UIContext";
import { server } from "./server";

function renderApp(initialRoute: string) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        refetchOnWindowFocus: false
      }
    }
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <UIProvider>
          <MemoryRouter initialEntries={[initialRoute]}>
            <App />
          </MemoryRouter>
        </UIProvider>
      </AuthProvider>
    </QueryClientProvider>
  );
}

describe("App integration", () => {
  function seedAiSession(): void {
    localStorage.setItem(
      "energaize_session",
      JSON.stringify({
        email: "tiago.fonseca@energaize.io",
        name: "Tiago Fonseca",
        role: "ai_manager",
        remember: true
      })
    );
    localStorage.setItem("energaize_active_community", JSON.stringify("solar-community"));
  }

  it("logs in and lands in AI jobs page", async () => {
    const user = userEvent.setup();
    renderApp("/login");

    await user.click(screen.getByRole("button", { name: /log in/i }));

    expect(await screen.findByRole("heading", { name: "Jobs" })).toBeInTheDocument();
  });

  it("runs a simulation from jobs page", async () => {
    seedAiSession();

    const user = userEvent.setup();
    renderApp("/app/ai/jobs");

    expect(await screen.findByRole("heading", { name: "Jobs" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /run job/i }));
    await user.clear(screen.getByLabelText(/config file/i));
    await user.type(screen.getByLabelText(/config file/i), "demo.yaml");
    await user.click(screen.getByRole("button", { name: /^next$/i }));
    await user.click(screen.getByRole("button", { name: /^next$/i }));
    await user.click(screen.getByRole("button", { name: /^next$/i }));
    await user.click(screen.getByRole("button", { name: /^run simulation$/i }));

    await waitFor(() => {
      expect(screen.getByText("job-4")).toBeInTheDocument();
    });
  });

  it("enables detail only for completed jobs and opens quick logs modal", async () => {
    seedAiSession();
    const user = userEvent.setup();

    const api = API_BASE_URL.replace(/\/$/, "");
    server.use(
      http.get(`${api}/logs-chunk/:jobId`, ({ request, params }) => {
        const url = new URL(request.url);
        const hasOffset = url.searchParams.has("offset");
        const text = hasOffset ? "" : "fallback logs content";
        const offsetRaw = url.searchParams.get("offset");
        const baseOffset = offsetRaw ? Number(offsetRaw) || 0 : 0;
        return HttpResponse.json({
          job_id: params.jobId,
          text,
          next_offset: baseOffset + text.length,
          truncated: false,
          available: true,
          message: null
        });
      })
    );

    renderApp("/app/ai/jobs");

    expect(await screen.findByRole("heading", { name: "Jobs" })).toBeInTheDocument();
    expect(await screen.findByText("job-completed-001")).toBeInTheDocument();

    const completedEye = screen.getByRole("button", {
      name: /see more about job-completed-001/i
    });
    const runningEye = screen.getByRole("button", {
      name: /see more about job-running-001/i
    });

    expect(completedEye).toBeEnabled();
    expect(runningEye).toBeDisabled();

    await user.click(
      screen.getByRole("button", {
        name: /open logs for job-completed-001/i
      })
    );

    expect(await screen.findByRole("heading", { name: /logs: job-completed-001/i })).toBeInTheDocument();
    expect(await screen.findByText(/fallback logs content/i)).toBeInTheDocument();
  });

  it("selects two completed jobs and opens KPI compare page", async () => {
    seedAiSession();
    const user = userEvent.setup();
    renderApp("/app/ai/jobs");

    expect(await screen.findByRole("heading", { name: "Jobs" })).toBeInTheDocument();
    expect(await screen.findByText("job-completed-001")).toBeInTheDocument();
    expect(
      screen.queryByRole("checkbox", {
        name: /select job-completed-001 for comparison/i
      })
    ).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /compare kpis/i }));

    await user.click(
      screen.getByRole("checkbox", {
        name: /select job-completed-001 for comparison/i
      })
    );
    await user.click(
      screen.getByRole("checkbox", {
        name: /select job-completed-002 for comparison/i
      })
    );

    await user.click(screen.getByRole("button", { name: /open kpi compare/i }));

    expect(await screen.findByRole("heading", { name: /compare jobs/i })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "job-completed-001" })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "job-completed-002" })).toBeInTheDocument();
  });

  it("returns from job detail and restores jobs filters from querystring", async () => {
    seedAiSession();
    const user = userEvent.setup();
    renderApp("/app/ai/jobs?q=alpha&status=completed");

    expect(await screen.findByRole("heading", { name: "Jobs" })).toBeInTheDocument();
    expect(await screen.findByText("job-completed-001")).toBeInTheDocument();

    await user.click(
      screen.getByRole("button", {
        name: /see more about job-completed-001/i
      })
    );

    expect(await screen.findByRole("heading", { name: /job-completed-001/i })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /back to jobs/i }));

    expect(await screen.findByRole("heading", { name: "Jobs" })).toBeInTheDocument();
    expect(screen.getByPlaceholderText(/search jobs/i)).toHaveValue("alpha");
    expect(screen.getByDisplayValue("completed")).toBeInTheDocument();
  });

  it("returns from KPI compare and restores jobs filters from querystring", async () => {
    seedAiSession();
    const user = userEvent.setup();
    renderApp("/app/ai/jobs?q=job-completed&status=completed");

    expect(await screen.findByRole("heading", { name: "Jobs" })).toBeInTheDocument();
    expect(await screen.findByText("job-completed-001")).toBeInTheDocument();
    expect(await screen.findByText("job-completed-002")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /compare kpis/i }));

    await user.click(
      screen.getByRole("checkbox", {
        name: /select job-completed-001 for comparison/i
      })
    );
    await user.click(
      screen.getByRole("checkbox", {
        name: /select job-completed-002 for comparison/i
      })
    );
    await user.click(screen.getByRole("button", { name: /open kpi compare/i }));

    expect(await screen.findByRole("heading", { name: /compare jobs/i })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /back to jobs/i }));

    expect(await screen.findByRole("heading", { name: "Jobs" })).toBeInTheDocument();
    expect(screen.getByPlaceholderText(/search jobs/i)).toHaveValue("job-completed");
    expect(screen.getByDisplayValue("completed")).toBeInTheDocument();
  });
});
