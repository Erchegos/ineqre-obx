import type { Metadata } from "next";
export const metadata: Metadata = {
  title: "OBX Volatility Dashboard — Index-Level Regime Detection",
  description: "OBX index volatility with regime status, constituent heatmap, vol cone, rolling correlation, and systemic risk indicators.",
};
export default function Layout({ children }: { children: React.ReactNode }) { return children; }
