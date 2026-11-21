"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import type { FormEvent } from "react";
import { useRouter } from "next/navigation";
import { LoaderCircle, Search, X } from "lucide-react";

export function DocumentSearch({ query }: { query: string }) {
  const router = useRouter();
  const [value, setValue] = useState(query);
  const [isPending, startTransition] = useTransition();
  const [waiting, setWaiting] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  const navigate = (nextValue: string) => {
    const nextQuery = nextValue.trim().slice(0, 120);
    setWaiting(false);
    startTransition(() => router.replace(nextQuery ? `/app?q=${encodeURIComponent(nextQuery)}` : "/app", { scroll: false }));
  };

  const onChange = (nextValue: string) => {
    setValue(nextValue);
    if (timer.current) clearTimeout(timer.current);
    if (nextValue.trim() === query) { setWaiting(false); return; }
    setWaiting(true);
    timer.current = setTimeout(() => navigate(nextValue), 400);
  };

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (timer.current) clearTimeout(timer.current);
    navigate(value);
  };

  return <form onSubmit={onSubmit} className="mt-5 flex max-w-3xl gap-2" role="search">
    <label htmlFor="document-search" className="sr-only">Search documents</label>
    <div className="relative min-w-0 flex-1">
      <Search aria-hidden size={17} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400"/>
      <input id="document-search" name="q" value={value} onChange={(event) => onChange(event.target.value)} maxLength={120} placeholder="Search titles, content, folders, and tags…" autoComplete="off" className="min-h-11 w-full rounded-xl border border-slate-200 bg-white py-2.5 pl-10 pr-10 text-sm outline-none placeholder:text-slate-400 focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100"/>
      {value && <button type="button" aria-label="Clear search" onClick={() => { setValue(""); if (timer.current) clearTimeout(timer.current); navigate(""); }} className="absolute right-2 top-1/2 grid size-8 -translate-y-1/2 place-items-center rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400"><X size={16}/></button>}
    </div>
    <button aria-label="Search documents" disabled={isPending || waiting} className="inline-flex min-h-11 min-w-11 items-center justify-center gap-2 rounded-xl bg-slate-900 px-4 text-sm font-medium text-white transition hover:bg-slate-700 disabled:cursor-wait disabled:opacity-75"><span className="hidden sm:inline">Search</span>{isPending || waiting ? <LoaderCircle size={16} className="animate-spin" aria-hidden/> : <Search size={16} className="sm:hidden" aria-hidden/>}</button>
    <span className="sr-only" role="status" aria-live="polite">{isPending || waiting ? "Searching documents" : ""}</span>
  </form>;
}
