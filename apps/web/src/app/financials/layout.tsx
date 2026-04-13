import type { Metadata } from "next";
export const metadata: Metadata = {
  title: "Financials Intelligence | OSE Banks & Insurance",
  description: "OSE financials terminal covering 12 companies. Interest rate sensitivity, yield curve tracking, scorecard comparison, ML signals, short interest, and insider transactions.",
};
export default function Layout({ children }: { children: React.ReactNode }) { return children; }
