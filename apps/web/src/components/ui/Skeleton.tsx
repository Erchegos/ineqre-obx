"use client";

/**
 * Consistent skeleton loading primitives.
 *
 * Usage:
 *   <SkeletonLine width="60%" />
 *   <SkeletonBlock height={200} />
 *   <SkeletonCard />
 *   <PageSkeleton title="Shipping Intelligence" cards={3} />
 */

export function SkeletonLine({
  width = "100%",
  height = 12,
  style,
}: {
  width?: string | number;
  height?: number;
  style?: React.CSSProperties;
}) {
  return (
    <div
      style={{
        width,
        height,
        borderRadius: 3,
        background: "linear-gradient(90deg, #21262d 25%, #30363d 50%, #21262d 75%)",
        backgroundSize: "200% 100%",
        animation: "shimmer 1.5s ease-in-out infinite",
        ...style,
      }}
    />
  );
}

export function SkeletonBlock({
  width = "100%",
  height = 200,
  borderRadius = 8,
  style,
}: {
  width?: string | number;
  height?: number;
  borderRadius?: number;
  style?: React.CSSProperties;
}) {
  return (
    <div
      style={{
        width,
        height,
        borderRadius,
        background: "linear-gradient(90deg, #21262d 25%, #30363d 50%, #21262d 75%)",
        backgroundSize: "200% 100%",
        animation: "shimmer 1.5s ease-in-out infinite",
        ...style,
      }}
    />
  );
}

export function SkeletonCard({ height = 120 }: { height?: number }) {
  return (
    <div
      style={{
        padding: 16,
        borderRadius: 8,
        border: "1px solid #30363d",
        background: "rgba(255,255,255,0.02)",
        height,
        display: "flex",
        flexDirection: "column",
        gap: 10,
      }}
    >
      <SkeletonLine width="40%" height={10} />
      <SkeletonLine width="70%" height={24} />
      <SkeletonLine width="55%" height={10} />
    </div>
  );
}

export function SkeletonTableRows({ rows = 8, cols = 5 }: { rows?: number; cols?: number }) {
  const widths = ["60%", "45%", "30%", "35%", "50%"];
  return (
    <>
      {Array.from({ length: rows }).map((_, r) => (
        <tr key={r} style={{ borderBottom: "1px solid #1e2530" }}>
          {Array.from({ length: cols }).map((_, c) => (
            <td key={c} style={{ padding: "13px 16px" }}>
              <SkeletonLine
                width={widths[c % widths.length]}
                height={12}
                style={{ marginLeft: c >= 2 ? "auto" : 0 }}
              />
            </td>
          ))}
        </tr>
      ))}
    </>
  );
}

/**
 * Full-page skeleton with title + card grid.
 * Use in loading.tsx files or as inline fallback.
 */
export default function PageSkeleton({
  title,
  cards = 3,
  chartHeight = 300,
}: {
  title?: string;
  cards?: number;
  chartHeight?: number;
}) {
  return (
    <main style={{ minHeight: "100vh", background: "#0a0a0a", color: "#fff", fontFamily: "monospace" }}>
      <style>{`
        @keyframes shimmer {
          0% { background-position: 200% 0; }
          100% { background-position: -200% 0; }
        }
      `}</style>

      {/* Nav skeleton bar */}
      <div style={{ padding: "10px 24px", borderBottom: "1px solid #21262d", display: "flex", alignItems: "center", gap: 6 }}>
        <SkeletonLine width={36} height={10} />
        <span style={{ color: "#30363d", fontSize: 9 }}>/</span>
        <SkeletonLine width={60} height={10} />
        {title && (
          <>
            <span style={{ color: "#30363d", fontSize: 9 }}>/</span>
            <SkeletonLine width={80} height={10} />
          </>
        )}
      </div>

      <div style={{ padding: "20px 24px", maxWidth: 1400, margin: "0 auto" }}>
        {/* Title */}
        {title ? (
          <div style={{ fontSize: 22, fontWeight: 700, color: "#fff", marginBottom: 20 }}>{title}</div>
        ) : (
          <SkeletonLine width={220} height={22} style={{ marginBottom: 20 }} />
        )}

        {/* Card grid */}
        <div style={{ display: "grid", gridTemplateColumns: `repeat(auto-fit, minmax(260px, 1fr))`, gap: 12, marginBottom: 24 }}>
          {Array.from({ length: cards }).map((_, i) => (
            <SkeletonCard key={i} />
          ))}
        </div>

        {/* Chart area */}
        <SkeletonBlock height={chartHeight} style={{ marginBottom: 24 }} />

        {/* Table skeleton */}
        <SkeletonBlock height={400} />
      </div>
    </main>
  );
}
