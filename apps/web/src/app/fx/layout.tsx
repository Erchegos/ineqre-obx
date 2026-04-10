import type { Metadata } from "next";
export const metadata: Metadata = {
  title: "FX Terminal — Currency Risk & Hedging",
  description: "Currency risk terminal for NOK portfolios. Multi-currency regression betas, forward curves via IRP, cross-currency basis, carry trade analytics, and Kalman filter pairs trading.",
};
export default function Layout({ children }: { children: React.ReactNode }) { return children; }
