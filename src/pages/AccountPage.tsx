import { Save, UserCircle2 } from "lucide-react";
import { useState } from "react";
import { useAuth } from "../contexts/AuthContext";
import { useUI } from "../contexts/UIContext";
import { useApiFeedback } from "../hooks/useApiFeedback";
import { Button } from "../components/ui/Button";
import { PageHeader } from "../components/ui/PageHeader";
import { AI_AVATAR_URL } from "../constants";

export function AccountPage(): JSX.Element {
  const { session, updateProfile } = useAuth();
  const { theme, setTheme } = useUI();
  const { notifySuccess } = useApiFeedback();
  const [name, setName] = useState(session?.name || "");
  const [email, setEmail] = useState(session?.email || "");

  return (
    <div className="page account-page">
      <PageHeader title="Account" subtitle="Manage profile and display preferences." />

      <section className="account-grid">
        <article className="panel">
          <h2>Profile Information</h2>
          <div className="account-inline">
            {session?.role === "ai_manager" ? (
              <img className="account-avatar" src={AI_AVATAR_URL} alt={session.name} />
            ) : (
              <UserCircle2 size={56} />
            )}
            <div>
              <label>
                <span>Full name</span>
                <input value={name} onChange={(event) => setName(event.target.value)} />
              </label>

              <label>
                <span>Email</span>
                <input value={email} onChange={(event) => setEmail(event.target.value)} />
              </label>

              <label>
                <span>Role</span>
                <input value={session?.role.replaceAll("_", " ") || "-"} disabled />
              </label>
            </div>
          </div>

          <Button
            variant="primary"
            iconLeft={<Save size={14} />}
            onClick={() => {
              updateProfile({ name, email });
              notifySuccess("Profile updated", "Changes were saved in your local session.");
            }}
          >
            Save changes
          </Button>
        </article>

        <article className="panel">
          <h2>Display</h2>
          <p>Switch between light and dark console themes.</p>

          <div className="theme-select-row">
            <button
              type="button"
              className={`theme-option${theme === "light" ? " is-active" : ""}`}
              onClick={() => setTheme("light")}
            >
              Light
            </button>
            <button
              type="button"
              className={`theme-option${theme === "dark" ? " is-active" : ""}`}
              onClick={() => setTheme("dark")}
            >
              Dark
            </button>
          </div>
        </article>
      </section>
    </div>
  );
}
