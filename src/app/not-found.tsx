import Link from "next/link";

export default function NotFound() {
  return (
    <div className="mx-auto max-w-xl pt-20 text-center">
      <h1 className="font-serif text-3xl">Nothing here</h1>
      <p className="mt-2 text-muted">This trace may have expired or never existed.</p>
      <Link href="/" className="mt-6 inline-block rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-accent-ink">Trace a message</Link>
    </div>
  );
}
