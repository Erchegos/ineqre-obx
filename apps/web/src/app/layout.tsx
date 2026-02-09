import type { Metadata } from "next";
import { GeistSans } from "geist/font/sans";
import { GeistMono } from "geist/font/mono";
import "./globals.css";

export const metadata: Metadata = {
  title: "Intelligence Equity Research",
  description: "Quantitative equity research platform for Oslo Børs. Historical price analysis with dividend adjustments, volatility tracking, Monte Carlo simulations, standard deviation channels, and sector correlation analysis powered by real-time Interactive Brokers data.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" data-theme="dark" className="dark">
      <body
        className={`${GeistSans.variable} ${GeistMono.variable} antialiased bg-[#0a0a0a] text-white`}
        style={{ backgroundColor: "#0a0a0a", color: "#ffffff" }}
      >
        {children}
      </body>
    </html>
  );
}
