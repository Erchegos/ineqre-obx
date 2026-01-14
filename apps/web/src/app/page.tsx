import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Intelligence Equity Research",
  description: "Quantitative equity research platform",
};

export default function Home() {
  return (
    <main style={{ padding: 24 }}>
      <h1>Intelligence Equity Research</h1>

      <p style={{ marginTop: 12 }}>
        <Link href="/stocks">Open stocks universe</Link>
      </p>
    </main>
  );
}
