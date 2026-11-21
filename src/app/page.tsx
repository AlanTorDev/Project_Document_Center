import Link from "next/link";
import { ThemeToggle } from "@/components/theme-toggle";

export default function HomePage() {
  return (
    <main className="flex min-h-screen items-center justify-center px-6 py-16">
      <section className="w-full max-w-xl rounded-3xl border border-[var(--line)] bg-white p-10 shadow-sm">
        <div className="mb-10 flex items-center gap-3">
          <div className="grid size-10 place-items-center rounded-xl bg-indigo-600 text-lg font-bold text-white">M</div>
          <div className="ml-auto"><ThemeToggle/></div>
          <span className="text-lg font-semibold tracking-tight">mộc</span>
        </div>
        <p className="mb-3 text-sm font-medium uppercase tracking-[.16em] text-indigo-600">Your personal knowledge space</p>
        <h1 className="text-4xl font-semibold tracking-tight">A quieter place for your ideas.</h1>
        <p className="mt-4 max-w-md leading-7 text-[var(--muted)]">Keep notes, plans, and reference documents together in a private workspace built to stay yours.</p>
        <div className="mt-8 flex flex-wrap gap-3">
          <Link href="/login" className="rounded-xl bg-indigo-600 px-5 py-3 text-sm font-semibold text-white hover:bg-indigo-700">Sign in</Link>
          <Link href="/signup" className="rounded-xl border border-[var(--line)] px-5 py-3 text-sm font-semibold hover:bg-gray-50">Create an account</Link>
        </div>
        <p className="mt-8 border-t border-[var(--line)] pt-5 text-xs text-[var(--muted)]">Private by default · Your documents stay yours</p>
      </section>
    </main>
  );
}
