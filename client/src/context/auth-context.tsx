import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { fetchCurrentSession, saveProfileToApi } from "../lib/api";
import { clearAuthToken, getAuthToken, setAuthToken } from "../lib/storage";
import type { AuthenticatedUser, UserProfile } from "../types";

interface AuthContextValue {
  token: string | null;
  user: AuthenticatedUser | null;
  profile: UserProfile | null;
  isAuthenticated: boolean;
  isBootstrapping: boolean;
  setSessionToken: (token: string | null) => void;
  saveProfile: (profile: UserProfile) => Promise<void>;
  refreshSession: () => Promise<void>;
  logout: () => void;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }): ReactNode {
  const [token, setTokenState] = useState<string | null>(() => getAuthToken());
  const [user, setUserState] = useState<AuthenticatedUser | null>(null);
  const [profile, setProfileState] = useState<UserProfile | null>(null);
  const [isBootstrapping, setIsBootstrapping] = useState<boolean>(Boolean(token));

  const setSessionToken = useCallback((nextToken: string | null): void => {
    setTokenState(nextToken);

    if (nextToken) {
      setIsBootstrapping(true);
      setUserState(null);
      setProfileState(null);
      setAuthToken(nextToken);
      return;
    }

    clearAuthToken();
    setUserState(null);
    setProfileState(null);
    setIsBootstrapping(false);
  }, []);

  const refreshSession = useCallback(async (): Promise<void> => {
    if (!token) {
      setUserState(null);
      setProfileState(null);
      return;
    }

    const session = await fetchCurrentSession(token);
    setUserState(session.user);
    setProfileState(session.profile ?? null);
  }, [token]);

  useEffect(() => {
    let active = true;

    const bootstrap = async (): Promise<void> => {
      if (!token) {
        if (!active) {
          return;
        }

        setUserState(null);
        setProfileState(null);
        setIsBootstrapping(false);
        return;
      }

      if (active) {
        setIsBootstrapping(true);
      }

      try {
        const session = await fetchCurrentSession(token);

        if (!active) {
          return;
        }

        setUserState(session.user);
        setProfileState(session.profile ?? null);
      } catch {
        if (!active) {
          return;
        }

        clearAuthToken();
        setTokenState(null);
        setUserState(null);
        setProfileState(null);
      } finally {
        if (active) {
          setIsBootstrapping(false);
        }
      }
    };

    void bootstrap();

    return () => {
      active = false;
    };
  }, [token]);

  const saveProfile = useCallback(
    async (nextProfile: UserProfile): Promise<void> => {
      if (!token) {
        throw new Error("Not authenticated.");
      }

      const response = await saveProfileToApi(token, nextProfile);
      setUserState(response.user);
      setProfileState(response.profile ?? null);
    },
    [token]
  );

  const logout = useCallback((): void => {
    clearAuthToken();
    setTokenState(null);
    setUserState(null);
    setProfileState(null);
    setIsBootstrapping(false);
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      token,
      user,
      profile,
      isAuthenticated: Boolean(token),
      isBootstrapping,
      setSessionToken,
      saveProfile,
      refreshSession,
      logout
    }),
    [token, user, profile, isBootstrapping, setSessionToken, saveProfile, refreshSession, logout]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);

  if (!context) {
    throw new Error("useAuth must be used inside AuthProvider.");
  }

  return context;
}
