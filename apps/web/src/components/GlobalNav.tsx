"use client";

/**
 * GlobalNav — persistent top nav for all pages.
 *
 * Features:
 * - Logo → home
 * - Module links grouped by category
 * - Ticker quick-search (Cmd/Ctrl+K) — jumps to /stocks/[TICKER]
 * - Auto-hides on /research (password-gated), keeps the rest of the app navigable
 *
 * Style: matches the terminal theme from CLAUDE.md UI Style Guide.
 */

import { useState, useEffect, useRef, useCallback } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";

type NavLink = { href: string; label: string };

const NAV_GROUPS: { label: string; links: NavLink[] }[] = [
  {
    label: "Markets",
    links: [
      { href: "/stocks", label: "Stocks" },
      { href: "/sectors", label: "Sectors" },
      { href: "/news", label: "News" },
      { href: "/correlation", label: "Correlation" },
    ],
  },
  {
    label: "Models",
    links: [
      { href: "/alpha", label: "Alpha" },
      { href: "/portfolio", label: "Portfolio" },
      { href: "/volatility/obx", label: "Volatility" },
      { href: "/backtest", label: "Backtest" },
      { href: "/std-channel-strategy", label: "Std Channel" },
    ],
  },
  {
    label: "Derivatives",
    links: [
      { href: "/options", label: "Options" },
      { href: "/fx", label: "FX" },
    ],
  },
  {
    label: "Sectors",
    links: [
      { href: "/seafood", label: "Seafood" },
      { href: "/shipping", label: "Shipping" },
      { href: "/commodities", label: "Commodities" },
      { href: "/financials", label: "Financials" },
    ],
  },
  {
    label: "Research",
    links: [{ href: "/research", label: "Research" }],
  },
];

const FLAT_LINKS = NAV_GROUPS.flatMap(g => g.links);

