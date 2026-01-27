"use client";

import { useState, useEffect, useRef } from "react";

type TickerSelectorProps = {
  value: string;
  onChange: (ticker: string) => void;
  placeholder?: string;
};

const POPULAR_TICKERS = [
  "AKER", "ABG", "DNB", "EQNR", "OBX", "YAR", "BAKKA", "PARETO",
  "STB", "NSKOG", "MOWI", "TGS", "AKRBP", "NEL", "CRAYN"
];

export default function TickerSelector({ value, onChange, placeholder = "Enter ticker symbol" }: TickerSelectorProps) {
  const [inputValue, setInputValue] = useState(value);
  const [isOpen, setIsOpen] = useState(false);
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setInputValue(value);
  }, [value]);

  useEffect(() => {
    // Filter suggestions based on input
    if (inputValue.length === 0) {
      setSuggestions(POPULAR_TICKERS);
    } else {
      const filtered = POPULAR_TICKERS.filter(ticker =>
        ticker.toLowerCase().includes(inputValue.toLowerCase())
      );
      setSuggestions(filtered);
    }
  }, [inputValue]);

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value.toUpperCase();
    setInputValue(val);
    setIsOpen(true);
  };

  const handleSelectTicker = (ticker: string) => {
    setInputValue(ticker);
    onChange(ticker);
    setIsOpen(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      onChange(inputValue);
      setIsOpen(false);
    } else if (e.key === 'Escape') {
      setIsOpen(false);
    }
  };

  const handleFocus = () => {
    setIsOpen(true);
  };

  return (
    <div ref={containerRef} style={{ position: "relative", width: "100%" }}>
      <input
        type="text"
        value={inputValue}
        onChange={handleInputChange}
        onKeyDown={handleKeyDown}
        onFocus={handleFocus}
        placeholder={placeholder}
        style={{
          width: "100%",
          padding: "8px 12px",
          borderRadius: 4,
          border: "1px solid var(--input-border)",
          background: "var(--input-bg)",
          color: "var(--foreground)",
          fontSize: 14,
          fontWeight: 500,
          textTransform: "uppercase",
        }}
      />

      {isOpen && suggestions.length > 0 && (
        <div style={{
          position: "absolute",
          top: "100%",
          left: 0,
          right: 0,
          marginTop: 4,
          maxHeight: 300,
          overflowY: "auto",
          background: "var(--card-bg)",
          border: "1px solid var(--card-border)",
          borderRadius: 4,
          boxShadow: "0 4px 12px rgba(0, 0, 0, 0.3)",
          zIndex: 1000,
        }}>
          {suggestions.map((ticker) => (
            <div
              key={ticker}
              onClick={() => handleSelectTicker(ticker)}
              style={{
                padding: "10px 12px",
                cursor: "pointer",
                fontSize: 14,
                fontWeight: 500,
                borderBottom: "1px solid var(--border)",
                transition: "background 0.15s",
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = "var(--hover-bg)";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = "transparent";
              }}
            >
              {ticker}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
