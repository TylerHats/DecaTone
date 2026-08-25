import React, { useState, useEffect } from 'react';
import { Users, UserPlus, Phone, Check, X, Trash2, Search, Zap, Shield, PhoneCall } from 'lucide-react';
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

  return (
    <div style={{ maxWidth: '1000px', margin: '0 auto', display: 'flex', flexDirection: 'column', gap: '2rem' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '1rem' }}>
        <div>
          <h1 style={{ fontSize: '1.75rem', marginBottom: '0.25rem' }}>Friends & Rotary Speed Dial</h1>
          <p style={{ color: 'var(--text-muted)', fontSize: '0.95rem' }}>
            Manage your network directory and assign favorite contacts to rotary digits 1 through 9.
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

      {/* Tab 1: Friends Directory & Add Contact Search */}
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
                {friends.map((f) => (
                  <div
                    key={f.id}
                    style={{
                      background: 'rgba(255,255,255,0.02)',
                      border: '1px solid var(--border-subtle)',
                      borderRadius: 'var(--radius-sm)',
                      padding: '1.25rem',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: '0.75rem'
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                      <div>
                        <strong style={{ fontSize: '1.05rem', color: '#fff' }}>{f.display_name || f.username}</strong>
                        <div style={{ color: 'var(--text-dim)', fontSize: '0.85rem' }}>@{f.username}</div>
                      </div>

                      {f.is_online ? (
                        <span className="badge badge-online"><span className="status-dot online" /> Available</span>
                      ) : (
                        <span className="badge badge-offline"><span className="status-dot offline" /> Offline</span>
                      )}
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
                ))}
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
    </div>
  );
};
