import React, { useState, useEffect } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { Phone, Users, Sliders, Voicemail, Shield, LogOut } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { usePhone } from '../context/PhoneContext';
import { useBranding } from '../context/BrandingContext';

export const Navbar: React.FC = () => {
  const { user, logout } = useAuth();
  const { phone } = usePhone();
  const { appName, logoUrl, navbarIconUrl } = useBranding();
  const location = useLocation();
  const [hideNavIcon, setHideNavIcon] = useState(false);

  useEffect(() => {
    setHideNavIcon(false);
  }, [navbarIconUrl]);

  if (!user) return null;

  const isActive = (path: string) => location.pathname === path;

  return (
    <header
      style={{
        background: 'rgba(11, 15, 25, 0.88)',
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
          padding: '0.65rem 1.25rem',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexWrap: 'wrap',
          gap: '0.75rem'
        }}
      >
        {/* Brand & Phone Indicator */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', flexWrap: 'wrap' }}>
          <Link
            to="/"
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '0.65rem',
              textDecoration: 'none'
            }}
          >
            <img
              src={logoUrl || '/branding/logo.png'}
              alt={appName}
              style={{
                width: '34px',
                height: '34px',
                borderRadius: '8px',
                objectFit: 'contain',
                boxShadow: '0 0 12px rgba(14, 165, 233, 0.3)'
              }}
              onError={(e) => {
                e.currentTarget.onerror = null;
                e.currentTarget.src = '/branding/logo.png';
              }}
            />
            <span
              style={{
                fontSize: '1.2rem',
                fontWeight: 800,
                color: '#fff',
                letterSpacing: '-0.02em'
              }}
            >
              {appName}
            </span>
            {navbarIconUrl && !hideNavIcon && (
              <img
                src={navbarIconUrl}
                alt=""
                style={{
                  width: '22px',
                  height: '22px',
                  borderRadius: '4px',
                  objectFit: 'contain',
                  opacity: 0.9
                }}
                onError={(e) => {
                  e.currentTarget.onerror = null;
                  setHideNavIcon(true);
                }}
              />
            )}
          </Link>

          {/* User Extension & Live Hardware Status Badge */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '0.5rem',
              background: 'rgba(255, 255, 255, 0.04)',
              padding: '0.3rem 0.7rem',
              borderRadius: 'var(--radius-full)',
              border: '1px solid var(--border-subtle)',
              fontSize: '0.82rem'
            }}
          >
            <span
              style={{
                fontFamily: 'var(--font-mono)',
                fontWeight: 700,
                color: 'var(--accent-amber)'
              }}
            >
              EXT {user.phoneNumber || '---'}
            </span>
            <div style={{ width: '1px', height: '14px', background: 'var(--border-subtle)' }} />
            {phone?.isOnline ? (
              <span
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.3rem',
                  color: '#34d399',
                  fontSize: '0.73rem',
                  fontWeight: 600
                }}
              >
                <span className="status-dot online" />{' '}
                {phone.hookState === 'off_hook' ? 'OFF HOOK' : 'ONLINE'}
              </span>
            ) : (
              <span
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.3rem',
                  color: '#94a3b8',
                  fontSize: '0.73rem'
                }}
              >
                <span className="status-dot offline" /> OFFLINE
              </span>
            )}
          </div>
        </div>

        {/* Navigation Links */}
        <nav
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '0.45rem',
            flexWrap: 'wrap'
          }}
        >
          <Link
            to="/"
            className={`btn btn-sm ${isActive('/') ? 'btn-primary' : 'btn-secondary'}`}
          >
            <Phone size={14} /> Switchboard
          </Link>

          <Link
            to="/friends"
            className={`btn btn-sm ${isActive('/friends') ? 'btn-primary' : 'btn-secondary'}`}
          >
            <Users size={14} /> Friends & Speed Dial
          </Link>

          <Link
            to="/settings"
            className={`btn btn-sm ${isActive('/settings') ? 'btn-primary' : 'btn-secondary'}`}
          >
            <Sliders size={14} /> Hardware & Audio
          </Link>

          <Link
            to="/voicemail"
            className={`btn btn-sm ${isActive('/voicemail') ? 'btn-primary' : 'btn-secondary'}`}
            style={{ position: 'relative' }}
          >
            <Voicemail size={14} /> Voicemail
            {(user.unreadVoicemails || 0) > 0 && (
              <span
                style={{
                  position: 'absolute',
                  top: '-4px',
                  right: '-4px',
                  background: 'var(--accent-rose)',
                  color: '#fff',
                  fontSize: '0.65rem',
                  fontWeight: 800,
                  padding: '1px 6px',
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
              <Shield size={14} /> Admin Center
            </Link>
          )}

          <div
            style={{
              width: '1px',
              height: '20px',
              background: 'var(--border-subtle)',
              margin: '0 0.15rem'
            }}
          />

          <button
            onClick={() => void logout()}
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
