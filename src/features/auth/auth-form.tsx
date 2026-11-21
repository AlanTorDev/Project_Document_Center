"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { z } from "zod";
import { createClient } from "@/lib/supabase/client";

const credentialsSchema = z.object({
  email: z.email(),
  password: z.string().min(8, "Use at least 8 characters."),
});

export function AuthForm({ mode }: { mode: "login" | "signup" }) {
  const router = useRouter();
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const isSignup = mode === "signup";

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(""); setMessage("");
    const data = new FormData(event.currentTarget);
    const parsed = credentialsSchema.safeParse({ email: data.get("email"), password: data.get("password") });
    if (!parsed.success) { setError(parsed.error.issues[0]?.message ?? "Check your details."); return; }
    if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) { setError("Supabase is not configured for this project yet. Add the two values from .env.example to .env.local and restart the app."); return; }
    setBusy(true);
    let result;
    try {
      const supabase = createClient();
      result = isSignup
        ? await supabase.auth.signUp({ email: parsed.data.email, password: parsed.data.password, options: { emailRedirectTo: `${window.location.origin}/auth/callback` } })
        : await supabase.auth.signInWithPassword(parsed.data);
    } catch {
      setError("Supabase did not respond in time. Check your connection and try again.");
      setBusy(false);
      return;
    }
    setBusy(false);
    if (result.error) { setError(result.error.message); return; }
    if (isSignup) {
      if (result.data.session) {
        router.replace("/app");
        router.refresh();
        return;
      }
      setMessage("Account created. Check your inbox to verify your email, then sign in.");
      return;
    }
    router.push("/app"); router.refresh();
  }

  return <form onSubmit={submit} className="mt-7 space-y-4">
    <label className="block text-sm font-medium">Email<input name="email" type="email" autoComplete="email" required className="mt-2 w-full rounded-xl border border-[var(--line)] px-4 py-3 outline-none focus:border-indigo-500" /></label>
    <label className="block text-sm font-medium">Password<input name="password" type="password" autoComplete={isSignup ? "new-password" : "current-password"} minLength={8} required className="mt-2 w-full rounded-xl border border-[var(--line)] px-4 py-3 outline-none focus:border-indigo-500" /></label>
    {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
    {message && <p role="status" className="text-sm text-emerald-700">{message}</p>}
    <button disabled={busy} className="w-full rounded-xl bg-indigo-600 px-5 py-3 font-semibold text-white disabled:opacity-60">{busy ? "Please wait…" : isSignup ? "Create account" : "Sign in"}</button>
    {!isSignup && <Link className="block text-center text-sm text-indigo-700" href="/reset-password">Forgot password?</Link>}
  </form>;
}
