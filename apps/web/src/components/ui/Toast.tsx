"use client";

import { createContext, useContext, useState, useCallback, useRef, type ReactNode } from "react";

/* ─── Types ─── */
type ToastType = "success" | "error" | "info" | "loading";

interface ToastItem {
  id: string;
  type: ToastType;
  message: string;
}

interface ToastContextValue {
  toast: (message: string, type?: ToastType, duration?: number) => string;
  dismiss: (id: string) => void;
}

/* ─── Context ─── */
const ToastContext = createContext<ToastContextValue | null>(null);

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used within <ToastProvider>");
  return ctx;
}

/* ─── Colors ─── */
const COLORS: Record<ToastType, { bg: string; border: string; icon: string }> = {
  success: { bg: "rgba(16, 185, 129, 0.12)", border: "#10b981", icon: "\u2713" },
  error:   { bg: "rgba(239, 68, 68, 0.12)",  border: "#ef4444", icon: "\u2717" },
  info:    { bg: "rgba(59, 130, 246, 0.12)",  border: "#3b82f6", icon: "\u2139" },
  loading: { bg: "rgba(245, 158, 11, 0.12)",  border: "#f59e0b", icon: "\u25CF" },
};

/* ─── Provider ─── */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const timers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  const dismiss = useCallback((id: string) => {
    const t = timers.current.get(id);
    if (t) { clearTimeout(t); timers.current.delete(id); }
    setToasts(prev => prev.filter(t => t.id !== id));
  }, []);

  const toast = useCallback((message: string, type: ToastType = "info", duration?: number) => {
    const id = Math.random().toString(36).slice(2, 9);
    setToasts(prev => {
      const next = [...prev, { id, type, message }];
      return next.slice(-3); // max 3 visible
    });

    const ms = duration ?? (type === "error" ? 5000 : 3000);
    if (ms > 0) {
      const timer = setTimeout(() => dismiss(id), ms);
      timers.current.set(id, timer);
    }

    return id;
  }, [dismiss]);

  return (
    <ToastContext.Provider value={{ toast, dismiss }}>
      {children}

      {/* Toast container */}
      {toasts.length > 0 && (
        <div
          style={{
            position: "fixed",
            bottom: 20,
            right: 20,
            zIndex: 10000,
            display: "flex",
            flexDirection: "column",
            gap: 8,
            pointerEvents: "none",
          }}
        >
          {toasts.map(t => {
            const c = COLORS[t.type];
            return (
              <div
                key={t.id}
                style={{
                  background: c.bg,
                  backdropFilter: "blur(12px)",
                  border: `1px solid ${c.border}`,
                  borderRadius: 6,
                  padding: "10px 14px",
                  fontSize: 12,
                  fontFamily: "monospace",
                  color: "#fff",
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  minWidth: 220,
                  maxWidth: 360,
                  boxShadow: "0 4px 16px rgba(0,0,0,0.4)",
                  animation: "fadeInUp 0.2s ease-out",
                  pointerEvents: "auto",
                  cursor: "pointer",
                }}
                onClick={() => dismiss(t.id)}
              >
                <span style={{ color: c.border, fontSize: 14, fontWeight: 700 }}>
                  {t.type === "loading" ? (
                    <span style={{ animation: "pulse-dot 1.5s ease-in-out infinite", display: "inline-block" }}>
                      {c.icon}
                    </span>
                  ) : c.icon}
                </span>
                <span>{t.message}</span>
              </div>
            );
          })}
        </div>
      )}
    </ToastContext.Provider>
  );
}
