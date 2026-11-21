import { createBrowserClient } from "@supabase/ssr";

const fetchWithTimeout: typeof fetch = (input, init) => {
  const timeout = AbortSignal.timeout(20_000);
  const signal = init?.signal ? AbortSignal.any([init.signal, timeout]) : timeout;
  return fetch(input, { ...init, signal });
};

export function createClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) throw new Error("Supabase environment variables are not configured.");
  return createBrowserClient(url, anonKey, { global: { fetch: fetchWithTimeout } });
}
