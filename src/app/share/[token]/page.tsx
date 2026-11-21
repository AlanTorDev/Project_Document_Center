import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { DocumentViewer } from "@/features/documents/document-viewer";

type SharedDocument = { title: string; content_json: Record<string, unknown>; updated_at: string; asset_scope: string | null };

export const metadata: Metadata = {
  title: "Shared document | Mộc",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};
export const dynamic = "force-dynamic";

export default async function SharedDocumentPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  if (!/^[A-Za-z0-9_-]{43}$/.test(token)) notFound();
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("get_shared_document", { share_token: token }) as unknown as { data: SharedDocument[] | null; error: { message: string } | null };
  const document = !error ? data?.[0] : null;
  if (!document) notFound();

  return <main className="min-h-screen bg-[var(--background)] px-4 py-10 text-slate-900 sm:px-8 sm:py-16">
    <article className="mx-auto max-w-3xl overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
      <header className="border-b border-slate-100 px-7 py-8 sm:px-12 sm:py-10">
        <p className="text-xs font-semibold uppercase tracking-[.14em] text-indigo-600">Shared document · Read only</p>
        <h1 className="mt-4 break-words text-3xl font-semibold tracking-tight text-slate-900 sm:text-4xl">{document.title}</h1>
      </header>
      <section className="px-7 py-8 sm:px-12 sm:py-10" aria-label="Document content">
        <DocumentViewer content={document.content_json} shareToken={token} assetScope={document.asset_scope}/>
      </section>
    </article>
    <p className="mx-auto mt-5 max-w-3xl text-center text-xs text-slate-400">Anyone with this link can view the document.</p>
  </main>;
}
