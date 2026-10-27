"use client";
import type { Confidence, DateProvenance, PageType } from "@/lib/types";

export const PROVENANCE_LABEL: Record<DateProvenance, string> = {
  published_date: "Published date reported by the source",
  page_metadata: "Date found in the page text/metadata",
  from_screenshot_unverified: "Shown in the screenshot (unverified)",
  pdf_metadata_unverified: "From document metadata (unverified)",
  unknown: "Date unknown",
};

const PROV_ICON: Record<DateProvenance, string> = {
  published_date: "●",
  page_metadata: "◐",
  from_screenshot_unverified: "◌",
  pdf_metadata_unverified: "◌",
  unknown: "?",
};

export function DateBadge({ date, provenance, compact }: { date: string | null; provenance: DateProvenance; compact?: boolean }) {
  return (
    <span title={PROVENANCE_LABEL[provenance]} className="inline-flex items-center gap-1 whitespace-nowrap">
      <span aria-hidden className={provenance === "published_date" ? "text-accent" : provenance === "unknown" ? "text-muted" : "text-amber"}>
        {PROV_ICON[provenance]}
      </span>
      <span>{date ? fmtDate(date) : "Undated"}</span>
      {!compact && <span className="text-muted">· {provenance.replace(/_/g, " ")}</span>}
      <span className="sr-only">({PROVENANCE_LABEL[provenance]})</span>
    </span>
  );
}

export function fmtDate(d: string) {
  const t = Date.parse(d);
  if (Number.isNaN(t)) return d;
  return new Date(t).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric", timeZone: "UTC" });
}

const TYPE_STYLE: Record<PageType, string> = {
  debunk: "bg-accent-soft text-accent",
  official: "bg-blue-soft text-blue",
  news: "bg-surface-2 text-ink",
  social: "bg-amber-soft text-amber",
  forum: "bg-amber-soft text-amber",
  other: "bg-surface-2 text-muted",
  user_input: "bg-blue-soft text-blue",
};
const TYPE_LABEL: Record<PageType, string> = { debunk: "fact-check", official: "official", news: "news", social: "social", forum: "forum", other: "web", user_input: "you" };

export function PageTypeBadge({ type }: { type: PageType }) {
  return <span className={`rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${TYPE_STYLE[type]}`}>{TYPE_LABEL[type]}</span>;
}

export function ConfidencePill({ c, label = "confidence" }: { c: Confidence; label?: string }) {
  const s = c === "high" ? "bg-accent-soft text-accent" : c === "medium" ? "bg-amber-soft text-amber" : "bg-surface-2 text-muted";
  return <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${s}`}>{c} {label}</span>;
}

export function Spinner() {
  return <span className="pulse-dot inline-block h-2 w-2 rounded-full bg-accent" aria-hidden />;
}

export function hostOf(url: string) {
  if (url.startsWith("upload:") || url.startsWith("user:")) return "Your upload";
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

export function SourceLink({ url, children }: { url: string; children?: React.ReactNode }) {
  if (url.startsWith("upload:") || url.startsWith("user:")) return <span className="text-muted">{children ?? "Your copy"}</span>;
  return (
    <a href={url} target="_blank" rel="noopener noreferrer nofollow" className="break-all text-accent underline decoration-accent/30 underline-offset-2 hover:decoration-accent">
      {children ?? hostOf(url)}
    </a>
  );
}
