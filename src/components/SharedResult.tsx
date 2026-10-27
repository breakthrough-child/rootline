"use client";
import type { Investigation } from "@/lib/types";
import { ResultView } from "./ResultView";

export function SharedResult({ investigation }: { investigation: Investigation }) {
  const claims = Object.fromEntries(investigation.claims.map((c) => [c.claimId, { claimId: c.claimId, variants: c.variants, edges: c.edges, result: c }]));
  return <ResultView state={{ status: "done", stages: [], claims, checks: investigation.checks, logs: investigation.logs, investigation, errors: [] }} />;
}
