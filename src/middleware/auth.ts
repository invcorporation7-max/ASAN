import { NextFunction, Request, Response } from 'express';
import { DecodedIdToken } from 'firebase-admin/auth';
import { adminAuth } from '../lib/firebase-admin.ts';
import { getOrCreateUser } from '../db/users.ts';

export interface AuthUserRecord {
  id: number;
  uid: string;
  shortUid: string;
  email: string;
  displayName: string;
  username: string;
  photoUrl: string;
  plan: string;
  viewPlanMode: string;
  role: string;
  points: number;
  proStartedAt: string;
  proExpiresAt: string;
  lastExpiryReminderFor: string;
  contributorApproved: boolean;
  contributorRequested: boolean;
  adminAuthorized: boolean;
  adminFirstGiftClaimed: boolean;
  lastWeeklyGrantWeek: string;
  spectraUrl: string;
  driveFolderId: string;
  scheduleSheetId: string;
}

export interface AuthRequest extends Request {
  user?: DecodedIdToken;
  dbUser?: AuthUserRecord;
}

export const requireAuth = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Unauthorized: Missing sign-in token' });
  }

  const token = authHeader.split('Bearer ')[1];
  let decodedToken: DecodedIdToken;
  try {
    decodedToken = await adminAuth.verifyIdToken(token);
  } catch (error) {
    console.error('Error verifying Firebase ID token:', error);
    return res.status(401).json({ error: 'Unauthorized: Session expired or invalid. Please refresh sign-in.' });
  }

  try {
    req.user = decodedToken;
    const dbUser = await getOrCreateUser(
      decodedToken.uid,
      decodedToken.email || '',
      decodedToken.name || undefined,
      decodedToken.picture || undefined
    );
    req.dbUser = dbUser as AuthUserRecord;
    next();
  } catch (error) {
    console.error('Error synchronizing user workspace profile:', error);
    return res.status(500).json({ error: 'Unable to load workspace profile. Please try again.' });
  }
};

export const requireAdmin = (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  if (req.dbUser?.role !== 'admin') {
    return res.status(403).json({ error: 'Forbidden: Admin responsibility required.' });
  }
  next();
};
