import type { Metadata } from "next";

type Props = { params: Promise<{ ticker: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { ticker } = await params;
  const t = ticker.toUpperCase();
  return {
    title: `${t} — Stock Analysis`,
    description: `Price chart, volatility, ML predictions, fundamentals, and technical factors for ${t} on Oslo Børs.`,
  };
}

export default function Layout({ children }: { children: React.ReactNode }) { return children; }
