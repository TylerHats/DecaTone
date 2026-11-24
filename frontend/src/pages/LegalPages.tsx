import React, { useState, useEffect } from 'react';
import { useLocation, Link } from 'react-router-dom';
import { FileText, Lock, Scale, ArrowLeft } from 'lucide-react';
import { useBranding } from '../context/BrandingContext';
import { SafeMarkdown, OPEN_SOURCE_LICENSES_MARKDOWN } from '../components/SafeMarkdown';
import { LegalTabType } from '../components/LegalModal';

function tabFromPath(pathname: string): LegalTabType {
  if (pathname.includes('licenses')) return 'licenses';
  if (pathname.includes('privacy')) return 'privacy';
  return 'terms';
}

export const LegalPage: React.FC = () => {
  const location = useLocation();
  const { appName, logoUrl } = useBranding();

  const [tab, setTab] = useState<LegalTabType>(() => tabFromPath(location.pathname));
  const [termsText, setTermsText] = useState('');
  const [privacyText, setPrivacyText] = useState('');
  const [licensesText, setLicensesText] = useState(OPEN_SOURCE_LICENSES_MARKDOWN);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setTab(tabFromPath(location.pathname));
  }, [location.pathname]);

  useEffect(() => {
    fetch('/api/legal/config')
      .then((res) => res.json())
      .then((data) => {
        setTermsText(data.terms || '');
        setPrivacyText(data.privacy || '');
        if (data.licenses) {
          setLicensesText(data.licenses);
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const title =
    tab === 'terms'
      ? `${appName} Terms of Service & 911 Disclaimer`
      : tab === 'privacy'
      ? `${appName} Privacy Policy & Zero-Access Notice`
      : `${appName} Open-Source Licenses & Attributions`;

  const activeContent =
    tab === 'terms' ? termsText : tab === 'privacy' ? privacyText : licensesText;

  return (
    <div style={{ maxWidth: '880px', margin: '2rem auto', width: '100%', padding: '0 1rem' }}>
      <div
        style={{
          marginBottom: '1.5rem',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexWrap: 'wrap',
          gap: '0.75rem'
        }}
      >
        <Link to="/" className="btn btn-secondary btn-sm">
          <ArrowLeft size={16} /> Back to Switchboard
        </Link>
        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
          <Link
            to="/terms"
            className={`btn btn-sm ${tab === 'terms' ? 'btn-primary' : 'btn-secondary'}`}
          >
            <FileText size={14} /> Terms of Service
          </Link>
          <Link
            to="/privacy"
            className={`btn btn-sm ${tab === 'privacy' ? 'btn-primary' : 'btn-secondary'}`}
          >
            <Lock size={14} /> Privacy Policy
          </Link>
          <Link
            to="/legal/licenses"
            className={`btn btn-sm ${tab === 'licenses' ? 'btn-primary' : 'btn-secondary'}`}
          >
            <Scale size={14} /> GPL v3 & Licenses
          </Link>
        </div>
      </div>

      <div className="glass-card highlight-cyan" style={{ padding: '2.25rem 2rem' }}>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '1rem',
            marginBottom: '1.75rem',
            borderBottom: '1px solid var(--border-subtle)',
            paddingBottom: '1.25rem'
          }}
        >
          <img
            src={logoUrl || '/branding/logo.png'}
            alt={appName}
            style={{ width: '48px', height: '48px', borderRadius: '12px', objectFit: 'contain' }}
            onError={(e) => {
              e.currentTarget.onerror = null;
              e.currentTarget.src = '/branding/logo.png';
            }}
          />
          <div>
            <h1 style={{ fontSize: '1.45rem', margin: 0 }}>{title}</h1>
            <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', margin: 0 }}>
              Official open-source operational, privacy, and software licensing documentation
            </p>
          </div>
        </div>

        <div
          style={{
            background: 'rgba(0, 0, 0, 0.35)',
            borderRadius: 'var(--radius-sm)',
            padding: '1.75rem',
            color: 'var(--text-main)',
            fontSize: '0.95rem'
          }}
        >
          {loading && tab !== 'licenses' ? (
            <div style={{ textAlign: 'center', padding: '3rem', color: 'var(--text-muted)' }}>
              Loading document...
            </div>
          ) : (
            <SafeMarkdown content={activeContent} />
          )}
        </div>
      </div>
    </div>
  );
};
