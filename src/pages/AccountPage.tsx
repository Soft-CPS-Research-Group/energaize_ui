import { Camera, Moon, Save, Sun, Trash2 } from "lucide-react";
import { useRef, useState } from "react";
import { useAuth } from "../contexts/AuthContext";
import { useUI } from "../contexts/UIContext";
import { useApiFeedback } from "../hooks/useApiFeedback";
import { prepareProfilePhoto, readProfilePhoto, saveProfilePhoto } from "../hooks/useProfilePhoto";
import { Button } from "../components/ui/Button";
import { PageHeader } from "../components/ui/PageHeader";
import { ProfileAvatar } from "../components/ui/ProfileAvatar";
import { roleLabel } from "../utils/roles";

export function AccountPage(): JSX.Element {
  const { session, updateProfile } = useAuth();
  const { theme, setTheme } = useUI();
  const { notifySuccess, notifyError } = useApiFeedback();
  const [saving, setSaving] = useState(false);
  const [photoLoading, setPhotoLoading] = useState(false);
  const [name, setName] = useState(session?.name || "");
  const [email, setEmail] = useState(session?.email || "");
  const fileInput = useRef<HTMLInputElement>(null);
  const currentRoleLabel = roleLabel(session?.role);

  return (
    <div className="page account-page common-page">
      <PageHeader title="Account" subtitle="Your profile, photo and workspace appearance." />
      <section className="account-grid">
        <form className="panel account-panel" onSubmit={async event => {
          event.preventDefault();
          if (!name.trim()) return;
          setSaving(true);
          try {
            const photo = readProfilePhoto(session?.email || "");
            await updateProfile({ name: name.trim(), email: email.trim() });
            if (photo !== null && email.trim().toLowerCase() !== session?.email) {
              try { saveProfilePhoto(email, photo); } catch { /* The profile remains saved if browser storage is full. */ }
            }
            notifySuccess("Profile updated", session?.role === "rec_manager" || session?.role === "prosumer"
              ? "Your community profile was saved." : "Changes were saved in your local session.");
          } catch (error) { notifyError("Unable to save profile", error); }
          finally { setSaving(false); }
        }}>
          <h2>Profile</h2>
          <div className="account-profile-head">
            <ProfileAvatar session={session} size="large" />
            <div className="account-identity">
              <strong>{session?.name || "User"}</strong>
              <small>{session?.email}</small>
              <span className="badge badge-neutral">{currentRoleLabel}</span>
            </div>
          </div>
          <div className="account-photo-controls">
            <input ref={fileInput} className="sr-only" type="file" accept="image/jpeg,image/png,image/webp" aria-label="Choose profile photo"
              disabled={photoLoading} onChange={async event => {
                const file = event.target.files?.[0];
                event.target.value = "";
                if (!file || !session) return;
                setPhotoLoading(true);
                try {
                  saveProfilePhoto(session.email, await prepareProfilePhoto(file));
                  notifySuccess("Photo updated", "Your photo is saved on this browser.");
                } catch (error) { notifyError("Unable to update photo", error); }
                finally { setPhotoLoading(false); }
              }} />
            <Button type="button" size="sm" variant="secondary" iconLeft={<Camera size={14} />} disabled={photoLoading} onClick={() => fileInput.current?.click()}>
              {photoLoading ? "Preparing photo…" : "Change photo"}
            </Button>
            <Button type="button" size="sm" variant="ghost" iconLeft={<Trash2 size={13} />} disabled={photoLoading} onClick={() => {
              try { saveProfilePhoto(session?.email || "", ""); }
              catch (error) { notifyError("Unable to remove photo", error); }
            }}>Remove photo</Button>
            <small>JPG, PNG or WebP, up to 8 MB. Saved on this browser.</small>
          </div>
          <div className="account-form-grid">
            <label><span>Full name</span><input required autoComplete="name" value={name} onChange={event => setName(event.target.value)} /></label>
            <label><span>Email</span><input required type="email" autoComplete="email" value={email} onChange={event => setEmail(event.target.value)} /></label>
            <label className="full-col"><span>Workspace role</span><input value={currentRoleLabel} disabled /></label>
          </div>
          <div className="account-actions"><Button type="submit" variant="primary" iconLeft={<Save size={14} />} disabled={saving || !name.trim()}>{saving ? "Saving…" : "Save changes"}</Button></div>
        </form>
        <article className="panel account-panel account-display">
          <h2>Appearance</h2>
          <p>Choose the look of your workspace.</p>
          <div className="theme-select-row" role="group" aria-label="Workspace appearance">
            {(["light", "dark"] as const).map(mode => (
              <button key={mode} type="button" className={`theme-option${theme === mode ? " is-active" : ""}`} aria-pressed={theme === mode} onClick={() => setTheme(mode)}>
                <span className={`theme-preview theme-preview--${mode}`} aria-hidden="true"><i /><i /><i /></span>
                <span>{mode === "light" ? <Sun size={15} /> : <Moon size={15} />}{mode === "light" ? "Light" : "Dark"}</span>
              </button>
            ))}
          </div>
        </article>
      </section>
    </div>
  );
}
