import React, { createContext, useContext, useState, useEffect, useCallback, useMemo } from 'react';
import {
  clearUnlockedKey,
  generateUserKeyBundle,
  isPrivateKeyUnlocked,
  purgeLegacyStorageKeys,
  restoreVaultFromIndexedDb,
  unlockPrivateKeyWithPassword
} from '../services/e2eeCrypto';

export interface User {
  id: number;
  username: string;
  displayName?: string;
  email?: string | null;
  phoneNumber?: string;
  areaCode?: string | null;
  role: string;
  callPrivacy?: string;
  notifyOnVoicemail?: boolean | number;
  notifyOnMissedCall?: boolean | number;
  dndManualState?: boolean | number;
  dndScheduleEnabled?: boolean | number;
  dndScheduleStart?: string;
  dndScheduleEnd?: string;
  dndScheduleDays?: string;
  dndRepeatedCallBreakthrough?: boolean | number;
  unreadVoicemails?: number;
  keySalt?: string | null;
  encryptionPublicKey?: string | null;
  encryptedPrivateKey?: string | null;
  hasRecoveryKey?: boolean;
  termsAcceptedVersion?: string | number | null;
  currentTermsVersion?: string | number | null;
  e911AcknowledgedAt?: string | null;
}

export function normalizeUser(raw: any): User {
  if (!raw) return raw;
  const rawPrivacy = raw.callPrivacy ?? raw.call_privacy ?? 'everyone';
  const normalizedPrivacy =
    rawPrivacy === 'open' || rawPrivacy === 'anyone' ? 'everyone' : rawPrivacy;

  return {
    ...raw,
    id: raw.id,
    username: raw.username,
    displayName: raw.displayName ?? raw.display_name ?? raw.username,
    email: raw.email ?? null,
    phoneNumber: raw.phoneNumber ?? raw.phone_number ?? '',
    areaCode: raw.areaCode ?? raw.area_code ?? null,
    role: raw.role || 'user',
    callPrivacy: normalizedPrivacy,
    notifyOnVoicemail:
      raw.notifyOnVoicemail !== undefined
        ? Boolean(raw.notifyOnVoicemail)
        : raw.notify_on_voicemail !== undefined
        ? Boolean(raw.notify_on_voicemail)
        : true,
    notifyOnMissedCall:
      raw.notifyOnMissedCall !== undefined
        ? Boolean(raw.notifyOnMissedCall)
        : raw.notify_on_missed_call !== undefined
        ? Boolean(raw.notify_on_missed_call)
        : true,
    dndManualState:
      raw.dndManualState !== undefined
        ? Boolean(raw.dndManualState)
        : raw.dnd_manual_state !== undefined
        ? Boolean(raw.dnd_manual_state)
        : false,
    dndScheduleEnabled:
      raw.dndScheduleEnabled !== undefined
        ? Boolean(raw.dndScheduleEnabled)
        : raw.dnd_schedule_enabled !== undefined
        ? Boolean(raw.dnd_schedule_enabled)
        : false,
    dndScheduleStart: raw.dndScheduleStart ?? raw.dnd_schedule_start ?? '22:00',
    dndScheduleEnd: raw.dndScheduleEnd ?? raw.dnd_schedule_end ?? '07:00',
    dndScheduleDays: raw.dndScheduleDays ?? raw.dnd_schedule_days ?? '1,2,3,4,5,6,7',
    dndRepeatedCallBreakthrough:
      raw.dndRepeatedCallBreakthrough !== undefined
        ? Boolean(raw.dndRepeatedCallBreakthrough)
        : raw.dnd_repeated_call_breakthrough !== undefined
        ? Boolean(raw.dnd_repeated_call_breakthrough)
        : true,
    unreadVoicemails: raw.unreadVoicemails ?? raw.unread_voicemails ?? 0,
    keySalt: raw.keySalt ?? raw.key_salt ?? null,
    encryptionPublicKey: raw.encryptionPublicKey ?? raw.encryption_public_key ?? null,
    encryptedPrivateKey: raw.encryptedPrivateKey ?? raw.encrypted_private_key ?? null,
    hasRecoveryKey:
      raw.hasRecoveryKey !== undefined
        ? Boolean(raw.hasRecoveryKey)
        : Boolean(raw.recovery_encrypted_private_key || raw.recoveryEncryptedPrivateKey),
    termsAcceptedVersion: raw.termsAcceptedVersion ?? raw.terms_accepted_version ?? null,
    currentTermsVersion: raw.currentTermsVersion ?? raw.termsVersion ?? raw.current_terms_version ?? null,
    e911AcknowledgedAt: raw.e911AcknowledgedAt ?? raw.e911_acknowledged_at ?? null
  };
}

export interface AuthContextType {
  user: User | null;
  token: string | null;
  loading: boolean;
  isVaultUnlocked: boolean;
  login: (tokenOrUser: string | User | null, userData?: User) => void;
  loginWithCredentials: (username: string, password: string) => Promise<User>;
  unlockE2ee: (password: string) => Promise<void>;
  refreshVaultStatus: () => void;
  logout: () => Promise<void>;
  refreshUser: () => Promise<User | null>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [isVaultUnlocked, setIsVaultUnlocked] = useState<boolean>(() => isPrivateKeyUnlocked());

