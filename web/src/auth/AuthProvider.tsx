import { createContext, use, type ReactNode } from "react";
import { useLogin, useLogout, useMe } from "@/api/session";
import type { LoginRequest, Me } from "@/api/types";

export type AuthStatus =
  /** `/api/me/` has not answered yet. Render nothing decisive. */
  | "loading"
  /** It answered 401/403. There is no session; show the login screen. */
  | "anonymous"
  /** It answered with an identity. */
  | "authenticated"
  /** It did not answer at all — the API is unreachable or erroring. */
  | "unavailable";

export interface AuthValue {
  status: AuthStatus;
  me: Me | null;
  /** Non-null only in the `unavailable` state. */
  error: Error | null;
  login: (credentials: LoginRequest) => Promise<Me>;
  loginPending: boolean;
  loginError: Error | null;
  logout: () => Promise<void>;
  logoutPending: boolean;
  retry: () => void;
}

const AuthContext = createContext<AuthValue | null>(null);

/**
 * One source of truth for "who is using this console".
 *
 * The four states are kept distinct on purpose. Collapsing `unavailable` into
 * `anonymous` — the obvious shortcut — makes a dead backend look like an
 * expired session, and sends the user to type their password at a server that
 * cannot check it. Collapsing `loading` into `anonymous` flashes the login
 * screen at someone who is already signed in.
 */
export function AuthProvider({ children }: { children: ReactNode }) {
  const me = useMe();
  const login = useLogin();
  const logout = useLogout();

  const status: AuthStatus = me.isPending
    ? "loading"
    : me.isError
      ? "unavailable"
      : me.data
        ? "authenticated"
        : "anonymous";

  const value: AuthValue = {
    status,
    me: me.data ?? null,
    error: me.error ?? null,
    login: (credentials) => login.mutateAsync(credentials),
    loginPending: login.isPending,
    loginError: login.error ?? null,
    logout: async () => {
      await logout.mutateAsync();
    },
    logoutPending: logout.isPending,
    retry: () => void me.refetch(),
  };

  return <AuthContext value={value}>{children}</AuthContext>;
}

export function useAuth(): AuthValue {
  const value = use(AuthContext);
  if (!value) throw new Error("useAuth must be used inside <AuthProvider>");
  return value;
}
