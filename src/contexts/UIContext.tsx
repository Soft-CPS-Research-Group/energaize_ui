import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode
} from "react";
import { INITIAL_COMMUNITIES } from "../constants";
import { createDomainRec } from "../data/communityDomain";
import type { CommunityContext, NotificationItem, ThemeMode, ToastItem } from "../types";
import { createId } from "../utils/id";
import { readStorage, STORAGE_KEYS, writeStorage } from "../utils/storage";

interface UIContextValue {
  theme: ThemeMode;
  setTheme: (mode: ThemeMode) => void;
  toggleTheme: () => void;
  communities: CommunityContext[];
  activeCommunity: CommunityContext;
  setActiveCommunity: (communityId: string) => void;
  addCommunity: (input: Omit<CommunityContext, "id" | "status"> & { status?: CommunityContext["status"] }) => CommunityContext;
  notifications: NotificationItem[];
  toasts: ToastItem[];
  unreadCount: number;
  pushNotification: (input: Omit<NotificationItem, "id" | "timestamp" | "read">) => void;
  dismissToast: (id: string) => void;
  markNotificationRead: (id: string) => void;
  markAllNotificationsRead: () => void;
  removeNotification: (id: string) => void;
  clearNotifications: () => void;
  treeCollapsed: boolean;
  toggleTreeCollapsed: () => void;
  mobileTreeOpen: boolean;
  setMobileTreeOpen: (value: boolean) => void;
  selectedEntityId: string;
  setSelectedEntityId: (value: string) => void;
}

const UIContext = createContext<UIContextValue | undefined>(undefined);

function resolveInitialCommunities(): CommunityContext[] {
  const domainCommunities = INITIAL_COMMUNITIES;
  const persisted = readStorage<CommunityContext[] | null>(STORAGE_KEYS.communities, null);
  if (!persisted || persisted.length === 0) return domainCommunities;

  const domainIds = new Set(domainCommunities.map((community) => community.id));
  const localDrafts = persisted.filter((community) => !domainIds.has(community.id));
  return [...localDrafts, ...domainCommunities];
}

function resolvePreferredTheme(): ThemeMode {
  const persisted = readStorage<ThemeMode | null>(STORAGE_KEYS.theme, null);
  if (persisted) return persisted;
  if (window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches) {
    return "dark";
  }
  return "light";
}

export function UIProvider({ children }: { children: ReactNode }): JSX.Element {
  const [theme, setThemeState] = useState<ThemeMode>(resolvePreferredTheme);
  const [communities, setCommunities] = useState<CommunityContext[]>(resolveInitialCommunities);

  const [activeCommunityId, setActiveCommunityId] = useState<string>(() => {
    const persisted = readStorage<string | null>(STORAGE_KEYS.communityId, null);
    return persisted || INITIAL_COMMUNITIES[0].id;
  });

  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const [treeCollapsed, setTreeCollapsed] = useState(false);
  const [mobileTreeOpen, setMobileTreeOpen] = useState(false);
  const [selectedEntityId, setSelectedEntityId] = useState("community");

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    writeStorage(STORAGE_KEYS.theme, theme);
  }, [theme]);

  const setTheme = useCallback((mode: ThemeMode) => {
    setThemeState(mode);
  }, []);

  const toggleTheme = useCallback(() => {
    setThemeState((previous) => (previous === "light" ? "dark" : "light"));
  }, []);

  const activeCommunity = useMemo(() => {
    return communities.find((item) => item.id === activeCommunityId) || communities[0];
  }, [activeCommunityId, communities]);

  const setActiveCommunity = useCallback((communityId: string) => {
    setActiveCommunityId(communityId);
    setSelectedEntityId("community");
    writeStorage(STORAGE_KEYS.communityId, communityId);
  }, []);

  const addCommunity = useCallback(
    (input: Omit<CommunityContext, "id" | "status"> & { status?: CommunityContext["status"] }) => {
      const community = createDomainRec({
        name: input.name,
        location: input.location,
        description: input.description,
        action_frequency: "daily"
      });

      setCommunities((previous) => {
        const next = [community, ...previous.filter((item) => item.id !== community.id)];
        writeStorage(STORAGE_KEYS.communities, next);
        return next;
      });
      setActiveCommunityId(community.id);
      setSelectedEntityId("community");
      writeStorage(STORAGE_KEYS.communityId, community.id);
      return community;
    },
    []
  );

  const pushNotification = useCallback(
    (input: Omit<NotificationItem, "id" | "timestamp" | "read">) => {
      const id = createId("notif");
      const createdAt = Date.now();
      setNotifications((previous) => [
        {
          id,
          timestamp: createdAt,
          read: false,
          ...input
        },
        ...previous
      ]);

      setToasts((previous) => [
        {
          id,
          title: input.title,
          message: input.message,
          severity: input.severity,
          createdAt
        },
        ...previous
      ]);

      window.setTimeout(() => {
        setToasts((previous) => previous.filter((item) => item.id !== id));
      }, 4500);
    },
    []
  );

  const dismissToast = useCallback((id: string) => {
    setToasts((previous) => previous.filter((item) => item.id !== id));
  }, []);

  const markNotificationRead = useCallback((id: string) => {
    setNotifications((previous) =>
      previous.map((item) => (item.id === id ? { ...item, read: true } : item))
    );
  }, []);

  const markAllNotificationsRead = useCallback(() => {
    setNotifications((previous) => previous.map((item) => ({ ...item, read: true })));
  }, []);

  const removeNotification = useCallback((id: string) => {
    setNotifications((previous) => previous.filter((item) => item.id !== id));
  }, []);

  const clearNotifications = useCallback(() => {
    setNotifications([]);
  }, []);

  const toggleTreeCollapsed = useCallback(() => {
    setTreeCollapsed((previous) => !previous);
  }, []);

  const unreadCount = useMemo(
    () => notifications.reduce((acc, item) => acc + (item.read ? 0 : 1), 0),
    [notifications]
  );

  const value = useMemo<UIContextValue>(
    () => ({
      theme,
      setTheme,
      toggleTheme,
      communities,
      activeCommunity,
      setActiveCommunity,
      addCommunity,
      notifications,
      toasts,
      unreadCount,
      pushNotification,
      dismissToast,
      markNotificationRead,
      markAllNotificationsRead,
      removeNotification,
      clearNotifications,
      treeCollapsed,
      toggleTreeCollapsed,
      mobileTreeOpen,
      setMobileTreeOpen,
      selectedEntityId,
      setSelectedEntityId
    }),
    [
      theme,
      setTheme,
      toggleTheme,
      communities,
      activeCommunity,
      setActiveCommunity,
      addCommunity,
      notifications,
      toasts,
      unreadCount,
      pushNotification,
      dismissToast,
      markNotificationRead,
      markAllNotificationsRead,
      removeNotification,
      clearNotifications,
      treeCollapsed,
      toggleTreeCollapsed,
      mobileTreeOpen,
      setMobileTreeOpen,
      selectedEntityId,
      setSelectedEntityId
    ]
  );

  return <UIContext.Provider value={value}>{children}</UIContext.Provider>;
}

export function useUI(): UIContextValue {
  const context = useContext(UIContext);
  if (!context) {
    throw new Error("useUI must be used inside UIProvider");
  }
  return context;
}
