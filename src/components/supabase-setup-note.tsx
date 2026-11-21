export function SupabaseSetupNote() {
  return <main className="flex min-h-screen items-center justify-center bg-[#f7f8fa] px-5 py-12">
    <section className="w-full max-w-lg rounded-3xl border border-slate-200 bg-white p-8 shadow-sm sm:p-10">
      <div className="grid size-10 place-items-center rounded-xl bg-indigo-600 font-bold text-white">M</div>
      <p className="mt-7 text-xs font-semibold uppercase tracking-[.16em] text-indigo-600">One-time setup</p>
      <h1 className="mt-2 text-2xl font-semibold tracking-tight">Connect your Supabase project</h1>
      <p className="mt-3 text-sm leading-6 text-slate-500">The app is running, but its Supabase URL and publishable key are not loaded in this project yet. Add them to <code className="rounded bg-slate-100 px-1.5 py-0.5 text-slate-700">.env.local</code> using <code className="rounded bg-slate-100 px-1.5 py-0.5 text-slate-700">.env.example</code>, then restart the dev server.</p>
      <ol className="mt-6 list-decimal space-y-2 pl-5 text-sm text-slate-600"><li>Copy <code>.env.example</code> to <code>.env.local</code>.</li><li>Set <code>NEXT_PUBLIC_SUPABASE_URL</code> and <code>NEXT_PUBLIC_SUPABASE_ANON_KEY</code>.</li><li>Apply the SQL migration in the Supabase project.</li></ol>
      <p className="mt-6 border-t border-slate-100 pt-5 text-xs leading-5 text-slate-400">Use the publishable/anon key. Never place a service role key in a browser environment variable.</p>
    </section>
  </main>;
}
