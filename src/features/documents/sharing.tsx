"use client";

import { useActionState, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Check, Copy, Link2, LoaderCircle, Share2 } from "lucide-react";
import { createShareLinkAction, revokeShareLinkAction, revokeDocumentShareAction, shareDocumentWithEmailAction, type EmailShareActionState, type ShareLinkActionState } from "./actions";

export type ShareLinkSummary = { id: string; created_at: string; expires_at: string | null; revoked_at: string | null };
export type DocumentShareSummary = { share_id: string; email: string; created_at: string; revoked_at: string | null };

export function DocumentSharing({ documentId, links, shares }: { documentId: string; links: ShareLinkSummary[]; shares: DocumentShareSummary[] }) {
  const router = useRouter();
  const [state, action, pending] = useActionState<ShareLinkActionState, FormData>(createShareLinkAction.bind(null, documentId), {});
  const [emailState, emailAction, emailPending] = useActionState<EmailShareActionState, FormData>(shareDocumentWithEmailAction.bind(null, documentId), {});
  const [origin, setOrigin] = useState("");
  const [copied, setCopied] = useState(false);
  const shareUrl = origin && state.token ? `${origin}/share/${state.token}` : "";

  useEffect(() => { setOrigin(window.location.origin); }, []);
  useEffect(() => { if (state.token) router.refresh(); }, [router, state.token]);
  useEffect(() => { if (emailState.success) router.refresh(); }, [emailState.success, router]);

  const copyLink = async () => {
    if (!shareUrl) return;
    try {
      await navigator.clipboard.writeText(shareUrl);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      setCopied(false);
    }
  };

  return <details className="relative">
    <summary className="inline-flex min-h-10 cursor-pointer list-none items-center gap-2 rounded-lg px-3 py-2 text-xs font-medium text-slate-600 transition hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400"><Share2 size={15}/><span>Share</span></summary>
    <section aria-label="Document sharing" className="absolute right-0 top-full z-40 mt-2 w-[min(22rem,calc(100vw-2rem))] rounded-2xl border border-slate-200 bg-white p-4 shadow-xl sm:p-5">
      <h2 className="text-sm font-semibold text-slate-900">Share this document</h2>
      <p className="mt-1 text-xs leading-5 text-slate-500">Anyone with the link can view it. You can revoke access at any time.</p>
      <form action={emailAction} className="mt-4 border-b border-slate-100 pb-4">
        <label htmlFor="share-email" className="text-xs font-medium text-slate-600">Share with a registered user</label>
        <p className="mt-1 text-[11px] leading-4 text-slate-400">They’ll see it in Shared with me when they sign in.</p>
        <div className="mt-1.5 flex gap-2"><input id="share-email" name="email" type="email" required maxLength={320} autoComplete="email" placeholder="name@example.com" className="min-h-10 min-w-0 flex-1 rounded-lg border border-slate-200 bg-white px-3 text-sm outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100"/><button disabled={emailPending} className="min-h-10 rounded-lg border border-slate-200 px-3 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-60">{emailPending ? "Sharing…" : "Share"}</button></div>
        {emailState.error && <p role="alert" className="mt-2 text-xs text-red-600">{emailState.error}</p>}
        {emailState.message && <p role="status" className="mt-2 text-xs text-emerald-700">{emailState.message}</p>}
      </form>
      <form action={action} className="mt-4 flex items-end gap-2">
        <label className="min-w-0 flex-1 text-xs font-medium text-slate-600">Link expires
          <select name="expires_in" defaultValue="30" className="mt-1.5 min-h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100">
            <option value="7">In 7 days</option><option value="30">In 30 days</option><option value="never">Never</option>
          </select>
        </label>
        <button disabled={pending} className="inline-flex min-h-10 shrink-0 items-center gap-2 rounded-lg bg-indigo-600 px-3 text-xs font-semibold text-white hover:bg-indigo-700 disabled:opacity-60">{pending ? <LoaderCircle size={14} className="animate-spin"/> : <Link2 size={14}/>}Create link</button>
      </form>
      {state.error && <p role="alert" className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">{state.error}</p>}
      {state.token && <div className="mt-3 rounded-xl border border-indigo-100 bg-indigo-50/70 p-3">
        <p className="text-xs font-medium text-indigo-900">Link created</p>
        {shareUrl ? <div className="mt-2 flex items-center gap-2"><input aria-label="Share link" readOnly value={shareUrl} className="min-w-0 flex-1 rounded-lg border border-indigo-100 bg-white px-2.5 py-2 text-xs text-slate-700"/><button type="button" onClick={() => void copyLink()} aria-label="Copy share link" className="grid size-9 shrink-0 place-items-center rounded-lg bg-white text-indigo-700 ring-1 ring-indigo-100 hover:bg-indigo-100">{copied ? <Check size={15}/> : <Copy size={15}/>}</button></div> : <p className="mt-1 text-xs text-indigo-700">Preparing link…</p>}
        {copied && <p role="status" className="mt-1 text-xs text-indigo-700">Copied to clipboard</p>}
      </div>}
      <div className="mt-4 border-t border-slate-100 pt-3">
        <p className="text-xs font-medium text-slate-600">People with access ({shares.filter((share) => !share.revoked_at).length})</p>
        {shares.length > 0 && <ul className="mt-2 max-h-36 space-y-2 overflow-y-auto">
          {shares.map((share) => <li key={share.share_id} className="flex items-center justify-between gap-3 rounded-lg bg-slate-50 px-3 py-2">
            <div className="min-w-0"><p className="truncate text-xs font-medium text-slate-700">{share.email}</p><p className="mt-0.5 text-[11px] text-slate-400">{share.revoked_at ? "Access revoked" : "Can view"}</p></div>
            {!share.revoked_at && <form action={revokeDocumentShareAction.bind(null, documentId, share.share_id)}><button className="min-h-8 shrink-0 rounded-md px-2 text-xs font-medium text-red-600 hover:bg-red-50">Revoke</button></form>}
          </li>)}
        </ul>}
      </div>
      <div className="mt-4 border-t border-slate-100 pt-3">
        <p className="text-xs font-medium text-slate-600">Links ({links.length})</p>
        {links.length === 0 ? <p className="mt-2 text-xs text-slate-400">No links yet.</p> : <ul className="mt-2 max-h-40 space-y-2 overflow-y-auto">
          {links.map((link) => <li key={link.id} className="flex items-center justify-between gap-3 rounded-lg bg-slate-50 px-3 py-2">
            <div className="min-w-0"><p className="truncate text-xs font-medium text-slate-700">{link.revoked_at ? "Revoked" : link.expires_at ? `Expires ${link.expires_at.slice(0, 10)}` : "Never expires"}</p><p className="mt-0.5 text-[11px] text-slate-400">Created {link.created_at.slice(0, 10)}</p></div>
            {!link.revoked_at && <form action={revokeShareLinkAction.bind(null, documentId, link.id)}><button className="min-h-8 shrink-0 rounded-md px-2 text-xs font-medium text-red-600 hover:bg-red-50">Revoke</button></form>}
          </li>)}
        </ul>}
      </div>
    </section>
  </details>;
}
