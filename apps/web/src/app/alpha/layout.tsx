import type { Metadata } from "next";
export const metadata: Metadata = {
  title: "Alpha Engine Yggdrasil | ML Trading Signals",
  description: "ML-driven trading signal explorer across 228 OSE stocks. 6-source signal combiner, walk-forward backtesting, equity curve simulation, and optimized portfolio strategy.",
};
export default function Layout({ children }: { children: React.ReactNode }) { return children; }
