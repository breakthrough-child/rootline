"use client";
import { toPng } from "html-to-image";
import { useMemo, useRef, useState } from "react";
import { mutationChip } from "@/lib/heuristics";
import type { ClaimResult, LineageEdge, OfficialCheck, PostExistsCheck, Variant } from "@/lib/types";
import { ConfidencePill, DateBadge, fmtDate, PageTypeBadge, PROVENANCE_LABEL, SourceLink, Spinner } from "./bits";

export function StageProgress({ stages, running }: { stages: { stage: string; message: string }[]; running: boolean }) {
  const steps = [
    { k: "A", label: "Understand" },
    { k: "B", label: "Search" },
    { k: "C", label: "Confirm" },
    { k: "D", label: "Compare" },
    { k: "F", label: "Lineage" },
    { k: "G", label: "Summary" },
  ];
  const seen = new Set(stages.map((s) => s.stage));
  const last = stages[stages.length - 1];
  const currentIdx = Math.max(-1, ...steps.map((s, i) => (seen.has(s.k) ? i : -1)));
  return (
    <div className="card p-4" aria-live="polite">
      <ol className="mb-3 flex gap-1">
        {steps.map((s, i) => (
          <li key={s.k} className="flex-1">
            <div className={`h-1.5 rounded-full ${i < currentIdx || (!running && i <= currentIdx) ? "bg-accent" : i === currentIdx ? "pulse-dot bg-accent" : "bg-line"}`} />
            <span className={`mt-1 hidden text-[11px] sm:block ${i <= currentIdx ? "text-ink" : "text-muted"}`}>{s.label}</span>
          </li>
        ))}
      </ol>
      <p className="flex items-center gap-2 text-sm text-muted">
        {running && <Spinner />}
        {last?.message ?? "Starting…"}
      </p>
    </div>
  );
}

function DetectedChanges({ edge, parent }: { edge: LineageEdge; parent?: Variant }) {
  const [showWeak, setShowWeak] = useState(false);
  const strong = edge.mutations.filter((m) => m.strength === "strong" || (m.strength === undefined && !["detail_added", "detail_removed", "other"].includes(m.type)));
  const weak = edge.mutations.filter((m) => !strong.includes(m));
  const row = (m: LineageEdge["mutations"][number], i: number) => (
    <li key={i} className="rounded-lg border border-line p-2">
      <span className="mr-1 rounded bg-amber-soft px-1.5 py-0.5 text-[11px] font-semibold text-amber">{m.type.replace(/_/g, " ")}</span>
      <span className="text-[13px]">{mutationChip(m)}</span>
      {m.explanation && <p className="mt-1 text-xs text-muted">{m.explanation}</p>}
    </li>
  );
  return (
    <section>
      <h4 className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted">Detected changes from its likely parent</h4>
      <p className="mb-2 text-xs text-muted">
        Likely lineage · <ConfidencePill c={edge.confidence} /> {edge.reason && <>— {edge.reason}</>}
      </p>
      {parent && <p className="mb-2 line-clamp-3 text-xs text-muted">Parent: “{parent.excerpt}”</p>}
      {edge.evidenceOnly ? (
        <p className="rounded-lg bg-surface-2 p-2 text-xs text-muted">One end of this link is an evidence page with no clean quoted copy of the message, so no changes are labelled here.</p>
      ) : (
        <>
          <ul className="space-y-1.5">{strong.length ? strong.map(row) : <li className="text-xs text-muted">No strong changes detected.</li>}</ul>
          {weak.length > 0 && (
            <>
              <button onClick={() => setShowWeak((x) => !x)} className="mt-2 text-xs text-accent underline" aria-expanded={showWeak}>
                {showWeak ? "Hide" : "Show"} {weak.length} weaker change{weak.length > 1 ? "s" : ""}
              </button>
              {showWeak && (
                <>
                  <p className="mt-1 text-[11px] text-muted">Less certain: lower-signal types or labels the review pass changed. Treat with caution.</p>
                  <ul className="mt-1 space-y-1.5 opacity-80">{weak.map(row)}</ul>
                </>
              )}
            </>
          )}
        </>
      )}
    </section>
  );
}

