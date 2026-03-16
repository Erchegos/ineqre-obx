export default function ResearchLoading() {
  return (
    <div
      style={{
        minHeight: "100vh",
        background: "#0a0a0a",
        padding: "24px 32px",
        fontFamily: "monospace",
        overflow: "hidden",
      }}
    >
      <style>{`
        @keyframes shimmer {
          0%   { background-position: -600px 0; }
          100% { background-position: 600px 0; }
        }
        @keyframes scanline {
          0%   { transform: translateX(-100%); }
          100% { transform: translateX(100vw); }
        }
        @keyframes pulse-dot {
          0%, 100% { opacity: 0.5; transform: scale(0.9); }
          50%       { opacity: 1;   transform: scale(1.1); }
        }
        @keyframes fade-in {
          from { opacity: 0; transform: translateY(5px); }
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
        .fade { animation: fade-in 0.3s ease both; }
      `}</style>

      {/* ── Top progress bar ── */}
      <div
        style={{
          position: "fixed",
          top: 0, left: 0, right: 0,
          height: 3,
          background: "#161b22",
          zIndex: 9999,
          overflow: "hidden",
        }}
      >
        <div
          style={{
            position: "absolute",
            top: 0, left: 0,
            height: "100%",
            width: 240,
            background: "linear-gradient(90deg, transparent, #3b82f6, #8b5cf6, #3b82f6, transparent)",
            animation: "scanline 1.1s ease-in-out infinite",
          }}
        />
      </div>

      <div style={{ maxWidth: 1200, margin: "0 auto" }}>

        {/* ── Header ── */}
        <div
          className="fade"
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            marginBottom: 6,
            animationDelay: "0ms",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            {/* "Research Portal" title */}
            <div className="shimmer" style={{ width: 160, height: 24, borderRadius: 4 }} />
            {/* "Data from 2026" badge */}
            <div
              className="shimmer"
              style={{
                width: 96, height: 22, borderRadius: 4,
                background: "linear-gradient(90deg, #0d1f3c 0%, #1a3a6b 50%, #0d1f3c 100%)",
                backgroundSize: "600px 100%",
                animation: "shimmer 1.4s infinite linear",
              }}
            />
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <div className="shimmer" style={{ width: 60, height: 32, borderRadius: 5 }} />
            <div className="shimmer" style={{ width: 68, height: 32, borderRadius: 5 }} />
          </div>
        </div>

        {/* sub-line: "0 documents · 0 shown" */}
        <div className="fade" style={{ marginBottom: 20, animationDelay: "30ms" }}>
          <div className="shimmer" style={{ width: 140, height: 11, borderRadius: 3 }} />
        </div>

        <div className="shimmer" style={{ width: "100%", height: 1, borderRadius: 1, marginBottom: 20, opacity: 0.4 }} />

        {/* ── Search + dropdowns row ── */}
        <div
          className="fade"
          style={{
            display: "flex",
            gap: 10,
            marginBottom: 14,
            animationDelay: "60ms",
          }}
        >
          <div className="shimmer" style={{ flex: 1, height: 40, borderRadius: 6 }} />
          <div className="shimmer" style={{ width: 140, height: 40, borderRadius: 6 }} />
          <div className="shimmer" style={{ width: 140, height: 40, borderRadius: 6 }} />
        </div>

        {/* ── Category chip row ── */}
        <div
          className="fade"
          style={{
            display: "flex",
            gap: 8,
            flexWrap: "wrap",
            marginBottom: 20,
            animationDelay: "90ms",
          }}
        >
          {/* "All" chip — accented */}
          <div
            style={{
              width: 52,
              height: 28,
              borderRadius: 14,
              background: "linear-gradient(90deg, #1a2d4a 0%, #2a4a7f 50%, #1a2d4a 100%)",
              backgroundSize: "600px 100%",
              animation: "shimmer 1.4s infinite linear",
              border: "1px solid #3b82f640",
            }}
          />
          {/* other chips */}
          {[110, 108, 100, 98, 68, 62, 62].map((w, i) => (
            <div
              key={i}
              className="shimmer"
              style={{ width: w, height: 28, borderRadius: 14 }}
            />
          ))}
        </div>

        {/* ── Status line ── */}
        <div
          className="fade"
          style={{
            display: "flex",
            alignItems: "center",
            gap: 7,
            marginBottom: 16,
            animationDelay: "110ms",
          }}
        >
          <div
            style={{
              width: 7, height: 7,
              borderRadius: "50%",
              background: "#8b5cf6",
              animation: "pulse-dot 1s ease-in-out infinite",
            }}
          />
          <span style={{ color: "rgba(139,92,246,0.7)", fontSize: 10, letterSpacing: "0.12em", textTransform: "uppercase" }}>
            Loading research documents...
          </span>
        </div>

        {/* ── Document cards ── */}
        {Array.from({ length: 7 }).map((_, i) => (
          <div
            key={i}
            className="fade"
            style={{
              background: "#161b22",
              border: "1px solid #21262d",
              borderRadius: 8,
              padding: "14px 18px",
              marginBottom: 8,
              animationDelay: `${130 + i * 55}ms`,
            }}
          >
            {/* top row: source badge + date */}
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <div className="shimmer" style={{ width: 56, height: 18, borderRadius: 10 }} />
                {i % 3 !== 2 && (
                  <div
                    className="shimmer"
                    style={{
                      width: 34, height: 18, borderRadius: 10,
                      background: i % 3 === 0
                        ? "linear-gradient(90deg, #0d2a1a 0%, #10b98133 50%, #0d2a1a 100%)"
                        : "linear-gradient(90deg, #2a1a0d 0%, #f59e0b33 50%, #2a1a0d 100%)",
                      backgroundSize: "600px 100%",
                      animation: "shimmer 1.4s infinite linear",
                    }}
                  />
                )}
                {i % 4 === 0 && (
                  <div className="shimmer" style={{ width: 28, height: 18, borderRadius: 10 }} />
                )}
              </div>
              <div className="shimmer" style={{ width: 80, height: 10, borderRadius: 3 }} />
            </div>

            {/* title / subject */}
            <div className="shimmer" style={{ width: `${65 + (i % 4) * 8}%`, height: 14, borderRadius: 3, marginBottom: 8 }} />

            {/* body preview - 1-2 lines */}
            <div className="shimmer" style={{ width: "92%", height: 10, borderRadius: 3, marginBottom: 5 }} />
            {i % 2 === 0 && (
              <div className="shimmer" style={{ width: `${55 + (i % 3) * 10}%`, height: 10, borderRadius: 3, marginBottom: 5 }} />
            )}

            {/* bottom row: ticker tags + PDF link */}
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 10 }}>
              <div style={{ display: "flex", gap: 6 }}>
                {Array.from({ length: 1 + (i % 3) }).map((_, j) => (
                  <div key={j} className="shimmer" style={{ width: 40 + j * 8, height: 18, borderRadius: 4 }} />
                ))}
              </div>
              {i % 2 === 0 && (
                <div className="shimmer" style={{ width: 60, height: 10, borderRadius: 3 }} />
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
