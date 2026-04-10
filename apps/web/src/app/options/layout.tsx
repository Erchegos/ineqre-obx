import type { Metadata } from "next";
export const metadata: Metadata = {
  title: "Options Analytics — Chain, Greeks & P&L Builder",
  description: "Black-Scholes options pricing for US-listed OSE stocks. IV skew, open interest, max pain, put/call ratios, and multi-leg strategy P&L calculator with preset strategies.",
};
export default function Layout({ children }: { children: React.ReactNode }) { return children; }
