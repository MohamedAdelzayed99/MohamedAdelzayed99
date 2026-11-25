import { useCallback, useEffect, useRef, useState } from "react";
import { useFocusEffect } from "expo-router";
import { get } from "./api";
import { useAuth } from "./auth";
import { cache } from "./storage";

/**
 * Show the cached copy immediately, then refresh from the server (plan section 6:
 * the app opens instantly even on a weak connection). Refreshes on screen focus.
 */
export function useCached<T>(path: string | null, cacheKey?: string) {
  const [data, setData] = useState<T | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [stale, setStale] = useState(false);
  const key = cacheKey ?? path ?? "";
  const mounted = useRef(true);
  // Wait until the stored session token is loaded, otherwise a cold start would fetch without it.
  const { ready } = useAuth();

  useEffect(() => {
    mounted.current = true;
    if (key) cache.get<T>(key).then((c) => { if (c !== undefined && mounted.current) setData((d) => d ?? c); });
    return () => { mounted.current = false; };
  }, [key]);

  const refresh = useCallback(async () => {
    if (!path || !ready) return;
    setLoading(true);
    try {
      const fresh = await get<T>(path);
      if (!mounted.current) return;
      setData(fresh);
      setError(null);
      setStale(false);
      cache.set(key, fresh);
    } catch (e: any) {
      if (!mounted.current) return;
      setError(e?.message ?? "حدث خطأ");
      setStale(true);
    } finally {
      if (mounted.current) setLoading(false);
    }
  }, [path, key, ready]);

  useFocusEffect(useCallback(() => { refresh(); }, [refresh]));

  return { data, error, loading, stale, refresh, setData };
}
