import type { Metadata } from "next";
export const metadata: Metadata = {
  title: "Sector Intelligence | OSE Sector Overview",
  description: "Per-sector aggregate intelligence for Oslo Børs. Sector performance, commodity drivers, best and worst performers, and cross-sector comparison.",
};
export default function Layout({ children }: { children: React.ReactNode }) { return children; }
