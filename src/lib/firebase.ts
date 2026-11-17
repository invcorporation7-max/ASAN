import { initializeApp } from 'firebase/app';
import {
  getAuth,
  GoogleAuthProvider,
  onAuthStateChanged,
  signInWithPopup,
  signOut,
  User,
} from 'firebase/auth';
import { doc, getDocFromServer, getFirestore } from 'firebase/firestore';
import firebaseConfig from '../../firebase-applet-config.json';

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);

const cfg = firebaseConfig as Record<string, string | undefined>;
export const db = cfg.firestoreDatabaseId
  ? getFirestore(app, cfg.firestoreDatabaseId)
  : getFirestore(app);

// Workspace scopes are ONLY requested on-demand when the user explicitly opts in
export const WORKSPACE_SCOPES = [
  'https://www.googleapis.com/auth/drive.file',
  'https://www.googleapis.com/auth/documents',
  'https://www.googleapis.com/auth/spreadsheets',
  'https://www.googleapis.com/auth/meetings.space.created',
  'https://www.googleapis.com/auth/meetings.space.readonly',
];

// Basic sign-in provider: NO Drive/Workspace scopes requested at login
export const basicGoogleAuthProvider = new GoogleAuthProvider();

// Opt-in Drive-only provider for Basic users storing unlimited notes/tasks .txt files in their ASAN-Study_tool folder
export const driveFolderOnlyAuthProvider = new GoogleAuthProvider();
driveFolderOnlyAuthProvider.addScope('https://www.googleapis.com/auth/drive.file');
driveFolderOnlyAuthProvider.setCustomParameters({ prompt: 'consent' });

// Incremental on-demand Workspace provider: only invoked when Pro/Admin user clicks Connect Workspace
export const workspaceGoogleAuthProvider = new GoogleAuthProvider();
WORKSPACE_SCOPES.forEach((scope) => {
  workspaceGoogleAuthProvider.addScope(scope);
});
workspaceGoogleAuthProvider.setCustomParameters({ prompt: 'consent' });

// In-memory OAuth access token cache (never stored in localStorage/sessionStorage)
let cachedWorkspaceToken: string | null = null;
let isSigningIn = false;

export const getAccessToken = (): string | null => cachedWorkspaceToken;

// Standard sign-in (does NOT request Drive/Sheets/Docs/Meet permissions)
export const googleSignIn = async (): Promise<{ user: User }> => {
  try {
    isSigningIn = true;
    const result = await signInWithPopup(auth, basicGoogleAuthProvider);
    return { user: result.user };
  } catch (error) {
    console.error('Google Sign-In failed:', error);
    throw error;
  } finally {
    isSigningIn = false;
  }
};

// Opt-in folder-isolated Drive access ONLY (for Basic users backing up unlimited .txt tasks/notes)
export const connectBasicDriveFolderOAuth = async (): Promise<{
  user: User;
  accessToken: string;
}> => {
  try {
    isSigningIn = true;
    const result = await signInWithPopup(auth, driveFolderOnlyAuthProvider);
    const credential = GoogleAuthProvider.credentialFromResult(result);
    if (!credential?.accessToken) {
      throw new Error('Could not obtain Google Drive folder access token.');
    }
    cachedWorkspaceToken = credential.accessToken;
    return { user: result.user, accessToken: cachedWorkspaceToken };
  } catch (error) {
    console.error('Basic Drive folder authorization failed:', error);
    throw error;
  } finally {
    isSigningIn = false;
  }
};

// Explicit opt-in Workspace authorization (only triggered when user clicks to connect Drive/Workspace)
export const connectWorkspaceOAuth = async (): Promise<{
  user: User;
  accessToken: string;
}> => {
  try {
    isSigningIn = true;
    const result = await signInWithPopup(auth, workspaceGoogleAuthProvider);
    const credential = GoogleAuthProvider.credentialFromResult(result);
    if (!credential?.accessToken) {
      throw new Error('Could not obtain Google Workspace access token.');
    }
    cachedWorkspaceToken = credential.accessToken;
    return { user: result.user, accessToken: cachedWorkspaceToken };
  } catch (error) {
    console.error('Workspace opt-in authorization failed:', error);
    throw error;
  } finally {
    isSigningIn = false;
  }
};

export const logout = async (): Promise<void> => {
  cachedWorkspaceToken = null;
  await signOut(auth);
};

export const subscribeAuth = (
  onUser: (user: User | null, workspaceToken: string | null) => void
) => {
  return onAuthStateChanged(auth, (user) => {
    if (!user) {
      cachedWorkspaceToken = null;
      onUser(null, null);
      return;
    }
    if (!isSigningIn) {
      onUser(user, cachedWorkspaceToken);
    }
  });
};

export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

export interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string | null;
    email?: string | null;
    emailVerified?: boolean | null;
    isAnonymous?: boolean | null;
    tenantId?: string | null;
    providerInfo?: {
      providerId?: string | null;
      email?: string | null;
    }[];
  };
}

export function handleFirestoreError(
  error: unknown,
  operationType: OperationType,
  path: string | null
): never {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo:
        auth.currentUser?.providerData?.map((provider) => ({
          providerId: provider.providerId,
          email: provider.email,
        })) || [],
    },
    operationType,
    path,
  };
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

export async function testFirestoreConnection(): Promise<void> {
  try {
    await getDocFromServer(doc(db, 'test', 'connection'));
  } catch (error) {
    if (error instanceof Error && error.message.includes('the client is offline')) {
      console.warn('Firestore offline or unconfigured on this project.');
    }
  }
}
