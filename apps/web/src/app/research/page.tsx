'use client';

import { useState, useEffect, useMemo } from 'react';

type ResearchDocument = {
  id: string;
  ticker: string | null;
  source: string;
  subject: string;
  body_text: string;
  ai_summary: string | null;
  received_date: string;
  attachment_count: number;
  attachments: {
    id: string;
    filename: string;
    content_type: string;
    file_size: number;
  }[];
};

type StockInfo = { ticker: string; name: string };

type DocMeta = {
  ticker: string | null;
  tickers: string[];  // all tickers mentioned (for BørsXtra multi-company docs)
  rating: 'Buy' | 'Hold' | 'Sell' | null;
  category: 'company' | 'morning' | 'sector' | null;
};

export default function ResearchPortalPage() {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [password, setPassword] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  const [documents, setDocuments] = useState<ResearchDocument[]>([]);
  const [selectedSource, setSelectedSource] = useState<string>('all');
  const [selectedTicker, setSelectedTicker] = useState<string>('all');
  const [selectedCategory, setSelectedCategory] = useState<string>('all');
  const [searchTerm, setSearchTerm] = useState('');
  const [expandedDocs, setExpandedDocs] = useState<Set<string>>(new Set());
  const [selectedDocument, setSelectedDocument] = useState<ResearchDocument | null>(null);
  const [pdfCheckStatus, setPdfCheckStatus] = useState<Map<string, boolean>>(new Map());
  const [stocksList, setStocksList] = useState<StockInfo[]>([]);

  const toggleExpanded = (docId: string) => {
    setExpandedDocs(prev => {
      const next = new Set(prev);
      if (next.has(docId)) {
        next.delete(docId);
      } else {
        next.add(docId);
      }
      return next;
    });
  };

  // Clean body text for display
  const cleanBodyText = (text: string): string => {
    if (!text) return '';

    // Remove the Pareto Securities disclaimer
    let cleaned = text.split(/Source:\s*Pareto Securities/i)[0];
    cleaned = cleaned.split(/\n*Full Report:/i)[0];
    cleaned = cleaned.replace(/CLICK HERE FOR THE FULL REPORT/gi, '');

    // Fix encoding artifacts (mojibake from email import)
    cleaned = cleaned
      .replace(/â€¢/g, '\u2022')   // bullet point
      .replace(/â€"/g, '\u2013')   // en dash
      .replace(/â€"/g, '\u2014')   // em dash
      .replace(/â€˜/g, '\u2018')   // left single quote
      .replace(/â€™/g, '\u2019')   // right single quote
      .replace(/â€œ/g, '\u201C')   // left double quote
      .replace(/â€/g, '\u201D')    // right double quote
      .replace(/Â /g, ' ')         // non-breaking space
      .replace(/Ã¸/g, '\u00F8')   // Norwegian o
      .replace(/Ã¥/g, '\u00E5')   // Norwegian a
      .replace(/Ã¦/g, '\u00E6')   // Norwegian ae
      .replace(/â€¦/g, '...')      // ellipsis
      // Remove any remaining mojibake artifacts
      .replace(/[âÂ]/g, '');

    return cleaned.trim();
  };

  // Render AI summary with structured formatting
  const renderSummary = (text: string, compact: boolean = false): React.ReactNode => {
    const lines = text.split('\n').filter(l => l.trim());
    const elements: React.ReactNode[] = [];

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();

      // Header line: **Rating:** Buy | **Target Price:** NOK 46 | ...
      if (line.startsWith('**Rating:') || line.startsWith('**Target')) {
        const parts = line.split('|').map(p => p.trim());
        elements.push(
          <div key={i} style={{
            display: 'flex',
            flexWrap: 'wrap',
            gap: 12,
            marginBottom: compact ? 8 : 12,
            paddingBottom: compact ? 8 : 10,
            borderBottom: '1px solid var(--border)',
          }}>
            {parts.map((part, j) => {
              const match = part.match(/\*\*(.+?):\*\*\s*(.*)/);
              if (!match) return null;
              const [, label, value] = match;
              const color = label === 'Rating'
                ? (value.toLowerCase().includes('buy') ? '#22c55e' : value.toLowerCase().includes('sell') ? '#ef4444' : '#f59e0b')
                : 'var(--foreground)';
              return (
                <span key={j} style={{ fontSize: compact ? 12 : 13, whiteSpace: 'nowrap' }}>
                  <span style={{ color: '#888', fontWeight: 500 }}>{label}: </span>
                  <span style={{ color, fontWeight: 700 }}>{value}</span>
                </span>
              );
            })}
          </div>
        );
        continue;
      }

      // Section headers: **Thesis:**, **Key Points:**, **Estimates:**, **Price Target Changes:**, **Market:**
      if (/^\*\*(Thesis|Key Points|Estimates|Catalysts|Risks|Valuation|Price Target Changes|Market):?\*\*/.test(line)) {
        const match = line.match(/^\*\*(.+?):?\*\*\s*(.*)/);
        if (match) {
          const [, header, rest] = match;
          if (header === 'Key Points' || header === 'Estimates' || header === 'Price Target Changes') {
            // Always show Price Target Changes header; hide Key Points/Estimates in compact
            if (!compact || header === 'Price Target Changes') {
              elements.push(
                <div key={i} style={{
                  fontSize: 11,
                  fontWeight: 700,
                  color: '#888',
                  textTransform: 'uppercase',
                  letterSpacing: '0.05em',
                  marginTop: 10,
                  marginBottom: 4,
                }}>
                  {header}
                </div>
              );
            }
          } else {
            // Thesis - render inline
            elements.push(
              <p key={i} style={{
                fontSize: compact ? 13 : 14,
                lineHeight: 1.6,
                color: 'var(--foreground)',
                margin: compact ? '0 0 6px' : '0 0 8px',
                fontStyle: 'italic',
              }}>
                {rest}
              </p>
            );
          }
          continue;
        }
      }

      // BørsXtra-style price target bullet: - **Company**: Broker action target to NOK X (Y), Rating
      const ptMatch = line.match(/^- \*\*(.+?)\*\*:\s*(.+)/);
      if (ptMatch && /target|kursmål|reiterat|downgrad|upgrad|initiat|cut|adjust|øker|kutter/i.test(ptMatch[2])) {
        const [, company, details] = ptMatch;
        // Extract rating: check end of line first, then "downgraded/upgraded to X" pattern
        const ratingEnd = details.match(/(Buys?|Holds?|Sells?|Kjøp|Nøytral|Selg)\s*$/i);
        const ratingMid = !ratingEnd ? details.match(/(?:downgrad|upgrad|initiat)\w*\s+(?:from\s+\w+\s+)?to\s+(Buy|Hold|Sell|Kjøp|Nøytral|Selg)/i) : null;
        const ratingRaw = ratingEnd ? ratingEnd[1] : ratingMid ? ratingMid[1] : null;
        // Normalize plural to singular
        const ratingText = ratingRaw ? ratingRaw.replace(/s$/i, '') : null;
        const ratingColor = ratingText && /buy|kjøp/i.test(ratingText) ? '#22c55e'
          : ratingText && /sell|selg/i.test(ratingText) ? '#ef4444'
          : ratingText ? '#f59e0b' : null;
        // Extract broker name (first word(s) before action verb)
        const brokerMatch = details.match(/^([\w\s]+?)\s+(downgrad|upgrad|increas|cut|adjust|reiterat|initiat|øker|kutter|gjentar|set)/i);
        const broker = brokerMatch ? brokerMatch[1].trim() : null;
        const action = broker ? details.substring(broker.length).replace(/,\s*(Buys?|Holds?|Sells?|Kjøp|Nøytral|Selg)\s*$/i, '').trim() : details.replace(/,\s*(Buys?|Holds?|Sells?|Kjøp|Nøytral|Selg)\s*$/i, '').trim();

        elements.push(
          <div key={i} style={{
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            flexWrap: 'wrap',
            fontSize: compact ? 12 : 13,
            padding: compact ? '4px 0' : '5px 0',
            borderBottom: '1px solid rgba(255,255,255,0.05)',
          }}>
            <span style={{
              fontWeight: 700,
              color: '#3b82f6',
              minWidth: compact ? 80 : 100,
              flexShrink: 0,
            }}>{company}</span>
            {broker && (
              <span style={{
                fontSize: compact ? 10 : 11,
                padding: '2px 6px',
                background: 'rgba(255,255,255,0.08)',
                borderRadius: 4,
                color: '#aaa',
                fontWeight: 500,
                flexShrink: 0,
              }}>{broker}</span>
            )}
            <span style={{ color: 'var(--foreground)', flex: 1 }}>{action}</span>
            {ratingText && ratingColor && (
              <span style={{
                fontSize: compact ? 10 : 11,
                fontWeight: 700,
                padding: '2px 8px',
                borderRadius: 4,
                background: `${ratingColor}18`,
                color: ratingColor,
                border: `1px solid ${ratingColor}40`,
                flexShrink: 0,
              }}>{ratingText}</span>
            )}
          </div>
        );
        continue;
      }

      // Regular bullet points
      if (line.startsWith('- ')) {
        const bulletText = line.substring(2);
        const bulletHtml = bulletText.replace(/\*\*(.+?)\*\*/g, '<b>$1</b>');
        elements.push(
          <div key={i} style={{
            display: 'flex',
            gap: 8,
            fontSize: compact ? 12 : 13,
            lineHeight: 1.5,
            color: 'var(--foreground)',
            marginBottom: 3,
            paddingLeft: 2,
          }}>
            <span style={{ color: '#888', flexShrink: 0 }}>•</span>
            <span dangerouslySetInnerHTML={{ __html: bulletHtml }} />
          </div>
        );
        continue;
      }

      // Regular text (fallback for bold inline)
      const rendered = line.replace(/\*\*(.+?)\*\*/g, '<b>$1</b>');
      if (rendered !== line) {
        elements.push(
          <p key={i} style={{ fontSize: compact ? 13 : 14, lineHeight: 1.6, margin: '0 0 6px' }}
            dangerouslySetInnerHTML={{ __html: rendered }} />
        );
      } else {
        elements.push(
          <p key={i} style={{ fontSize: compact ? 13 : 14, lineHeight: 1.6, margin: '0 0 6px', color: 'var(--foreground)' }}>
            {line}
          </p>
        );
      }
    }

    return <>{elements}</>;
  };

  // Highlight search term in text
  const highlightText = (text: string, search: string): React.ReactNode => {
    if (!search.trim()) return text;

    const parts = text.split(new RegExp(`(${search})`, 'gi'));
    return parts.map((part, index) =>
      part.toLowerCase() === search.toLowerCase() ? (
        <mark key={index} style={{
          background: '#fef08a',
          color: '#000',
          padding: '2px 4px',
          borderRadius: 3,
          fontWeight: 600,
        }}>
          {part}
        </mark>
      ) : (
        part
      )
    );
  };

  // Clean filename for display
  const cleanFilename = (filename: string): string => {
    return filename
      .replace(/^report_/i, '')
      .replace(/___+/g, ' - ')
      .replace(/__+/g, ' ')
      .replace(/_/g, ' ')
      .replace(/\.pdf$/i, '');
  };

  // Extract PDF report link from body text
  const extractPdfLink = (text: string): string | null => {
    // Look for "Full Report:" followed by URL
    const fullReportMatch = text.match(/Full Report:\s*(https?:\/\/[^\s]+)/i);
    if (fullReportMatch) {
      return fullReportMatch[1];
    }

    // Fallback to FactSet hosting links
    const factsetMatch = text.match(/https:\/\/parp\.hosting\.factset\.com[^\s]+/);
    if (factsetMatch) {
      return factsetMatch[0];
    }

    // Last resort: any https link
    const urlMatch = text.match(/https?:\/\/[^\s\)]+/);
    return urlMatch ? urlMatch[0] : null;
  };

  // Check if already authenticated and session hasn't expired
  useEffect(() => {
    const token = sessionStorage.getItem('research_token');
    const loginTime = sessionStorage.getItem('research_login_time');

    if (token && loginTime) {
      const now = Date.now();
      const elapsed = now - parseInt(loginTime);
      const fourHours = 4 * 60 * 60 * 1000; // 4 hours in milliseconds

      if (elapsed < fourHours) {
        setIsAuthenticated(true);
        fetchDocuments(token);
      } else {
        // Session expired - clear storage
        sessionStorage.removeItem('research_token');
        sessionStorage.removeItem('research_login_time');
        setIsAuthenticated(false);
      }
    }

    // Fetch stocks list for ticker dropdown (public endpoint)
    fetch('/api/stocks')
      .then(r => r.ok ? r.json() : [])
      .then((data: StockInfo[]) => setStocksList(data))
      .catch(() => {});
  }, []);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setError('');

    try {
      const res = await fetch('/api/research/auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
      });

      if (!res.ok) {
        throw new Error('Invalid password');
      }

      const { token } = await res.json();
      sessionStorage.setItem('research_token', token);
      sessionStorage.setItem('research_login_time', Date.now().toString());
      setIsAuthenticated(true);
      fetchDocuments(token);
    } catch (err: any) {
      setError(err.message || 'Authentication failed');
    } finally {
      setIsLoading(false);
    }
  };

  const fetchDocuments = async (token: string) => {
    try {
      const res = await fetch('/api/research/documents?limit=2000', {
        headers: { 'Authorization': `Bearer ${token}` },
      });

      if (!res.ok) {
        if (res.status === 401) {
          sessionStorage.removeItem('research_token');
          sessionStorage.removeItem('research_login_time');
          setIsAuthenticated(false);
          return;
        }
        throw new Error('Failed to fetch documents');
      }

      const data = await res.json();
      setDocuments(data);

      // Automatically generate summaries in background if any are missing
      autoGenerateSummaries(token, data);
    } catch (err: any) {
      setError(err.message || 'Failed to load documents');
    }
  };

  // Silently generate AI summaries in background for documents that need them
  const autoGenerateSummaries = async (token: string, docs: ResearchDocument[]) => {
    // Check if any documents are missing summaries
    const missingCount = docs.filter(doc =>
      !doc.ai_summary && doc.body_text && doc.body_text.length > 100
    ).length;

    console.log(`[Auto-Summary] Found ${missingCount} documents needing summaries`);

    if (missingCount === 0) {
      return; // All documents have summaries
    }

    try {
      console.log('[Auto-Summary] Starting background generation...');

      // Silently trigger summary generation in background
      const res = await fetch('/api/research/generate-summaries', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}` },
      });

      if (!res.ok) {
        const errorText = await res.text();
        console.error('[Auto-Summary] API returned error:', res.status, errorText);
        return;
      }

      const result = await res.json();
      console.log('[Auto-Summary] Generation completed:', result);

      // After summaries are generated, refresh documents to show them
      console.log('[Auto-Summary] Refreshing documents...');
      const docsRes = await fetch('/api/research/documents?limit=2000', {
        headers: { 'Authorization': `Bearer ${token}` },
      });

      if (docsRes.ok) {
        const updatedData = await docsRes.json();
        setDocuments(updatedData);
        console.log('[Auto-Summary] Documents refreshed with new summaries');
      }
    } catch (err: any) {
      console.error('[Auto-Summary] Failed:', err.message);
    }
  };

  const handleViewPDF = async (doc: ResearchDocument) => {
    // First, check if there's a PDF attachment
    const pdfAttachment = doc.attachments?.find(att =>
      att.content_type === 'application/pdf' ||
      att.filename.toLowerCase().endsWith('.pdf')
    );

    if (pdfAttachment) {
      // Download the stored PDF
      await handleDownload(doc.id, pdfAttachment.id, pdfAttachment.filename);
      return;
    }

    // Fallback: try to extract and copy the report link
    const pdfLink = extractPdfLink(doc.body_text);

    if (!pdfLink) {
      alert('No PDF report available for this document.');
      return;
    }

    // Copy link to clipboard as fallback
    try {
      await navigator.clipboard.writeText(pdfLink);
      alert(
        'No PDF file stored. Report link copied to clipboard!\n\n' +
        'Note: This link may require authentication. ' +
        'Paste it in your browser to access the report.'
      );
    } catch (err) {
      alert(
        'Could not copy to clipboard. Here is the link:\n\n' +
        pdfLink +
        '\n\nNote: This link may require authentication.'
      );
    }
  };

  const handleDownload = async (documentId: string, attachmentId: string, filename: string) => {
    const token = sessionStorage.getItem('research_token');
    if (!token) return;

    try {
      const res = await fetch(`/api/research/documents/${documentId}/attachments/${attachmentId}`, {
        headers: { 'Authorization': `Bearer ${token}` },
      });

      if (!res.ok) {
        // PDF not available - mark it and show inline preview instead
        setPdfCheckStatus(prev => new Map(prev).set(`${documentId}-${attachmentId}`, false));
        const doc = documents.find(d => d.id === documentId);
        if (doc) {
          setSelectedDocument(doc);
        }
        return;
      }

      // PDF available - mark it
      setPdfCheckStatus(prev => new Map(prev).set(`${documentId}-${attachmentId}`, true));

      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.URL.revokeObjectURL(url);
    } catch (err: any) {
      // Show inline preview on error
      setPdfCheckStatus(prev => new Map(prev).set(`${documentId}-${attachmentId}`, false));
      const doc = documents.find(d => d.id === documentId);
      if (doc) {
        setSelectedDocument(doc);
      }
    }
  };

  const handleLogout = () => {
    sessionStorage.removeItem('research_token');
    sessionStorage.removeItem('research_login_time');
    setIsAuthenticated(false);
    setDocuments([]);
  };

  // Build company name → ticker lookup from stocks list
  const nameToTicker = useMemo(() => {
    const map = new Map<string, string>();
    for (const s of stocksList) {
      // Add ticker itself
      map.set(s.ticker.toUpperCase(), s.ticker);
      if (!s.name) continue;
      const name = s.name.toUpperCase();
      // Full name: "Aker BP ASA" → AKRBP
      map.set(name, s.ticker);
      // Without suffix: "Aker BP" → AKRBP
      const short = name.replace(/\s+(ASA|AS|A\/S|LTD|LIMITED|SA|SE|NV|OYJ|HOLDING|HOLDINGS|CORP|CORPORATION)\b\.?/gi, '').trim();
      if (short && short !== name) map.set(short, s.ticker);
      // Also strip "P/F" prefix for Faroese companies
      const noPrefix = short.replace(/^P\/F\s+/i, '').trim();
      if (noPrefix !== short) map.set(noPrefix, s.ticker);
    }
    return map;
  }, [stocksList]);

  // Compute metadata (ticker, rating, category) for each document
  const docMeta = useMemo(() => {
    const meta = new Map<string, DocMeta>();
    // Sort tickers longest-first to avoid AKER matching before AKERBP
    const sortedTickers = [...stocksList].sort((a, b) => b.ticker.length - a.ticker.length);
    // Build name entries sorted longest-first for subject matching
    // Exclude bare ticker symbols — those are matched case-sensitively in the second pass
    const tickerSet = new Set(stocksList.map(s => s.ticker.toUpperCase()));
    const nameEntries = Array.from(nameToTicker.entries())
      .filter(([name]) => name.length >= 3 && !tickerSet.has(name))
      .sort((a, b) => b[0].length - a[0].length);

    for (const doc of documents) {
      const subjectLow = doc.subject.toLowerCase();
      const isBorsXtra = /børsxtra|borsxtra/i.test(subjectLow);

      // Extract ticker: use DB value if set, otherwise match from subject
      let ticker: string | null = doc.ticker;
      if (!ticker) {
        // First pass: match company names case-insensitively (longer names first)
        const subjectUp = doc.subject.toUpperCase();
        for (const [name, t] of nameEntries) {
          const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
          if (new RegExp('\\b' + escaped + '\\b').test(subjectUp)) {
            ticker = t;
            break;
          }
        }
        // Second pass: match ticker symbols case-sensitively on original text
        // (prevents common words like "next", "all" from matching tickers)
        if (!ticker) {
          for (const s of sortedTickers) {
            const t = s.ticker.toUpperCase();
            const re = new RegExp('\\b' + t.replace('.', '\\.') + '\\b');
            if (re.test(doc.subject)) {
              ticker = s.ticker;
              break;
            }
          }
        }
      }

      // For BørsXtra: extract ALL company tickers from the AI summary
      const tickers: string[] = [];
      if (isBorsXtra && doc.ai_summary) {
        const companyMatches = doc.ai_summary.matchAll(/\*\*(.+?)\*\*:/g);
        for (const cm of companyMatches) {
          const companyName = cm[1].trim().toUpperCase();
          // Try exact match in name lookup
          const found = nameToTicker.get(companyName);
          if (found) {
            if (!tickers.includes(found)) tickers.push(found);
            continue;
          }
          // Try matching against ticker symbols directly
          for (const s of sortedTickers) {
            if (companyName === s.ticker.toUpperCase()) {
              if (!tickers.includes(s.ticker)) tickers.push(s.ticker);
              break;
            }
            // Partial name match: "Aker BP" in "Aker BP ASA"
            const sName = (s.name || '').toUpperCase();
            if (sName.startsWith(companyName) || companyName.startsWith(sName.replace(/\s+(ASA|LTD|SE|A\/S)$/i, '').trim())) {
              if (!tickers.includes(s.ticker)) tickers.push(s.ticker);
              break;
            }
          }
        }
      }

      // If single-company doc, add its ticker to tickers array too
      if (ticker && !tickers.includes(ticker)) tickers.unshift(ticker);

      // Extract rating from AI summary
      let rating: DocMeta['rating'] = null;
      const ratingMatch = doc.ai_summary?.match(/\*\*Rating:\*\*\s*(Buy|Hold|Sell)/i);
      if (ratingMatch) {
        const r = ratingMatch[1].charAt(0).toUpperCase() + ratingMatch[1].slice(1).toLowerCase();
        rating = r as DocMeta['rating'];
      }

      // Classify category from subject
      let category: DocMeta['category'] = null;
      if (/morning comment|daily|high yield daily|shipping daily/.test(subjectLow)) {
        category = 'morning';
      } else if (/oil\s*&?\s*gas|shipping|energy|sector|macro|borsxtra|børsxtra/.test(subjectLow)) {
        category = 'sector';
      } else if (/update|newsflash|quarterly|preview|review|initiated|upgrade|downgrade|reiterat/.test(subjectLow)) {
        category = 'company';
      }

      meta.set(doc.id, { ticker: ticker || (tickers[0] ?? null), tickers, rating, category });
    }
    return meta;
  }, [documents, stocksList, nameToTicker]);

  // Get tickers that appear in documents, with counts
  const tickerOptions = useMemo(() => {
    const counts = new Map<string, number>();
    for (const [, m] of docMeta) {
      for (const t of m.tickers) {
        counts.set(t, (counts.get(t) || 0) + 1);
      }
    }
    return Array.from(counts.entries())
      .sort((a, b) => b[1] - a[1])
      .map(([ticker, count]) => ({ ticker, count }));
  }, [docMeta]);

  // Count documents by category and rating for chip badges
  const filterCounts = useMemo(() => {
    const counts = { company: 0, morning: 0, sector: 0, Buy: 0, Hold: 0, Sell: 0 };
    for (const [, m] of docMeta) {
      if (m.category) counts[m.category]++;
      if (m.rating) counts[m.rating]++;
    }
    return counts;
  }, [docMeta]);

  // Filter documents
  const filteredDocuments = documents.filter(doc => {
    if (!doc.body_text && !doc.ai_summary) return false;

    const meta = docMeta.get(doc.id);
    const matchesSource = selectedSource === 'all' || doc.source === selectedSource;
    const matchesTicker = selectedTicker === 'all' || (meta?.tickers?.includes(selectedTicker) ?? false);
    const matchesSearch = !searchTerm ||
      doc.subject.toLowerCase().includes(searchTerm.toLowerCase()) ||
      (doc.ticker && doc.ticker.toLowerCase().includes(searchTerm.toLowerCase())) ||
      (meta?.ticker && meta.ticker.toLowerCase().includes(searchTerm.toLowerCase())) ||
      (doc.body_text && doc.body_text.toLowerCase().includes(searchTerm.toLowerCase()));

    // Category filter: 'all', 'company', 'morning', 'sector', 'Buy', 'Hold', 'Sell'
    let matchesCategory = true;
    if (selectedCategory === 'company' || selectedCategory === 'morning' || selectedCategory === 'sector') {
      matchesCategory = meta?.category === selectedCategory;
    } else if (selectedCategory === 'Buy' || selectedCategory === 'Hold' || selectedCategory === 'Sell') {
      matchesCategory = meta?.rating === selectedCategory;
    }

    return matchesSource && matchesTicker && matchesSearch && matchesCategory;
  });

  // Get unique sources
  const sources = Array.from(new Set(documents.map(d => d.source)));

  if (!isAuthenticated) {
    return (
      <main style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'var(--background)'
      }}>
        <div style={{
          width: '100%',
          maxWidth: 400,
          padding: 32,
          border: '1px solid var(--border)',
          borderRadius: 12,
          background: 'var(--card-bg)',
          boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06)'
        }}>
          <h1 style={{ fontSize: 24, fontWeight: 700, marginBottom: 8, textAlign: 'center' }}>
            Research Portal
          </h1>
          <p style={{ fontSize: 14, color: 'var(--muted-foreground)', marginBottom: 24, textAlign: 'center' }}>
            Pareto Securities & Analyst Reports
          </p>

          <form onSubmit={handleLogin}>
            <div style={{ marginBottom: 16 }}>
              <label style={{
                display: 'block',
                fontSize: 13,
                fontWeight: 500,
                marginBottom: 8,
                color: 'var(--foreground)'
              }}>
                Access Password
              </label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Enter password"
                style={{
                  width: '100%',
                  padding: '10px 12px',
                  border: '1px solid var(--input-border)',
                  borderRadius: 6,
                  background: 'var(--input-bg)',
                  color: 'var(--foreground)',
                  fontSize: 14,
                }}
                disabled={isLoading}
              />
            </div>

            {error && (
              <div style={{
                padding: '8px 12px',
                marginBottom: 16,
                background: 'rgba(239, 68, 68, 0.1)',
                border: '1px solid rgba(239, 68, 68, 0.3)',
                borderRadius: 6,
                color: '#ef4444',
                fontSize: 13,
              }}>
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={isLoading || !password}
              style={{
                width: '100%',
                padding: '10px 16px',
                background: '#3b82f6',
                color: '#fff',
                border: 'none',
                borderRadius: 6,
                fontSize: 14,
                fontWeight: 600,
                cursor: isLoading || !password ? 'not-allowed' : 'pointer',
                opacity: isLoading || !password ? 0.6 : 1,
              }}
            >
              {isLoading ? 'Authenticating...' : 'Access Research'}
            </button>
          </form>
        </div>
      </main>
    );
  }

  return (
    <main style={{ maxWidth: 1400, margin: '0 auto', padding: 20, background: 'var(--background)', minHeight: '100vh' }}>
      {/* Header */}
      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: 32,
        paddingBottom: 16,
        borderBottom: '2px solid var(--border)'
      }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 4 }}>
            <h1 style={{ fontSize: 32, fontWeight: 700, color: 'var(--foreground)' }}>
              Research Portal
            </h1>
            <span style={{
              fontSize: 12,
              fontWeight: 600,
              padding: '4px 10px',
              background: 'rgba(59, 130, 246, 0.1)',
              border: '1px solid rgba(59, 130, 246, 0.3)',
              borderRadius: 4,
              color: '#3b82f6',
            }}>
              Data from 2026
            </span>
          </div>
          <p style={{ fontSize: 14, color: 'var(--muted-foreground)' }}>
            {documents.length} documents • {filteredDocuments.length} shown
          </p>
        </div>
        <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
          <button
            onClick={() => {
              window.location.href = 'https://ineqre.no';
            }}
            style={{
              padding: '8px 16px',
              background: 'transparent',
              border: '1px solid var(--border)',
              borderRadius: 6,
              color: 'var(--foreground)',
              fontSize: 14,
              cursor: 'pointer',
              transition: 'all 0.2s',
            }}
            onMouseOver={(e) => e.currentTarget.style.background = 'var(--hover-bg)'}
            onMouseOut={(e) => e.currentTarget.style.background = 'transparent'}
          >
            Home
          </button>
          <button
            onClick={handleLogout}
            style={{
              padding: '8px 16px',
              background: 'transparent',
              border: '1px solid var(--border)',
              borderRadius: 6,
              color: 'var(--foreground)',
              fontSize: 14,
              cursor: 'pointer',
              transition: 'all 0.2s',
            }}
            onMouseOver={(e) => e.currentTarget.style.background = 'var(--hover-bg)'}
            onMouseOut={(e) => e.currentTarget.style.background = 'transparent'}
          >
            Logout
          </button>
        </div>
      </div>

      {/* Filters */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginBottom: 24 }}>
        {/* Row 1: Search + Dropdowns */}
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
          <input
            type="text"
            placeholder="Search by ticker, subject, or content..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            style={{
              flex: 1,
              minWidth: 280,
              padding: '10px 14px',
              border: '1px solid var(--input-border)',
              borderRadius: 8,
              background: 'var(--input-bg)',
              color: 'var(--foreground)',
              fontSize: 14,
            }}
          />

          <select
            value={selectedTicker}
            onChange={(e) => setSelectedTicker(e.target.value)}
            style={{
              padding: '10px 14px',
              border: '1px solid var(--input-border)',
              borderRadius: 8,
              background: 'var(--input-bg)',
              color: 'var(--foreground)',
              fontSize: 14,
              cursor: 'pointer',
              minWidth: 160,
            }}
          >
            <option value="all">All Tickers</option>
            {tickerOptions.map(({ ticker, count }) => (
              <option key={ticker} value={ticker}>{ticker} ({count})</option>
            ))}
          </select>

          <select
            value={selectedSource}
            onChange={(e) => setSelectedSource(e.target.value)}
            style={{
              padding: '10px 14px',
              border: '1px solid var(--input-border)',
              borderRadius: 8,
              background: 'var(--input-bg)',
              color: 'var(--foreground)',
              fontSize: 14,
              cursor: 'pointer',
              minWidth: 160,
            }}
          >
            <option value="all">All Sources</option>
            {sources.map(source => (
              <option key={source} value={source}>{source}</option>
            ))}
          </select>
        </div>

        {/* Row 2: Filter chips */}
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          {[
            { key: 'all', label: 'All', color: undefined },
            { key: 'company', label: 'Company Reports', color: undefined },
            { key: 'morning', label: 'Morning / Daily', color: undefined },
            { key: 'sector', label: 'Sector / Macro', color: undefined },
          ].map(chip => {
            const isActive = selectedCategory === chip.key;
            const count = chip.key === 'all' ? documents.filter(d => d.body_text || d.ai_summary).length : filterCounts[chip.key as keyof typeof filterCounts] || 0;
            return (
              <button
                key={chip.key}
                onClick={() => setSelectedCategory(chip.key)}
                style={{
                  padding: '6px 14px',
                  fontSize: 13,
                  fontWeight: isActive ? 600 : 400,
                  border: `1px solid ${isActive ? '#0066CC' : 'var(--border)'}`,
                  borderRadius: 20,
                  background: isActive ? 'rgba(0, 102, 204, 0.1)' : 'transparent',
                  color: isActive ? '#3b82f6' : 'var(--muted-foreground)',
                  cursor: 'pointer',
                  transition: 'all 0.15s',
                }}
              >
                {chip.label} <span style={{ opacity: 0.6, fontSize: 11 }}>{count}</span>
              </button>
            );
          })}

          <span style={{ width: 1, height: 20, background: 'var(--border)', margin: '0 4px' }} />

          {[
            { key: 'Buy', label: 'Buy', color: '#22c55e' },
            { key: 'Hold', label: 'Hold', color: '#f59e0b' },
            { key: 'Sell', label: 'Sell', color: '#ef4444' },
          ].map(chip => {
            const isActive = selectedCategory === chip.key;
            const count = filterCounts[chip.key as keyof typeof filterCounts] || 0;
            return (
              <button
                key={chip.key}
                onClick={() => setSelectedCategory(isActive ? 'all' : chip.key)}
                style={{
                  padding: '6px 14px',
                  fontSize: 13,
                  fontWeight: isActive ? 600 : 400,
                  border: `1px solid ${isActive ? chip.color : 'var(--border)'}`,
                  borderRadius: 20,
                  background: isActive ? `${chip.color}18` : 'transparent',
                  color: isActive ? chip.color : 'var(--muted-foreground)',
                  cursor: 'pointer',
                  transition: 'all 0.15s',
                }}
              >
                <span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: '50%', background: chip.color, marginRight: 6 }} />
                {chip.label} <span style={{ opacity: 0.6, fontSize: 11 }}>{count}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Documents List */}
      {filteredDocuments.length === 0 ? (
        <div style={{
          padding: 60,
          textAlign: 'center',
          color: 'var(--muted)',
          border: '1px dashed var(--border)',
          borderRadius: 12,
          background: 'var(--card-bg)',
        }}>
          <p style={{ fontSize: 18, marginBottom: 8, fontWeight: 500 }}>No documents found</p>
          <p style={{ fontSize: 14 }}>
            {searchTerm ? 'Try adjusting your search' : 'Documents will appear here when received'}
          </p>
        </div>
      ) : (
        <div style={{ display: 'grid', gap: 20 }}>
          {filteredDocuments.map(doc => (
            <div
              key={doc.id}
              style={{
                padding: 24,
                border: '1px solid var(--border)',
                borderRadius: 12,
                background: 'var(--card-bg)',
                boxShadow: '0 1px 3px 0 rgba(0, 0, 0, 0.1)',
                transition: 'all 0.2s',
              }}
            >
              {/* Header */}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'start', marginBottom: 16 }}>
                <div style={{ flex: 1 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8, flexWrap: 'wrap' }}>
                    {(() => {
                      const meta = docMeta.get(doc.id);
                      const displayTickers = meta?.tickers?.length ? meta.tickers : (meta?.ticker ? [meta.ticker] : (doc.ticker ? [doc.ticker] : []));
                      const ratingColor = meta?.rating === 'Buy' ? '#22c55e' : meta?.rating === 'Sell' ? '#ef4444' : meta?.rating === 'Hold' ? '#f59e0b' : null;
                      // Show max 5 ticker badges, then "+N more"
                      const maxBadges = 5;
                      const shownTickers = displayTickers.slice(0, maxBadges);
                      const extraCount = displayTickers.length - maxBadges;
                      return (
                        <>
                          {shownTickers.map(t => (
                            <span
                              key={t}
                              style={{
                                padding: '3px 8px',
                                background: '#0066CC',
                                color: '#fff',
                                fontSize: 11,
                                fontWeight: 700,
                                borderRadius: 5,
                                letterSpacing: '0.5px',
                                cursor: 'pointer',
                              }}
                              onClick={() => setSelectedTicker(t)}
                            >
                              {t}
                            </span>
                          ))}
                          {extraCount > 0 && (
                            <span style={{ fontSize: 11, color: '#888' }}>+{extraCount} more</span>
                          )}
                          {meta?.rating && ratingColor && (
                            <span style={{
                              padding: '3px 8px',
                              fontSize: 11,
                              fontWeight: 700,
                              borderRadius: 4,
                              background: `${ratingColor}18`,
                              color: ratingColor,
                              border: `1px solid ${ratingColor}40`,
                            }}>
                              {meta.rating}
                            </span>
                          )}
                        </>
                      );
                    })()}
                    <span style={{
                      fontSize: 12,
                      color: 'var(--muted-foreground)',
                      padding: '4px 10px',
                      background: 'var(--hover-bg)',
                      borderRadius: 6,
                    }}>
                      {doc.source}
                    </span>
                    <span style={{ fontSize: 12, color: 'var(--muted-foreground)' }}>
                      {new Date(doc.received_date).toLocaleDateString('en-US', {
                        year: 'numeric',
                        month: 'short',
                        day: 'numeric',
                      })} • {new Date(doc.received_date).toLocaleTimeString('en-US', {
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </span>
                  </div>
                  <h3 style={{ fontSize: 18, fontWeight: 600, marginBottom: 0, color: 'var(--foreground)', lineHeight: 1.4 }}>
                    {highlightText(doc.subject, searchTerm)}
                  </h3>
                </div>
              </div>

              {/* Preview text - show AI summary if available, otherwise body text */}
              {(doc.ai_summary || doc.body_text) && (
                <div style={{
                  padding: 16,
                  background: 'var(--hover-bg)',
                  borderLeft: `3px solid ${doc.ai_summary ? '#10B981' : '#0066CC'}`,
                  borderRadius: 6,
                  marginBottom: 16,
                }}>
                  {doc.ai_summary ? (
                    <div style={{
                      fontSize: 14,
                      lineHeight: 1.6,
                      color: 'var(--foreground)',
                    }}>
                      {renderSummary(doc.ai_summary, true)}
                    </div>
                  ) : (
                    <>
                      <p style={{
                        fontSize: 14,
                        lineHeight: 1.6,
                        color: 'var(--foreground)',
                        margin: 0,
                        display: '-webkit-box',
                        WebkitLineClamp: expandedDocs.has(doc.id) ? 'unset' : 3,
                        WebkitBoxOrient: 'vertical',
                        overflow: 'hidden',
                      }}>
                        {highlightText(cleanBodyText(doc.body_text), searchTerm)}
                      </p>
                      {doc.body_text.length > 300 && (
                        <button
                          onClick={() => toggleExpanded(doc.id)}
                          style={{
                            marginTop: 12,
                            padding: '6px 12px',
                            background: 'transparent',
                            border: '1px solid var(--border)',
                            borderRadius: 6,
                            color: '#0066CC',
                            fontSize: 13,
                            fontWeight: 500,
                            cursor: 'pointer',
                          }}
                        >
                          {expandedDocs.has(doc.id) ? 'Show less ▲' : 'Read more ▼'}
                        </button>
                      )}
                    </>
                  )}
                </div>
              )}

              {/* Action buttons */}
              <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
                {doc.attachments && doc.attachments.length > 0 && (() => {
                  const pdfKey = `${doc.id}-${doc.attachments[0].id}`;
                  const pdfStatus = pdfCheckStatus.get(pdfKey);
                  const isPdfUnavailable = pdfStatus === false;

                  return (
                    <>
                      <button
                        onClick={() => handleDownload(doc.id, doc.attachments[0].id, doc.attachments[0].filename)}
                        disabled={isPdfUnavailable}
                        style={{
                          padding: '12px 24px',
                          background: isPdfUnavailable ? '#6B7280' : '#0066CC',
                          color: '#fff',
                          border: 'none',
                          borderRadius: 6,
                          fontSize: 14,
                          fontWeight: 600,
                          cursor: isPdfUnavailable ? 'not-allowed' : 'pointer',
                          opacity: isPdfUnavailable ? 0.6 : 1,
                          transition: 'all 0.2s',
                        }}
                        onMouseOver={(e) => {
                          if (!isPdfUnavailable) {
                            e.currentTarget.style.background = '#0052A3';
                          }
                        }}
                        onMouseOut={(e) => {
                          if (!isPdfUnavailable) {
                            e.currentTarget.style.background = '#0066CC';
                          }
                        }}
                      >
                        {isPdfUnavailable ? 'PDF Not Available' : 'View Report'}
                      </button>
                      {isPdfUnavailable && (
                        <span style={{
                          fontSize: 12,
                          color: '#EF4444',
                          fontWeight: 500,
                        }}>
                          Use "Show Details" to view content
                        </span>
                      )}
                    </>
                  );
                })()}

                {/* Show full content button */}
                <button
                  onClick={() => {
                    if (selectedDocument?.id === doc.id) {
                      setSelectedDocument(null);
                    } else {
                      setSelectedDocument(doc);
                    }
                  }}
                  style={{
                    padding: '12px 24px',
                    background: selectedDocument?.id === doc.id ? 'rgba(0, 102, 204, 0.1)' : 'transparent',
                    color: '#0066CC',
                    border: '2px solid #0066CC',
                    borderRadius: 6,
                    fontSize: 14,
                    fontWeight: 600,
                    cursor: 'pointer',
                    transition: 'all 0.2s',
                  }}
                  onMouseOver={(e) => {
                    if (selectedDocument?.id !== doc.id) {
                      e.currentTarget.style.background = 'rgba(0, 102, 204, 0.1)';
                    }
                  }}
                  onMouseOut={(e) => {
                    if (selectedDocument?.id !== doc.id) {
                      e.currentTarget.style.background = 'transparent';
                    }
                  }}
                >
                  {selectedDocument?.id === doc.id ? 'Hide Details ▲' : 'Show Details ▼'}
                </button>
              </div>

              {/* Inline Full Content Preview */}
              {selectedDocument?.id === doc.id && (
                <div style={{
                  marginTop: 20,
                  paddingTop: 20,
                  borderTop: '2px solid var(--border)',
                }}>
                  {/* AI Summary if available */}
                  {doc.ai_summary && (
                    <div style={{
                      padding: 20,
                      marginBottom: 20,
                      background: 'rgba(34, 197, 94, 0.05)',
                      border: '2px solid rgba(34, 197, 94, 0.2)',
                      borderRadius: 8,
                    }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
                        <span style={{
                          fontSize: 12,
                          fontWeight: 700,
                          color: '#22c55e',
                          textTransform: 'uppercase',
                          letterSpacing: '0.05em',
                        }}>
                          AI Summary
                        </span>
                      </div>
                      <div style={{
                        fontSize: 14,
                        lineHeight: 1.7,
                        color: 'var(--foreground)',
                      }}>
                        {renderSummary(doc.ai_summary, false)}
                      </div>
                    </div>
                  )}

                  {/* Full Email Content */}
                  {doc.body_text && (
                    <div style={{
                      padding: 20,
                      background: 'var(--background)',
                      border: '1px solid var(--border)',
                      borderRadius: 8,
                      maxHeight: 600,
                      overflow: 'auto',
                    }}>
                      <h4 style={{
                        fontSize: 12,
                        fontWeight: 600,
                        color: 'var(--muted-foreground)',
                        marginBottom: 16,
                        textTransform: 'uppercase',
                        letterSpacing: '0.05em'
                      }}>
                        Full Email Content
                      </h4>
                      <div style={{
                        fontSize: 14,
                        lineHeight: 1.7,
                        color: 'var(--foreground)',
                        whiteSpace: 'pre-wrap',
                        fontFamily: 'monospace',
                      }}>
                        {cleanBodyText(doc.body_text)}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

    </main>
  );
}
