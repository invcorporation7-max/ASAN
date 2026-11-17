import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
} from 'react';
import { User } from 'firebase/auth';
import { apiFetch } from '../lib/api';
import {
  connectBasicDriveFolderOAuth,
  connectWorkspaceOAuth,
  getAccessToken,
  googleSignIn,
  logout,
  subscribeAuth,
} from '../lib/firebase';
import type { DbUser } from '../types';

interface AuthContextValue {
  firebaseUser: User | null;
  dbUser: DbUser | null;
  isGuest: boolean;
  effectivePlan: 'free' | 'basic' | 'pro';
  isEffectiveProOrAdmin: boolean;
  workspaceToken: string | null;
  loading: boolean;
  error: string | null;
  signIn: () => Promise<void>;
  continueFreeGuest: () => void;
  exitGuestToSignIn: () => void;
  connectBasicDrive: () => Promise<string | null>;
  connectWorkspace: () => Promise<string | null>;
  signOutUser: () => Promise<void>;
  refreshProfile: () => Promise<void>;
  updateProfile: (updates: {
    displayName?: string;
    username?: string;
    spectraUrl?: string;
    driveFolderId?: string;
    scheduleSheetId?: string;
    viewPlanMode?: 'auto' | 'basic';
  }) => Promise<void>;
  setViewPlanMode: (mode: 'auto' | 'basic') => Promise<void>;
  switchPlanAdmin: (plan: 'basic' | 'pro') => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);
