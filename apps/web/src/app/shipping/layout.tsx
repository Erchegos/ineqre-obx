import type { Metadata } from "next";
export const metadata: Metadata = {
  title: "Shipping Intelligence — Fleet, Rates & Contracts",
  description: "OSE shipping terminal with global vessel map, BDI/BDTI/BCTI rate indices, quarterly TCE comparison, charter contract tracking, and AIS vessel positions.",
};
export default function Layout({ children }: { children: React.ReactNode }) { return children; }