  const refreshVaultStatus = useCallback(() => {
    setIsVaultUnlocked(isPrivateKeyUnlocked());
  }, []);

  const refreshUser = useCallback(async (): Promise<User | null> => {
    purgeLegacyStorageKeys();

    try {
      const res = await fetch('/api/auth/me', {
        credentials: 'include'
      });
      if (res.ok) {
        const data = await res.json();
        const normalized = normalizeUser(data.user);
        setUser(normalized);
        await restoreVaultFromIndexedDb(normalized.encryptionPublicKey);
        setIsVaultUnlocked(isPrivateKeyUnlocked());
        return normalized;
      } else {
        clearUnlockedKey();
        setUser(null);
        setIsVaultUnlocked(false);
        return null;
      }
    } catch (err) {
      console.error('Failed to fetch user:', err);
      return null;
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refreshUser();
  }, [refreshUser]);

  const ensureOrUnlockUserKeys = useCallback(async (password: string, targetUser: User): Promise<User> => {
    let updatedUser = targetUser;

    if (
      updatedUser.encryptedPrivateKey === undefined ||
      (!updatedUser.encryptedPrivateKey && !updatedUser.encryptionPublicKey)
    ) {
      try {
        const meRes = await fetch('/api/auth/me', { credentials: 'include' });
        if (meRes.ok) {
          const meData = await meRes.json();
          updatedUser = normalizeUser(meData.user);
        }
      } catch {
        // Proceed with targetUser
      }
    }

    if (updatedUser.encryptedPrivateKey && updatedUser.keySalt) {
      await unlockPrivateKeyWithPassword(password, updatedUser.keySalt, updatedUser.encryptedPrivateKey);
      setIsVaultUnlocked(true);
    } else {
      const generated = await generateUserKeyBundle(password);
      try {
        const putRes = await fetch('/api/auth/encryption-keys', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify(generated)
        });
        if (putRes.ok) {
          updatedUser = {
            ...updatedUser,
            encryptionPublicKey: generated.encryptionPublicKey,
            encryptedPrivateKey: generated.encryptedPrivateKey,
            keySalt: generated.keySalt
          };
        }
      } catch (err) {
        console.warn('Could not upload generated encryption keys:', err);
      }
      setIsVaultUnlocked(true);
    }

    return updatedUser;
  }, []);

  const login = useCallback((tokenOrUser: string | User | null, userData?: User) => {
    purgeLegacyStorageKeys();
    const rawUser = typeof tokenOrUser === 'object' && tokenOrUser !== null ? tokenOrUser : userData;
    if (!rawUser) return;
    const normalized = normalizeUser(rawUser);
    setUser(normalized);
    setIsVaultUnlocked(isPrivateKeyUnlocked());
  }, []);

  const loginWithCredentials = useCallback(
    async (username: string, password: string): Promise<User> => {
      purgeLegacyStorageKeys();
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ username, password })
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Login failed');
      }

      let normalized = normalizeUser(data.user);
      try {
        normalized = await ensureOrUnlockUserKeys(password, normalized);
      } catch (keyErr) {
        console.warn('[E2EE] Key unlock warning during login:', keyErr);
      }

      setUser(normalized);
      setIsVaultUnlocked(isPrivateKeyUnlocked());
      return normalized;
    },
    [ensureOrUnlockUserKeys]
  );

  const unlockE2ee = useCallback(
    async (password: string): Promise<void> => {
      let currentUser = user;
      if (!currentUser || (!currentUser.encryptedPrivateKey && !currentUser.keySalt)) {
        currentUser = await refreshUser();
      }
      if (!currentUser) {
        throw new Error('Not signed in');
      }

      if (currentUser.encryptedPrivateKey && currentUser.keySalt) {
        await unlockPrivateKeyWithPassword(password, currentUser.keySalt, currentUser.encryptedPrivateKey);
        setIsVaultUnlocked(true);
        return;
      }

      const generated = await generateUserKeyBundle(password);
      const putRes = await fetch('/api/auth/encryption-keys', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(generated)
      });
      if (!putRes.ok) {
        clearUnlockedKey();
        setIsVaultUnlocked(false);
        const errData = await putRes.json().catch(() => ({}));
        throw new Error(errData.error || 'Failed to initialize encryption keys');
      }
      await refreshUser();
      setIsVaultUnlocked(true);
    },
    [user, refreshUser]
  );

  const logout = useCallback(async () => {
    try {
      await fetch('/api/auth/logout', {
        method: 'POST',
        credentials: 'include'
      });
    } catch {
      // Ignore network errors during logout
    }
    purgeLegacyStorageKeys();
    clearUnlockedKey();
    setUser(null);
    setIsVaultUnlocked(false);
  }, []);

  const value = useMemo<AuthContextType>(
    () => ({
      user,
      token: user ? 'cookie-session' : null,
      loading,
      isVaultUnlocked,
      login,
      loginWithCredentials,
      unlockE2ee,
      refreshVaultStatus,
      logout,
      refreshUser
    }),
    [
      user,
      loading,
      isVaultUnlocked,
      login,
      loginWithCredentials,
      unlockE2ee,
      refreshVaultStatus,
      logout,
      refreshUser
    ]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};
