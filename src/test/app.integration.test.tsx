import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import App from "../App";
import { JOB_ORCHESTRATOR_API_URL } from "../api/client";
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

function readBlobAsText(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(typeof reader.result === "string" ? reader.result : "");
    reader.onerror = () => reject(reader.error || new Error("Could not read blob."));
    reader.readAsText(blob);
  });
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

  function seedCommunitySession(role: "rec_manager" | "prosumer"): void {
    localStorage.setItem(
      "energaize_session",
      JSON.stringify({
        email: role === "prosumer" ? "prosumer@energaize.io" : "rec@energaize.io",
        name: role === "prosumer" ? "Prosumer" : "REC Manager",
        role,
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

    const api = JOB_ORCHESTRATOR_API_URL.replace(/\/$/, "");
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

  it("downloads the complete job log file instead of the visible preview buffer", async () => {
    seedAiSession();
    const user = userEvent.setup();
    const api = JOB_ORCHESTRATOR_API_URL.replace(/\/$/, "");
    const createdUrls: Blob[] = [];

    const originalCreateObjectURL = URL.createObjectURL;
    const originalRevokeObjectURL = URL.revokeObjectURL;
    Object.defineProperty(URL, "createObjectURL", {
      configurable: true,
      value: vi.fn((blob: Blob) => {
        createdUrls.push(blob);
        return "blob:job-logs";
      })
    });
    Object.defineProperty(URL, "revokeObjectURL", {
      configurable: true,
      value: vi.fn()
    });
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined);

    server.use(
      http.get(`${api}/logs-chunk/:jobId`, ({ params }) =>
        HttpResponse.json({
          job_id: params.jobId,
          text: "visible preview only",
          next_offset: "visible preview only".length,
          truncated: true,
          available: true,
          message: null
        })
      ),
      http.get(`${api}/file-logs/:jobId`, () => HttpResponse.text("complete file logs\nline 2\n"))
    );

    try {
      renderApp("/app/ai/jobs");

      await user.click(
        await screen.findByRole("button", {
          name: /open logs for job-completed-001/i
        })
      );

      expect(await screen.findByText(/visible preview only/i)).toBeInTheDocument();

      await user.click(screen.getByRole("button", { name: /^download$/i }));

      await waitFor(() => expect(clickSpy).toHaveBeenCalled());
      expect(createdUrls).toHaveLength(1);
      await expect(readBlobAsText(createdUrls[0])).resolves.toBe("complete file logs\nline 2\n");
    } finally {
      clickSpy.mockRestore();
      Object.defineProperty(URL, "createObjectURL", {
        configurable: true,
        value: originalCreateObjectURL
      });
      Object.defineProperty(URL, "revokeObjectURL", {
        configurable: true,
        value: originalRevokeObjectURL
      });
    }
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
    expect(screen.getAllByRole("columnheader", { name: "job-completed-001" }).length).toBeGreaterThan(0);
    expect(screen.getAllByRole("columnheader", { name: "job-completed-002" }).length).toBeGreaterThan(0);
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

  it("opens REC manager community dashboard from community selection", async () => {
    seedCommunitySession("rec_manager");
    const user = userEvent.setup();
    renderApp("/communities");

    expect(await screen.findByRole("heading", { name: /choose a community/i })).toBeInTheDocument();
    await user.click(screen.getAllByRole("button", { name: /view/i })[0]);

    expect(await screen.findByRole("heading", { name: "Dashboard" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Topology" })).toBeInTheDocument();
  });

  it("creates a blank community and opens the editable topology builder", async () => {
    seedCommunitySession("rec_manager");
    const user = userEvent.setup();
    renderApp("/communities");

    await user.click(await screen.findByRole("button", { name: /new community/i }));
    await user.type(screen.getByLabelText(/^name$/i), "Pilot REC");
    await user.type(screen.getByLabelText(/^location$/i), "Lisbon, PT");
    await user.click(screen.getByRole("button", { name: /^create$/i }));

    expect(await screen.findByRole("heading", { name: "Topology" })).toBeInTheDocument();
    expect(screen.getByText(/start with the first building or shared asset/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /add element/i })).toBeInTheDocument();
    expect(screen.queryByText("Building A")).not.toBeInTheDocument();
  });

  it("sends a prosumer with one assigned building straight to that dashboard", async () => {
    seedCommunitySession("prosumer");
    renderApp("/communities");

    expect(await screen.findByRole("heading", { name: "Dashboard" })).toBeInTheDocument();
    expect(screen.getByText(/Solar Community \/ House 1/i)).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: /choose a community/i })).not.toBeInTheDocument();
  });

  it("shows the prosumer flexibility workspace", async () => {
    seedCommunitySession("prosumer");
    renderApp("/app/community/flexibility");

    expect(await screen.findByRole("heading", { name: "Flexibility" })).toBeInTheDocument();
    expect(screen.getByText(/comfort limits are always enforced/i)).toBeInTheDocument();
  });
});
