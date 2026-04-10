import type { Metadata } from "next";
export const metadata: Metadata = {
  title: "Flow Intelligence — Intraday Microstructure Analytics",
  description: "Intraday orderflow analytics for liquid OSE stocks. VPIN, Kyle's Lambda, Order Flow Imbalance, iceberg detection, and who-is-trading classification from Euronext tick data.",
};
export default function Layout({ children }: { children: React.ReactNode }) { return children; }
