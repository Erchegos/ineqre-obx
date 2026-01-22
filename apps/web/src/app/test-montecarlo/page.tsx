"use client";

import { useMemo, useState } from "react";
import MonteCarloChart from "@/components/MonteCarloChart";
import {
  generateMonteCarloSimulation,
  calculateFinalDistribution,
  calculateTheoreticalDistribution,
  calculatePercentiles,
  calculateParameters,
} from "@/lib/montecarlo";

export default function TestMonteCarloPage() {
  const [numPaths, setNumPaths] = useState(100);
  const [numSteps, setNumSteps] = useState(100);
  const [startPrice, setStartPrice] = useState(10);
  const [drift, setDrift] = useState(0.0);
  const [volatility, setVolatility] = useState(0.2);
  const [seed, setSeed] = useState(1);

  // Generate simulation
  const { paths, distribution, theoreticalDist, percentiles } = useMemo(() => {
    // Set random seed for reproducibility (simple approach)
    let seedValue = seed;
    Math.random = () => {
      seedValue = (seedValue * 9301 + 49297) % 233280;
      return seedValue / 233280;
    };

    const simPaths = generateMonteCarloSimulation(
      startPrice,
      numPaths,
      numSteps,
      drift,
      volatility,
      1
    );

    const finalDist = calculateFinalDistribution(simPaths, 50);
    const theoreticalDist = calculateTheoreticalDistribution(
      startPrice,
      numSteps,
      drift,
      volatility,
      finalDist
    );
    const pcts = calculatePercentiles(simPaths);

    return {
      paths: simPaths,
      distribution: finalDist,
      theoreticalDist,
      percentiles: pcts,
    };
  }, [numPaths, numSteps, startPrice, drift, volatility, seed]);

  return (
    <main style={{ padding: 24, maxWidth: 1400, margin: "0 auto" }}>
      <h1 style={{ fontSize: 32, fontWeight: 600, marginBottom: 24, color: "var(--foreground)" }}>
        Monte Carlo Simulation Test
      </h1>

      {/* Controls */}
      <div style={{
        marginBottom: 24,
        padding: 20,
        background: "var(--card-bg)",
        border: "1px solid var(--border)",
        borderRadius: 8,
      }}>
        <h2 style={{ fontSize: 16, fontWeight: 600, marginBottom: 16, color: "var(--foreground)" }}>
          Simulation Parameters
        </h2>

        <div style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
          gap: 16,
        }}>
          <ParamInput
            label="Number of Paths"
            value={numPaths}
            onChange={setNumPaths}
            min={10}
            max={500}
            step={10}
          />
          <ParamInput
            label="Number of Steps (T)"
            value={numSteps}
            onChange={setNumSteps}
            min={10}
            max={500}
            step={10}
          />
          <ParamInput
            label="Start Price ($)"
            value={startPrice}
            onChange={setStartPrice}
            min={1}
            max={1000}
            step={1}
          />
          <ParamInput
            label="Drift (μ)"
            value={drift}
            onChange={setDrift}
            min={-0.5}
            max={0.5}
            step={0.01}
          />
          <ParamInput
            label="Volatility (σ)"
            value={volatility}
            onChange={setVolatility}
            min={0.01}
            max={1.0}
            step={0.01}
          />
          <ParamInput
            label="Random Seed"
            value={seed}
            onChange={setSeed}
            min={1}
            max={10000}
            step={1}
          />
        </div>

        <button
          onClick={() => setSeed(Math.floor(Math.random() * 10000))}
          style={{
            marginTop: 16,
            padding: "8px 16px",
            borderRadius: 6,
            border: "1px solid var(--border)",
            background: "var(--input-bg)",
            color: "var(--foreground)",
            fontSize: 13,
            fontWeight: 500,
            cursor: "pointer",
          }}
        >
          🎲 Randomize Seed
        </button>
      </div>

      {/* Chart */}
      <div style={{
        padding: 20,
        background: "var(--card-bg)",
        border: "1px solid var(--border)",
        borderRadius: 8,
      }}>
        <MonteCarloChart
          paths={paths}
          distribution={distribution}
          theoreticalDistribution={theoreticalDist}
          startPrice={startPrice}
          finalTime={numSteps}
          percentiles={percentiles}
          height={400}
          ticker="TEST"
        />
      </div>

      {/* Info */}
      <div style={{
        marginTop: 24,
        padding: 16,
        background: "var(--hover-bg)",
        border: "1px solid var(--border)",
        borderRadius: 8,
        fontSize: 13,
        color: "var(--muted-foreground)",
        lineHeight: 1.6,
      }}>
        <h3 style={{ fontSize: 14, fontWeight: 600, marginBottom: 8, color: "var(--foreground)" }}>
          About This Simulation
        </h3>
        <p style={{ margin: 0, marginBottom: 8 }}>
          This Monte Carlo simulation uses <strong>Geometric Brownian Motion (GBM)</strong> to model potential
          future price paths for a stock. Each path represents one possible future scenario.
        </p>
        <p style={{ margin: 0, marginBottom: 8 }}>
          <strong>Formula:</strong> dS = μS dt + σS dW, where μ is drift (expected return), σ is volatility,
          and dW is a random Brownian motion.
        </p>
        <p style={{ margin: 0 }}>
          The green histogram shows the <strong>empirical distribution</strong> of final prices from all paths,
          while the magenta line shows the <strong>theoretical normal distribution</strong> predicted by GBM theory.
        </p>
      </div>
    </main>
  );
}

function ParamInput({
  label,
  value,
  onChange,
  min,
  max,
  step,
}: {
  label: string;
  value: number;
  onChange: (val: number) => void;
  min: number;
  max: number;
  step: number;
}) {
  return (
    <div>
      <label style={{
        display: "block",
        fontSize: 12,
        color: "var(--muted)",
        marginBottom: 6,
        fontWeight: 500,
      }}>
        {label}
      </label>
      <input
        type="number"
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        min={min}
        max={max}
        step={step}
        style={{
          width: "100%",
          padding: "8px 12px",
          borderRadius: 4,
          border: "1px solid var(--border)",
          background: "var(--input-bg)",
          color: "var(--foreground)",
          fontSize: 14,
          fontFamily: "monospace",
        }}
      />
    </div>
  );
}
