import Link from "next/link";

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
