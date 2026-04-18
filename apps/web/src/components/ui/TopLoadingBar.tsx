"use client";

import { useEffect, useState, useRef } from "react";
import { usePathname } from "next/navigation";

/**
 * TopLoadingBar — thin progress bar at the top of the viewport.
 * Animates on route changes (detected via pathname).
 * Inspired by NProgress / YouTube loading bars.
 */
export default function TopLoadingBar() {
  const pathname = usePathname();
  const [progress, setProgress] = useState(0);
  const [visible, setVisible] = useState(false);
  const prevPath = useRef(pathname);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (pathname === prevPath.current) return;
    prevPath.current = pathname;

    // Start progress
    setVisible(true);
    setProgress(15);

    // Simulate progress: fast start, slowing down
    let current = 15;
    timerRef.current = setInterval(() => {
      current += Math.random() * 12;
      if (current >= 90) {
        current = 90;
        if (timerRef.current) clearInterval(timerRef.current);
      }
      setProgress(current);
    }, 150);

    // Complete after a short delay (page has loaded by now)
    const completeTimer = setTimeout(() => {
      if (timerRef.current) clearInterval(timerRef.current);
      setProgress(100);
      setTimeout(() => {
        setVisible(false);
        setProgress(0);
      }, 300);
    }, 500);

    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
      clearTimeout(completeTimer);
    };
  }, [pathname]);

  if (!visible && progress === 0) return null;

  return (
    <div
      style={{
        position: "fixed",
        top: 0,
        left: 0,
        width: `${progress}%`,
        height: 3,
        background: "linear-gradient(90deg, #3b82f6, #60a5fa)",
        transition: progress === 100
          ? "width 0.2s ease-out, opacity 0.3s ease"
          : "width 0.3s cubic-bezier(0.4, 0, 0.2, 1)",
        opacity: visible ? 1 : 0,
        zIndex: 9999,
        boxShadow: "0 0 8px rgba(59, 130, 246, 0.4)",
      }}
    />
  );
}
