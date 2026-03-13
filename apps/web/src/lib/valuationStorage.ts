const STORAGE_KEY = "ineqre-valuation-edits";

export type CellEdit = {
  targetPrice?: number;
  customEps?: number;
  notes?: string;
};

export type ValuationEdits = Record<string, CellEdit>; // keyed by ticker

export function loadValuationEdits(): ValuationEdits {
  if (typeof window === "undefined") return {};
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

export function saveValuationEdits(edits: ValuationEdits): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(edits));
  } catch (e) {
    console.error("Failed to save valuation edits:", e);
  }
}

export function clearValuationEdits(): void {
  if (typeof window === "undefined") return;
  localStorage.removeItem(STORAGE_KEY);
}
