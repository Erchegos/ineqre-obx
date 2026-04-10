import type { Metadata } from "next";

type Props = { params: Promise<{ ticker: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { ticker } = await params;
  const t = ticker.toUpperCase();
  return {
    title: `${t} — ML Price Prediction`,
    description: `XGBoost/LightGBM ensemble prediction for ${t}. 1-month forward return forecast with SHAP feature importance and confidence intervals.`,
  };
}

export default function Layout({ children }: { children: React.ReactNode }) { return children; }
