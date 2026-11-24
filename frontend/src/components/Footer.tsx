import React from 'react';
import { Link } from 'react-router-dom';
import { useBranding } from '../context/BrandingContext';

export const Footer: React.FC = () => {
  const { appName } = useBranding();

  return (
    <footer
      style={{
        borderTop: '1px solid var(--border-subtle)',
        padding: '1.5rem 0',
        textAlign: 'center',
        color: 'var(--text-dim)',
        fontSize: '0.85rem',
        marginTop: 'auto'
      }}
    >
      <div
        style={{
          maxWidth: '1280px',
          margin: '0 auto',
          padding: '0 1.5rem',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: '0.75rem'
        }}
      >
        <div>
          <span>{appName} &mdash; Open-Source Rotary Phone VoIP Switch &bull; GNU GPL v3.0</span>
        </div>
        <div style={{ display: 'flex', gap: '1.25rem', flexWrap: 'wrap' }}>
          <Link to="/terms" style={{ color: 'var(--text-muted)' }}>
            Terms & 911 Notice
          </Link>
          <Link to="/privacy" style={{ color: 'var(--text-muted)' }}>
            Privacy Policy
          </Link>
          <Link to="/legal/licenses" style={{ color: 'var(--text-muted)' }}>
            Open-Source Licenses
          </Link>
          <Link to="/settings" style={{ color: 'var(--text-muted)' }}>
            Audio Settings
          </Link>
          <a
            href="https://github.com/TylerHats/DecaTone"
            target="_blank"
            rel="noopener noreferrer"
            style={{ color: 'var(--text-muted)' }}
          >
            GitHub
          </a>
        </div>
      </div>
    </footer>
  );
};
