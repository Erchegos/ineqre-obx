import type { Metadata } from "next";
export const metadata: Metadata = {
  title: "Volatility Analysis | Regime Detection & GARCH Models",
  description: "6-regime volatility classification for Oslo Børs equities. Yang-Zhang estimators, vol cone, GARCH/MSGARCH models, VaR backtesting, and regime-specific trading signals.",
};
export default function Layout({ children }: { children: React.ReactNode }) { return children; }
