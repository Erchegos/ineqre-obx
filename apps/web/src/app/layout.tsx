import type { Metadata } from "next";
import { GeistSans } from "geist/font/sans";
import { GeistMono } from "geist/font/mono";
import "./globals.css";
import GlobalNav from "@/components/GlobalNav";
import TopLoadingBar from "@/components/ui/TopLoadingBar";
import { ToastProvider } from "@/components/ui/Toast";

export const metadata: Metadata = {
  title: {
    default: "Intelligence Equity Research | OSE Quant Platform",
    template: "%s | InEqRe",
  },
  description: "Quantitative equity research platform for 225+ Oslo Børs securities. ML price predictions, GARCH volatility models, Monte Carlo simulations, options analytics, portfolio optimization, and AI-summarized broker research.",
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "InEqRe",
  },
  other: {
    "mobile-web-app-capable": "yes",
    "theme-color": "#0a0a0a",
  },
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
        <ToastProvider>
          <TopLoadingBar />
          <GlobalNav />
          <main>{children}</main>
        </ToastProvider>
      </body>
    </html>
  );
}
