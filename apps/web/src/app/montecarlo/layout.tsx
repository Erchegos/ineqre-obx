import type { Metadata } from "next";
export const metadata: Metadata = {
  title: "Monte Carlo Simulation — 10,000-Path GBM",
  description: "Monte Carlo price simulation for Oslo Børs equities. 10,000-path Geometric Brownian Motion with percentile bands, probability cones, and statistical scenario analysis.",
};
export default function Layout({ children }: { children: React.ReactNode }) { return children; }
