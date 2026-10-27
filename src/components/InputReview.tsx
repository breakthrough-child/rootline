"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import type { CandidateClaim, ExtractedInput, ModelCallLog } from "@/lib/types";

export function InputReview({ input, claims, files, onRun, logs }: { input: ExtractedInput; claims: CandidateClaim[]; files: File[]; onRun: (input: ExtractedInput, claims: { id: string; text: string }[]) => void; logs: ModelCallLog[] }) {
  const [text, setText] = useState(input.text);
  const multi = claims.length > 1;
  const [picked, setPicked] = useState<Set<string>>(() => new Set(claims.slice(0, 3).map((c) => c.id)));
  const [editedClaims, setEditedClaims] = useState<Record<string, string>>({});
  const objectUrl = useMemo(() => (files[0] ? URL.createObjectURL(files[0]) : null), [files]);
  useEffect(() => () => void (objectUrl && URL.revokeObjectURL(objectUrl)), [objectUrl]);
  const mediaRef = useRef<HTMLAudioElement & HTMLVideoElement>(null);
  const kind = input.sourceKind;

  const go = () => {
    const edited = { ...input, text };
    if (multi) onRun(edited, claims.filter((c) => picked.has(c.id)).map((c) => ({ id: c.id, text: editedClaims[c.id] ?? c.text })));
    else onRun(edited, [{ id: "k0", text }]);
  };

  const label = kind === "image" ? "Text read from the screenshot" : kind === "audio" || kind === "video" ? "Transcript" : "Extracted text";
  const paths = [...new Set(input.adapterPath)];

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold">Check what we read</h1>
        <p className="text-sm text-muted">Fix anything that was misread before tracing. Read via: {paths.join(" · ")}</p>
      </div>
      {input.notes?.map((n) => (
        <p key={n} className="rounded-lg bg-amber-soft px-3 py-2 text-sm text-amber">{n}</p>
      ))}

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="card overflow-hidden p-3">
          {kind === "image" && (files.length ? files.map((f, i) => <ImagePreview key={i} file={f} />) : input.original.thumbnail && <img src={input.original.thumbnail} alt="Uploaded screenshot" className="mx-auto max-h-[520px] rounded-lg" />)}
          {kind === "audio" && objectUrl && <audio ref={mediaRef} src={objectUrl} controls className="w-full" />}
          {kind === "video" && objectUrl && <video ref={mediaRef} src={objectUrl} controls className="max-h-[360px] w-full rounded-lg bg-black" />}
          {(kind === "audio" || kind === "video") && input.locations.length > 0 && (
            <ol className="mt-3 max-h-[360px] space-y-1 overflow-y-auto text-sm">
              {input.locations.map((l, i) => (
                <li key={i}>
                  <button
                    className="w-full rounded-md px-2 py-1 text-left hover:bg-surface-2"
                    onClick={() => {
                      if (mediaRef.current && l.seconds !== undefined) {
                        mediaRef.current.currentTime = l.seconds;
                        void mediaRef.current.play();
                      }
                    }}
                  >
                    <span className="mr-2 font-mono text-xs text-accent">{l.label}</span>
                    {input.text.slice(l.start, l.end)}
                  </button>
                </li>
              ))}
            </ol>
          )}
          {["pdf", "docx", "xlsx", "pptx"].includes(kind) && <DocViewer input={input} claims={claims.filter((c) => picked.has(c.id))} />}
          {Object.keys(input.unverifiedMetadata).length > 0 && (
            <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 border-t border-line pt-2 text-xs text-muted">
              {Object.entries(input.unverifiedMetadata).map(([k, v]) => (
                <Row key={k} k={k} v={v} />
              ))}
            </dl>
          )}
          {input.screenshot && (
            <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 border-t border-line pt-2 text-xs">
              <Row k="Platform" v={input.screenshot.platform} />
              {input.screenshot.display_name && <Row k="Display name" v={input.screenshot.display_name} />}
              {input.screenshot.handle && <Row k="Handle" v={input.screenshot.handle} />}
              <dd className="col-span-2 mt-1 text-muted">All fields are from the screenshot and unverified.</dd>
            </dl>
          )}
        </div>

        <div className="space-y-4">
          {!multi && (
            <div className="card p-3">
              <label htmlFor="edit" className="mb-1 block text-sm font-medium">{label}</label>
              <textarea id="edit" value={text} onChange={(e) => setText(e.target.value)} rows={10} className="w-full resize-y rounded-lg border border-line bg-surface-2 p-2.5 text-[15px] leading-relaxed outline-none focus:border-accent" />
              {input.englishText && input.englishText !== input.text && (
                <p className="mt-2 text-sm text-muted">
                  <span className="font-medium text-ink">English (for searching):</span> {input.englishText}
                </p>
              )}
            </div>
          )}
          {multi && (
            <div className="card p-3">
              <p className="mb-2 text-sm font-medium">Checkable claims found ({claims.length}) — pick up to 5</p>
              <ul className="space-y-2">
                {claims.map((c) => (
                  <li key={c.id} className={`rounded-lg border p-2.5 ${picked.has(c.id) ? "border-accent bg-accent-soft/50" : "border-line"}`}>
                    <label className="flex items-start gap-2">
                      <input
                        type="checkbox"
                        className="mt-1 accent-[var(--accent)]"
                        checked={picked.has(c.id)}
                        onChange={() =>
                          setPicked((p) => {
                            const n = new Set(p);
                            if (n.has(c.id)) n.delete(c.id);
                            else if (n.size < 5) n.add(c.id);
                            return n;
                          })
                        }
                      />
                      <span className="flex-1">
                        <textarea
                          value={editedClaims[c.id] ?? c.text}
                          onChange={(e) => setEditedClaims((x) => ({ ...x, [c.id]: e.target.value }))}
                          rows={2}
                          className="w-full resize-y bg-transparent text-sm outline-none"
                          aria-label="Claim text"
                        />
                        <span className="text-xs text-muted">
                          {c.location && <>{c.location} · </>}score {c.score.toFixed(2)}
                          {c.reason && <> · {c.reason}</>}
                        </span>
                      </span>
                    </label>
                  </li>
                ))}
              </ul>
            </div>
          )}
          <button onClick={go} disabled={multi ? picked.size === 0 : !text.trim()} className="w-full rounded-lg bg-accent px-4 py-3 text-sm font-semibold text-accent-ink hover:opacity-90 disabled:opacity-40">
            Trace {multi ? `${picked.size} claim${picked.size === 1 ? "" : "s"}` : "this"}
          </button>
          {logs.length > 0 && <p className="text-xs text-muted">{logs.length} calls used to read this input.</p>}
        </div>
      </div>
    </div>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <>
      <dt className="text-muted">{k}</dt>
      <dd className="break-words">{v}</dd>
    </>
  );
}

function ImagePreview({ file }: { file: File }) {
  const url = useMemo(() => URL.createObjectURL(file), [file]);
  useEffect(() => () => URL.revokeObjectURL(url), [url]);
  return <img src={url} alt="Uploaded screenshot" className="mx-auto mb-2 max-h-[520px] rounded-lg" />;
}

/** Extracted document text by location, with selected claims highlighted. */
function DocViewer({ input, claims }: { input: ExtractedInput; claims: CandidateClaim[] }) {
  const needles = claims.map((c) => c.text.slice(0, 50).toLowerCase());
  return (
    <div className="max-h-[560px] space-y-3 overflow-y-auto text-sm">
      {input.locations.map((l, i) => {
        const t = input.text.slice(l.start, l.end);
        const hit = needles.some((n) => t.toLowerCase().includes(n.slice(0, 30)));
        return (
          <div key={i} className={`rounded-md p-2 ${hit ? "bg-amber-soft" : ""}`}>
            <p className="mb-0.5 font-mono text-[11px] text-muted">{l.label}</p>
            <p className="whitespace-pre-wrap leading-relaxed">{t}</p>
          </div>
        );
      })}
    </div>
  );
}
