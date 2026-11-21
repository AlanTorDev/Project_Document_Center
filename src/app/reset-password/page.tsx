"use client";

import Link from "next/link";
import { useState, type FormEvent } from "react";
import { z } from "zod";
import { ThemeToggle } from "@/components/theme-toggle";
import { createClient } from "@/lib/supabase/client";

export default function ResetPasswordPage() {
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setError(""); setStatus("");
    const email = z.email().safeParse(new FormData(event.currentTarget).get("email"));
    if (!email.success) { setError("Enter a valid email address."); return; }
    if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) { setError("Supabase is not configured for this project yet. Add the two values from .env.example to .env.local and restart the app."); return; }
    try {
      const { error: requestError } = await createClient().auth.resetPasswordForEmail(email.data, { redirectTo: `${window.location.origin}/auth/callback?next=/reset-password/update` });
      if (requestError) setError(requestError.message); else setStatus("If an account exists for that email, a recovery link is on its way.");
    } catch {
      setError("Supabase did not respond in time. Check your connection and try again.");
    }
  }

  return <main className="flex min-h-screen items-center justify-center px-5 py-12">
    <section className="w-full max-w-md rounded-3xl border border-[var(--line)] bg-white p-8 shadow-sm sm:p-10">
      <div className="mb-4 flex items-center justify-between"><Link href="/login" className="text-sm font-medium text-indigo-700">← Back to sign in</Link><ThemeToggle/></div>
      <h1 className="mt-8 text-3xl font-semibold tracking-tight">Reset password</h1>
      <p className="mt-2 text-sm leading-6 text-[var(--muted)]">We’ll email you a secure recovery link.</p>
      <form onSubmit={submit} className="mt-7 space-y-4">
        <label className="block text-sm font-medium">Email address<input name="email" type="email" autoComplete="email" required placeholder="you@example.com" className="mt-2 w-full rounded-xl border border-[var(--line)] bg-white px-4 py-3 outline-none focus:border-indigo-500"/></label>
        <button className="w-full rounded-xl bg-indigo-600 px-5 py-3 font-semibold text-white transition hover:bg-indigo-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2">Send recovery link</button>
        {error && <p role="alert" className="rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
        {status && <p role="status" className="rounded-xl bg-emerald-50 px-3 py-2 text-sm text-emerald-700">{status}</p>}
      </form>
    </section>
  </main>;
}