const GUEST_STORAGE_KEY = 'asan_guest_free_mode';

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  const [firebaseUser, setFirebaseUser] = useState<User | null>(null);
  const [dbUser, setDbUser] = useState<DbUser | null>(null);
  const [isGuest, setIsGuest] = useState<boolean>(() => {
    try {
      return localStorage.getItem(GUEST_STORAGE_KEY) === '1';
    } catch {
      return false;
    }
  });
  const [workspaceToken, setWorkspaceToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const syncUserRecords = useCallback(async (user: User) => {
    try {
      const profile = await apiFetch<DbUser>('/api/me');
      setDbUser(profile);
      setError(null);
    } catch (err) {
      setDbUser((prev) =>
        prev || {
          id: 0,
          uid: user.uid,
          shortUid: 'TEMP0',
          email: user.email || '',
          displayName: user.displayName || 'Student',
          username: (user.email || '').split('@')[0] || 'student',
          photoUrl: user.photoURL || '',
          plan: 'basic',
          viewPlanMode: 'auto',
          role: 'user',
          points: 500,
          proStartedAt: '',
          proExpiresAt: '',
          lastExpiryReminderFor: '',
          contributorApproved: false,
          contributorRequested: false,
          adminAuthorized: false,
          adminFirstGiftClaimed: false,
          lastWeeklyGrantWeek: '',
          spectraUrl: 'https://www.khanacademy.org',
          driveFolderId: '',
          scheduleSheetId: '',
        }
      );
      setError(err instanceof Error ? err.message : 'Failed to load user account');
    }
  }, []);

  useEffect(() => {
    const unsub = subscribeAuth(async (user, token) => {
      setFirebaseUser(user);
      setWorkspaceToken(token || getAccessToken());
      if (user) {
        setIsGuest(false);
        try {
          localStorage.removeItem(GUEST_STORAGE_KEY);
        } catch {
          // ignore
        }
        await syncUserRecords(user);
      } else {
        setDbUser(null);
      }
      setLoading(false);
    });
    return () => unsub();
  }, [syncUserRecords]);

  // Basic Sign-In ONLY (does not request Google Drive / Workspace scopes on login)
  const signIn = useCallback(async () => {
    setError(null);
    setLoading(true);
    try {
      const res = await googleSignIn();
      setIsGuest(false);
      try {
        localStorage.removeItem(GUEST_STORAGE_KEY);
      } catch {
        // ignore
      }
      setFirebaseUser(res.user);
      await syncUserRecords(res.user);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Google sign-in failed');
    } finally {
      setLoading(false);
    }
  }, [syncUserRecords]);

  const continueFreeGuest = useCallback(() => {
    setError(null);
    setIsGuest(true);
    try {
      localStorage.setItem(GUEST_STORAGE_KEY, '1');
    } catch {
      // ignore
    }
  }, []);

  const exitGuestToSignIn = useCallback(() => {
    setIsGuest(false);
    try {
      localStorage.removeItem(GUEST_STORAGE_KEY);
    } catch {
      // ignore
    }
  }, []);

  const connectBasicDrive = useCallback(async () => {
    setError(null);
    try {
      const res = await connectBasicDriveFolderOAuth();
      setFirebaseUser(res.user);
      setWorkspaceToken(res.accessToken);
      return res.accessToken;
    } catch (err) {
      setError(
        err instanceof Error ? err.message : 'Failed to connect ASAN-user-content Drive folder'
      );
      return null;
    }
  }, []);

  const connectWorkspace = useCallback(async () => {
    setError(null);
    try {
      const res = await connectWorkspaceOAuth();
      setFirebaseUser(res.user);
      setWorkspaceToken(res.accessToken);
      return res.accessToken;
    } catch (err) {
      setError(
        err instanceof Error ? err.message : 'Failed to connect Google Workspace'
      );
      return null;
    }
  }, []);

  const signOutUser = useCallback(async () => {
    await logout();
    setFirebaseUser(null);
    setDbUser(null);
    setWorkspaceToken(null);
    setIsGuest(false);
    try {
      localStorage.removeItem(GUEST_STORAGE_KEY);
    } catch {
      // ignore
    }
  }, []);

  const refreshProfile = useCallback(async () => {
    if (!firebaseUser) return;
    await syncUserRecords(firebaseUser);
  }, [firebaseUser, syncUserRecords]);

  const updateProfile = useCallback(
    async (updates: {
      displayName?: string;
      username?: string;
      spectraUrl?: string;
      driveFolderId?: string;
      scheduleSheetId?: string;
      viewPlanMode?: 'auto' | 'basic';
    }) => {
      const updated = await apiFetch<DbUser>('/api/me', {
        method: 'PATCH',
        body: JSON.stringify(updates),
      });
      setDbUser(updated);
    },
    []
  );

  // Switch between full tier and lower Basic plan preview without pausing Pro tenure
  const setViewPlanMode = useCallback(
    async (mode: 'auto' | 'basic') => {
      await updateProfile({ viewPlanMode: mode });
    },
    [updateProfile]
  );

  const switchPlanAdmin = useCallback(async (plan: 'basic' | 'pro') => {
    try {
      const updated = await apiFetch<DbUser>('/api/me/plan', {
        method: 'POST',
        body: JSON.stringify({ plan }),
      });
      setDbUser(updated);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to switch plan');
    }
  }, []);

  const effectivePlan: 'free' | 'basic' | 'pro' = isGuest
    ? 'free'
    : dbUser?.viewPlanMode === 'basic'
      ? 'basic'
      : dbUser?.plan === 'pro'
        ? 'pro'
        : 'basic';

  const isEffectiveProOrAdmin =
    !isGuest &&
    dbUser?.viewPlanMode !== 'basic' &&
    (dbUser?.plan === 'pro' || dbUser?.role === 'admin');

  return (
    <AuthContext.Provider
      value={{
        firebaseUser,
        dbUser,
        isGuest,
        effectivePlan,
        isEffectiveProOrAdmin,
        workspaceToken,
        loading,
        error,
        signIn,
        continueFreeGuest,
        exitGuestToSignIn,
        connectBasicDrive,
        connectWorkspace,
        signOutUser,
        refreshProfile,
        updateProfile,
        setViewPlanMode,
        switchPlanAdmin,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error('useAuth must be used inside AuthProvider');
  }
  return ctx;
}
