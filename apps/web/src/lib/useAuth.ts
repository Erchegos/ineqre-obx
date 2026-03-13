"use client";

import { useState, useEffect, useCallback } from "react";

const STORAGE_KEY = "ineqre_auth";

type AuthState = {
  token: string | null;
  profile: string;
};

function readStorage(): AuthState {
  if (typeof window === "undefined") return { token: null, profile: "" };
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { token: null, profile: "" };
    const parsed = JSON.parse(raw);
    // Check JWT expiry (payload is base64-encoded middle segment)
    if (parsed.token) {
      const payload = JSON.parse(atob(parsed.token.split(".")[1]));
      if (payload.exp && payload.exp * 1000 < Date.now()) {
        localStorage.removeItem(STORAGE_KEY);
        return { token: null, profile: "" };
      }
    }
    return { token: parsed.token || null, profile: parsed.profile || "" };
  } catch {
    return { token: null, profile: "" };
  }
}

function writeStorage(state: AuthState) {
  if (typeof window === "undefined") return;
  if (state.token) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } else {
    localStorage.removeItem(STORAGE_KEY);
  }
}

/**
 * Shared auth hook — persists JWT + profile in localStorage.
 * Login once, stays logged in across all pages until token expires (8h).
 */
export function useAuth() {
  const [token, setToken] = useState<string | null>(null);
  const [profile, setProfile] = useState("");
  const [ready, setReady] = useState(false);

  // Hydrate from localStorage on mount
  useEffect(() => {
    const stored = readStorage();
    setToken(stored.token);
    setProfile(stored.profile);
    setReady(true);
  }, []);

  const login = useCallback((newToken: string, newProfile: string) => {
    setToken(newToken);
    setProfile(newProfile);
    writeStorage({ token: newToken, profile: newProfile });
  }, []);

  const logout = useCallback(() => {
    setToken(null);
    setProfile("");
    writeStorage({ token: null, profile: "" });
  }, []);

  // Auto-logout on 401 — call this when any API returns 401
  const handleUnauthorized = useCallback(() => {
    logout();
  }, [logout]);

  return { token, profile, ready, login, logout, handleUnauthorized };
}
