import React, { useState, useEffect } from 'react';
import { useLocation, Link } from 'react-router-dom';
import { ShieldAlert, FileText, Lock, ArrowLeft } from 'lucide-react';
import { useBranding } from '../context/BrandingContext';

export const LegalPage: React.FC = () => {
  const location = useLocation();
  const { appName, logoUrl } = useBranding();

  const isPrivacy = location.pathname.includes('privacy');
  const [tab, setTab] = useState<'terms' | 'privacy'>(isPrivacy ? 'privacy' : 'terms');
  const [termsText, setTermsText] = useState('');
  const [privacyText, setPrivacyText] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setTab(location.pathname.includes('privacy') ? 'privacy' : 'terms');
  }, [location.pathname]);

  useEffect(() => {
    fetch('/api/legal/config')
      .then(res => res.json())
      .then(data => {
        setTermsText(data.terms);
        setPrivacyText(data.privacy);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  return (
    <div style={{ maxWidth: '850px', margin: '2rem auto', width: '100%', padding: '0 1rem' }}>
      <div style={{ marginBottom: '1.5rem', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <Link to="/" className="btn btn-secondary btn-sm" style={{ display: 'inline-flex', alignItems: 'center', gap: '0.4rem' }}>
          <ArrowLeft size={16} /> Back to Switchboard
        </Link>
        <div style={{ display: 'flex', gap: '0.5rem' }}>
          <Link
            to="/terms"
            className={`btn btn-sm ${tab === 'terms' ? 'btn-primary' : 'btn-secondary'}`}
            style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}
          >
            <FileText size={14} /> Terms of Service
          </Link>
          <Link
            to="/privacy"
            className={`btn btn-sm ${tab === 'privacy' ? 'btn-primary' : 'btn-secondary'}`}
            style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}
          >
            <Lock size={14} /> Privacy Policy
          </Link>
        </div>
      </div>

      <div className="glass-card highlight-cyan" style={{ padding: '2.5rem 2rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', marginBottom: '2rem', borderBottom: '1px solid var(--border-subtle)', paddingBottom: '1.25rem' }}>
          <img
            src={logoUrl}
            alt={appName}
            style={{ width: '48px', height: '48px', borderRadius: '12px' }}
            onError={(e) => { (e.target as HTMLImageElement).src = '/assets/logo.png'; }}
          />
          <div>
            <h1 style={{ fontSize: '1.5rem', margin: 0 }}>
              {tab === 'terms' ? `${appName} Terms of Service & Telephony Agreement` : `${appName} Privacy Policy & Zero-Access Notice`}
            </h1>
            <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', margin: 0 }}>
              Official open-source operational and legal agreement
            </p>
          </div>
        </div>

        <div
          style={{
            background: 'rgba(0, 0, 0, 0.3)',
            borderRadius: 'var(--radius-sm)',
            padding: '2rem',
            color: 'var(--text-main)',
            fontSize: '0.95rem',
            lineHeight: 1.7,
            whiteSpace: 'pre-wrap',
            fontFamily: 'system-ui, -apple-system, sans-serif'
          }}
        >
          {loading ? (
            <div style={{ textAlign: 'center', padding: '3rem', color: 'var(--text-muted)' }}>
              Loading document...
            </div>
          ) : (
            tab === 'terms' ? termsText : privacyText
          )}
        </div>
      </div>
    </div>
  );
};
