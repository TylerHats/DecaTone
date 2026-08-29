import React, { useState, useEffect, useRef } from 'react';
import { Users, UserPlus, Phone, Check, X, Trash2, Search, Zap, Shield, PhoneCall, Star, Bell, Sliders, Volume2, Play, Square } from 'lucide-react';
import { usePhone } from '../context/PhoneContext';

interface Friend {
  id: number;
  username: string;
  display_name: string;
  phone_number: string;
  area_code?: string;
  is_online?: boolean;
  hook_state?: string;
  call_state?: string;
  ring_style?: string;
  ring_cadence_custom?: string;
  is_vip?: number;
}

interface FriendRequest {
  id: number;
  sender_id?: number;
  receiver_id?: number;
  username: string;
  display_name?: string;
  phone_number?: string;
}

interface SpeedDialSlot {
  slot_digit: number;
  target_phone_number: string;
  label?: string;
  target_display_name?: string;
  target_username?: string;
}

export const FriendsPage: React.FC = () => {
  const { dialNumber } = usePhone();

  const [friends, setFriends] = useState<Friend[]>([]);
  const [incomingReqs, setIncomingReqs] = useState<FriendRequest[]>([]);
  const [outgoingReqs, setOutgoingReqs] = useState<FriendRequest[]>([]);
  const [speedDials, setSpeedDials] = useState<SpeedDialSlot[]>([]);

  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<any[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);

  const [activeTab, setActiveTab] = useState<'directory' | 'speed_dial' | 'requests'>('directory');
  const [toast, setToast] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // Custom Ring Pattern Designer Modal State
  const [designerFriend, setDesignerFriend] = useState<Friend | null>(null);
  const [customCadenceInput, setCustomCadenceInput] = useState('1000,500,1000,3500');
  const [isPlayingPreview, setIsPlayingPreview] = useState(false);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const previewTimerRef = useRef<any[]>([]);

  const token = localStorage.getItem('decatone_token');

  useEffect(() => {
    fetchFriends();
    fetchRequests();
    fetchSpeedDials();
  }, []);

  const fetchFriends = async () => {
    try {
      const res = await fetch('/api/friends', { headers: { Authorization: `Bearer ${token}` } });
      if (res.ok) {
        const data = await res.json();
        setFriends(data.friends || []);
      }
    } catch (e) {}
  };

  const fetchRequests = async () => {
    try {
      const res = await fetch('/api/friends/requests', { headers: { Authorization: `Bearer ${token}` } });
      if (res.ok) {
        const data = await res.json();
        setIncomingReqs(data.incoming || []);
        setOutgoingReqs(data.outgoing || []);
      }
    } catch (e) {}
  };

  const fetchSpeedDials = async () => {
    try {
      const res = await fetch('/api/phone/speed-dials', { headers: { Authorization: `Bearer ${token}` } });
      if (res.ok) {
        const data = await res.json();
        setSpeedDials(data.speedDials || []);
      }
    } catch (e) {}
  };

  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!searchQuery.trim()) return;

    setSearchLoading(true);
    try {
      const res = await fetch(`/api/friends/search?q=${encodeURIComponent(searchQuery.trim())}`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (res.ok) {
        const data = await res.json();
        setSearchResults(data.users || []);
      }
    } catch (e) {}
    setSearchLoading(false);
  };

  const handleSendRequest = async (target: string) => {
    try {
      const res = await fetch('/api/friends/request', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ target })
      });
      const data = await res.json();
      if (res.ok) {
        setToast({ type: 'success', text: data.message });
        fetchRequests();
        fetchFriends();
      } else {
        setToast({ type: 'error', text: data.error });
      }
    } catch (e) {}
  };

  const handleRespondRequest = async (requestId: number, action: 'accept' | 'decline') => {
    try {
      const res = await fetch('/api/friends/respond', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ requestId, action })
      });
      if (res.ok) {
        setToast({ type: 'success', text: `Request ${action}ed!` });
        fetchRequests();
        fetchFriends();
      } else {
        const data = await res.json();
        setToast({ type: 'error', text: data.error || 'Failed to update friend request' });
      }
    } catch (e) {}
  };

  const handleRemoveFriend = async (friendId: number) => {
    if (!window.confirm('Remove this friend?')) return;
    try {
      const res = await fetch(`/api/friends/${friendId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` }
      });
      if (res.ok) {
        fetchFriends();
        fetchSpeedDials();
      }
    } catch (e) {}
  };

  const handleUpdateFriendSettings = async (
    friendId: number,
    settings: { ringStyle?: string; ringCadenceCustom?: string; isVip?: boolean }
  ) => {
    try {
      const res = await fetch(`/api/friends/${friendId}/settings`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify(settings)
      });
      if (res.ok) {
        setFriends(prev =>
          prev.map(f => {
            if (f.id === friendId) {
              return {
                ...f,
                ring_style: settings.ringStyle !== undefined ? settings.ringStyle : f.ring_style,
                ring_cadence_custom: settings.ringCadenceCustom !== undefined ? settings.ringCadenceCustom : f.ring_cadence_custom,
                is_vip: settings.isVip !== undefined ? (settings.isVip ? 1 : 0) : f.is_vip
              };
            }
            return f;
          })
        );
        setToast({ type: 'success', text: 'Friend settings updated!' });
      }
    } catch (e) {
      setToast({ type: 'error', text: 'Failed to update friend settings' });
    }
  };

  const handleSaveSpeedDial = async (slotDigit: number, targetPhoneNumber: string, label?: string, targetUserId?: number) => {
    try {
      const res = await fetch('/api/phone/speed-dials', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ slotDigit, targetPhoneNumber, label, targetUserId })
      });
      if (res.ok) {
        setToast({ type: 'success', text: `Speed dial [${slotDigit}] saved!` });
        fetchSpeedDials();
      }
    } catch (e) {}
  };

  const handleDeleteSpeedDial = async (slotDigit: number) => {
    try {
      await fetch(`/api/phone/speed-dials/${slotDigit}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` }
      });
      fetchSpeedDials();
    } catch (e) {}
  };

  // Web Audio Synthesizer: 20Hz Dual Gong Vintage Mechanical Bell Preview
  const playBellSimulation = (cadenceStr: string) => {
    stopBellSimulation();
    setIsPlayingPreview(true);

    try {
      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      const ctx = new AudioCtx();
      audioCtxRef.current = ctx;

      const intervals = cadenceStr.split(',').map(s => parseInt(s.trim(), 10)).filter(n => !isNaN(n) && n > 0);
      if (intervals.length === 0) return;

      let currentTimeMs = 0;
      intervals.forEach((durationMs, idx) => {
        const isRingOn = idx % 2 === 0;
        if (isRingOn) {
          const timer = setTimeout(() => {
            if (!audioCtxRef.current) return;
            const now = ctx.currentTime;
            
            // Dual Gong: Gong 1 (1050Hz) + Gong 2 (1320Hz) modulated with 20Hz LFO striker
            const osc1 = ctx.createOscillator();
            const osc2 = ctx.createOscillator();
            const lfo = ctx.createOscillator();
            const lfoGain = ctx.createGain();
            const mainGain = ctx.createGain();

            osc1.type = 'sine';
            osc1.frequency.setValueAtTime(1050, now);

            osc2.type = 'sine';
            osc2.frequency.setValueAtTime(1320, now);

            lfo.type = 'square';
            lfo.frequency.setValueAtTime(20, now); // 20Hz mechanical clapper strike rate
            lfoGain.gain.setValueAtTime(0.5, now);

            mainGain.gain.setValueAtTime(0.3, now);
            mainGain.gain.linearRampToValueAtTime(0.01, now + (durationMs / 1000));

            lfo.connect(lfoGain.gain);
            osc1.connect(mainGain);
            osc2.connect(mainGain);
            mainGain.connect(ctx.destination);

            osc1.start(now);
            osc2.start(now);
            lfo.start(now);

            const stopTime = now + (durationMs / 1000);
            osc1.stop(stopTime);
            osc2.stop(stopTime);
            lfo.stop(stopTime);
          }, currentTimeMs);
          previewTimerRef.current.push(timer);
        }
        currentTimeMs += durationMs;
      });

      const endTimer = setTimeout(() => {
        setIsPlayingPreview(false);
      }, currentTimeMs + 100);
      previewTimerRef.current.push(endTimer);
    } catch (e) {
      console.error(e);
      setIsPlayingPreview(false);
    }
  };

  const stopBellSimulation = () => {
    previewTimerRef.current.forEach(t => clearTimeout(t));
    previewTimerRef.current = [];
    if (audioCtxRef.current) {
      audioCtxRef.current.close().catch(() => {});
      audioCtxRef.current = null;
    }
    setIsPlayingPreview(false);
  };

  return (
    <div style={{ maxWidth: '1000px', margin: '0 auto', display: 'flex', flexDirection: 'column', gap: '2rem' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '1rem' }}>
        <div>
          <h1 style={{ fontSize: '1.75rem', marginBottom: '0.25rem' }}>Friends, Ring Cadence & Speed Dial</h1>
          <p style={{ color: 'var(--text-muted)', fontSize: '0.95rem' }}>
            Manage private contacts, custom bell ringing cadences per friend, VIP DND bypass, and rotary speed dials.
          </p>
        </div>

        {/* Tab Controls */}
        <div style={{ display: 'flex', gap: '0.5rem', background: 'rgba(255,255,255,0.04)', padding: '0.35rem', borderRadius: 'var(--radius-md)' }}>
          <button
            onClick={() => setActiveTab('directory')}
            className={`btn btn-sm ${activeTab === 'directory' ? 'btn-primary' : 'btn-secondary'}`}
          >
            <Users size={15} /> Friends ({friends.length})
          </button>
          <button
            onClick={() => setActiveTab('speed_dial')}
            className={`btn btn-sm ${activeTab === 'speed_dial' ? 'btn-amber' : 'btn-secondary'}`}
          >
            <Zap size={15} /> Speed Dial (1-9)
          </button>
          <button
            onClick={() => setActiveTab('requests')}
            className={`btn btn-sm ${activeTab === 'requests' ? 'btn-primary' : 'btn-secondary'}`}
            style={{ position: 'relative' }}
          >
            <UserPlus size={15} /> Requests
            {incomingReqs.length > 0 && (
              <span style={{ position: 'absolute', top: '-4px', right: '-4px', background: 'var(--accent-rose)', color: '#fff', fontSize: '0.65rem', padding: '2px 6px', borderRadius: '10px' }}>
                {incomingReqs.length}
              </span>
            )}
          </button>
        </div>
      </div>

      {toast && (
        <div
          style={{
            padding: '0.85rem 1.25rem',
            borderRadius: 'var(--radius-sm)',
            fontSize: '0.9rem',
            background: toast.type === 'success' ? 'rgba(16, 185, 129, 0.15)' : 'rgba(244, 63, 94, 0.15)',
            border: `1px solid ${toast.type === 'success' ? 'rgba(16, 185, 129, 0.3)' : 'rgba(244, 63, 94, 0.3)'}`,
            color: toast.type === 'success' ? '#34d399' : '#fda4af'
          }}
        >
          {toast.text}
        </div>
      )}

      {/* Tab 1: Friends Directory & Custom Rings */}
      {activeTab === 'directory' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
          {/* Add Friend Search Bar */}
          <div className="glass-card">
            <h3 style={{ fontSize: '1.1rem', marginBottom: '1rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <UserPlus size={18} color="var(--accent-cyan)" /> Find Users & Send Friend Request
            </h3>

            <form onSubmit={handleSearch} style={{ display: 'flex', gap: '0.75rem', marginBottom: searchResults.length > 0 ? '1rem' : 0 }}>
              <input
                type="text"
                className="form-input"
                placeholder="Search by username, display name, or phone number..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
              <button type="submit" disabled={searchLoading || !searchQuery.trim()} className="btn btn-primary">
                <Search size={16} /> Search
              </button>
            </form>

            {searchResults.length > 0 && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', marginTop: '1rem', borderTop: '1px solid var(--border-subtle)', paddingTop: '1rem' }}>
                {searchResults.map((u) => (
                  <div
                    key={u.id}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      padding: '0.75rem 1rem',
                      background: 'rgba(255,255,255,0.02)',
                      borderRadius: 'var(--radius-sm)'
                    }}
                  >
                    <div>
                      <strong style={{ color: '#fff' }}>{u.display_name || u.username}</strong>
                      <span style={{ color: 'var(--text-dim)', fontSize: '0.85rem', marginLeft: '0.5rem' }}>@{u.username}</span>
                      <div style={{ fontFamily: 'var(--font-mono)', fontSize: '0.85rem', color: 'var(--accent-amber)' }}>
                        EXT {u.phone_number}
                      </div>
                    </div>
                    <button
                      onClick={() => handleSendRequest(u.username)}
                      className="btn btn-secondary btn-sm"
                    >
                      <UserPlus size={14} /> Send Request
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Friends List */}
          <div className="glass-card">
            <h3 style={{ fontSize: '1.1rem', marginBottom: '1.25rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <Users size={18} color="var(--accent-cyan)" /> Connected Friends Directory
            </h3>

            {friends.length === 0 ? (
              <p style={{ color: 'var(--text-muted)', textAlign: 'center', padding: '2rem 0' }}>
                No friends added yet. Search above to add contacts to your switchboard!
              </p>
            ) : (
              <div className="grid-2">
                {friends.map((f) => {
                  const isVip = f.is_vip === 1;
                  return (
                    <div
                      key={f.id}
                      style={{
                        background: isVip ? 'rgba(245, 158, 11, 0.05)' : 'rgba(255,255,255,0.02)',
                        border: `1px solid ${isVip ? 'rgba(245, 158, 11, 0.3)' : 'var(--border-subtle)'}`,
                        borderRadius: 'var(--radius-sm)',
                        padding: '1.25rem',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: '0.85rem'
                      }}
                    >
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                        <div>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                            <strong style={{ fontSize: '1.05rem', color: '#fff' }}>{f.display_name || f.username}</strong>
                            <button
                              onClick={() => handleUpdateFriendSettings(f.id, { isVip: !isVip })}
                              title={isVip ? 'VIP Friend (Bypasses DND). Click to toggle.' : 'Set as VIP Friend'}
                              style={{
                                background: 'transparent',
                                border: 'none',
                                cursor: 'pointer',
                                padding: 0,
                                display: 'flex',
                                alignItems: 'center'
                              }}
                            >
                              <Star size={16} fill={isVip ? '#fbbf24' : 'none'} color={isVip ? '#fbbf24' : 'var(--text-dim)'} />
                            </button>
                          </div>
                          <div style={{ color: 'var(--text-dim)', fontSize: '0.85rem' }}>@{f.username}</div>
                        </div>

                        {f.is_online ? (
                          <span className="badge badge-online"><span className="status-dot online" /> Available</span>
                        ) : (
                          <span className="badge badge-offline"><span className="status-dot offline" /> Offline</span>
                        )}
                      </div>

                      {/* Distinctive Ring Selector per Friend */}
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.5rem', background: 'rgba(0,0,0,0.2)', padding: '0.5rem 0.75rem', borderRadius: 'var(--radius-sm)' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.82rem', color: 'var(--text-muted)' }}>
                          <Bell size={13} color="var(--accent-amber)" /> Ring Style:
                        </div>

                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                          <select
                            className="form-select"
                            style={{ fontSize: '0.8rem', padding: '0.25rem 0.5rem', minWidth: '130px' }}
                            value={f.ring_style || 'default'}
                            onChange={(e) => {
                              const val = e.target.value;
                              if (val === 'custom') {
                                setDesignerFriend(f);
                                setCustomCadenceInput(f.ring_cadence_custom || '1000,500,1000,3500');
                              } else {
                                handleUpdateFriendSettings(f.id, { ringStyle: val });
                              }
                            }}
                          >
                            <option value="default">Default Phone Ring</option>
                            <option value="traditional">Traditional (2s on, 4s off)</option>
                            <option value="double_ring">Double Ring (0.8s, 0.4s, 0.8s, 4s)</option>
                            <option value="short_short_long">Short-Short-Long</option>
                            <option value="custom">Custom Cadence...</option>
                          </select>

                          {f.ring_style === 'custom' && (
                            <button
                              onClick={() => {
                                setDesignerFriend(f);
                                setCustomCadenceInput(f.ring_cadence_custom || '1000,500,1000,3500');
                              }}
                              className="btn btn-secondary btn-sm"
                              title="Edit Custom Cadence"
                              style={{ padding: '0.25rem 0.45rem' }}
                            >
                              <Sliders size={12} />
                            </button>
                          )}
                        </div>
                      </div>

                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderTop: '1px solid var(--border-subtle)', paddingTop: '0.75rem' }}>
                        <span style={{ fontFamily: 'var(--font-mono)', fontSize: '1.1rem', fontWeight: '700', color: 'var(--accent-amber)' }}>
                          EXT {f.phone_number}
                        </span>

                        <div style={{ display: 'flex', gap: '0.5rem' }}>
                          <button
                            onClick={() => dialNumber(f.phone_number)}
                            className="btn btn-primary btn-sm"
                            title="Call on physical phone"
                          >
                            <PhoneCall size={14} /> Call
                          </button>
                          <button
                            onClick={() => handleRemoveFriend(f.id)}
                            className="btn btn-secondary btn-sm"
                            title="Remove Friend"
                            style={{ padding: '0.4rem 0.6rem' }}
                          >
                            <Trash2 size={14} color="#fda4af" />
                          </button>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Tab 2: Rotary Speed Dial (Slots 1-9) */}
      {activeTab === 'speed_dial' && (
        <div className="glass-card highlight-amber">
          <h3 style={{ fontSize: '1.15rem', marginBottom: '0.5rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <Zap size={20} color="var(--accent-amber)" /> Rotary Single-Digit Speed Dial (Digits 1 to 9)
          </h3>
          <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem', marginBottom: '1.5rem' }}>
            When you pick up your vintage handset and dial a single digit (1 through 9), the switchboard will instantly ring the assigned contact.
          </p>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            {[1, 2, 3, 4, 5, 6, 7, 8, 9].map((slot) => {
              const current = speedDials.find(s => s.slot_digit === slot);
              return (
                <div
                  key={slot}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: '0.85rem 1.25rem',
                    background: 'rgba(0,0,0,0.3)',
                    border: '1px solid var(--border-subtle)',
                    borderRadius: 'var(--radius-sm)',
                    flexWrap: 'wrap',
                    gap: '0.75rem'
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
                    <div
                      style={{
                        width: '38px',
                        height: '38px',
                        borderRadius: '50%',
                        background: 'radial-gradient(circle, #2d3748 0%, #1a202c 100%)',
                        border: '2px solid #d97706',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        fontFamily: 'var(--font-mono)',
                        fontWeight: '800',
                        fontSize: '1.1rem',
                        color: '#fbbf24'
                      }}
                    >
                      {slot}
                    </div>

                    <div>
                      {current ? (
                        <div>
                          <strong style={{ color: '#fff' }}>{current.label || current.target_display_name || current.target_username}</strong>
                          <div style={{ fontFamily: 'var(--font-mono)', fontSize: '0.85rem', color: 'var(--accent-amber)' }}>
                            EXT {current.target_phone_number}
                          </div>
                        </div>
                      ) : (
                        <span style={{ color: 'var(--text-dim)', fontStyle: 'italic', fontSize: '0.9rem' }}>
                          Unassigned Slot
                        </span>
                      )}
                    </div>
                  </div>

                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                    <select
                      className="form-select"
                      style={{ minWidth: '180px', padding: '0.4rem 0.75rem', fontSize: '0.85rem' }}
                      value={current ? current.target_phone_number : ''}
                      onChange={(e) => {
                        const selectedNum = e.target.value;
                        if (!selectedNum) {
                          handleDeleteSpeedDial(slot);
                        } else {
                          const friend = friends.find(f => f.phone_number === selectedNum);
                          handleSaveSpeedDial(slot, selectedNum, friend ? friend.display_name || friend.username : undefined, friend?.id);
                        }
                      }}
                    >
                      <option value="">-- Choose Friend / Extension --</option>
                      {friends.map(f => (
                        <option key={f.id} value={f.phone_number}>
                          {f.display_name || f.username} (EXT {f.phone_number})
                        </option>
                      ))}
                    </select>

                    {current && (
                      <button
                        onClick={() => handleDeleteSpeedDial(slot)}
                        className="btn btn-danger btn-sm"
                        style={{ padding: '0.4rem 0.6rem' }}
                      >
                        <Trash2 size={14} />
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Tab 3: Friend Requests */}
      {activeTab === 'requests' && (
        <div className="glass-card">
          <h3 style={{ fontSize: '1.15rem', marginBottom: '1.25rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <UserPlus size={18} color="var(--accent-cyan)" /> Pending Friend Requests
          </h3>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
            {/* Incoming Requests */}
            <div>
              <h4 style={{ fontSize: '0.95rem', color: 'var(--text-muted)', marginBottom: '0.75rem', textTransform: 'uppercase' }}>
                Incoming Requests ({incomingReqs.length})
              </h4>
              {incomingReqs.length === 0 ? (
                <p style={{ color: 'var(--text-dim)', fontSize: '0.9rem' }}>No pending incoming requests.</p>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                  {incomingReqs.map((req) => (
                    <div
                      key={req.id}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        padding: '0.75rem 1rem',
                        background: 'rgba(255,255,255,0.02)',
                        borderRadius: 'var(--radius-sm)',
                        border: '1px solid var(--border-subtle)'
                      }}
                    >
                      <div>
                        <strong style={{ color: '#fff' }}>{req.display_name || req.username}</strong>
                        <span style={{ color: 'var(--text-dim)', fontSize: '0.85rem', marginLeft: '0.5rem' }}>@{req.username}</span>
                        <div style={{ fontFamily: 'var(--font-mono)', fontSize: '0.85rem', color: 'var(--accent-amber)' }}>
                          EXT {req.phone_number}
                        </div>
                      </div>

                      <div style={{ display: 'flex', gap: '0.5rem' }}>
                        <button onClick={() => handleRespondRequest(req.id, 'accept')} className="btn btn-primary btn-sm">
                          <Check size={14} /> Accept
                        </button>
                        <button onClick={() => handleRespondRequest(req.id, 'decline')} className="btn btn-secondary btn-sm">
                          <X size={14} /> Decline
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Outgoing Requests */}
            <div style={{ borderTop: '1px solid var(--border-subtle)', paddingTop: '1.25rem' }}>
              <h4 style={{ fontSize: '0.95rem', color: 'var(--text-muted)', marginBottom: '0.75rem', textTransform: 'uppercase' }}>
                Sent Requests ({outgoingReqs.length})
              </h4>
              {outgoingReqs.length === 0 ? (
                <p style={{ color: 'var(--text-dim)', fontSize: '0.9rem' }}>No pending sent requests.</p>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                  {outgoingReqs.map((req) => (
                    <div
                      key={req.id}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        padding: '0.75rem 1rem',
                        background: 'rgba(255,255,255,0.02)',
                        borderRadius: 'var(--radius-sm)'
                      }}
                    >
                      <div>
                        <strong style={{ color: '#fff' }}>{req.display_name || req.username}</strong>
                        <span style={{ color: 'var(--text-dim)', fontSize: '0.85rem', marginLeft: '0.5rem' }}>@{req.username}</span>
                      </div>
                      <span className="badge badge-offline">Pending Approval</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Custom Ring Pattern Designer Dialog */}
      {designerFriend && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.8)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1000,
            padding: '1rem'
          }}
        >
          <div className="glass-card" style={{ width: '100%', maxWidth: '520px', display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h3 style={{ fontSize: '1.2rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <Bell size={18} color="var(--accent-amber)" /> Custom Ring Pattern Designer
              </h3>
              <button
                onClick={() => {
                  stopBellSimulation();
                  setDesignerFriend(null);
                }}
                className="btn btn-secondary btn-sm"
                style={{ padding: '0.35rem 0.55rem' }}
              >
                <X size={16} />
              </button>
            </div>

            <p style={{ color: 'var(--text-muted)', fontSize: '0.88rem' }}>
              Design a distinctive electromechanical ring cadence for <strong>{designerFriend.display_name || designerFriend.username}</strong>.
              Enter alternating <span style={{ color: '#fbbf24' }}>Ring ON</span> and <span style={{ color: 'var(--text-dim)' }}>Pause OFF</span> durations in milliseconds.
            </p>

            <div>
              <label style={{ fontSize: '0.85rem', color: 'var(--text-muted)', display: 'block', marginBottom: '0.4rem' }}>
                Ring Cadence (milliseconds comma-separated):
              </label>
              <input
                type="text"
                className="form-input"
                placeholder="e.g. 1000,500,1000,3500"
                value={customCadenceInput}
                onChange={(e) => setCustomCadenceInput(e.target.value)}
                style={{ fontFamily: 'var(--font-mono)', fontSize: '1rem', letterSpacing: '0.05em' }}
              />
            </div>

            {/* Quick Presets */}
            <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap' }}>
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                style={{ fontSize: '0.75rem' }}
                onClick={() => setCustomCadenceInput('1000,500,1000,3500')}
              >
                Short-Short (1s, 0.5s, 1s, 3.5s)
              </button>
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                style={{ fontSize: '0.75rem' }}
                onClick={() => setCustomCadenceInput('400,200,400,200,1200,3800')}
              >
                Syncopated Triple (0.4s, 0.2s, 0.4s, 0.2s, 1.2s, 3.8s)
              </button>
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                style={{ fontSize: '0.75rem' }}
                onClick={() => setCustomCadenceInput('1500,1500,1500,1500')}
              >
                Urgent Staccato (1.5s on, 1.5s off)
              </button>
            </div>

            {/* Visual Cadence Preview Strip */}
            <div style={{ background: 'rgba(0,0,0,0.4)', padding: '0.85rem', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border-subtle)' }}>
              <div style={{ fontSize: '0.8rem', color: 'var(--text-dim)', marginBottom: '0.5rem' }}>Visual Cycle Sequence:</div>
              <div style={{ display: 'flex', height: '24px', borderRadius: '4px', overflow: 'hidden', width: '100%' }}>
                {customCadenceInput.split(',').map((val, idx) => {
                  const ms = parseInt(val.trim(), 10) || 500;
                  const isRing = idx % 2 === 0;
                  return (
                    <div
                      key={idx}
                      style={{
                        flex: ms,
                        background: isRing ? 'linear-gradient(90deg, #f59e0b, #d97706)' : 'rgba(255,255,255,0.08)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        fontSize: '0.65rem',
                        fontWeight: '700',
                        color: isRing ? '#000' : 'var(--text-dim)',
                        borderRight: '1px solid rgba(0,0,0,0.4)'
                      }}
                      title={`${isRing ? 'Ring ON' : 'Pause OFF'}: ${ms}ms`}
                    >
                      {ms}ms
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Actions */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '0.5rem' }}>
              <button
                type="button"
                onClick={() => {
                  if (isPlayingPreview) {
                    stopBellSimulation();
                  } else {
                    playBellSimulation(customCadenceInput);
                  }
                }}
                className={`btn ${isPlayingPreview ? 'btn-danger' : 'btn-secondary'} btn-sm`}
              >
                {isPlayingPreview ? <Square size={14} /> : <Play size={14} />}
                {isPlayingPreview ? 'Stop Preview' : 'Listen with Web Audio'}
              </button>

              <div style={{ display: 'flex', gap: '0.5rem' }}>
                <button
                  type="button"
                  onClick={() => {
                    stopBellSimulation();
                    setDesignerFriend(null);
                  }}
                  className="btn btn-secondary btn-sm"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={() => {
                    stopBellSimulation();
                    handleUpdateFriendSettings(designerFriend.id, {
                      ringStyle: 'custom',
                      ringCadenceCustom: customCadenceInput.trim()
                    });
                    setDesignerFriend(null);
                  }}
                  className="btn btn-primary btn-sm"
                >
                  Save Ring Pattern
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
