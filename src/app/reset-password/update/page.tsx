"use client";

import Link from "next/link";
import { useState, type FormEvent } from "react";
import { z } from "zod";
import { ThemeToggle } from "@/components/theme-toggle";
import { createClient } from "@/lib/supabase/client";

export default function UpdatePasswordPage() {
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setError(""); setStatus("");
    const password = z.string().min(8, "Use at least 8 characters.").safeParse(new FormData(event.currentTarget).get("password"));
    if (!password.success) { setError(password.error.issues[0]?.message ?? "Check your password."); return; }
    if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) { setError("Supabase is not configured for this project yet. Add the two values from .env.example to .env.local and restart the app."); return; }
    try {
      const { error: updateError } = await createClient().auth.updateUser({ password: password.data });
      if (updateError) setError(updateError.message); else setStatus("Password updated. You can now sign in with it.");
    } catch {
      setError("Supabase did not respond in time. Check your connection and try again.");
    }
  }

  return <main className="flex min-h-screen items-center justify-center px-5 py-12">
    <section className="w-full max-w-md rounded-3xl border border-[var(--line)] bg-white p-8 shadow-sm sm:p-10">
      <div className="mb-4 flex justify-end"><ThemeToggle/></div>
      <h1 className="text-3xl font-semibold tracking-tight">Choose a new password</h1>
      <p className="mt-2 text-sm leading-6 text-[var(--muted)]">Choose a strong password you haven’t used before.</p>
      <form onSubmit={submit} className="mt-7 space-y-4">
        <label className="block text-sm font-medium">New password<input name="password" type="password" autoComplete="new-password" minLength={8} required placeholder="At least 8 characters" className="mt-2 w-full rounded-xl border border-[var(--line)] bg-white px-4 py-3 outline-none focus:border-indigo-500"/></label>
        <button className="w-full rounded-xl bg-indigo-600 px-5 py-3 font-semibold text-white transition hover:bg-indigo-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2">Update password</button>
        {error && <p role="alert" className="rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
        {status && <p role="status" className="rounded-xl bg-emerald-50 px-3 py-2 text-sm text-emerald-700">{status} <Link className="underline" href="/login">Sign in</Link></p>}
      </form>
    </section>
  </main>;
}
