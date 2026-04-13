import type { Metadata } from "next";
export const metadata: Metadata = {
  title: "Intelligence Terminal | News, Shorts & Commodities",
  description: "Real-time market intelligence hub for Oslo Børs. AI-classified NewsWeb filings, Finanstilsynet short positions, commodity prices with stock sensitivity betas.",
};
export default function Layout({ children }: { children: React.ReactNode }) { return children; }
