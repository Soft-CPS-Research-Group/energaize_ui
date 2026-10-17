import { useState } from "react";
import { AI_AVATAR_URL } from "../../constants";
import { useProfilePhoto } from "../../hooks/useProfilePhoto";
import { isTrainingManagerRole } from "../../utils/roles";
import type { Session } from "../../types";

export function ProfileAvatar({ session, size = "small" }: { session: Session | null; size?: "small" | "large" }) {
  const saved = useProfilePhoto(session?.email || "");
  const source = session?.avatar_url ?? (session?.id ? undefined : saved) ?? (isTrainingManagerRole(session?.role) ? AI_AVATAR_URL : "");
  const [failedSource, setFailedSource] = useState<string | null>(null);
  const initials = session?.name.trim().split(/\s+/).map(part => part[0]).slice(0, 2).join("").toUpperCase() || "U";
  return (
    <span className={`profile-avatar profile-avatar--${size}`}>
      {source && failedSource !== source ? (
        <img src={source} alt={session?.name || "Profile"} onError={() => setFailedSource(source)} />
      ) : <span aria-label={session?.name || "Profile"}>{initials}</span>}
    </span>
  );
}
