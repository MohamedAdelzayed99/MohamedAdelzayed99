import { createContext, type ReactNode, useCallback, useContext, useEffect, useState } from "react";
import { get, type Member, post, setApiToken, setUnauthorizedHandler } from "./api";
import { cache, tokenStore } from "./storage";
import { registerPush } from "./push";

interface AuthState {
  ready: boolean;
  member: Member | null;
  /** Referral code from a deep link / share link, used to prefill sign-up. */
  pendingCode: string | null;
  setPendingCode: (c: string | null) => void;
  signIn: (token: string, member: Member) => Promise<void>;
  signOut: () => Promise<void>;
  refresh: () => Promise<void>;
}

const Ctx = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);
  const [member, setMember] = useState<Member | null>(null);
  const [pendingCode, setPendingCodeState] = useState<string | null>(null);

  const signOut = useCallback(async () => {
    try { await post("/auth/logout"); } catch { /* token may already be invalid */ }
    setApiToken(null);
    await tokenStore.set(null);
    await cache.clearUserData();
    setMember(null);
  }, []);

  const refresh = useCallback(async () => {
    const me = await get<Member>("/me");
    setMember(me);
    await cache.set("me", me);
  }, []);

  useEffect(() => {
    setUnauthorizedHandler(() => {
      setApiToken(null);
      tokenStore.set(null);
      setMember(null);
    });
    (async () => {
      const [token, code] = await Promise.all([tokenStore.get(), cache.get<string>("pendingCode")]);
      if (code) setPendingCodeState(code);
      if (token) {
        setApiToken(token);
        // Show the cached account instantly (works offline), then refresh from the server.
        const cached = await cache.get<Member>("me");
        if (cached) setMember(cached);
        try {
          const me = await get<Member>("/me");
          setMember(me);
          await cache.set("me", me);
          registerPush();
        } catch (e: any) {
          if (e?.status === 401) setMember(null);
        }
      }
      setReady(true);
    })();
  }, []);

  const signIn = useCallback(async (token: string, m: Member) => {
    setApiToken(token);
    await tokenStore.set(token);
    await cache.set("me", m);
    await cache.set("pendingCode", null);
    setPendingCodeState(null);
    setMember(m);
    registerPush();
  }, []);

  const setPendingCode = useCallback((c: string | null) => {
    setPendingCodeState(c);
    cache.set("pendingCode", c);
  }, []);

  return (
    <Ctx.Provider value={{ ready, member, pendingCode, setPendingCode, signIn, signOut, refresh }}>{children}</Ctx.Provider>
  );
}

export function useAuth() {
  const c = useContext(Ctx);
  if (!c) throw new Error("useAuth outside AuthProvider");
  return c;
}