export function NodePanel({ variant, edges, variants, onClose }: { variant: Variant; edges: LineageEdge[]; variants: Variant[]; onClose: () => void }) {
  const incoming = edges.find((e) => e.to === variant.id);
  const parent = incoming ? variants.find((v) => v.id === incoming.from) : undefined;
  const children = edges.filter((e) => e.from === variant.id).length;
  return (
    <aside className="card flex max-h-[75vh] flex-col overflow-hidden" aria-label="Version details">
      <div className="flex items-center justify-between border-b border-line px-4 py-3">
        <div className="flex items-center gap-2">
          <PageTypeBadge type={variant.pageType} />
          <span className="text-sm font-medium">{variant.isUserInput ? "Your copy" : "Version details"}</span>
        </div>
        <button onClick={onClose} className="rounded-md px-2 py-1 text-muted hover:bg-surface-2" aria-label="Close details">✕</button>
      </div>
      <div className="space-y-4 overflow-y-auto p-4 text-sm">
        <section>
          <h4 className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted">Exact excerpt</h4>
          <blockquote className="rounded-lg border-l-4 border-accent bg-surface-2 p-3 font-serif leading-relaxed">“{variant.excerpt}”</blockquote>
        </section>
        <section>
          <h4 className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted">Date</h4>
          <DateBadge date={variant.date} provenance={variant.dateProvenance} />
          <p className="mt-1 text-xs text-muted">{PROVENANCE_LABEL[variant.dateProvenance]}.</p>
        </section>
        {incoming && <DetectedChanges edge={incoming} parent={parent} />}
        <section>
          <h4 className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted">Sources ({variant.sources.length})</h4>
          <ul className="space-y-2">
            {variant.sources.map((s) => (
              <li key={s.url} className="rounded-lg border border-line p-2">
                <div className="flex flex-wrap items-center gap-1.5">
                  <PageTypeBadge type={s.pageType} />
                  <SourceLink url={s.url} />
                </div>
                {s.title && <p className="mt-1 text-xs">{s.title}</p>}
                <p className="mt-1 text-xs text-muted">
                  <DateBadge date={s.date} provenance={s.dateProvenance} />
                </p>
              </li>
            ))}
          </ul>
        </section>
        {children > 0 && <p className="text-xs text-muted">{children} later version{children > 1 ? "s" : ""} likely descend from this one.</p>}
      </div>
    </aside>
  );
}

export function Timeline({ variants, earliestId, onSelect, selectedId }: { variants: Variant[]; earliestId: string | null; onSelect: (id: string) => void; selectedId: string | null }) {
  const dated = variants.filter((v) => v.date).sort((a, b) => a.date!.localeCompare(b.date!));
  const undated = variants.filter((v) => !v.date);
  if (!dated.length) return null;
  const t0 = Date.parse(dated[0].date!);
  const t1 = Date.parse(dated[dated.length - 1].date!);
  const span = Math.max(1, t1 - t0);
  return (
    <div className="card px-4 pb-3 pt-4">
      <div className="mb-2 flex items-center justify-between text-xs text-muted">
        <span>Timeline</span>
        {undated.length > 0 && <span>{undated.length} undated</span>}
      </div>
      <div className="relative mx-2 h-10">
        <div className="absolute left-0 right-0 top-1/2 h-px bg-line" />
        {dated.map((v) => {
          const x = ((Date.parse(v.date!) - t0) / span) * 100;
          return (
            <button
              key={v.id}
              onClick={() => onSelect(v.id)}
              title={`${fmtDate(v.date!)} — ${v.excerpt.slice(0, 80)}`}
              aria-label={`Version from ${fmtDate(v.date!)}`}
              style={{ left: `${x}%` }}
              className={`absolute top-1/2 h-3.5 w-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-surface transition ${v.id === selectedId ? "scale-150" : ""} ${v.id === earliestId ? "bg-accent" : v.pageType === "debunk" ? "bg-blue" : "bg-amber"}`}
            />
          );
        })}
      </div>
      <div className="flex justify-between text-[11px] text-muted">
        <span>{fmtDate(dated[0].date!)}</span>
        <span>{fmtDate(dated[dated.length - 1].date!)}</span>
      </div>
      <div className="mt-1 flex gap-3 text-[11px] text-muted">
        <span><span className="mr-1 inline-block h-2 w-2 rounded-full bg-accent" />earliest found</span>
        <span><span className="mr-1 inline-block h-2 w-2 rounded-full bg-amber" />version</span>
        <span><span className="mr-1 inline-block h-2 w-2 rounded-full bg-blue" />fact-check</span>
      </div>
    </div>
  );
}

