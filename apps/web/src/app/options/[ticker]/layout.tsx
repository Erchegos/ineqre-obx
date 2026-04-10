import type { Metadata } from "next";

type Props = { params: Promise<{ ticker: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { ticker } = await params;
  const t = ticker.toUpperCase();
  return {
    title: `${t} — Options Chain & Greeks`,
    description: `Options chain, IV skew, open interest, max pain, Greeks, and P&L strategy builder for ${t}.`,
  };
}

export default function Layout({ children }: { children: React.ReactNode }) { return children; }
