'use client';

import { useState, useEffect } from 'react';

type ResearchDocument = {
  id: string;
  ticker: string | null;
  source: string;
  subject: string;
  body_text: string;
  received_date: string;
  attachment_count: number;
  attachments: {
    id: string;
    filename: string;
    content_type: string;
    file_size: number;
  }[];
};

export default function ResearchPortalPage() {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [password, setPassword] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  const [documents, setDocuments] = useState<ResearchDocument[]>([]);
  const [selectedSource, setSelectedSource] = useState<string>('all');
  const [searchTerm, setSearchTerm] = useState('');
  const [expandedDocs, setExpandedDocs] = useState<Set<string>>(new Set());

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

    // First, remove the Pareto Securities disclaimer (everything from "Source: Pareto Securities" onwards)
    let cleaned = text.split(/Source:\s*Pareto Securities/i)[0];

    // Remove "Full Report:" section and everything after it
    cleaned = cleaned.split(/\n*Full Report:/i)[0];

    // Remove "CLICK HERE FOR THE FULL REPORT" and similar patterns
    cleaned = cleaned.replace(/CLICK HERE FOR THE FULL REPORT/gi, '');

    // Comprehensive fix for Windows-1252 to UTF-8 double-encoding (mojibake)
    const mojibakeFixes: Array<[string, string]> = [
      // Quotes and apostrophes (most common)
      ['â€™', "'"], ['â€˜', "'"], ['â€œ', '"'], ['â€', '"'],
      ['â€˛', "'"], ['â€³', '"'], [''', "'"], [''', "'"], ['"', '"'], ['"', '"'],
      // Dashes
      ['â€"', '–'], ['â€"', '—'], ['â€'', '-'],
      // Special chars
      ['â€¦', '...'], ['â€¢', '•'], ['â€‹', ''],
      // Spaces
      ['Â ', ' '], ['Â', ''],
      // Norwegian
      ['Ã¥', 'å'], ['Ã¸', 'ø'], ['Ã¦', 'æ'], ['Ã…', 'Å'], ['Ã˜', 'Ø'], ['Ã†', 'Æ'],
      // European chars
      ['Ã©', 'é'], ['Ã¨', 'è'], ['Ãª', 'ê'], ['Ã«', 'ë'],
      ['Ã¡', 'á'], ['Ã ', 'à'], ['Ã¢', 'â'], ['Ã¤', 'ä'], ['Ã£', 'ã'],
      ['Ã¶', 'ö'], ['Ã´', 'ô'], ['Ã²', 'ò'], ['Ã³', 'ó'],
      ['Ã¼', 'ü'], ['Ã»', 'û'], ['Ã¹', 'ù'], ['Ãº', 'ú'],
      ['Ã±', 'ñ'], ['Ã§', 'ç'], ['Ã', 'Ø'],
      // Symbols
      ['Â°', '°'], ['Â±', '±'], ['Ã—', '×'], ['Ã·', '÷'],
      ['Â£', '£'], ['â‚¬', '€'], ['Â¥', '¥'], ['Â¢', '¢'],
      ['Â©', '©'], ['Â®', '®'], ['â„¢', '™'], ['Â§', '§'], ['Âµ', 'µ'],
    ];

    for (const [bad, good] of mojibakeFixes) {
      while (cleaned.includes(bad)) {
        cleaned = cleaned.replace(bad, good);
      }
    }

    // Clean up extra whitespace
    cleaned = cleaned.trim().replace(/\s+/g, ' ');

    return cleaned;
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

  // Check if already authenticated
  useEffect(() => {
    const token = sessionStorage.getItem('research_token');
    if (token) {
      setIsAuthenticated(true);
      fetchDocuments(token);
    }
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
      const res = await fetch('/api/research/documents', {
        headers: { 'Authorization': `Bearer ${token}` },
      });

      if (!res.ok) {
        if (res.status === 401) {
          sessionStorage.removeItem('research_token');
          setIsAuthenticated(false);
          return;
        }
        throw new Error('Failed to fetch documents');
      }

      const data = await res.json();
      setDocuments(data);
    } catch (err: any) {
      setError(err.message || 'Failed to load documents');
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

      if (!res.ok) throw new Error('Download failed');

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
      alert(`Failed to download: ${err.message}`);
    }
  };

  const handleLogout = () => {
    sessionStorage.removeItem('research_token');
    setIsAuthenticated(false);
    setDocuments([]);
  };

  // Filter documents
  const filteredDocuments = documents.filter(doc => {
    const matchesSource = selectedSource === 'all' || doc.source === selectedSource;
    const matchesSearch = !searchTerm ||
      doc.subject.toLowerCase().includes(searchTerm.toLowerCase()) ||
      (doc.ticker && doc.ticker.toLowerCase().includes(searchTerm.toLowerCase())) ||
      (doc.body_text && doc.body_text.toLowerCase().includes(searchTerm.toLowerCase()));
    return matchesSource && matchesSearch;
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
          <h1 style={{ fontSize: 32, fontWeight: 700, marginBottom: 4, color: 'var(--foreground)' }}>
            Research Portal
          </h1>
          <p style={{ fontSize: 14, color: 'var(--muted-foreground)' }}>
            {documents.length} documents • {filteredDocuments.length} shown
          </p>
        </div>
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

      {/* Filters */}
      <div style={{
        display: 'flex',
        gap: 12,
        marginBottom: 24,
        flexWrap: 'wrap'
      }}>
        <input
          type="text"
          placeholder="Search by ticker or subject..."
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          style={{
            flex: 1,
            minWidth: 300,
            padding: '10px 14px',
            border: '1px solid var(--input-border)',
            borderRadius: 8,
            background: 'var(--input-bg)',
            color: 'var(--foreground)',
            fontSize: 14,
          }}
        />

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
            minWidth: 180,
          }}
        >
          <option value="all">All Sources</option>
          {sources.map(source => (
            <option key={source} value={source}>{source}</option>
          ))}
        </select>
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
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8, flexWrap: 'wrap' }}>
                    {doc.ticker && (
                      <span style={{
                        padding: '4px 10px',
                        background: '#3b82f6',
                        color: '#fff',
                        fontSize: 12,
                        fontWeight: 700,
                        borderRadius: 6,
                        letterSpacing: '0.5px',
                      }}>
                        {doc.ticker}
                      </span>
                    )}
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
                    {doc.subject}
                  </h3>
                </div>
              </div>

              {/* Preview text */}
              {doc.body_text && (
                <div style={{
                  padding: 16,
                  background: 'var(--hover-bg)',
                  borderLeft: '3px solid #3b82f6',
                  borderRadius: 6,
                  marginBottom: 16,
                }}>
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
                    {cleanBodyText(doc.body_text)}
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
                        color: '#3b82f6',
                        fontSize: 13,
                        fontWeight: 500,
                        cursor: 'pointer',
                      }}
                    >
                      {expandedDocs.has(doc.id) ? 'Show less ▲' : 'Read more ▼'}
                    </button>
                  )}
                </div>
              )}

              {/* Action buttons */}
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
                {/* View PDF Report button */}
                <button
                  onClick={() => handleViewPDF(doc)}
                  style={{
                    padding: '10px 16px',
                    background: '#10b981',
                    color: '#fff',
                    border: 'none',
                    borderRadius: 8,
                    fontSize: 14,
                    fontWeight: 600,
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    boxShadow: '0 2px 4px rgba(16, 185, 129, 0.2)',
                    transition: 'all 0.2s',
                  }}
                  onMouseOver={(e) => e.currentTarget.style.background = '#059669'}
                  onMouseOut={(e) => e.currentTarget.style.background = '#10b981'}
                >
                  <span>View Report</span>
                </button>

                {/* Attachments */}
                {doc.attachments && doc.attachments.length > 0 && doc.attachments.map(att => (
                  <button
                    key={att.id}
                    onClick={() => handleDownload(doc.id, att.id, att.filename)}
                    style={{
                      padding: '10px 16px',
                      background: '#6366f1',
                      color: '#fff',
                      border: 'none',
                      borderRadius: 8,
                      fontSize: 14,
                      fontWeight: 500,
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      gap: 8,
                      transition: 'all 0.2s',
                    }}
                    onMouseOver={(e) => e.currentTarget.style.background = '#4f46e5'}
                    onMouseOut={(e) => e.currentTarget.style.background = '#6366f1'}
                  >
                    <span>{cleanFilename(att.filename)}</span>
                    <span style={{ opacity: 0.8, fontSize: 12 }}>
                      ({(att.file_size / 1024 / 1024).toFixed(1)} MB)
                    </span>
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </main>
  );
}