export function SummaryPanel({ result }: { result: ClaimResult }) {
  const v = result.verdict;
  const earliest = result.variants.find((x) => x.id === result.earliestId);
  return (
    <section className="card p-5" aria-label="Summary">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <h3 className="text-base font-semibold">How it evolved</h3>
        <ConfidencePill c={v.confidence} />
        <span className="text-xs text-muted">likely lineage · inferred from public sources</span>
      </div>
      <p className="leading-relaxed">{v.summary}</p>
      {earliest && (
        <p className="mt-3 text-sm text-muted">
          Earliest version found: <DateBadge date={earliest.date} provenance={earliest.dateProvenance} /> · <SourceLink url={earliest.sources[0].url} />
        </p>
      )}
      {v.whatChanged.length > 0 && (
        <>
          <h4 className="mb-1 mt-4 text-xs font-semibold uppercase tracking-wide text-muted">Detected changes</h4>
          <ul className="list-disc space-y-1 pl-5 text-sm">
            {v.whatChanged.map((w, i) => (
              <li key={i}>{w}</li>
            ))}
          </ul>
        </>
      )}
      {v.unsupported.length > 0 && (
        <>
          <h4 className="mb-1 mt-4 text-xs font-semibold uppercase tracking-wide text-muted">What sources contradict</h4>
          <ul className="space-y-2 text-sm">
            {v.unsupported.map((u, i) => (
              <li key={i} className="rounded-lg bg-rose-soft p-2.5">
                <p className="text-rose">{u.statement}</p>
                <p className="mt-1 flex flex-wrap gap-x-3 text-xs">
                  {u.sourceUrls.map((s) => (
                    <SourceLink key={s} url={s} />
                  ))}
                </p>
              </li>
            ))}
          </ul>
        </>
      )}
      {result.warnings.length > 0 && <p className="mt-4 text-xs text-muted">Note: {result.warnings.join(" ")}</p>}
    </section>
  );
}

