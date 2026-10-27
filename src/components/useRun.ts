"use client";
import { useCallback, useRef, useState } from "react";
import type { CandidateClaim, ClaimResult, ExtractedInput, Investigation, LineageEdge, ModelCallLog, OfficialCheck, PostExistsCheck, RunEvent, Variant } from "@/lib/types";

export interface LiveClaim {
  claimId: string;
  variants: Variant[];
  edges: LineageEdge[];
  result?: ClaimResult;
}

export interface RunState {
  status: "idle" | "running" | "done" | "error";
  stages: { stage: string; message: string; claimId?: string; at: number }[];
  claims: Record<string, LiveClaim>;
  logs: ModelCallLog[];
  checks: { postExists?: PostExistsCheck; official?: OfficialCheck };
  investigation?: Investigation;
  errors: string[];
  extracted?: { input: ExtractedInput; claims: CandidateClaim[] };
}

const initial: RunState = { status: "idle", stages: [], claims: {}, logs: [], checks: {}, errors: [] };

/** Read a text/event-stream response body and yield parsed RunEvents. */
export async function* readSse(res: Response): AsyncGenerator<RunEvent> {
  if (!res.body) return;
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let i: number;
    while ((i = buf.indexOf("\n\n")) >= 0) {
      const chunk = buf.slice(0, i);
      buf = buf.slice(i + 2);
      const data = chunk
        .split("\n")
        .filter((l) => l.startsWith("data: "))
        .map((l) => l.slice(6))
        .join("\n");
      if (data) {
        try {
          yield JSON.parse(data) as RunEvent;
        } catch {
          /* ignore malformed */
        }
      }
    }
  }
}

export function useRun() {
  const [state, setState] = useState<RunState>(initial);
  const abortRef = useRef<AbortController | null>(null);

  const reset = useCallback(() => {
    abortRef.current?.abort();
    setState(initial);
  }, []);

  const start = useCallback(async (url: string, init?: RequestInit) => {
    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;
    setState({ ...initial, status: "running" });
    try {
      const res = await fetch(url, { ...init, signal: ac.signal });
      if (!res.ok || !res.headers.get("content-type")?.includes("text/event-stream")) {
        const j = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(j.error || `Request failed (${res.status})`);
      }
      for await (const e of readSse(res)) apply(e);
      setState((s) => (s.status === "running" ? { ...s, status: s.investigation || s.extracted ? "done" : s.errors.length ? "error" : "done" } : s));
    } catch (err) {
      if ((err as Error).name === "AbortError") return;
      setState((s) => ({ ...s, status: "error", errors: [...s.errors, (err as Error).message] }));
    }

    function apply(e: RunEvent) {
      setState((s) => {
        switch (e.type) {
          case "stage":
            return { ...s, stages: [...s.stages, { stage: e.stage, message: e.message, claimId: e.claimId, at: Date.now() }] };
          case "log":
            return { ...s, logs: [...s.logs, e.log] };
          case "node": {
            const c = s.claims[e.claimId] ?? { claimId: e.claimId, variants: [], edges: [] };
            if (c.variants.some((v) => v.id === e.variant.id)) return s;
            return { ...s, claims: { ...s.claims, [e.claimId]: { ...c, variants: [...c.variants, e.variant] } } };
          }
          case "edge": {
            const c = s.claims[e.claimId] ?? { claimId: e.claimId, variants: [], edges: [] };
            return { ...s, claims: { ...s.claims, [e.claimId]: { ...c, edges: [...c.edges, e.edge] } } };
          }
          case "claim_done":
            return { ...s, claims: { ...s.claims, [e.claim.claimId]: { claimId: e.claim.claimId, variants: e.claim.variants, edges: e.claim.edges, result: e.claim } } };
          case "check":
            return { ...s, checks: { ...s.checks, ...(e.postExists ? { postExists: e.postExists } : {}), ...(e.official ? { official: e.official } : {}) } };
          case "result":
            return { ...s, status: "done", investigation: e.investigation, checks: e.investigation.checks, logs: e.investigation.logs };
          case "extracted":
            return { ...s, status: "done", extracted: { input: e.input, claims: e.claims } };
          case "error":
            return { ...s, errors: [...s.errors, e.message], status: e.stage === "config" || e.stage === "read" ? "error" : s.status };
          default:
            return s;
        }
      });
    }
  }, []);

  return { state, start, reset };
}
