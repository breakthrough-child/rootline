import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { SharedResult } from "@/components/SharedResult";
import { getInvestigation } from "@/lib/store";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  const inv = await getInvestigation(id).catch(() => null);
  const c = inv?.claims[0];
  return {
    title: c ? `Rootline · ${c.claim.slice(0, 60)}` : "Rootline",
    description: c?.verdict.summary ?? "See where it really came from before you forward it.",
  };
}

export default async function SharePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const inv = await getInvestigation(id).catch(() => null);
  if (!inv) notFound();
  return (
    <div className="pt-6">
      <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted">Shared trace · {new Date(inv.createdAt).toUTCString().slice(0, 16)}</p>
      <h1 className="mb-4 line-clamp-3 font-serif text-2xl leading-snug">“{inv.claims[0]?.claim ?? inv.input.text.slice(0, 200)}”</h1>
      <SharedResult investigation={inv} />
    </div>
  );
}
