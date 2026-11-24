import React, { useState, useEffect } from 'react';
import { X, FileText, Lock, Scale } from 'lucide-react';
import { SafeMarkdown, OPEN_SOURCE_LICENSES_MARKDOWN } from './SafeMarkdown';

export type LegalTabType = 'terms' | 'privacy' | 'licenses';

interface LegalModalProps {
  isOpen: boolean;
  initialTab?: LegalTabType;
  onClose: () => void;
}

export const LegalModal: React.FC<LegalModalProps> = ({
  isOpen,
  initialTab = 'terms',
  onClose
}) => {
  const [tab, setTab] = useState<LegalTabType>(initialTab);
  const [termsText, setTermsText] = useState('');
  const [privacyText, setPrivacyText] = useState('');
  const [licensesText, setLicensesText] = useState(OPEN_SOURCE_LICENSES_MARKDOWN);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setTab(initialTab);
  }, [initialTab]);

  useEffect(() => {
    if (isOpen) {
      setLoading(true);
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
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const activeMarkdown =
    tab === 'terms' ? termsText : tab === 'privacy' ? privacyText : licensesText;

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        backgroundColor: 'rgba(0, 0, 0, 0.8)',
        backdropFilter: 'blur(8px)',
        zIndex: 1000,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '1.5rem'
      }}
      onClick={onClose}
    >
      <div
        className="glass-card"
        style={{
          width: '100%',
          maxWidth: '780px',
          maxHeight: '85vh',
          display: 'flex',
          flexDirection: 'column',
          padding: '1.75rem',
          border: '1px solid var(--border-subtle)',
          boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.7)'
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            gap: '0.75rem',
            flexWrap: 'wrap',
            marginBottom: '1.25rem'
          }}
        >
          <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
            <button
              type="button"
              onClick={() => setTab('terms')}
              className={`btn btn-sm ${tab === 'terms' ? 'btn-primary' : 'btn-secondary'}`}
            >
              <FileText size={14} /> Terms & 911 Disclaimer
            </button>
            <button
              type="button"
              onClick={() => setTab('privacy')}
              className={`btn btn-sm ${tab === 'privacy' ? 'btn-primary' : 'btn-secondary'}`}
            >
              <Lock size={14} /> Privacy & Zero-Access Policy
            </button>
            <button
              type="button"
              onClick={() => setTab('licenses')}
              className={`btn btn-sm ${tab === 'licenses' ? 'btn-primary' : 'btn-secondary'}`}
            >
              <Scale size={14} /> GPL v3 & Open-Source Licenses
            </button>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close legal dialog"
            style={{
              background: 'transparent',
              border: 'none',
              color: 'var(--text-muted)',
              cursor: 'pointer',
              padding: '4px'
            }}
          >
            <X size={20} />
          </button>
        </div>

        {/* Content Body */}
        <div
          style={{
            flex: 1,
            overflowY: 'auto',
            background: 'rgba(0, 0, 0, 0.35)',
            borderRadius: 'var(--radius-sm)',
            padding: '1.5rem',
            color: 'var(--text-main)',
            fontSize: '0.9rem'
          }}
        >
          {loading && tab !== 'licenses' ? (
            <div style={{ textAlign: 'center', padding: '2rem', color: 'var(--text-muted)' }}>
              Loading legal documentation...
            </div>
          ) : (
            <SafeMarkdown content={activeMarkdown} />
          )}
        </div>

        {/* Footer */}
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '1.25rem' }}>
          <button type="button" onClick={onClose} className="btn btn-primary btn-sm">
            Close & Acknowledge
          </button>
        </div>
      </div>
    </div>
  );
};
