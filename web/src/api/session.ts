/**
 * The session half of the API: who is calling, and how they say so.
 *
 * Session auth rather than tokens, because `TenantMiddleware` reads
 * `request.user` to decide which institute to bind the Postgres connection to,
 * and that happens *before* the view runs. A DRF token authenticator runs
 * inside the view, by which point the middleware has already seen
 * `AnonymousUser` and left the connection unscoped — silently. `apps/api/auth.py`
 * argues the case in full.
 *
 * The practical consequence for this file: every request carries cookies, and
 * every unsafe one carries `X-CSRFToken`. Both live in `client.ts`.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ApiError, apiGet, apiPost, ensureCsrfToken } from "./client";
import { qk } from "./queries";
import type { LoginRequest, Me } from "./types";

/**
 * The current identity, or `null` when nobody is signed in.
 *
 * A 401/403 is a *successful* answer to "who am I" — it means "nobody" — so it
 * resolves to `null` rather than rejecting. Anything else is a real failure and
 * is allowed to surface, because a login screen shown because the API is down
 * is a lie that costs a user their password attempt.
 */
export async function fetchMe(): Promise<Me | null> {
  try {
    return await apiGet("/api/me/");
  } catch (error) {
    if (error instanceof ApiError && error.isAuthFailure) return null;
    throw error;
  }
}

export function useMe() {
  return useQuery<Me | null, Error>({
    queryKey: qk.me,
    queryFn: fetchMe,
    // Identity does not go stale on a timer; it changes when the user acts,
    // and both of those paths invalidate this key explicitly.
    staleTime: Infinity,
    retry: false,
  });
}

export function useLogin() {
  const queryClient = useQueryClient();
  return useMutation<Me, Error, LoginRequest>({
    mutationFn: async (body) => {
      // Prime the cookie first: a browser that has never met this API has no
      // `csrftoken`, and Django rejects the POST before it reads the body.
      await ensureCsrfToken();
      return apiPost("/api/auth/login/", { body });
    },
    onSuccess: (me) => {
      queryClient.setQueryData(qk.me, me);
      // Everything cached before the login belonged to nobody, or to whoever
      // was signed in last. Under RLS that is a different tenant's data.
      void queryClient.invalidateQueries();
    },
  });
}

export function useLogout() {
  const queryClient = useQueryClient();
  return useMutation<void, Error, void>({
    mutationFn: async () => {
      await apiPost("/api/auth/logout/", {});
    },
    onSettled: () => {
      queryClient.setQueryData(qk.me, null);
      queryClient.clear();
    },
  });
}

/** `mentor` and `director` see the console; `student` sees the plan. */
export function isConsoleRole(me: Me | null | undefined): boolean {
  return me?.role === "mentor" || me?.role === "director";
}
