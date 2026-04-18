import GlobeLoaderWrapper from "@/components/ui/GlobeLoaderWrapper";

export default function StocksLoading() {
  return (
    <div
      style={{
        minHeight: "100vh",
        background: "#0a0a0a",
        padding: "20px 24px",
        fontFamily: "monospace",
        overflow: "hidden",
      }}
    >
      <style>{`
        @keyframes shimmer {
          0%   { background-position: -600px 0; }
          100% { background-position: 600px 0; }
        }
        @keyframes pulse-bar {
          0%, 100% { opacity: 0.6; }
          50%       { opacity: 1; }
        }
        @keyframes fade-in {
          from { opacity: 0; transform: translateY(6px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        .shimmer {
          background: linear-gradient(
            90deg,
            #161b22 0%,
            #1e2730 40%,
            #2a3441 50%,
            #1e2730 60%,
            #161b22 100%
          );
          background-size: 600px 100%;
          animation: shimmer 1.4s infinite linear;
        }
        .row-fade {
          animation: fade-in 0.3s ease both;
        }
      `}</style>

      {/* ── Globe loader hero ── */}
      <GlobeLoaderWrapper size={180} label="Loading universe..." />

      {/* ── Header row ── */}
      <div
        className="row-fade"
        style={{
          maxWidth: 1400,
          margin: "0 auto",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: 20,
          animationDelay: "0ms",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <div className="shimmer" style={{ width: 180, height: 22, borderRadius: 4 }} />
          <div className="shimmer" style={{ width: 48, height: 18, borderRadius: 10 }} />
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          {[90, 70, 80, 65].map((w, i) => (
            <div key={i} className="shimmer" style={{ width: w, height: 28, borderRadius: 5 }} />
          ))}
        </div>
      </div>

      <div style={{ maxWidth: 1400, margin: "0 auto" }}>

        {/* ── Tier + filter strip ── */}
        <div
          className="row-fade"
          style={{
            display: "flex",
            gap: 8,
            marginBottom: 14,
            animationDelay: "60ms",
          }}
        >
          {[44, 40, 40, 40, 120, 100, 96].map((w, i) => (
            <div key={i} className="shimmer" style={{ width: w, height: 26, borderRadius: 4 }} />
          ))}
        </div>

        {/* ── Search bar ── */}
        <div
          className="row-fade"
          style={{ marginBottom: 14, animationDelay: "80ms" }}
        >
          <div className="shimmer" style={{ width: "100%", height: 36, borderRadius: 6 }} />
        </div>

        {/* ── Stats strip ── */}
        <div
          className="row-fade"
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(4, 1fr)",
            gap: 8,
            marginBottom: 16,
            animationDelay: "100ms",
          }}
        >
          {[0, 1, 2, 3].map((i) => (
            <div
              key={i}
              style={{
                background: "#161b22",
                border: "1px solid #21262d",
                borderRadius: 6,
                padding: "10px 14px",
              }}
            >
              <div className="shimmer" style={{ width: 60, height: 9, borderRadius: 3, marginBottom: 6 }} />
              <div className="shimmer" style={{ width: 80, height: 18, borderRadius: 3 }} />
            </div>
          ))}
        </div>

        {/* ── Table header ── */}
        <div
          className="row-fade"
          style={{
            display: "grid",
            gridTemplateColumns: "110px 1fr 90px 90px 80px 70px 80px 80px 60px",
            gap: 8,
            padding: "8px 12px",
            borderBottom: "1px solid #30363d",
            marginBottom: 4,
            animationDelay: "120ms",
          }}
        >
          {[50, 80, 55, 55, 40, 40, 50, 50, 35].map((w, i) => (
            <div key={i} className="shimmer" style={{ width: w, height: 9, borderRadius: 3 }} />
          ))}
        </div>

        {/* ── Skeleton rows ── */}
        {Array.from({ length: 18 }).map((_, i) => (
          <div
            key={i}
            className="row-fade"
            style={{
              display: "grid",
              gridTemplateColumns: "110px 1fr 90px 90px 80px 70px 80px 80px 60px",
              gap: 8,
              padding: "9px 12px",
              borderBottom: "1px solid #161b22",
              animationDelay: `${140 + i * 25}ms`,
            }}
          >
            {/* ticker */}
            <div className="shimmer" style={{ width: 52 + (i % 3) * 10, height: 12, borderRadius: 3 }} />
            {/* name */}
            <div className="shimmer" style={{ width: 120 + (i % 5) * 20, height: 11, borderRadius: 3 }} />
            {/* sector */}
            <div className="shimmer" style={{ width: 60 + (i % 4) * 8, height: 11, borderRadius: 3 }} />
            {/* currency */}
            <div className="shimmer" style={{ width: 34, height: 11, borderRadius: 3 }} />
            {/* price */}
            <div className="shimmer" style={{ width: 50, height: 11, borderRadius: 3 }} />
            {/* change */}
            <div
              className="shimmer"
              style={{
                width: 40,
                height: 11,
                borderRadius: 3,
                background: i % 3 === 0
                  ? "linear-gradient(90deg, #0d1f14 0%, #10b98133 50%, #0d1f14 100%)"
                  : i % 3 === 1
                  ? "linear-gradient(90deg, #1f0d0d 0%, #ef444433 50%, #1f0d0d 100%)"
                  : undefined,
              }}
            />
            {/* mktcap */}
            <div className="shimmer" style={{ width: 55, height: 11, borderRadius: 3 }} />
            {/* tier badge */}
            <div className="shimmer" style={{ width: 22, height: 18, borderRadius: 10 }} />
            {/* rows */}
            <div className="shimmer" style={{ width: 38, height: 11, borderRadius: 3 }} />
          </div>
        ))}
      </div>
    </div>
  );
}
