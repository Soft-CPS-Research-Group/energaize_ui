import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { describe, expect, it } from "vitest";
import { AuthProvider } from "../contexts/AuthContext";
import { AuthGuard } from "./guards";

function renderGuarded(initialEntry: string) {
  return render(
    <AuthProvider>
      <MemoryRouter initialEntries={[initialEntry]}>
        <Routes>
          <Route path="/login" element={<div>login page</div>} />
          <Route element={<AuthGuard />}>
            <Route path="/private" element={<div>private page</div>} />
          </Route>
        </Routes>
      </MemoryRouter>
    </AuthProvider>
  );
}

describe("AuthGuard", () => {
  it("redirects anonymous users to login", async () => {
    renderGuarded("/private");

    expect(await screen.findByText("login page")).toBeInTheDocument();
  });

  it("allows authenticated users", async () => {
    localStorage.setItem(
      "energaize_session",
      JSON.stringify({
        email: "tiago.fonseca@energaize.io",
        name: "Tiago Fonseca",
        role: "ai_manager",
        remember: true
      })
    );

    renderGuarded("/private");

    await waitFor(() => {
      expect(screen.getByText("private page")).toBeInTheDocument();
    });
  });
});
