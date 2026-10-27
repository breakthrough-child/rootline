"use client";
import { useEffect, useState } from "react";

export function ThemeToggle() {
  const [theme, setTheme] = useState<string | null>(null);
  useEffect(() => setTheme(document.documentElement.dataset.theme ?? null), []);
  const next = () => {
    const isDark = theme ? theme === "dark" : window.matchMedia("(prefers-color-scheme: dark)").matches;
    const t = isDark ? "light" : "dark";
    document.documentElement.dataset.theme = t;
    try {
      localStorage.setItem("rootline-theme", t);
    } catch {
      /* private mode */
    }
    setTheme(t);
  };
  return (
    <button onClick={next} aria-label="Toggle dark mode" className="rounded-lg px-2.5 py-1.5 text-muted hover:bg-surface-2 hover:text-ink">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
        <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" />
      </svg>
    </button>
  );
}
