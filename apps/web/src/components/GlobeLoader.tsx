"use client";

/**
 * GlobeLoader — Spinning globe loading indicator with Norway highlight
 * and orbital arc-trail whirl particles.
 *
 * Designed by Claude Design for ineqre.no.
 * Arc Trails variant — smooth orbital arcs with blue accent.
 */

import { useRef, useEffect } from "react";
import { geoOrthographic, geoPath, geoGraticule10 } from "d3-geo";
import { feature } from "topojson-client";
import type { Topology, GeometryCollection } from "topojson-specification";
// eslint-disable-next-line @typescript-eslint/no-require-imports
import worldAtlas from "world-atlas/countries-110m.json";

const COLORS = {
  bg: "#0d1117",
  accent: "#2f81f7",
  landStroke: "rgba(136,153,175,0.35)",
  landFill: "rgba(136,153,175,0.06)",
  faint: "rgba(136,153,175,0.12)",
  sphereEdge: "rgba(136,153,175,0.25)",
  norwayFill: "rgba(47,129,247,0.35)",
};

const NORWAY_ID = "578";
const PARTICLE_COUNT = 28;

interface Particle {
  r: number;
  theta: number;
  speed: number;
  arcLen: number;
  yaw: number;
  pitch: number;
  width: number;
  alpha: number;
}

