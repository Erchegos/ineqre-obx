import type { Metadata } from "next";

type Props = { params: Promise<{ ticker: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { ticker } = await params;
  const t = ticker.toUpperCase();
  return {
    title: `${t} — Monte Carlo Simulation`,
    description: `10,000-path Geometric Brownian Motion simulation for ${t}. Percentile bands, probability cones, and statistical scenario analysis.`,
  };
}

export default function Layout({ children }: { children: React.ReactNode }) { return children; }
