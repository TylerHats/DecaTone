import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { Phone, Users, Sliders, Voicemail, BellRing, PhoneOutgoing, Wifi, WifiOff, Volume2, ShieldCheck, History, ArrowUpRight, ArrowDownLeft, Clock, Zap } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { usePhone } from '../context/PhoneContext';
import { InteractiveRotaryDial } from '../components/InteractiveRotaryDial';

interface CallRecord {
  id: number;
  caller_number: string;
  callee_number: string;
  caller_display_name?: string;
  callee_display_name?: string;
  status: string;
  duration_sec: number;
  started_at: string;
}

interface SpeedDialItem {
  slot_digit: number;
  target_phone_number: string;
  label?: string;
  target_display_name?: string;
}

export const HomePage: React.FC = () => {
  const { user } = useAuth();
  const { phone, currentDialBuffer, dialNumber, testRing, loading } = usePhone();
  const [typedNumber, setTypedNumber] = useState('');
  const [speedDials, setSpeedDials] = useState<SpeedDialItem[]>([]);
  const [calls, setCalls] = useState<CallRecord[]>([]);
  const [ringingTest, setRingingTest] = useState(false);
  const [dialing, setDialing] = useState(false);
  const [statusMsg, setStatusMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  useEffect(() => {
    fetchSpeedDials();
    fetchRecentCalls();
  }, []);

  const fetchSpeedDials = async () => {
    try {
      const res = await fetch('/api/phone/speed-dials', {
        headers: { Authorization: `Bearer ${localStorage.getItem('decatone_token')}` }
      });
      if (res.ok) {
        const data = await res.json();
        setSpeedDials(data.speedDials || []);
      }
    } catch (e) {}
  };

  const fetchRecentCalls = async () => {
    try {
      const res = await fetch('/api/phone/calls', {
        headers: { Authorization: `Bearer ${localStorage.getItem('decatone_token')}` }
      });
      if (res.ok) {
        const data = await res.json();
        setCalls(data.calls || []);
      }
    } catch (e) {}
  };

  const handleDial = async (numToDial?: string) => {
    const target = numToDial || typedNumber;
    if (!target) return;

    setDialing(true);
    setStatusMsg(null);
    const success = await dialNumber(target);
    setDialing(false);

    if (success) {
      setStatusMsg({ type: 'success', text: `Initiating call to ${target}...` });
      setTypedNumber('');
    } else {
      setStatusMsg({ type: 'error', text: 'Failed to place call. Ensure your ESP32-S3 hardware is online.' });
    }
  };

  const handleTestRing = async () => {
    setRingingTest(true);
    const ok = await testRing();
    setRingingTest(false);
    if (ok) {
      setStatusMsg({ type: 'success', text: 'Test ring signal sent to your rotary phone!' });
    } else {
      setStatusMsg({ type: 'error', text: 'Test ring failed. Is your phone connected?' });
    }
  };

  const handleRotaryDigit = (digit: string) => {
    setTypedNumber(prev => prev + digit);
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '2rem' }}>
      {/* Top Banner / User Switchboard Card */}
      <div className="glass-card highlight-cyan" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '1.5rem' }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '0.25rem' }}>
            <h1 style={{ fontSize: '1.75rem' }}>
              Welcome back, {user?.displayName || user?.username}!
            </h1>
          </div>
          <p style={{ color: 'var(--text-muted)', fontSize: '0.95rem' }}>
            DecaTone Telephone Switch &bull; Line Assigned to <strong style={{ color: 'var(--accent-amber)', fontFamily: 'var(--font-mono)' }}>EXT {user?.phoneNumber}</strong>
          </p>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
          {phone ? (
            <button
              onClick={handleTestRing}
              disabled={ringingTest || !phone.isOnline}
              className="btn btn-amber btn-sm"
              title="Test physical bell ringer"
            >
              <BellRing size={16} /> {ringingTest ? 'Ringing...' : 'Test Bell Ringer'}
            </button>
          ) : (
            <Link to="/onboarding" className="btn btn-primary btn-sm">
              <Zap size={16} /> Pair Your ESP32-S3 Phone
            </Link>
          )}

          <Link to="/settings" className="btn btn-secondary btn-sm">
            <Sliders size={16} /> Hardware Audio
          </Link>
        </div>
      </div>

      {statusMsg && (
        <div
          style={{
            padding: '0.85rem 1.25rem',
            borderRadius: 'var(--radius-sm)',
            fontSize: '0.9rem',
            display: 'flex',
            alignItems: 'center',
            gap: '0.5rem',
            background: statusMsg.type === 'success' ? 'rgba(16, 185, 129, 0.15)' : 'rgba(244, 63, 94, 0.15)',
            border: `1px solid ${statusMsg.type === 'success' ? 'rgba(16, 185, 129, 0.3)' : 'rgba(244, 63, 94, 0.3)'}`,
            color: statusMsg.type === 'success' ? '#34d399' : '#fda4af'
          }}
        >
          {statusMsg.text}
        </div>
      )}

      {/* Main Grid: Hardware Status & Rotary Dial Switchboard */}
      <div className="grid-2">
        {/* Left Column: Interactive Rotary Dial Simulator & Keypad */}
        <div className="glass-card" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '1.5rem' }}>
          <div style={{ width: '100%', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <h3 style={{ fontSize: '1.15rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <Phone size={18} color="var(--accent-cyan)" /> Rotary Switchboard
            </h3>
            {currentDialBuffer && (
              <span className="badge badge-busy">
                Pulse Buffer: {currentDialBuffer}
              </span>
            )}
          </div>

          {/* Interactive Rotary Component */}
          <InteractiveRotaryDial onDialDigit={handleRotaryDigit} />

          {/* Dialing Input & Action */}
          <div style={{ width: '100%', maxWidth: '320px', display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
            <div style={{ display: 'flex', gap: '0.5rem' }}>
              <input
                type="text"
                className="form-input"
                placeholder="Dial extension..."
                value={typedNumber}
                onChange={(e) => setTypedNumber(e.target.value.replace(/\D/g, ''))}
                style={{ fontFamily: 'var(--font-mono)', fontSize: '1.2rem', textAlign: 'center', letterSpacing: '0.1em' }}
              />
              {typedNumber && (
                <button
                  onClick={() => setTypedNumber('')}
                  className="btn btn-secondary btn-sm"
                  style={{ padding: '0 0.75rem' }}
                >
                  Clear
                </button>
              )}
            </div>

            <button
              onClick={() => handleDial()}
              disabled={dialing || !typedNumber}
              className="btn btn-primary btn-lg"
              style={{ width: '100%' }}
            >
              <PhoneOutgoing size={18} /> {dialing ? 'Connecting...' : `Call Extension ${typedNumber || ''}`}
            </button>
          </div>

          {/* Speed Dial Quick Buttons (1-9) */}
          <div style={{ width: '100%', borderTop: '1px solid var(--border-subtle)', paddingTop: '1.25rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
              <span style={{ fontSize: '0.85rem', fontWeight: '700', color: 'var(--text-muted)', textTransform: 'uppercase' }}>
                Rotary Speed Dial Slots (1-9)
              </span>
              <Link to="/friends" style={{ fontSize: '0.8rem' }}>Edit Slots &rarr;</Link>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '0.5rem' }}>
              {[1, 2, 3, 4, 5, 6, 7, 8, 9].map((slot) => {
                const sd = speedDials.find(s => s.slot_digit === slot);
                return (
                  <button
                    key={slot}
                    onClick={() => sd && handleDial(sd.target_phone_number)}
                    disabled={!sd}
                    className="btn btn-secondary btn-sm"
                    style={{
                      display: 'flex',
                      flexDirection: 'column',
                      alignItems: 'center',
                      padding: '0.6rem 0.25rem',
                      opacity: sd ? 1 : 0.4
                    }}
                  >
                    <span style={{ fontFamily: 'var(--font-mono)', fontWeight: '800', color: 'var(--accent-amber)' }}>
                      [{slot}] {sd ? sd.label || sd.target_display_name || sd.target_phone_number : 'Empty'}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        {/* Right Column: Hardware Telephony Status & Call Logs */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
          {/* Phone Hardware Card */}
          <div className="glass-card">
            <h3 style={{ fontSize: '1.15rem', marginBottom: '1rem', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <Zap size={18} color="var(--accent-amber)" /> Paired ESP32-S3 Hardware
              </span>
              {phone?.isOnline ? (
                <span className="badge badge-online"><span className="status-dot online" /> Connected</span>
              ) : (
                <span className="badge badge-offline"><span className="status-dot offline" /> Offline</span>
              )}
            </h3>

            {phone ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', fontSize: '0.9rem' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid var(--border-subtle)', paddingBottom: '0.5rem' }}>
                  <span style={{ color: 'var(--text-muted)' }}>Device ID</span>
                  <strong style={{ fontFamily: 'var(--font-mono)', color: '#fff' }}>{phone.deviceId}</strong>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid var(--border-subtle)', paddingBottom: '0.5rem' }}>
                  <span style={{ color: 'var(--text-muted)' }}>Handset State</span>
                  <span style={{ fontWeight: '600', color: phone.hookState === 'off_hook' ? 'var(--accent-amber)' : '#34d399' }}>
                    {phone.hookState === 'off_hook' ? 'Lifted (Off Hook)' : 'Resting (On Hook)'}
                  </span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid var(--border-subtle)', paddingBottom: '0.5rem' }}>
                  <span style={{ color: 'var(--text-muted)' }}>Audio Hardware</span>
                  <span style={{ color: 'var(--text-dim)' }}>MAX98357A I2S + MAX4466 ADC</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid var(--border-subtle)', paddingBottom: '0.5rem' }}>
                  <span style={{ color: 'var(--text-muted)' }}>Bell Ringer Circuit</span>
                  <span style={{ color: 'var(--text-dim)' }}>IRF640N MOSFET (20Hz Resonant)</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid var(--border-subtle)', paddingBottom: '0.5rem' }}>
                  <span style={{ color: 'var(--text-muted)' }}>Firmware Version</span>
                  <span style={{ fontFamily: 'var(--font-mono)' }}>v{phone.firmwareVersion || '1.0.0'}</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span style={{ color: 'var(--text-muted)' }}>WiFi Signal (RSSI)</span>
                  <span>{phone.rssi ? `${phone.rssi} dBm` : 'Good'}</span>
                </div>
              </div>
            ) : (
              <div style={{ textAlign: 'center', padding: '1.5rem 0' }}>
                <p style={{ color: 'var(--text-muted)', marginBottom: '1rem' }}>
                  No ESP32-S3 rotary phone paired to this account yet.
                </p>
                <Link to="/onboarding" className="btn btn-primary btn-sm">
                  Pair Phone Now &rarr;
                </Link>
              </div>
            )}
          </div>

          {/* Recent Call Logs */}
          <div className="glass-card" style={{ flex: 1 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
              <h3 style={{ fontSize: '1.15rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <History size={18} color="var(--accent-cyan)" /> Call History
              </h3>
            </div>

            {calls.length === 0 ? (
              <p style={{ color: 'var(--text-dim)', fontSize: '0.9rem', textAlign: 'center', padding: '1rem 0' }}>
                No recent calls on this switch line.
              </p>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', maxHeight: '260px', overflowY: 'auto' }}>
                {calls.slice(0, 6).map((c) => {
                  const isOutbound = c.caller_number === user?.phoneNumber;
                  return (
                    <div
                      key={c.id}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        padding: '0.5rem 0.75rem',
                        background: 'rgba(255,255,255,0.02)',
                        borderRadius: 'var(--radius-sm)',
                        border: '1px solid var(--border-subtle)',
                        fontSize: '0.85rem'
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                        {isOutbound ? (
                          <ArrowUpRight size={16} color="var(--accent-cyan)" />
                        ) : (
                          <ArrowDownLeft size={16} color="#34d399" />
                        )}
                        <div>
                          <strong style={{ color: '#fff' }}>
                            {isOutbound ? (c.callee_display_name || `EXT ${c.callee_number}`) : (c.caller_display_name || `EXT ${c.caller_number}`)}
                          </strong>
                          <div style={{ fontSize: '0.75rem', color: 'var(--text-dim)' }}>
                            {new Date(c.started_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} &bull; {c.duration_sec}s &bull; {c.status}
                          </div>
                        </div>
                      </div>

                      <button
                        onClick={() => handleDial(isOutbound ? c.callee_number : c.caller_number)}
                        className="btn btn-secondary btn-sm"
                        style={{ padding: '0.25rem 0.5rem', fontSize: '0.75rem' }}
                      >
                        Redial
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