export function ReplyCard({ text, earliestDate, shareUrl }: { text: string; earliestDate: string | null; shareUrl?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);
  const full = shareUrl ? `${text}\n\nTraced with Rootline: ${shareUrl}` : text;
  const wa = `https://wa.me/?text=${encodeURIComponent(full)}`;
  const download = async () => {
    if (!ref.current) return;
    setBusy(true);
    try {
      const url = await toPng(ref.current, { pixelRatio: 2, cacheBust: true });
      const a = document.createElement("a");
      a.href = url;
      a.download = "rootline-reply.png";
      a.click();
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="card p-5" aria-label="Reply card">
      <h3 className="mb-3 text-base font-semibold">Reply to the group</h3>
      <div ref={ref} className="rounded-2xl p-5" style={{ background: "linear-gradient(135deg,#1f6f5c,#174f43)", color: "#fff" }}>
        <p className="mb-3 text-[11px] font-semibold uppercase tracking-[0.14em] opacity-80">Before you forward</p>
        <p className="text-[17px] leading-relaxed">{text}</p>
        <p className="mt-4 flex items-center justify-between text-[11px] opacity-80">
          <span>{earliestDate ? `Earliest version found: ${fmtDate(earliestDate)}` : "Traced with public sources"}</span>
          <span className="font-semibold">Rootline</span>
        </p>
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        <a href={wa} target="_blank" rel="noopener noreferrer" className="rounded-lg bg-accent px-3.5 py-2 text-sm font-medium text-accent-ink hover:opacity-90">Share to WhatsApp</a>
        <button
          onClick={async () => {
            await navigator.clipboard.writeText(full);
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          }}
          className="rounded-lg border border-line px-3.5 py-2 text-sm hover:bg-surface-2"
        >
          {copied ? "Copied" : "Copy text"}
        </button>
        <button onClick={download} disabled={busy} className="rounded-lg border border-line px-3.5 py-2 text-sm hover:bg-surface-2 disabled:opacity-50">
          {busy ? "Rendering…" : "Download PNG"}
        </button>
      </div>
    </section>
  );
}

const PLATFORM_NAME: Record<string, string> = { x: "X", facebook: "Facebook", instagram: "Instagram", tiktok: "TikTok", whatsapp: "WhatsApp", news_site: "a news site" };

export function PostExistsPanel({ check, platform: rawPlatform }: { check: PostExistsCheck; platform?: string }) {
  const platform = rawPlatform ? PLATFORM_NAME[rawPlatform] : undefined;
  const tone = check.outcome === "found_matching" ? "accent" : check.outcome === "found_altered" ? "amber" : "rose";
  const title = check.outcome === "found_matching" ? "Matching post found" : check.outcome === "found_altered" ? "A post was found, but the wording differs" : "No evidence this post exists";
  return (
    <section className={`card border-l-4 p-4 ${tone === "accent" ? "border-l-accent" : tone === "amber" ? "border-l-amber" : "border-l-rose"}`} aria-label="Does this post actually exist?">
      <p className="text-xs font-semibold uppercase tracking-wide text-muted">Does this post actually exist?</p>
      <h3 className="mt-1 text-base font-semibold">{title}</h3>
      <p className="mt-1 text-sm text-muted">
        {check.outcome === "not_found" ? `We searched for this text from ${check.handle ?? "this account"}${platform ? ` on ${platform}` : ""} and found nothing. It may be deleted, private or fabricated.` : check.note}
      </p>
      {check.url && (
        <p className="mt-2 text-sm">
          <SourceLink url={check.url}>View the post found</SourceLink>
        </p>
      )}
      {check.differences?.length ? (
        <ul className="mt-2 space-y-1 text-sm">
          {check.differences.map((d, i) => (
            <li key={i} className="rounded-md bg-surface-2 p-2">
              <span className="text-muted line-through">{d.before || "(not in found post)"}</span> → <span>{d.after || "(missing in screenshot)"}</span>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}

export function OfficialPanel({ check }: { check: OfficialCheck }) {
  const map = {
    official_match_found: { t: "Official match found", c: "border-l-accent" },
    official_version_differs: { t: "The official version differs", c: "border-l-amber" },
    no_official_record_found: { t: "No official record found", c: "border-l-rose" },
    already_debunked: { t: "Already debunked", c: "border-l-rose" },
    not_applicable: { t: "Not an official-looking document", c: "border-l-line" },
  } as const;
  const m = map[check.outcome];
  return (
    <section className={`card border-l-4 p-4 ${m.c}`} aria-label="Is this official?">
      <p className="text-xs font-semibold uppercase tracking-wide text-muted">Is this official?</p>
      <h3 className="mt-1 text-base font-semibold">{m.t}</h3>
      <p className="mt-1 text-sm text-muted">{check.note}</p>
      <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
        {check.organization && (
          <>
            <dt className="text-muted">Claims to be from</dt>
            <dd>{check.organization}</dd>
          </>
        )}
        {check.reference && (
          <>
            <dt className="text-muted">Reference</dt>
            <dd>{check.reference}</dd>
          </>
        )}
      </dl>
      {check.url && (
        <p className="mt-2 text-sm">
          <SourceLink url={check.url}>{check.outcome === "already_debunked" ? "Read the fact-check" : "View the official source"}</SourceLink>
        </p>
      )}
      {check.differences?.length ? (
        <ul className="mt-2 list-disc pl-5 text-sm">
          {check.differences.map((d, i) => (
            <li key={i}>{d}</li>
          ))}
        </ul>
      ) : null}
      {Object.keys(check.metadataHints).length > 0 && (
        <details className="mt-3 text-xs text-muted">
          <summary className="cursor-pointer">Unverified metadata (hints only)</summary>
          <dl className="mt-1 grid grid-cols-[auto_1fr] gap-x-3">
            {Object.entries(check.metadataHints).map(([k, v]) => (
              <FragmentRow key={k} k={k} v={v} />
            ))}
          </dl>
        </details>
      )}
    </section>
  );
}

function FragmentRow({ k, v }: { k: string; v: string }) {
  return (
    <>
      <dt>{k}</dt>
      <dd className="break-all">{v}</dd>
    </>
  );
}

export function LimitedFamily({ result }: { result: ClaimResult }) {
  const n = result.variants.filter((v) => !v.isUserInput).length;
  return (
    <section className="card p-5" aria-label="Limited family found">
      <div className="flex items-start gap-3">
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-surface-2 text-lg" aria-hidden>
          🌱
        </span>
        <div>
          <h3 className="font-semibold">Limited family found</h3>
          <p className="mt-1 text-sm text-muted">
            Rootline searched {result.stats.queries} ways and read {result.stats.pagesSearched} pages, but found {n === 0 ? "no earlier versions" : `only ${n} related version${n > 1 ? "s" : ""}`} of this message. We don&apos;t pad the tree with guesses.
            {n === 0 ? " This can mean the message is new, circulates only in private chats, or was reworded heavily." : " Here is what we did find."}
          </p>
          <p className="mt-2 text-sm text-muted">Not finding earlier versions is not evidence the message is true or false.</p>
        </div>
      </div>
    </section>
  );
}

export function useEarliestDate(result?: ClaimResult) {
  return useMemo(() => result?.variants.find((v) => v.id === result.earliestId)?.date ?? null, [result]);
}