export default function GlobeLoader({
  size = 220,
  style,
}: {
  size?: number;
  style?: React.CSSProperties;
}) {
  const globeRef = useRef<HTMLCanvasElement>(null);
  const whirlRef = useRef<HTMLCanvasElement>(null);
  const animRef = useRef<number | null>(null);

  useEffect(() => {
    if (!globeRef.current || !whirlRef.current) return;
    let cancelled = false;

    const DPR = window.devicePixelRatio || 1;
    const PX = Math.round(size * DPR);
    const CENTER = PX / 2;
    const R = PX * 0.41;

    // Set canvas backing store
    [globeRef, whirlRef].forEach((ref) => {
      const cv = ref.current!;
      cv.width = PX;
      cv.height = PX;
      cv.style.width = `${size}px`;
      cv.style.height = `${size}px`;
    });

    // Parse geo data
    const topo = worldAtlas as unknown as Topology<{
      countries: GeometryCollection;
      land: GeometryCollection;
    }>;
    const countries = feature(topo, topo.objects.countries);
    const land = feature(topo, topo.objects.land);
    const norway = {
      type: "FeatureCollection" as const,
      features: countries.features.filter(
        (f) => f.id === NORWAY_ID
      ),
    };

    // Projection
    const projection = geoOrthographic()
      .scale(R)
      .translate([CENTER, CENTER])
      .clipAngle(90)
      .rotate([-8, -62, 0]);

    const g = globeRef.current.getContext("2d")!;
    const w = whirlRef.current.getContext("2d")!;
    const path = geoPath(projection, g);
    const graticule = geoGraticule10();

    // Whirl particles
    const particles: Particle[] = [];
    for (let i = 0; i < PARTICLE_COUNT; i++) {
      const ringIdx = i % 3;
      const ringR = R + PX * 0.031 + ringIdx * (PX * 0.025);
      particles.push({
        r: ringR,
        theta: Math.random() * Math.PI * 2,
        speed: (0.5 + Math.random() * 0.7) * (ringIdx === 1 ? -1 : 1),
        arcLen: 0.12 + Math.random() * 0.5,
        yaw: ringIdx * 0.28 - 0.28,
        pitch: ringIdx === 1 ? 0.0 : ringIdx === 0 ? -0.5 : 0.5,
        width: (1.0 + Math.random() * 0.8) * DPR,
        alpha: 0.3 + Math.random() * 0.5,
      });
    }

    function projectRing(
      t: number,
      ringR: number,
      yaw: number,
      pitch: number
    ) {
      const x0 = ringR * Math.cos(t);
      let y = ringR * Math.sin(t);
      let z = 0;
      const cp = Math.cos(pitch),
        sp = Math.sin(pitch);
      const y1 = y * cp - z * sp;
      const z1 = y * sp + z * cp;
      y = y1;
      z = z1;
      const cy = Math.cos(yaw),
        sy = Math.sin(yaw);
      const x1 = x0 * cy + z * sy;
      const z2 = -x0 * sy + z * cy;
      return { x: CENTER + x1, y: CENTER + y, z: z2 };
    }

    let start: number | null = null;
    function frame(ts: number) {
      if (cancelled) return;
      if (!start) start = ts;
      const tSec = (ts - start) / 1000;
      const rotLon = -8 + tSec * 12;
      projection.rotate([rotLon, -62, 0]);

      // Globe
      g.clearRect(0, 0, PX, PX);

      g.beginPath();
      g.arc(CENTER, CENTER, R, 0, Math.PI * 2);
      g.fillStyle = COLORS.bg;
      g.fill();

      g.beginPath();
      path(graticule);
      g.lineWidth = 0.8 * DPR;
      g.strokeStyle = COLORS.faint;
      g.stroke();

      g.beginPath();
      path(land);
      g.fillStyle = COLORS.landFill;
      g.fill();

      g.beginPath();
      path(countries);
      g.lineWidth = 0.8 * DPR;
      g.strokeStyle = COLORS.landStroke;
      g.stroke();

      g.beginPath();
      path(norway);
      g.fillStyle = COLORS.norwayFill;
      g.fill();
      g.beginPath();
      path(norway);
      g.lineWidth = 1.6 * DPR;
      g.strokeStyle = COLORS.accent;
      g.stroke();

      g.beginPath();
      g.arc(CENTER, CENTER, R, 0, Math.PI * 2);
      g.lineWidth = 1.4 * DPR;
      g.strokeStyle = COLORS.sphereEdge;
      g.stroke();

      // Whirl
      w.clearRect(0, 0, PX, PX);

      for (const p of particles) {
        const headTheta = p.theta + p.speed * tSec;
        const STEPS = 20;
        const step = p.arcLen / STEPS;

        for (let i = 0; i < STEPS; i++) {
          const t0 = headTheta - i * step;
          const t1 = headTheta - (i + 1) * step;
          const a = projectRing(t0, p.r, p.yaw, p.pitch);
          const b = projectRing(t1, p.r, p.yaw, p.pitch);
          const dx = a.x - CENTER,
            dy = a.y - CENTER;
          const behind = a.z < 0 && dx * dx + dy * dy < R * R;
          const baseAlpha = p.alpha * (1 - i / STEPS) * (behind ? 0.08 : 1.0);
          if (baseAlpha < 0.02) continue;

          w.beginPath();
          w.moveTo(a.x, a.y);
          w.lineTo(b.x, b.y);
          w.lineWidth = p.width;
          w.lineCap = "round";
          w.strokeStyle = `rgba(47,129,247,${baseAlpha.toFixed(3)})`;
          w.stroke();
        }

        // Head dot
        const head = projectRing(headTheta, p.r, p.yaw, p.pitch);
        const hdx = head.x - CENTER,
          hdy = head.y - CENTER;
        if (!(head.z < 0 && hdx * hdx + hdy * hdy < R * R)) {
          w.beginPath();
          w.arc(head.x, head.y, p.width * 1.3, 0, Math.PI * 2);
          w.fillStyle = `rgba(47,129,247,${(p.alpha * 0.9).toFixed(3)})`;
          w.fill();
        }
      }

      animRef.current = requestAnimationFrame(frame);
    }

    animRef.current = requestAnimationFrame(frame);

    return () => {
      cancelled = true;
      if (animRef.current) cancelAnimationFrame(animRef.current);
    };
  }, [size]);

  return (
    <div
      style={{
        width: size,
        height: size,
        position: "relative",
        ...style,
      }}
    >
      <canvas ref={whirlRef} style={{ position: "absolute", inset: 0 }} />
      <canvas ref={globeRef} style={{ position: "absolute", inset: 0 }} />
    </div>
  );
}
