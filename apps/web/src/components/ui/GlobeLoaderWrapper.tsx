"use client";

import dynamic from "next/dynamic";

const GlobeLoader = dynamic(() => import("@/components/GlobeLoader"), {
  ssr: false,
});

export default function GlobeLoaderWrapper({
  size = 200,
  label = "Loading data...",
  accentColor = "#2f81f7",
}: {
  size?: number;
  label?: string;
  accentColor?: string;
}) {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        padding: "40px 24px 20px",
        gap: 14,
      }}
    >
      <GlobeLoader size={size} />
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <div
          style={{
            width: 6,
            height: 6,
            borderRadius: "50%",
            background: accentColor,
            animation: "pulse-dot 1.2s ease-in-out infinite",
          }}
        />
        <span
          style={{
            color: accentColor,
            opacity: 0.7,
            fontSize: 10,
            letterSpacing: "0.12em",
            textTransform: "uppercase",
            fontWeight: 600,
          }}
        >
          {label}
        </span>
      </div>
    </div>
  );
}
