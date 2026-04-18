"use client";

import { useEffect, useState } from "react";

/**
 * useCountUp — animates a number from 0 to target with cubic ease-out.
 * Extracted from HomeContent.tsx for reuse across KPI cards.
 *
 * @param target - Final number to count up to
 * @param duration - Animation duration in ms (default 1500)
 * @returns Current animated value
 */
export function useCountUp(target: number, duration = 1500): number {
  const [value, setValue] = useState(0);
  useEffect(() => {
    if (target === 0) { setValue(0); return; }
    let start: number | null = null;
    let raf: number;
    const step = (ts: number) => {
      if (!start) start = ts;
      const progress = Math.min((ts - start) / duration, 1);
      const eased = 1 - Math.pow(1 - progress, 3); // cubic ease-out
      setValue(Math.round(eased * target));
      if (progress < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [target, duration]);
  return value;
}
