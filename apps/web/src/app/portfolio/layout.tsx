import type { Metadata } from "next";
export const metadata: Metadata = {
  title: "Portfolio Optimizer | Markowitz Mean-Variance",
  description: "Markowitz portfolio optimization with 5 modes. Efficient frontier, Ledoit-Wolf covariance, risk decomposition, ML alpha signals, and regime-aware stress scenarios for Oslo Børs equities.",
};
export default function Layout({ children }: { children: React.ReactNode }) { return children; }
