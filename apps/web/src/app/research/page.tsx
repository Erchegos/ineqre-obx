'use client';

import { useState, useEffect } from 'react';

type ResearchDocument = {
  id: string;
  ticker: string | null;
  source: string;
  subject: string;
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

  const handleDownload = async (documentId: string, attachmentId: string, filename: string) => {
    const token = sessionStorage.getItem('research_token');
    if (!token) return;

    try {
      const res = await fetch(`/api/research/documents/${documentId}/attachments/${attachmentId}`, {
        headers: { 'Authorization': `Bearer ${token}` },
      });

      if (!res.ok) throw new Error('Download failed');

      const { url } = await res.json();
      window.open(url, '_blank');
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
      (doc.ticker && doc.ticker.toLowerCase().includes(searchTerm.toLowerCase()));
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
                background: 'var(--primary)',
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
    <main style={{ maxWidth: 1400, margin: '0 auto', padding: 20 }}>
      {/* Header */}
      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: 32,
        paddingBottom: 16,
        borderBottom: '1px solid var(--border)'
      }}>
        <div>
          <h1 style={{ fontSize: 28, fontWeight: 700, marginBottom: 4 }}>
            Research Portal
          </h1>
          <p style={{ fontSize: 14, color: 'var(--muted-foreground)' }}>
            {documents.length} documents available
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
          }}
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
            padding: '8px 12px',
            border: '1px solid var(--input-border)',
            borderRadius: 6,
            background: 'var(--input-bg)',
            color: 'var(--foreground)',
            fontSize: 14,
          }}
        />

        <select
          value={selectedSource}
          onChange={(e) => setSelectedSource(e.target.value)}
          style={{
            padding: '8px 12px',
            border: '1px solid var(--input-border)',
            borderRadius: 6,
            background: 'var(--input-bg)',
            color: 'var(--foreground)',
            fontSize: 14,
            cursor: 'pointer',
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
          border: '1px solid var(--border)',
          borderRadius: 8,
        }}>
          <p style={{ fontSize: 16, marginBottom: 8 }}>No documents found</p>
          <p style={{ fontSize: 14 }}>
            {searchTerm ? 'Try adjusting your search' : 'Documents will appear here when received'}
          </p>
        </div>
      ) : (
        <div style={{ display: 'grid', gap: 16 }}>
          {filteredDocuments.map(doc => (
            <div
              key={doc.id}
              style={{
                padding: 20,
                border: '1px solid var(--border)',
                borderRadius: 8,
                background: 'var(--card-bg)',
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'start', marginBottom: 12 }}>
                <div style={{ flex: 1 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                    {doc.ticker && (
                      <span style={{
                        padding: '2px 8px',
                        background: 'var(--primary-bg)',
                        color: 'var(--primary)',
                        fontSize: 11,
                        fontWeight: 600,
                        borderRadius: 4,
                      }}>
                        {doc.ticker}
                      </span>
                    )}
                    <span style={{ fontSize: 12, color: 'var(--muted-foreground)' }}>
                      {doc.source}
                    </span>
                  </div>
                  <h3 style={{ fontSize: 16, fontWeight: 600, marginBottom: 4, color: 'var(--foreground)' }}>
                    {doc.subject}
                  </h3>
                  <p style={{ fontSize: 13, color: 'var(--muted-foreground)' }}>
                    {new Date(doc.received_date).toLocaleString('en-US', {
                      year: 'numeric',
                      month: 'short',
                      day: 'numeric',
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </p>
                </div>
              </div>

              {/* Attachments */}
              {doc.attachments && doc.attachments.length > 0 && (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 12 }}>
                  {doc.attachments.map(att => (
                    <button
                      key={att.id}
                      onClick={() => handleDownload(doc.id, att.id, att.filename)}
                      style={{
                        padding: '6px 12px',
                        background: 'var(--primary)',
                        color: '#fff',
                        border: 'none',
                        borderRadius: 6,
                        fontSize: 13,
                        fontWeight: 500,
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        gap: 6,
                      }}
                    >
                      <span>📄</span>
                      <span>{att.filename}</span>
                      <span style={{ opacity: 0.7, fontSize: 11 }}>
                        ({(att.file_size / 1024 / 1024).toFixed(1)} MB)
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </main>
  );
}
