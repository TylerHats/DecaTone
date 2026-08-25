import React from 'react';
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
      <div style={{ maxWidth: '1280px', margin: '0 auto', padding: '0 1.5rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.75rem' }}>
        <div>
          <span>{appName} &copy; {new Date().getFullYear()} &mdash; Open-Source Rotary Phone VoIP Switch</span>
        </div>
        <div style={{ display: 'flex', gap: '1.25rem' }}>
          <a href="/onboarding" style={{ color: 'var(--text-muted)' }}>Pair Hardware</a>
          <a href="/settings" style={{ color: 'var(--text-muted)' }}>Audio Settings</a>
          <a href="https://github.com/TylerHats/DecaTone" target="_blank" rel="noreferrer" style={{ color: 'var(--text-muted)' }}>GitHub Repository</a>
        </div>
      </div>
    </footer>
  );
};
