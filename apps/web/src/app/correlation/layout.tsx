import type { Metadata } from "next";
export const metadata: Metadata = {
  title: "Correlation Matrix | Cross-Sectional Analysis",
  description: "Interactive correlation heatmap for Oslo Børs equities with configurable lookback windows. Rolling correlation time series and sector-level co-movement analysis.",
};
export default function Layout({ children }: { children: React.ReactNode }) { return children; }
