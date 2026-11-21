import { FileText, LoaderCircle } from "lucide-react";

export default function AppLoading() {
  return <main aria-label="Loading workspace" className="min-h-screen bg-[#f7f8fc] md:pl-64">
    <aside className="fixed inset-y-0 left-0 hidden w-64 border-r border-slate-200/80 bg-white p-6 md:block">
      <div className="h-9 w-36 animate-pulse rounded-lg bg-slate-100" />
      <div className="mt-10 h-16 animate-pulse rounded-xl bg-slate-50" />
      <div className="mt-8 space-y-3">{Array.from({ length: 4 }, (_, index) => <div key={index} className="h-9 animate-pulse rounded-lg bg-slate-50" />)}</div>
    </aside>
    <section className="mx-auto max-w-5xl px-6 py-12">
      <div className="flex items-center justify-between"><div><div className="h-4 w-24 animate-pulse rounded bg-slate-100"/><div className="mt-3 h-9 w-56 animate-pulse rounded bg-slate-100"/></div><LoaderCircle aria-hidden size={18} className="animate-spin text-indigo-500"/></div>
      <div className="mt-9 h-11 max-w-2xl animate-pulse rounded-xl bg-white"/>
      <div className="mt-9 space-y-3 rounded-2xl border border-slate-200 bg-white p-5">{Array.from({ length: 4 }, (_, index) => <div key={index} className="flex items-center gap-4 py-3"><span className="grid size-10 place-items-center rounded-xl bg-indigo-50 text-indigo-400"><FileText size={16}/></span><div className="flex-1"><div className="h-4 w-48 animate-pulse rounded bg-slate-100"/><div className="mt-2 h-3 w-32 animate-pulse rounded bg-slate-50"/></div></div>)}</div>
    </section>
  </main>;
}
