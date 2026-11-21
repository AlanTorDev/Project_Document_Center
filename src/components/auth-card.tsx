import Link from "next/link";
import { AuthForm } from "@/features/auth/auth-form";
import { ThemeToggle } from "./theme-toggle";

export function AuthCard({ mode }: { mode: "login" | "signup" }) {
  const isSignup = mode === "signup";
  return <main className="flex min-h-screen items-center justify-center px-5 py-12">
    <section className="w-full max-w-md rounded-3xl border border-[var(--line)] bg-white p-8 shadow-sm sm:p-10">
      <div className="mb-3 flex justify-end"><ThemeToggle/></div>
      <Link href="/" className="text-sm font-semibold text-indigo-700">← mộc</Link>
      <h1 className="mt-8 text-3xl font-semibold tracking-tight">{isSignup ? "Create your space" : "Welcome back"}</h1>
      <p className="mt-2 text-sm leading-6 text-[var(--muted)]">{isSignup ? "Your private workspace starts with an account." : "Sign in to continue to your documents."}</p>
      <AuthForm mode={mode} />
      <p className="mt-6 text-center text-sm text-[var(--muted)]">{isSignup ? "Already have an account? " : "New to mộc? "}<Link className="font-medium text-indigo-700" href={isSignup ? "/login" : "/signup"}>{isSignup ? "Sign in" : "Create an account"}</Link></p>
    </section>
  </main>;
}
