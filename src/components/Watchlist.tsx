"use client";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import type { WatchItem } from "@/lib/store";
import { fmtDate } from "./bits";
import { ResultView } from "./ResultView";
import { useRun } from "./useRun";

export function Watchlist() {
  const [items, setItems] = useState<WatchItem[] | null>(null);
  const [storage, setStorage] = useState("");
  const [rerunning, setRerunning] = useState<string | null>(null);
  const run = useRun();

  const load = useCallback(async () => {
    const r = await fetch("/api/watchlist", { cache: "no-store" });
    const j = (await r.json()) as { items: WatchItem[]; storage: string };
    setItems(j.items);
    setStorage(j.storage);
  }, []);
  useEffect(() => {
    void load();
  }, [load]);
  useEffect(() => {
    if (run.state.status === "done" || run.state.status === "error") void load();
  }, [run.state.status, load]);

  const newVariants = run.state.investigation?.claims.flatMap((c) => c.variants.filter((v) => v.isNew)) ?? [];

  return (
    <div className="pt-8">
      <h1 className="font-serif text-3xl">Watchlist</h1>
      <p className="mt-1 text-sm text-muted">For newsrooms, fact-checkers, NGOs and comms teams: save investigations and re-run them to catch new mutations.</p>
      {storage === "local-json" && <p className="mt-2 text-xs text-muted">Storage: local JSON (Supabase not configured). Items may not persist across server restarts or deployments.</p>}

      <div className="mt-6 space-y-3">
        {items === null && <p className="text-sm text-muted">Loading…</p>}
        {items?.length === 0 && (
          <div className="card p-6 text-center text-sm text-muted">
            Nothing watched yet. Trace a message and choose <b>Add to Watchlist</b>. <Link href="/" className="text-accent underline">Trace one now</Link>
          </div>
        )}
        {items?.map((it) => {
          const last = it.runs[it.runs.length - 1];
          return (
            <div key={it.id} className="card flex flex-col gap-3 p-4 sm:flex-row sm:items-center">
              <div className="min-w-0 flex-1">
                <p className="line-clamp-2 font-medium">“{it.label}”</p>
                <p className="mt-1 text-xs text-muted">
                  Watched since {fmtDate(it.createdAt)} · {it.runs.length} run{it.runs.length > 1 ? "s" : ""} · last {fmtDate(it.lastRunAt)} · {last.variantCount} versions
                  {last.newCount > 0 && <span className="ml-1 rounded bg-amber-soft px-1.5 py-0.5 font-semibold text-amber">{last.newCount} new</span>}
                </p>
              </div>
              <div className="flex shrink-0 gap-2">
                <Link href={`/r/${it.investigationId}`} className="rounded-lg border border-line px-3 py-1.5 text-sm hover:bg-surface-2">Open</Link>
                <button
                  disabled={run.state.status === "running"}
                  onClick={() => {
                    setRerunning(it.id);
                    run.start(`/api/watchlist/${it.id}/rerun`, { method: "POST" });
                  }}
                  className="rounded-lg bg-accent px-3 py-1.5 text-sm font-medium text-accent-ink disabled:opacity-50"
                >
                  {run.state.status === "running" && rerunning === it.id ? "Re-running…" : "Re-run"}
                </button>
                <button
                  onClick={async () => {
                    await fetch(`/api/watchlist?id=${it.id}`, { method: "DELETE" });
                    void load();
                  }}
                  className="rounded-lg px-2 py-1.5 text-sm text-muted hover:bg-surface-2"
                  aria-label="Remove from watchlist"
                >
                  ✕
                </button>
              </div>
            </div>
          );
        })}
      </div>

      {rerunning && run.state.status !== "idle" && (
        <div className="mt-8">
          {run.state.status === "done" && run.state.investigation && (
            <p className={`mb-3 rounded-lg px-3 py-2 text-sm ${newVariants.length ? "bg-amber-soft text-amber" : "bg-accent-soft text-accent"}`}>
              {newVariants.length ? `${newVariants.length} new version${newVariants.length > 1 ? "s" : ""} since the last run — highlighted in the tree.` : "No new versions since the last run."}
            </p>
          )}
          <ResultView state={run.state} shareable={false} />
        </div>
      )}
    </div>
  );
}
