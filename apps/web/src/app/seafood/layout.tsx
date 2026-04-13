import type { Metadata } from "next";
export const metadata: Metadata = {
  title: "Seafood Intelligence | Salmon, Lice & Harvest Tracking",
  description: "Norwegian aquaculture dashboard. Salmon spot and forward prices, sea lice monitoring, production area traffic lights, biomass tracking, and live wellboat harvest detection via AIS.",
};
export default function Layout({ children }: { children: React.ReactNode }) { return children; }
