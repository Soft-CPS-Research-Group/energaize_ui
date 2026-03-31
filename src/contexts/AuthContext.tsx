import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode
} from "react";
import { MOCK_USERS } from "../constants";
import type { Session, UserRole } from "../types";
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
  login: (payload: LoginPayload) => Promise<void>;
  logout: () => void;
  updateProfile: (patch: Partial<Pick<Session, "name" | "email">>) => void;
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
}

export function AuthProvider({ children }: { children: ReactNode }): JSX.Element {
  const [session, setSession] = useState<Session | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    setSession(readPersistedSession());
    setIsLoading(false);
  }, []);

  const login = useCallback(async ({ email, password, remember }: LoginPayload) => {
    await new Promise((resolve) => setTimeout(resolve, 450));

    const key = email.trim().toLowerCase();
    const user = MOCK_USERS[key];

    if (!user || user.password !== password) {
      throw new Error("Invalid credentials. Try tiago.fonseca@energaize.io / TfTm#2026!");
    }

    const next: Session = {
      email: key,
      name: user.name,
      role: user.role as UserRole,
      remember
    };

    setSession(next);
    writePersistedSession(next);
  }, []);

  const logout = useCallback(() => {
    setSession(null);
    clearPersistedSession();
  }, []);

  const updateProfile = useCallback((patch: Partial<Pick<Session, "name" | "email">>) => {
    setSession((previous) => {
      if (!previous) return previous;
      const next = { ...previous, ...patch };
      writePersistedSession(next);
      return next;
    });
  }, []);

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
