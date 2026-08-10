import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import App from "../App";
import { JOB_ORCHESTRATOR_API_URL } from "../api/client";
import { AuthProvider } from "../contexts/AuthContext";
import { UIProvider } from "../contexts/UIContext";
import { setMockJobStatus } from "./handlers";
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

function createDragDataTransfer(): DataTransfer {
  const values = new Map<string, string>();
  return {
    effectAllowed: "none",
    dropEffect: "none",
    getData: (type: string) => values.get(type) || "",
    setData: (type: string, value: string) => {
      values.set(type, value);
    }
  } as DataTransfer;
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

  it("organizes personal jobs in folders and archive without moving results", async () => {
    seedAiSession();
    setMockJobStatus("job-completed-001", "finished");
    setMockJobStatus("job-completed-002", "finished");
    const user = userEvent.setup();
    renderApp("/app/ai/jobs");

    expect(await screen.findByText("job-completed-001")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Create folder" }));
    await screen.findByRole("heading", { name: "Create folder" });
    await user.type(screen.getByLabelText("Name"), "Research");
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByRole("button", { name: /Research/ })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /General/ }));
    const firstGeneralRow = (await screen.findByText("job-completed-001")).closest("tr");
    const secondGeneralRow = screen.getByText("job-completed-002").closest("tr");
    expect(firstGeneralRow).not.toBeNull();
    expect(secondGeneralRow).not.toBeNull();
    expect(firstGeneralRow).toHaveAttribute("draggable", "true");

    fireEvent.click(firstGeneralRow!);
    fireEvent.click(secondGeneralRow!, { ctrlKey: true });
    expect(screen.getByText("2 selected")).toBeInTheDocument();

    const moveTransfer = createDragDataTransfer();
    fireEvent.dragStart(firstGeneralRow!, { dataTransfer: moveTransfer });
    const researchTab = screen.getByRole("button", { name: /Research/ });
    fireEvent.dragOver(researchTab, { dataTransfer: moveTransfer });
    fireEvent.drop(researchTab, { dataTransfer: moveTransfer });
    fireEvent.dragEnd(firstGeneralRow!, { dataTransfer: moveTransfer });
    await waitFor(() => expect(screen.queryByText("2 selected")).not.toBeInTheDocument());
    await waitFor(() => {
      expect(screen.queryByText("job-completed-001")).not.toBeInTheDocument();
      expect(screen.queryByText("job-completed-002")).not.toBeInTheDocument();
    });

    await user.click(await screen.findByRole("button", { name: /Research/ }));
    expect(await screen.findByText("job-completed-001")).toBeInTheDocument();
    expect(screen.getByText("job-completed-002")).toBeInTheDocument();

    const firstFolderRow = screen.getByText("job-completed-001").closest("tr");
    const secondFolderRow = screen.getByText("job-completed-002").closest("tr");
    fireEvent.click(firstFolderRow!);
    fireEvent.click(secondFolderRow!, { ctrlKey: true });
    const archiveTransfer = createDragDataTransfer();
    fireEvent.dragStart(firstFolderRow!, { dataTransfer: archiveTransfer });
    const archiveTab = screen.getByRole("button", { name: /Archive/ });
    fireEvent.dragOver(archiveTab, { dataTransfer: archiveTransfer });
    fireEvent.drop(archiveTab, { dataTransfer: archiveTransfer });
    fireEvent.dragEnd(firstFolderRow!, { dataTransfer: archiveTransfer });
    await waitFor(() => expect(screen.queryByText("2 selected")).not.toBeInTheDocument());

    await user.click(await screen.findByRole("button", { name: /Archive/ }));
    expect(await screen.findByText("job-completed-001")).toBeInTheDocument();
    expect(screen.getByText("job-completed-002")).toBeInTheDocument();

    const firstArchiveRow = screen.getByText("job-completed-001").closest("tr");
    const secondArchiveRow = screen.getByText("job-completed-002").closest("tr");
    fireEvent.click(firstArchiveRow!);
    fireEvent.click(secondArchiveRow!, { ctrlKey: true });
    const restoreTransfer = createDragDataTransfer();
    fireEvent.dragStart(firstArchiveRow!, { dataTransfer: restoreTransfer });
    const restoreTarget = screen.getByRole("button", { name: /Research/ });
    fireEvent.dragOver(restoreTarget, { dataTransfer: restoreTransfer });
    fireEvent.drop(restoreTarget, { dataTransfer: restoreTransfer });
    fireEvent.dragEnd(firstArchiveRow!, { dataTransfer: restoreTransfer });
    await waitFor(() => expect(screen.queryByText("2 selected")).not.toBeInTheDocument());

    await user.click(screen.getByRole("button", { name: /Research/ }));
    expect(await screen.findByText("job-completed-001")).toBeInTheDocument();
    expect(screen.getByText("job-completed-002")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Move .* to folder/ })).not.toBeInTheDocument();
  });

  it("switches General, Archive, and folders with the selected submitter", async () => {
    seedAiSession();
    const user = userEvent.setup();
    const api = JOB_ORCHESTRATOR_API_URL.replace(/\/$/, "");
    const organization = (folderId: string | null, archived = false) => ({
      folder_id: folderId,
      archived,
      archived_at: archived ? 1770000000 : null,
      archived_by: archived ? "owner" : null
    });
    const job = (jobId: string, submittedBy: string, folderId: string | null, archived = false) => ({
      job_id: jobId,
      status: "finished",
      job_info: {
        experiment_name: `Experiment ${jobId}`,
        target_host: "worker-a",
        submitted_by: submittedBy
      },
      organization: organization(folderId, archived)
    });
    const folders = [
      { folder_id: "tiago-folder", name: "Tiago Research", owner: "Tiago Fonseca", created_at: 1, updated_at: 1 },
      { folder_id: "gustavo-folder", name: "Gustavo Research", owner: "Gustavo", created_at: 1, updated_at: 1 }
    ];

    server.use(
      http.get(`${api}/jobs`, () =>
        HttpResponse.json([
          job("tiago-general", "Tiago Fonseca", null),
          job("tiago-foldered", "Tiago Fonseca", "tiago-folder"),
          job("tiago-archived", "Tiago Fonseca", null, true),
          job("gustavo-general", "Gustavo", null),
          job("gustavo-foldered", "Gustavo", "gustavo-folder"),
          job("gustavo-archived", "Gustavo", null, true)
        ])
      ),
      http.get(`${api}/job-folders`, ({ request }) => {
        const owner = new URL(request.url).searchParams.get("owner") || "";
        return HttpResponse.json(folders.filter((folder) => folder.owner === owner));
      })
    );

    renderApp("/app/ai/jobs");

    expect(await screen.findByRole("button", { name: /Tiago Research/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Gustavo Research/ })).not.toBeInTheDocument();
    const collectionCount = (name: RegExp) =>
      Number(screen.getByRole("button", { name }).querySelector("small")?.textContent || "0");
    const tiagoGeneralCount = collectionCount(/General/);
    expect(tiagoGeneralCount).toBeGreaterThanOrEqual(1);
    expect(collectionCount(/Archive/)).toBeGreaterThanOrEqual(1);
    expect(screen.getByRole("button", { name: "Create folder" })).toBeInTheDocument();

    await user.selectOptions(screen.getByLabelText("Submitted by"), "all");
    await waitFor(() => expect(screen.queryByRole("button", { name: /Tiago Research/ })).not.toBeInTheDocument());
    expect(screen.queryByRole("button", { name: /Gustavo Research/ })).not.toBeInTheDocument();
    expect(collectionCount(/General/)).toBeGreaterThan(tiagoGeneralCount);
    expect(collectionCount(/Archive/)).toBeGreaterThanOrEqual(2);
    expect(screen.queryByRole("button", { name: "Create folder" })).not.toBeInTheDocument();
    expect(await screen.findByText("tiago-foldered")).toBeInTheDocument();
    expect(screen.getByText("gustavo-foldered")).toBeInTheDocument();

    await user.selectOptions(screen.getByLabelText("Submitted by"), "Gustavo");
    expect(await screen.findByRole("button", { name: /Gustavo Research/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Tiago Research/ })).not.toBeInTheDocument();
    expect(collectionCount(/General/)).toBe(1);
    expect(collectionCount(/Archive/)).toBe(1);
    expect(screen.queryByRole("button", { name: "Create folder" })).not.toBeInTheDocument();
    expect(await screen.findByText("gustavo-general")).toBeInTheDocument();
    expect(screen.queryByText("tiago-general")).not.toBeInTheDocument();
  });

  it("closes the Union authentication popup when the requested attempt fails", async () => {
    seedAiSession();
    const user = userEvent.setup();
    const api = JOB_ORCHESTRATOR_API_URL.replace(/\/$/, "");
    let unionAuth: Record<string, unknown> = {
      status: "authentication_required",
      updated_at: 1,
      error: "Previous authentication error"
    };
    const popupDocument = document.implementation.createHTMLDocument();
    const closePopup = vi.fn();
    const popup = {
      close: closePopup,
      document: popupDocument,
      location: { href: "about:blank" },
      opener: window
    } as unknown as Window;
    const openWindow = vi.spyOn(window, "open").mockReturnValue(popup);

    server.use(
      http.get(`${api}/hosts`, () =>
        HttpResponse.json({
          available_hosts: ["union-inesctec"],
          hosts: {
            "union-inesctec": {
              online: true,
              last_seen: Date.now() / 1000,
              info: {
                executor: "union",
                max_active_jobs: 10,
                active_job_count: 0,
                union_auth: unionAuth
              },
              running: 0
            }
          }
        })
      ),
      http.post(`${api}/ops/workers/:workerId/authenticate`, () => {
        unionAuth = {
          status: "authentication_required",
          request_id: "auth-request-1",
          updated_at: 101,
          error: "Fresh authentication error"
        };
        return HttpResponse.json({
          worker_id: "union-inesctec",
          action: "union_authenticate",
          request_id: "auth-request-1",
          requested_at: 100
        });
      })
    );

    renderApp("/app/ai/jobs");
    await user.click(await screen.findByTitle("Open details for Union INESC TEC"));
    await user.click(await screen.findByRole("button", { name: "Authenticate with Union" }));

    await waitFor(() => expect(closePopup).toHaveBeenCalled());
    expect(await screen.findByText("Fresh authentication error")).toBeInTheDocument();
    openWindow.mockRestore();
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

  it("keeps email notification metadata out of the jobs table and shows it in job details", async () => {
    seedAiSession();
    const user = userEvent.setup();
    renderApp("/app/ai/jobs");

    expect(await screen.findByRole("heading", { name: "Jobs" })).toBeInTheDocument();
    expect(await screen.findByText("job-completed-001")).toBeInTheDocument();
    expect(screen.queryByRole("columnheader", { name: "Email" })).not.toBeInTheDocument();
    expect(screen.queryByText("calof@isep.ipp.pt")).not.toBeInTheDocument();

    await user.click(
      screen.getByRole("button", {
        name: /see more about job-completed-001/i
      })
    );

    expect(await screen.findByRole("heading", { name: /email notifications/i })).toBeInTheDocument();
    expect((await screen.findAllByText("calof@isep.ipp.pt")).length).toBeGreaterThan(0);
    expect(screen.getByText("[EnergAIze] Job completed: Baseline Alpha")).toBeInTheDocument();
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
