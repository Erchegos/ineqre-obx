"use client";

type DepthData = {
  bid_prices: number[];
  bid_sizes: number[];
  ask_prices: number[];
  ask_sizes: number[];
  spread_bps: number;
  mid_price: number;
  book_imbalance: number;
};

export default function OrderbookVisual({ depth }: { depth: DepthData | null }) {
  if (!depth) {
    return (
      <div
        style={{
          height: 200,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          color: "rgba(255,255,255,0.4)",
          fontSize: 12,
          fontFamily: "monospace",
        }}
      >
        No depth data
      </div>
    );
  }

  const bidPrices = depth.bid_prices || [];
  const bidSizes = depth.bid_sizes || [];
  const askPrices = depth.ask_prices || [];
  const askSizes = depth.ask_sizes || [];
  const levels = Math.max(bidPrices.length, askPrices.length, 5);
  const maxSize = Math.max(...bidSizes, ...askSizes, 1);

  const imbalance = depth.book_imbalance || 0;
  const imbalanceColor = imbalance > 0.1 ? "#10b981" : imbalance < -0.1 ? "#ef4444" : "#6b7280";

  return (
    <div style={{ background: "#0d1117", border: "1px solid #21262d", borderRadius: 6, padding: 12 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
        <div
          style={{
            fontSize: 9,
            fontWeight: 600,
            color: "rgba(255,255,255,0.5)",
            letterSpacing: "0.06em",
            fontFamily: "monospace",
            textTransform: "uppercase" as const,
          }}
        >
          ORDERBOOK
        </div>
        <div style={{ display: "flex", gap: 12, fontSize: 9, fontFamily: "monospace" }}>
          <span style={{ color: "rgba(255,255,255,0.4)" }}>
            Mid: <span style={{ color: "#fff", fontWeight: 700 }}>{(depth.mid_price || 0).toFixed(2)}</span>
          </span>
          <span style={{ color: "rgba(255,255,255,0.4)" }}>
            Spread: <span style={{ color: "#00e5ff", fontWeight: 700 }}>{(depth.spread_bps || 0).toFixed(1)} bps</span>
          </span>
          <span style={{ color: "rgba(255,255,255,0.4)" }}>
            Imbal: <span style={{ color: imbalanceColor, fontWeight: 700 }}>{imbalance >= 0 ? "+" : ""}{(imbalance * 100).toFixed(1)}%</span>
          </span>
        </div>
      </div>

      {Array.from({ length: Math.min(levels, 5) }).map((_, i) => {
        const bidSize = bidSizes[i] || 0;
        const askSize = askSizes[i] || 0;
        const bidPrice = bidPrices[i];
        const askPrice = askPrices[i];
        const bidPct = (bidSize / maxSize) * 100;
        const askPct = (askSize / maxSize) * 100;

        return (
          <div
            key={i}
            style={{
              display: "grid",
              gridTemplateColumns: "1fr 55px 4px 55px 1fr",
              gap: 0,
              alignItems: "center",
              height: 22,
              marginBottom: 2,
            }}
          >
            {/* Bid bar (right-aligned) */}
            <div style={{ display: "flex", justifyContent: "flex-end", alignItems: "center", gap: 4 }}>
              <span style={{ fontSize: 9, color: "rgba(255,255,255,0.35)", fontFamily: "monospace", minWidth: 40, textAlign: "right" }}>
                {bidSize > 0 ? bidSize.toLocaleString() : ""}
              </span>
              <div style={{ width: `${bidPct}%`, height: 14, background: "rgba(16,185,129,0.3)", borderRadius: "2px 0 0 2px", minWidth: bidSize > 0 ? 2 : 0 }} />
            </div>
            {/* Bid price */}
            <div style={{ fontSize: 10, fontWeight: 600, color: "#10b981", fontFamily: "monospace", textAlign: "right", paddingRight: 4 }}>
              {bidPrice != null ? bidPrice.toFixed(2) : ""}
            </div>
            {/* Separator */}
            <div style={{ background: "#30363d", width: 1, height: "100%", margin: "0 auto" }} />
            {/* Ask price */}
            <div style={{ fontSize: 10, fontWeight: 600, color: "#ef4444", fontFamily: "monospace", textAlign: "left", paddingLeft: 4 }}>
              {askPrice != null ? askPrice.toFixed(2) : ""}
            </div>
            {/* Ask bar (left-aligned) */}
            <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
              <div style={{ width: `${askPct}%`, height: 14, background: "rgba(239,68,68,0.3)", borderRadius: "0 2px 2px 0", minWidth: askSize > 0 ? 2 : 0 }} />
              <span style={{ fontSize: 9, color: "rgba(255,255,255,0.35)", fontFamily: "monospace" }}>
                {askSize > 0 ? askSize.toLocaleString() : ""}
              </span>
            </div>
          </div>
        );
      })}
    </div>
  );
}
