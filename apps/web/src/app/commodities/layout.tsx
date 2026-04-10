import type { Metadata } from "next";
export const metadata: Metadata = {
  title: "Commodity Terminal — Prices, Correlations & Stock Sensitivity",
  description: "17 commodity prices with multi-period returns, stock sensitivity betas, treemap visualization, and cross-commodity correlation matrix for Oslo Børs equity analysis.",
};
export default function Layout({ children }: { children: React.ReactNode }) { return children; }
