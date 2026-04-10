import type { Metadata } from "next";
export const metadata: Metadata = {
  title: "ML Predictions — 19-Factor Ensemble Model",
  description: "Machine learning price predictions for Oslo Børs equities. XGBoost/LightGBM ensemble on 19 technical and fundamental factors with SHAP feature importance.",
};
export default function Layout({ children }: { children: React.ReactNode }) { return children; }
