'use client';

import { useEffect, useState } from 'react';

interface Officer {
  rank: number;
  name: string;
  age?: number;
  title: string;
  since?: string;
}

interface CompanyFundamentals {
  ticker: string;
  companyName: string;
  exchange: string;
  industry?: string;
  sector?: string;
  status: string;

  // Operational
  employees?: number;
  sharesOutstanding?: number;
  totalFloat?: number;
  reportingCurrency?: string;

  // Descriptions
  businessSummary?: string;
  financialSummary?: string;

  // Contact
  website?: string;
  email?: string;
  phone?: {
    main?: string;
  };
  address?: {
    street: string[];
    city?: string;
    country?: string;
  };

  // IR Contact
  investorRelationsContact?: {
    name?: string;
    title?: string;
    phone?: string;
  };

  // Officers
  officers?: Officer[];

  // Dates
  latestAnnualDate?: string;
  latestInterimDate?: string;
  lastModified?: string;
}

interface StockFundamentalsPanelProps {
  ticker: string;
  isOpen: boolean;
  onClose: () => void;
}

export default function StockFundamentalsPanel({
  ticker,
  isOpen,
  onClose,
}: StockFundamentalsPanelProps) {
  const [data, setData] = useState<CompanyFundamentals | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (isOpen && ticker) {
      fetchFundamentals();
    }
  }, [isOpen, ticker]);

  const fetchFundamentals = async () => {
    setLoading(true);
    setError(null);

    try {
      const response = await fetch(`/api/fundamentals/${ticker}`);

      if (!response.ok) {
        throw new Error('Failed to fetch fundamentals');
      }

      const result = await response.json();
      setData(result.data);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  if (!isOpen) return null;

  return (
    <>
      {/* Overlay */}
      <div
        style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          background: 'rgba(0, 0, 0, 0.8)',
          zIndex: 999,
          opacity: isOpen ? 1 : 0,
          transition: 'opacity 0.3s ease',
        }}
        onClick={onClose}
      />

      {/* Panel */}
      <div
        style={{
          position: 'fixed',
          top: 0,
          right: 0,
          bottom: 0,
          width: '600px',
          maxWidth: '90vw',
          background: 'var(--background)',
          borderLeft: '1px solid var(--border)',
          zIndex: 1000,
          overflowY: 'auto',
          transform: isOpen ? 'translateX(0)' : 'translateX(100%)',
          transition: 'transform 0.3s ease',
          boxShadow: '-4px 0 24px rgba(0, 0, 0, 0.5)',
        }}
      >
        {/* Header */}
        <div
          style={{
            position: 'sticky',
            top: 0,
            background: 'var(--background)',
            borderBottom: '1px solid var(--border)',
            padding: '20px 24px',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            zIndex: 10,
          }}
        >
          <div>
            <h2 style={{ fontSize: 20, fontWeight: 700, margin: 0 }}>
              {ticker}
            </h2>
            {data && (
              <p style={{ fontSize: 13, color: 'var(--muted-foreground)', margin: '4px 0 0 0' }}>
                {data.companyName}
              </p>
            )}
          </div>
          <button
            onClick={onClose}
            style={{
              background: 'transparent',
              border: 'none',
              fontSize: 24,
              cursor: 'pointer',
              color: 'var(--foreground)',
              padding: 8,
              lineHeight: 1,
            }}
          >
            ×
          </button>
        </div>

        {/* Content */}
        <div style={{ padding: '24px' }}>
          {loading && (
            <div style={{ textAlign: 'center', padding: 40, color: 'var(--muted-foreground)' }}>
              Loading fundamentals...
            </div>
          )}

          {error && (
            <div
              style={{
                padding: 16,
                background: 'rgba(239, 68, 68, 0.1)',
                border: '1px solid rgba(239, 68, 68, 0.3)',
                borderRadius: 6,
                color: '#ef4444',
                fontSize: 14,
              }}
            >
              {error}
            </div>
          )}

          {data && (
            <>
              {/* Quick Stats */}
              <section style={{ marginBottom: 32 }}>
                <h3 style={{ fontSize: 14, fontWeight: 600, marginBottom: 16, color: 'var(--muted-foreground)' }}>
                  KEY METRICS
                </h3>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
                  <StatItem label="Exchange" value={data.exchange} />
                  <StatItem label="Industry" value={data.industry} />
                  <StatItem label="Employees" value={data.employees?.toLocaleString()} />
                  <StatItem label="Shares Outstanding" value={data.sharesOutstanding?.toLocaleString()} />
                  <StatItem label="Float" value={data.totalFloat?.toLocaleString()} />
                  <StatItem label="Currency" value={data.reportingCurrency} />
                </div>
              </section>

              {/* Business Description */}
              {data.businessSummary && (
                <section style={{ marginBottom: 32 }}>
                  <h3 style={{ fontSize: 14, fontWeight: 600, marginBottom: 12, color: 'var(--muted-foreground)' }}>
                    BUSINESS OVERVIEW
                  </h3>
                  <p style={{ fontSize: 14, lineHeight: 1.6, color: 'var(--foreground)', margin: 0 }}>
                    {data.businessSummary}
                  </p>
                </section>
              )}

              {/* Financial Summary */}
              {data.financialSummary && (
                <section style={{ marginBottom: 32 }}>
                  <h3 style={{ fontSize: 14, fontWeight: 600, marginBottom: 12, color: 'var(--muted-foreground)' }}>
                    RECENT PERFORMANCE
                  </h3>
                  <p style={{ fontSize: 14, lineHeight: 1.6, color: 'var(--foreground)', margin: 0 }}>
                    {data.financialSummary}
                  </p>
                </section>
              )}

              {/* Key Executives */}
              {data.officers && data.officers.length > 0 && (
                <section style={{ marginBottom: 32 }}>
                  <h3 style={{ fontSize: 14, fontWeight: 600, marginBottom: 16, color: 'var(--muted-foreground)' }}>
                    KEY EXECUTIVES
                  </h3>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                    {data.officers.slice(0, 5).map((officer) => (
                      <div
                        key={officer.rank}
                        style={{
                          padding: 12,
                          background: 'var(--muted)',
                          borderRadius: 6,
                        }}
                      >
                        <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 4 }}>
                          {officer.name}
                          {officer.age && (
                            <span style={{ fontSize: 13, fontWeight: 400, color: 'var(--muted-foreground)', marginLeft: 8 }}>
                              Age {officer.age}
                            </span>
                          )}
                        </div>
                        <div style={{ fontSize: 13, color: 'var(--muted-foreground)' }}>
                          {officer.title}
                        </div>
                      </div>
                    ))}
                  </div>
                </section>
              )}

              {/* Contact Information */}
              <section style={{ marginBottom: 32 }}>
                <h3 style={{ fontSize: 14, fontWeight: 600, marginBottom: 16, color: 'var(--muted-foreground)' }}>
                  CONTACT
                </h3>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                  {data.website && (
                    <ContactItem
                      label="Website"
                      value={
                        <a
                          href={data.website}
                          target="_blank"
                          rel="noopener noreferrer"
                          style={{ color: '#3b82f6', textDecoration: 'none' }}
                        >
                          {data.website}
                        </a>
                      }
                    />
                  )}
                  {data.email && <ContactItem label="Email" value={data.email} />}
                  {data.phone?.main && <ContactItem label="Phone" value={data.phone.main} />}
                  {data.address && (
                    <ContactItem
                      label="Address"
                      value={
                        <>
                          {data.address.street.map((line, i) => (
                            <div key={i}>{line}</div>
                          ))}
                          {data.address.city && <div>{data.address.city}</div>}
                          {data.address.country && <div>{data.address.country}</div>}
                        </>
                      }
                    />
                  )}
                </div>
              </section>

              {/* Investor Relations */}
              {data.investorRelationsContact && (
                <section style={{ marginBottom: 32 }}>
                  <h3 style={{ fontSize: 14, fontWeight: 600, marginBottom: 16, color: 'var(--muted-foreground)' }}>
                    INVESTOR RELATIONS
                  </h3>
                  <div
                    style={{
                      padding: 16,
                      background: 'rgba(59, 130, 246, 0.05)',
                      border: '1px solid rgba(59, 130, 246, 0.2)',
                      borderRadius: 6,
                    }}
                  >
                    <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 4 }}>
                      {data.investorRelationsContact.name}
                    </div>
                    {data.investorRelationsContact.title && (
                      <div style={{ fontSize: 13, color: 'var(--muted-foreground)', marginBottom: 8 }}>
                        {data.investorRelationsContact.title}
                      </div>
                    )}
                    {data.investorRelationsContact.phone && (
                      <div style={{ fontSize: 13, color: 'var(--foreground)' }}>
                        {data.investorRelationsContact.phone}
                      </div>
                    )}
                  </div>
                </section>
              )}

              {/* Reporting Dates */}
              <section>
                <h3 style={{ fontSize: 14, fontWeight: 600, marginBottom: 16, color: 'var(--muted-foreground)' }}>
                  FINANCIAL REPORTING
                </h3>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
                  <StatItem label="Latest Annual" value={data.latestAnnualDate} />
                  <StatItem label="Latest Interim" value={data.latestInterimDate} />
                </div>
              </section>
            </>
          )}
        </div>
      </div>
    </>
  );
}

// Helper components
function StatItem({ label, value }: { label: string; value?: string | number }) {
  return (
    <div>
      <div style={{ fontSize: 12, color: 'var(--muted-foreground)', marginBottom: 4 }}>
        {label}
      </div>
      <div style={{ fontSize: 16, fontWeight: 600, color: 'var(--foreground)' }}>
        {value || 'N/A'}
      </div>
    </div>
  );
}

function ContactItem({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <div style={{ fontSize: 12, color: 'var(--muted-foreground)', marginBottom: 4 }}>
        {label}
      </div>
      <div style={{ fontSize: 14, color: 'var(--foreground)' }}>
        {value}
      </div>
    </div>
  );
}