export default function GlobalNav() {
  const pathname = usePathname();
  const router = useRouter();
  const [openGroup, setOpenGroup] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [searchFocused, setSearchFocused] = useState(false);
  const [tickers, setTickers] = useState<{ ticker: string; name: string | null }[]>([]);
  const searchRef = useRef<HTMLInputElement>(null);
  const groupCloseTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Lazy-load ticker list on first focus
  useEffect(() => {
    if (!searchFocused || tickers.length > 0) return;
    fetch("/api/stocks?asset_type=equity")
      .then(r => r.ok ? r.json() : [])
      .then(data => {
        if (Array.isArray(data)) {
          setTickers(data.map((s: { ticker: string; name?: string | null }) => ({ ticker: s.ticker, name: s.name ?? null })));
        }
      })
      .catch(() => {});
  }, [searchFocused, tickers.length]);

  // Cmd/Ctrl+K to focus search
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        searchRef.current?.focus();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  const handleGroupEnter = useCallback((label: string) => {
    if (groupCloseTimer.current) clearTimeout(groupCloseTimer.current);
    setOpenGroup(label);
  }, []);

  const handleGroupLeave = useCallback(() => {
    if (groupCloseTimer.current) clearTimeout(groupCloseTimer.current);
    groupCloseTimer.current = setTimeout(() => setOpenGroup(null), 150);
  }, []);

  const isActive = (href: string) => {
    if (href === "/") return pathname === "/";
    return pathname === href || pathname.startsWith(href + "/");
  };

  const q = query.trim().toUpperCase();
  const suggestions = q.length > 0
    ? tickers
        .filter(t => t.ticker.includes(q) || (t.name && t.name.toUpperCase().includes(q)))
        .slice(0, 8)
    : [];

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!q) return;
    const exact = tickers.find(t => t.ticker === q);
    const pick = exact ?? suggestions[0];
    if (pick) {
      router.push(`/stocks/${pick.ticker}`);
      setQuery("");
      setSearchFocused(false);
      searchRef.current?.blur();
    }
  };

  // Don't show on research login page (distinct theme)
  if (pathname === "/research") return null;

  return (
    <nav
      style={{
        position: "sticky",
        top: 0,
        zIndex: 100,
        background: "rgba(10,10,10,0.92)",
        backdropFilter: "blur(8px)",
        borderBottom: "1px solid #21262d",
        fontFamily: "monospace",
      }}
    >
      <div
        style={{
          maxWidth: 1600,
          margin: "0 auto",
          padding: "0 20px",
          height: 44,
          display: "flex",
          alignItems: "center",
          gap: 4,
        }}
      >
        {/* Logo */}
        <Link
          href="/"
          style={{
            color: "#fff",
            textDecoration: "none",
            fontSize: 13,
            fontWeight: 800,
            letterSpacing: "0.06em",
            padding: "6px 10px",
            marginRight: 6,
            display: "flex",
            alignItems: "center",
            gap: 6,
          }}
        >
          <span style={{ color: "#3b82f6" }}>◆</span>
          <span>INEQRE</span>
        </Link>

        {/* Groups */}
        <div style={{ display: "flex", alignItems: "center", gap: 2, flex: 1 }}>
          {NAV_GROUPS.map(group => {
            const active = group.links.some(l => isActive(l.href));
            const isOpen = openGroup === group.label;
            return (
              <div
                key={group.label}
                style={{ position: "relative" }}
                onMouseEnter={() => handleGroupEnter(group.label)}
                onMouseLeave={handleGroupLeave}
              >
                <button
                  type="button"
                  style={{
                    background: "none",
                    border: "none",
                    color: active ? "#3b82f6" : "rgba(255,255,255,0.7)",
                    fontSize: 10,
                    fontWeight: 600,
                    letterSpacing: "0.08em",
                    textTransform: "uppercase",
                    fontFamily: "monospace",
                    padding: "14px 10px",
                    cursor: "pointer",
                  }}
                >
                  {group.label}
                </button>
                {isOpen && (
                  <div
                    style={{
                      position: "absolute",
                      top: "100%",
                      left: 0,
                      minWidth: 160,
                      background: "#161b22",
                      border: "1px solid #30363d",
                      borderRadius: 6,
                      padding: 4,
                      boxShadow: "0 8px 24px rgba(0,0,0,0.5)",
                    }}
                  >
                    {group.links.map(link => (
                      <Link
                        key={link.href}
                        href={link.href}
                        onClick={() => setOpenGroup(null)}
                        style={{
                          display: "block",
                          padding: "8px 12px",
                          fontSize: 11,
                          fontWeight: 600,
                          color: isActive(link.href) ? "#3b82f6" : "rgba(255,255,255,0.8)",
                          textDecoration: "none",
                          borderRadius: 4,
                          letterSpacing: "0.04em",
                        }}
                        onMouseEnter={e => { e.currentTarget.style.background = "rgba(59,130,246,0.08)"; }}
                        onMouseLeave={e => { e.currentTarget.style.background = "transparent"; }}
                      >
                        {link.label}
                      </Link>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* Ticker search */}
        <form onSubmit={handleSubmit} style={{ position: "relative" }}>
          <input
            ref={searchRef}
            type="text"
            value={query}
            onChange={e => setQuery(e.target.value)}
            onFocus={() => setSearchFocused(true)}
            onBlur={() => setTimeout(() => setSearchFocused(false), 150)}
            placeholder="Search ticker  ⌘K"
            style={{
              background: "#0d1117",
              border: "1px solid #30363d",
              borderRadius: 5,
              padding: "6px 10px",
              color: "#fff",
              fontSize: 11,
              fontFamily: "monospace",
              width: 180,
              outline: "none",
            }}
          />
          {searchFocused && suggestions.length > 0 && (
            <div
              style={{
                position: "absolute",
                top: "100%",
                right: 0,
                marginTop: 4,
                minWidth: 260,
                background: "#161b22",
                border: "1px solid #30363d",
                borderRadius: 6,
                padding: 4,
                boxShadow: "0 8px 24px rgba(0,0,0,0.5)",
              }}
            >
              {suggestions.map(s => (
                <Link
                  key={s.ticker}
                  href={`/stocks/${s.ticker}`}
                  onMouseDown={e => e.preventDefault()}
                  onClick={() => { setQuery(""); setSearchFocused(false); }}
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    gap: 12,
                    padding: "8px 10px",
                    fontSize: 11,
                    color: "rgba(255,255,255,0.85)",
                    textDecoration: "none",
                    borderRadius: 4,
                  }}
                  onMouseEnter={e => { e.currentTarget.style.background = "rgba(59,130,246,0.1)"; }}
                  onMouseLeave={e => { e.currentTarget.style.background = "transparent"; }}
                >
                  <span style={{ fontWeight: 700, color: "#3b82f6" }}>{s.ticker}</span>
                  <span style={{ color: "rgba(255,255,255,0.5)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {s.name}
                  </span>
                </Link>
              ))}
            </div>
          )}
        </form>
      </div>
    </nav>
  );
}

// Suppress unused warning for FLAT_LINKS (reserved for future search-all feature)
void FLAT_LINKS;
