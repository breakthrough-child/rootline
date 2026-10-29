"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { ExtractedInput, Investigation } from "@/lib/types";
import { GeneralReports, LimitedFamily, NodePanel, OfficialPanel, PostExistsPanel, ReplyCard, StageProgress, SummaryPanel, Timeline } from "./panels";
import { RoutingDrawer } from "./RoutingDrawer";
import { TreeView } from "./TreeView";
import type { RunState } from "./useRun";

export function ResultView({ state, input, shareable = true }: { state: Pick<RunState, "status" | "stages" | "claims" | "checks" | "logs" | "investigation" | "errors">; input?: ExtractedInput; shareable?: boolean }) {
  const inv = state.investigation;
  const claimIds = useMemo(() => (inv ? inv.claims.map((c) => c.claimId) : Object.keys(state.claims)), [inv, state.claims]);
  const [active, setActive] = useState<string | null>(null);
  const claimId = active && claimIds.includes(active) ? active : claimIds[0];
  const live = claimId ? state.claims[claimId] : undefined;
  const result = inv?.claims.find((c) => c.claimId === claimId) ?? live?.result;
  const variants = result?.variants ?? live?.variants ?? [];
  const edges = result?.edges ?? live?.edges ?? [];
  const [selected, setSelected] = useState<string | null>(null);
  const selectedVariant = variants.find((v) => v.id === selected);
  const onSelect = useCallback((id: string) => setSelected((s) => (s === id ? null : id)), []);
  const running = state.status === "running";
  const theInput = inv?.input ?? input;
  const [shareUrl, setShareUrl] = useState<string | undefined>();
  useEffect(() => {
    if (inv && inv.mode !== "replay") setShareUrl(`${window.location.origin}/r/${inv.id}`);
  }, [inv]);

  return (
    <div className="space-y-4">
      {inv?.modeNote && (
        <div className={`rounded-xl px-4 py-2.5 text-sm ${inv.mode === "offline_mock" || inv.modeNote.includes("FICTIONAL") ? "bg-amber-soft text-amber" : "bg-blue-soft text-blue"}`} role="note">
          {inv.modeNote}
        </div>
      )}
      {(running || !inv) && state.stages.length > 0 && <StageProgress stages={state.stages} running={running} />}
      {state.errors.length > 0 && (
        <div className="rounded-xl border border-rose/40 bg-rose-soft px-4 py-3 text-sm text-rose" role="alert">
          {state.errors.map((e, i) => (
            <p key={i}>{e}</p>
          ))}
        </div>
      )}

      {claimIds.length > 1 && (
        <div className="flex gap-2 overflow-x-auto pb-1" role="tablist" aria-label="Claims">
          {claimIds.map((id, i) => {
            const c = inv?.claims.find((x) => x.claimId === id) ?? state.claims[id]?.result;
            return (
              <button key={id} role="tab" aria-selected={id === claimId} onClick={() => setActive(id)} className={`max-w-[260px] shrink-0 truncate rounded-lg border px-3 py-1.5 text-left text-sm ${id === claimId ? "border-accent bg-accent-soft" : "border-line hover:bg-surface-2"}`}>
                <span className="mr-1 text-muted">Claim {i + 1}</span>
                {c?.claim}
              </button>
            );
          })}
        </div>
      )}

      {(state.checks.postExists || state.checks.official) && (
        <div className="grid gap-4 md:grid-cols-2">
          {state.checks.postExists && <PostExistsPanel check={state.checks.postExists} platform={theInput?.screenshot?.platform} />}
          {state.checks.official && <OfficialPanel check={state.checks.official} />}
        </div>
      )}

      {result?.claim && claimIds.length <= 1 && theInput?.sourceKind !== "text" && (
        <p className="text-sm text-muted">
          Tracing: <span className="text-ink">“{result.claim.slice(0, 220)}{result.claim.length > 220 ? "…" : ""}”</span>
        </p>
      )}

      {result?.kind === "general" && <GeneralReports result={result} />}

      {result?.limited && result.kind !== "general" && <LimitedFamily result={result} />}

      {variants.length > 0 && result?.kind !== "general" && (
        <div className={`grid gap-4 ${selectedVariant ? "lg:grid-cols-[1fr_360px]" : ""}`}>
          <div className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-base font-semibold">
                Likely lineage <span className="font-normal text-muted">· {variants.filter((v) => !v.isUserInput).length} versions found</span>
              </h2>
              <p className="text-xs text-muted">Edges are inferences. Dashed = low confidence. Click a version for its source.</p>
            </div>
            <TreeView variants={variants} edges={edges} earliestId={result?.earliestId ?? null} selectedId={selected} onSelect={onSelect} thumb={theInput?.original.thumbnail} sourceKind={theInput?.sourceKind} />
            <Timeline variants={variants} earliestId={result?.earliestId ?? null} onSelect={onSelect} selectedId={selected} />
          </div>
          {selectedVariant && (
            <div className="fixed inset-x-0 bottom-0 z-40 max-h-[80vh] p-2 lg:static lg:z-auto lg:p-0">
              <NodePanel variant={selectedVariant} edges={edges} variants={variants} onClose={() => setSelected(null)} />
            </div>
          )}
        </div>
      )}

      {result?.kind === "general" && (
        <div className="max-w-xl">
          <ReplyCard text={result.verdict.replyCard} earliestDate={null} shareUrl={shareUrl} />
        </div>
      )}

      {result && result.kind !== "general" && (
        <div className="grid gap-4 lg:grid-cols-[1fr_400px]">
          <SummaryPanel result={result} />
          <ReplyCard text={result.verdict.replyCard} earliestDate={result.variants.find((v) => v.id === result.earliestId)?.date ?? null} shareUrl={shareUrl} />
        </div>
      )}

      {inv && (
        <div className="flex flex-wrap items-center gap-2 pt-2">
          <RoutingDrawer logs={inv.logs} pricing={inv.pricing} input={inv.input} provider={inv.llmProvider} />
          {shareable && <WatchButton inv={inv} />}
          {shareUrl && shareable && <CopyLink url={shareUrl} />}
        </div>
      )}
      {!inv && state.logs.length > 0 && running && <p className="text-xs text-muted">{state.logs.length} model/search calls so far</p>}
    </div>
  );
}

function CopyLink({ url }: { url: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      onClick={async () => {
        await navigator.clipboard.writeText(url);
        setDone(true);
        setTimeout(() => setDone(false), 1500);
      }}
      className="rounded-lg border border-line px-3 py-1.5 text-sm hover:bg-surface-2"
    >
      {done ? "Link copied" : "Copy share link"}
    </button>
  );
}

function WatchButton({ inv }: { inv: Investigation }) {
  const [state, setState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  return (
    <button
      disabled={state === "saving" || state === "saved"}
      onClick={async () => {
        setState("saving");
        const res = await fetch("/api/watchlist", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(inv.mode === "replay" ? { investigation: inv } : { investigationId: inv.id }) });
        setState(res.ok ? "saved" : "error");
      }}
      className="rounded-lg border border-line px-3 py-1.5 text-sm hover:bg-surface-2 disabled:opacity-60"
    >
      {state === "saved" ? "Added to Watchlist ✓" : state === "saving" ? "Saving…" : state === "error" ? "Couldn't save — retry" : "Add to Watchlist"}
    </button>
  );
}
