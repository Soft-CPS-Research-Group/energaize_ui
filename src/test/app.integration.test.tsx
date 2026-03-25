import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";
import App from "../App";
import { AuthProvider } from "../contexts/AuthContext";
import { UIProvider } from "../contexts/UIContext";

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
  it("logs in and lands in AI jobs page", async () => {
    const user = userEvent.setup();
    renderApp("/login");

    await user.click(screen.getByRole("button", { name: /log in/i }));

    expect(await screen.findByRole("heading", { name: "Jobs" })).toBeInTheDocument();
  });

  it("runs a simulation from jobs page", async () => {
    localStorage.setItem(
      "energaize_session",
      JSON.stringify({
        email: "ai@energaize.io",
        name: "Training Manager",
        role: "ai_manager",
        remember: true
      })
    );
    localStorage.setItem("energaize_active_community", JSON.stringify("solar-community"));

    const user = userEvent.setup();
    renderApp("/app/ai/jobs");

    expect(await screen.findByRole("heading", { name: "Jobs" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /run new simulation/i }));
    await user.click(screen.getByRole("button", { name: /inline config/i }));
    await user.click(screen.getByRole("button", { name: /^run simulation$/i }));

    await waitFor(() => {
      expect(screen.getByText("job-2")).toBeInTheDocument();
    });
  });
});
