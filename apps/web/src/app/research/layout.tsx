import type { Metadata } from "next";
export const metadata: Metadata = {
  title: "Research Portal | AI-Summarized Broker Research",
  description: "AI-summarized equity research from Pareto Securities, DNB Carnegie, DNB Markets, Redeye, and Xtrainvestor. Full-text search across 1,500+ reports with PDF viewer.",
};
export default function Layout({ children }: { children: React.ReactNode }) { return children; }
