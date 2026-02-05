"use client";

type ModelModeToggleProps = {
  mode: "default" | "optimized";
  onChange: (mode: "default" | "optimized") => void;
  hasOptimized: boolean;
};

const baseStyle = {
  fontSize: 10,
  fontWeight: 600 as const,
  fontFamily: "monospace" as const,
  letterSpacing: "0.5px",
  padding: "5px 12px",
  cursor: "pointer" as const,
  borderWidth: 1,
  borderStyle: "solid" as const,
  borderColor: "var(--border)",
  transition: "all 0.15s ease",
};

export default function ModelModeToggle({
  mode,
  onChange,
  hasOptimized,
}: ModelModeToggleProps) {
  if (!hasOptimized) return null;

  return (
    <div style={{ display: "flex", gap: 0 }}>
      <button
        onClick={() => onChange("default")}
        style={{
          ...baseStyle,
          background:
            mode === "default" ? "var(--accent)" : "var(--input-bg)",
          color: mode === "default" ? "#ffffff" : "var(--foreground)",
          borderColor:
            mode === "default" ? "var(--accent)" : "var(--border)",
          borderRadius: "2px 0 0 2px",
          borderRightWidth: 0,
        }}
      >
        DEFAULT
      </button>
      <button
        onClick={() => onChange("optimized")}
        style={{
          ...baseStyle,
          background:
            mode === "optimized" ? "#f59e0b" : "var(--input-bg)",
          color: mode === "optimized" ? "#000000" : "var(--foreground)",
          borderColor:
            mode === "optimized" ? "#f59e0b" : "var(--border)",
          borderRadius: "0 2px 2px 0",
        }}
      >
        OPTIMIZED
      </button>
    </div>
  );
}
