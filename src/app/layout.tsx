import type { Metadata, Viewport } from "next";
import Link from "next/link";
import { ThemeToggle } from "@/components/ThemeToggle";
import "./globals.css";

export const metadata: Metadata = {
  title: "Rootline",
  description: "See where it really came from before you forward it. Rootline finds earlier versions of a message and shows how it changed.",
};

export const viewport: Viewport = { width: "device-width", initialScale: 1, themeColor: [{ media: "(prefers-color-scheme: dark)", color: "#121412" }, { color: "#f7f6f2" }] };

const themeScript = `try{var t=localStorage.getItem("rootline-theme");if(t)document.documentElement.dataset.theme=t}catch(e){}`;

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body className="min-h-dvh antialiased">
        <header className="sticky top-0 z-30 border-b border-line bg-bg/85 backdrop-blur">
          <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3">
            <Link href="/" className="flex items-center gap-2 font-semibold tracking-tight">
              <Logo />
              <span>Rootline</span>
            </Link>
            <nav className="flex items-center gap-1 text-sm">
              <Link href="/watchlist" className="rounded-lg px-3 py-1.5 text-muted hover:bg-surface-2 hover:text-ink">Watchlist</Link>
              <ThemeToggle />
            </nav>
          </div>
        </header>
        <main className="mx-auto max-w-6xl px-4 pb-16">{children}</main>
        <footer className="mx-auto max-w-6xl px-4 pb-10 text-xs text-muted">
          Rootline traces what is said, not whether media is authentic. Lineage is inferred from public sources and may be incomplete. Built with NVIDIA Nemotron on Nebius Token Factory and Tavily.
        </footer>
      </body>
    </html>
  );
}

function Logo() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden className="text-accent">
      <circle cx="5" cy="12" r="2.6" fill="currentColor" />
      <circle cx="18" cy="5" r="2.2" stroke="currentColor" strokeWidth="1.8" />
      <circle cx="18" cy="19" r="2.2" stroke="currentColor" strokeWidth="1.8" />
      <circle cx="13" cy="12" r="1.8" stroke="currentColor" strokeWidth="1.8" />
      <path d="M7.5 12h3.6M14.6 11l2-4.3M14.6 13l2 4.3" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}
