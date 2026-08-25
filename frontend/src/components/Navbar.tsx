import React from 'react';
import { Link, useLocation } from 'react-router-dom';
import { Phone, Users, Sliders, Voicemail, Shield, LogOut, PhoneCall, Wifi, WifiOff } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { usePhone } from '../context/PhoneContext';
import { useBranding } from '../context/BrandingContext';

export const Navbar: React.FC = () => {
  const { user, logout } = useAuth();
  const { phone } = usePhone();
  const { appName, logoUrl } = useBranding();
  const location = useLocation();

  if (!user) return null;

  const isActive = (path: string) => location.pathname === path;

  return (
    <header
      style={{
        background: 'rgba(11, 15, 25, 0.85)',
        backdropFilter: 'blur(16px)',
        borderBottom: '1px solid var(--border-subtle)',
        position: 'sticky',
        top: 0,
        zIndex: 100
      }}
    >
      <div
        style={{
          maxWidth: '1280px',
          margin: '0 auto',
          padding: '0.75rem 1.5rem',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between'
        }}
      >
        {/* Brand & Phone Indicator */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '1.5rem' }}>
          <Link to="/" style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', textDecoration: 'none' }}>
            <img
              src={logoUrl}
              alt={appName}
              style={{
                width: '36px',
                height: '36px',
                borderRadius: '8px',
                objectFit: 'contain',
                boxShadow: '0 0 12px rgba(14, 165, 233, 0.3)'
              }}
              onError={(e) => {
                // Fallback to default asset
                (e.target as HTMLImageElement).src = '/assets/logo.png';
              }}
            />
            <span style={{ fontSize: '1.25rem', fontWeight: '800', color: '#fff', letterSpacing: '-0.02em' }}>
              {appName}
            </span>
          </Link>

          {/* User Extension & Live Hardware Status Badge */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '0.5rem',
              background: 'rgba(255, 255, 255, 0.04)',
              padding: '0.35rem 0.75rem',
              borderRadius: 'var(--radius-full)',
              border: '1px solid var(--border-subtle)',
              fontSize: '0.85rem'
            }}
          >
            <span style={{ fontFamily: 'var(--font-mono)', fontWeight: '700', color: 'var(--accent-amber)' }}>
              EXT {user.phoneNumber || '---'}
            </span>
            <div style={{ width: '1px', height: '14px', background: 'var(--border-subtle)' }} />
            {phone?.isOnline ? (
              <span style={{ display: 'flex', alignItems: 'center', gap: '0.3rem', color: '#34d399', fontSize: '0.75rem', fontWeight: '600' }}>
                <span className="status-dot online" /> {phone.hookState === 'off_hook' ? 'OFF HOOK' : 'ONLINE'}
              </span>
            ) : (
              <span style={{ display: 'flex', alignItems: 'center', gap: '0.3rem', color: '#94a3b8', fontSize: '0.75rem' }}>
                <span className="status-dot offline" /> OFFLINE
              </span>
            )}
          </div>
        </div>

        {/* Navigation Links */}
        <nav style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <Link
            to="/"
            className={`btn btn-sm ${isActive('/') ? 'btn-primary' : 'btn-secondary'}`}
          >
            <Phone size={15} /> Switchboard
          </Link>

          <Link
            to="/friends"
            className={`btn btn-sm ${isActive('/friends') ? 'btn-primary' : 'btn-secondary'}`}
          >
            <Users size={15} /> Friends & Speed Dial
          </Link>

          <Link
            to="/settings"
            className={`btn btn-sm ${isActive('/settings') ? 'btn-primary' : 'btn-secondary'}`}
          >
            <Sliders size={15} /> Hardware & Audio
          </Link>

          <Link
            to="/voicemail"
            className={`btn btn-sm ${isActive('/voicemail') ? 'btn-primary' : 'btn-secondary'}`}
            style={{ position: 'relative' }}
          >
            <Voicemail size={15} /> Voicemail
            {(user.unreadVoicemails || 0) > 0 && (
              <span
                style={{
                  position: 'absolute',
                  top: '-4px',
                  right: '-4px',
                  background: 'var(--accent-rose)',
                  color: '#fff',
                  fontSize: '0.65rem',
                  fontWeight: '800',
                  padding: '2px 6px',
                  borderRadius: '10px'
                }}
              >
                {user.unreadVoicemails}
              </span>
            )}
          </Link>

          {user.role === 'admin' && (
            <Link
              to="/admin"
              className={`btn btn-sm ${isActive('/admin') ? 'btn-amber' : 'btn-secondary'}`}
            >
              <Shield size={15} /> Admin Center
            </Link>
          )}

          <div style={{ width: '1px', height: '20px', background: 'var(--border-subtle)', margin: '0 0.25rem' }} />

          <button
            onClick={logout}
            className="btn btn-sm btn-secondary"
            title="Log Out"
            style={{ padding: '0.4rem 0.6rem' }}
          >
            <LogOut size={15} />
          </button>
        </nav>
      </div>
    </header>
  );
};
