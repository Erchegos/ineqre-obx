"use client";

import Link from "next/link";

export type Crumb = {
  label: string;
  href?: string;
};

export type NavAction = {
  label: string;
  href: string;
};

/**
 * Consistent breadcrumb navigation for all pages.
 *
 * Usage:
 *   <PageNav crumbs={[{ label: "Home", href: "/" }, { label: "Stocks", href: "/stocks" }, { label: "EQNR" }]} />
 *   <PageNav crumbs={[{ label: "Home", href: "/" }, { label: "Shipping" }]} actions={[{ label: "Stocks", href: "/stocks" }]} />
 */
export default function PageNav({
  crumbs,
  actions,
}: {
  crumbs: Crumb[];
  actions?: NavAction[];
}) {
  return (
    <nav
      style={{
        display: "flex",
        alignItems: "center",
        gap: 0,
        flexWrap: "wrap",
        fontFamily: "monospace",
        fontSize: 10,
        lineHeight: 1,
      }}
    >
      {crumbs.map((crumb, i) => {
        const isLast = i === crumbs.length - 1;
        return (
          <span key={i} style={{ display: "flex", alignItems: "center" }}>
            {i > 0 && (
              <span style={{ color: "#30363d", fontSize: 9, padding: "0 2px" }}>/</span>
            )}
            {crumb.href && !isLast ? (
              <Link
                href={crumb.href}
                style={{
                  color: "rgba(255,255,255,0.5)",
                  textDecoration: "none",
                  padding: "2px 6px",
                  borderRadius: 3,
                  whiteSpace: "nowrap",
                  transition: "color 0.15s",
                }}
                onMouseEnter={(e) => { (e.target as HTMLElement).style.color = "#3b82f6"; }}
                onMouseLeave={(e) => { (e.target as HTMLElement).style.color = "rgba(255,255,255,0.5)"; }}
              >
                {crumb.label}
              </Link>
            ) : (
              <span
                style={{
                  color: "#fff",
                  fontWeight: 600,
                  padding: "2px 6px",
                  whiteSpace: "nowrap",
                }}
              >
                {crumb.label}
              </span>
            )}
          </span>
        );
      })}

      {actions && actions.length > 0 && (
        <>
          <span style={{ color: "#30363d", fontSize: 10, margin: "0 4px" }}>|</span>
          {actions.map((action, i) => (
            <Link
              key={i}
              href={action.href}
              style={{
                color: "rgba(255,255,255,0.5)",
                textDecoration: "none",
                padding: "2px 6px",
                borderRadius: 3,
                whiteSpace: "nowrap",
                fontSize: 10,
                transition: "color 0.15s",
              }}
              onMouseEnter={(e) => { (e.target as HTMLElement).style.color = "#3b82f6"; }}
              onMouseLeave={(e) => { (e.target as HTMLElement).style.color = "rgba(255,255,255,0.5)"; }}
            >
              {action.label}
            </Link>
          ))}
        </>
      )}
    </nav>
  );
}
