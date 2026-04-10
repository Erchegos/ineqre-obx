import type { Metadata } from "next";

type Props = { params: Promise<{ ticker: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { ticker } = await params;
  const t = ticker.toUpperCase();
  return {
    title: `${t} — Financial Analysis`,
    description: `Financial intelligence for ${t}. Fundamentals, rate sensitivity, ML signals, short interest, and insider transactions.`,
  };
}

export default function Layout({ children }: { children: React.ReactNode }) { return children; }
