"use client";

import { useState } from "react";

/**
 * Consistent collapsible info/glossary section.
 *
 * Usage:
 *   <InfoToggle title="How to read this page">
 *     <p>Explanation here...</p>
 *   </InfoToggle>
 */
export default function InfoToggle({
  title = "How to read this page",
  children,
  defaultOpen = false,
}: {
  title?: string;
  children: React.ReactNode;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <div style={{ marginBottom: 12 }}>
      <button
        onClick={() => setOpen(!open)}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 6,
          padding: "6px 0",
          background: "none",
          border: "none",
          cursor: "pointer",
          fontSize: 11,
          color: "rgba(255,255,255,0.4)",
          fontFamily: "monospace",
          userSelect: "none",
          transition: "color 0.15s",
        }}
        onMouseEnter={(e) => { (e.target as HTMLElement).style.color = "rgba(255,255,255,0.6)"; }}
        onMouseLeave={(e) => { (e.target as HTMLElement).style.color = "rgba(255,255,255,0.4)"; }}
      >
        <svg
          width="12"
          height="12"
          viewBox="0 0 16 16"
          fill="currentColor"
          style={{
            transform: open ? "rotate(90deg)" : "rotate(0deg)",
            transition: "transform 0.2s ease",
            flexShrink: 0,
          }}
        >
          <path d="M6 4l4 4-4 4" stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        {title}
      </button>
      {open && (
        <div
          style={{
            marginTop: 6,
            padding: "12px 16px",
            borderRadius: 6,
            background: "rgba(255,255,255,0.02)",
            border: "1px solid #21262d",
            fontSize: 11,
            color: "rgba(255,255,255,0.5)",
            lineHeight: 1.6,
          }}
        >
          {children}
        </div>
      )}
    </div>
  );
}
