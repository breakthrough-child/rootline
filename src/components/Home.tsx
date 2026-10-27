"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { textToInput } from "@/lib/adapters/text";
import { wordCount } from "@/lib/text";
import type { CandidateClaim, ExtractedInput } from "@/lib/types";
import { Spinner } from "./bits";
import { InputReview } from "./InputReview";
import { ResultView } from "./ResultView";
import { useRun } from "./useRun";

interface Status {
  demoMode: boolean;
  offlineMock: boolean;
  llm: Record<string, boolean>;
  asr: boolean;
  search: boolean;
  fixtures: { id: string; title: string; chip: string; description: string }[];
}

const ACCEPT = ".png,.jpg,.jpeg,.webp,.mp3,.m4a,.ogg,.opus,.wav,.mp4,.mov,.webm,.pdf,.docx,.xlsx,.pptx";

export function Home() {
  const [text, setText] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [status, setStatus] = useState<Status | null>(null);
  const [phase, setPhase] = useState<"compose" | "extracting" | "review" | "run">("compose");
  const [review, setReview] = useState<{ input: ExtractedInput; claims: CandidateClaim[] } | null>(null);
  const [runInput, setRunInput] = useState<ExtractedInput | undefined>();
  const extract = useRun();
  const run = useRun();
  const [drag, setDrag] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    fetch("/api/status")
      .then((r) => r.json())
      .then(setStatus)
      .catch(() => undefined);
  }, []);

  // Paste screenshots straight from the clipboard.
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      if (phase !== "compose") return;
      const imgs = [...(e.clipboardData?.files ?? [])].filter((f) => f.type.startsWith("image/"));
      if (imgs.length) {
        e.preventDefault();
        setFiles(imgs.map((f, i) => new File([f], f.name && f.name !== "image.png" ? f.name : `pasted-${i + 1}.png`, { type: f.type })));
      }
    };
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  }, [phase]);

  useEffect(() => {
    if (extract.state.extracted && phase === "extracting") {
      setReview(extract.state.extracted);
      setPhase("review");
    }
  }, [extract.state.extracted, phase]);

  const startRun = useCallback(
    (input: ExtractedInput, claims: { id: string; text: string }[]) => {
      setRunInput(input);
      setPhase("run");
      run.start("/api/run", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ input, claims }) });
      window.scrollTo({ top: 0, behavior: "smooth" });
    },
    [run],
  );

  const submit = () => {
    if (files.length) {
      const form = new FormData();
      files.forEach((f) => form.append("files", f));
      setPhase("extracting");
      extract.start("/api/extract", { method: "POST", body: form });
      return;
    }
    const t = text.trim();
    if (!t) return;
    if (wordCount(t) > 180) {
      setPhase("extracting");
      extract.start("/api/extract", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text: t }) });
      return;
    }
    const input = textToInput(t);
    startRun(input, [{ id: "k0", text: input.text }]);
  };

  const demo = (id: string) => {
    setRunInput(undefined);
    setPhase("run");
    run.start(`/api/demo/${id}`);
  };

  const startOver = () => {
    run.reset();
    extract.reset();
    setFiles([]);
    setReview(null);
    setPhase("compose");
  };

  if (phase === "run")
    return (
      <div className="pt-6">
        <div className="mb-4 flex items-center justify-between gap-2">
          <button onClick={startOver} className="text-sm text-muted hover:text-ink">← New trace</button>
        </div>
        <ResultView state={run.state} input={runInput} />
      </div>
    );

  if (phase === "review" && review)
    return (
      <div className="pt-6">
        <button onClick={startOver} className="mb-4 text-sm text-muted hover:text-ink">← Start over</button>
        <InputReview input={review.input} claims={review.claims} files={files} onRun={startRun} logs={extract.state.logs} />
      </div>
    );

  const kinds = files.length ? [...new Set(files.map((f) => f.name.split(".").pop()?.toLowerCase()))].join(", ") : "";
  return (
    <div className="mx-auto max-w-3xl pt-10 sm:pt-16">
      <h1 className="text-balance font-serif text-3xl leading-tight sm:text-5xl">See where it really came from before you forward it.</h1>
      <p className="mt-3 text-muted">Rootline finds earlier versions of a message and shows how it changed.</p>

      <div className="card mt-8 p-3 sm:p-4">
        <label htmlFor="msg" className="sr-only">Paste a forwarded message</label>
        <textarea
          id="msg"
          value={text}
          onChange={(e) => setText(e.target.value)}
          disabled={!!files.length || phase === "extracting"}
          placeholder="Paste a forwarded message…"
          rows={6}
          className="w-full resize-y rounded-lg bg-transparent p-2 text-[15px] leading-relaxed outline-none placeholder:text-muted disabled:opacity-50"
        />
        <div
          onDragOver={(e) => {
            e.preventDefault();
            setDrag(true);
          }}
          onDragLeave={() => setDrag(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDrag(false);
            setFiles([...e.dataTransfer.files]);
          }}
          onClick={() => fileRef.current?.click()}
          role="button"
          tabIndex={0}
          onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && fileRef.current?.click()}
          className={`mt-2 cursor-pointer rounded-lg border border-dashed px-4 py-4 text-center text-sm transition ${drag ? "border-accent bg-accent-soft" : "border-line hover:bg-surface-2"}`}
        >
          {files.length ? (
            <span>
              {files.length} file{files.length > 1 ? "s" : ""} ready ({kinds}) ·{" "}
              <button
                className="text-accent underline"
                onClick={(e) => {
                  e.stopPropagation();
                  setFiles([]);
                }}
              >
                remove
              </button>
            </span>
          ) : (
            <span className="text-muted">
              Or drop / paste a <b className="font-medium text-ink">screenshot</b>, <b className="font-medium text-ink">voice note</b>, video or document
              <span className="block text-xs">PNG · JPG · WebP · MP3 · M4A · OGG · WAV · MP4 · MOV · PDF · DOCX · XLSX · PPTX</span>
            </span>
          )}
          <input
            ref={fileRef}
            type="file"
            multiple
            accept={ACCEPT}
            className="hidden"
            onChange={(e) => {
              setFiles([...(e.target.files ?? [])]);
              e.target.value = "";
            }}
          />
        </div>
        <div className="mt-3 flex items-center justify-between gap-3">
          <p className="text-xs text-muted">Uploads are deleted after reading. We keep only extracted text and results.</p>
          <button onClick={submit} disabled={phase === "extracting" || (!text.trim() && !files.length)} className="shrink-0 rounded-lg bg-accent px-4 py-2.5 text-sm font-semibold text-accent-ink transition hover:opacity-90 disabled:opacity-40">
            {phase === "extracting" ? "Reading…" : "Trace it"}
          </button>
        </div>
      </div>

      {phase === "extracting" && (
        <div className="mt-4 flex items-center gap-2 text-sm text-muted" aria-live="polite">
          <Spinner /> {extract.state.stages[extract.state.stages.length - 1]?.message ?? "Uploading…"}
        </div>
      )}
      {extract.state.errors.length > 0 && (
        <div className="mt-4 rounded-xl border border-rose/40 bg-rose-soft px-4 py-3 text-sm text-rose" role="alert">
          {extract.state.errors.map((e, i) => (
            <p key={i}>{e}</p>
          ))}
          <button
            className="mt-2 underline"
            onClick={() => {
              extract.reset();
              setPhase("compose");
            }}
          >
            Try again
          </button>
        </div>
      )}

      {status?.fixtures?.length ? (
        <div className="mt-8">
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">Try an example (replay of a saved run)</p>
          <div className="flex flex-wrap gap-2">
            {status.fixtures.map((f) => (
              <button key={f.id} onClick={() => demo(f.id)} title={f.description} className="rounded-full border border-line bg-surface px-3.5 py-1.5 text-sm hover:border-accent hover:bg-accent-soft">
                {f.chip}
              </button>
            ))}
          </div>
        </div>
      ) : null}

      {status && !status.search && !status.demoMode && (
        <p className="mt-6 rounded-lg bg-amber-soft px-3 py-2 text-sm text-amber">Live tracing isn&apos;t configured on this deployment. The examples above still work.</p>
      )}
      {status?.offlineMock && <p className="mt-6 rounded-lg bg-amber-soft px-3 py-2 text-sm text-amber">Offline mock mode: live traces use a fictional built-in corpus, not the real web.</p>}

      <section className="mt-14 grid gap-6 text-sm sm:grid-cols-3">
        <div>
          <h2 className="mb-1 font-semibold">Family tree, not a verdict</h2>
          <p className="text-muted">Every version links to a real source with the exact excerpt found. Edges are labelled “likely lineage” with confidence.</p>
        </div>
        <div>
          <h2 className="mb-1 font-semibold">See the mutation</h2>
          <p className="text-muted">Spot where a number was inflated, a place swapped, or a fake authority added — and when it spread.</p>
        </div>
        <div>
          <h2 className="mb-1 font-semibold">Reply kindly</h2>
          <p className="text-muted">Get a short, calm reply card to send back to the family group.</p>
        </div>
      </section>
    </div>
  );
}
