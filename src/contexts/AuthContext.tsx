import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode
} from "react";
import { authenticateWorkspace, updateCommunityIdentity } from '../api/workspaceIdentity';
import type { Session } from "../types";
import { STORAGE_KEYS } from "../utils/storage";

interface LoginPayload {
  email: string;
  password: string;
  remember: boolean;
}

interface AuthContextValue {
  session: Session | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  login: (payload: LoginPayload) => Promise<Session>;
  logout: () => void;
  updateProfile: (patch: Partial<Pick<Session, "name" | "email">>) => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

function readPersistedSession(): Session | null {
  const fromLocal = localStorage.getItem(STORAGE_KEYS.session);
  const fromSession = sessionStorage.getItem(STORAGE_KEYS.session);
  const raw = fromLocal || fromSession;
  if (!raw) return null;
  try {
    return JSON.parse(raw) as Session;
  } catch {
    return null;
  }
}

function writePersistedSession(session: Session): void {
  if (session.remember) {
    localStorage.setItem(STORAGE_KEYS.session, JSON.stringify(session));
    sessionStorage.removeItem(STORAGE_KEYS.session);
    return;
  }

  sessionStorage.setItem(STORAGE_KEYS.session, JSON.stringify(session));
  localStorage.removeItem(STORAGE_KEYS.session);
}

function clearPersistedSession(): void {
  localStorage.removeItem(STORAGE_KEYS.session);
  sessionStorage.removeItem(STORAGE_KEYS.session);
  sessionStorage.removeItem('console-session-email');
}

export function AuthProvider({ children }: { children: ReactNode }): JSX.Element {
  const [session, setSession] = useState<Session | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    sessionStorage.removeItem('console-session-email');
    setSession(readPersistedSession());
    setIsLoading(false);
  }, []);

  const login = useCallback(async ({ email, password, remember }: LoginPayload) => {
    const next = await authenticateWorkspace(email,password,remember);

    setSession(next);
    writePersistedSession(next);
    return next;
  }, []);

  const logout = useCallback(() => {
    setSession(null);
    clearPersistedSession();
  }, []);

  const updateProfile = useCallback(async (patch: Partial<Pick<Session, "name" | "email">>) => {
    if(!session)return;
    const normalized={...patch,...(patch.email?{email:patch.email.trim().toLowerCase()}:{})};
    if(['rec_manager','prosumer'].includes(session.role))await updateCommunityIdentity(session.email,normalized);
    setSession((previous) => {
      if (!previous || previous.email!==session.email) return previous;
      const next = { ...previous, ...normalized };
      writePersistedSession(next);
      return next;
    });
  }, [session]);

  const value = useMemo<AuthContextValue>(
    () => ({
      session,
      isAuthenticated: Boolean(session),
      isLoading,
      login,
      logout,
      updateProfile
    }),
    [isLoading, login, logout, session, updateProfile]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used inside AuthProvider");
  }
  return context;
}
