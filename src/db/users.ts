import crypto from 'crypto';
import { desc, eq, or } from 'drizzle-orm';
import { db } from './index.js';
import {
  ADMIN_OWNER_EMAIL,
  CONSTANT_ADMIN_LICENSE_KEY,
  getLocalStore,
  isDbUnavailableError,
  nextSeq,
  persistLocalStore,
  StoreUser,
} from './localStore.js';
import {
  licenseKeys,
  notebooks,
  notePages,
  notifications,
  pointTransactions,
  userMessages,
  users,
} from './schema.js';

export function getSundayWeekKey(date = new Date()): string {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - d.getDay()); // Sunday = 0
  return d.toISOString().slice(0, 10);
}

export function generate8CharKey(): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bytes = crypto.randomBytes(8);
  let out = '';
  for (let i = 0; i < 8; i++) {
    out += alphabet[bytes[i] % alphabet.length];
  }
  return out;
}

export function generate5CharUid(existing: Set<string> = new Set()): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  for (let attempt = 0; attempt < 50; attempt++) {
    const bytes = crypto.randomBytes(5);
    let out = '';
    for (let i = 0; i < 5; i++) {
      out += alphabet[bytes[i] % alphabet.length];
    }
    if (!existing.has(out)) return out;
  }
  return crypto.randomBytes(3).toString('hex').toUpperCase().slice(0, 5);
}

function addMonthsIso(fromDate: Date, months: number): string {
  const d = new Date(fromDate);
  d.setMonth(d.getMonth() + months);
  return d.toISOString();
}

function addYearsIso(fromDate: Date, years: number): string {
  const d = new Date(fromDate);
  d.setFullYear(d.getFullYear() + years);
  return d.toISOString();
}

function sanitizeUsernameBase(email: string, displayName?: string): string {
  const raw = (email.split('@')[0] || displayName || 'student')
    .toLowerCase()
    .replace(/[^a-z0-9_.-]/g, '');
  return raw.slice(0, 24) || 'student';
}

// --- LOCAL STORE HELPERS ---
function localAwardPoints(
  userId: number,
  amount: number,
  reason: string,
  category: string
): StoreUser | undefined {
  const store = getLocalStore();
  const user = store.users.find((u) => u.id === userId);
  if (!user) return undefined;
  user.points = Math.max(0, (user.points || 0) + amount);
  user.updatedAt = new Date();
  store.pointTransactions.unshift({
    id: nextSeq('pointTransactions'),
    userId,
    amount,
    reason,
    category,
    createdAt: new Date(),
  });
  persistLocalStore();
  return user;
}

function localPushNotification(params: {
  userId: number | null;
  senderId?: number | null;
  senderLabel?: string;
  title: string;
  message: string;
  type?: string;
}) {
  const store = getLocalStore();
  store.notifications.unshift({
    id: nextSeq('notifications'),
    userId: params.userId,
    senderId: params.senderId ?? null,
    senderLabel: params.senderLabel || 'ASAN System',
    title: params.title,
    message: params.message,
    type: params.type || 'info',
    isRead: false,
    createdAt: new Date(),
  });
  persistLocalStore();
}

function localSendSystemMail(params: {
  recipient: StoreUser;
  senderId?: number | null;
  senderEmail?: string;
  senderUsername?: string;
  senderLabel?: string;
  isAdminMail?: boolean;
  subject: string;
  body: string;
  notifTitle?: string;
  notifMessage?: string;
  notifType?: string;
}) {
  const store = getLocalStore();
  const now = new Date();
  store.userMessages.unshift({
    id: nextSeq('userMessages'),
    senderId: params.senderId || params.recipient.id,
    recipientId: params.recipient.id,
    senderEmail: params.senderEmail || ADMIN_OWNER_EMAIL,
    senderUsername: params.senderUsername || 'asan_system',
    recipientEmail: params.recipient.email,
    recipientUsername: params.recipient.username,
    visibility: 'direct',
    isAdminMail: Boolean(params.isAdminMail ?? true),
    recipientSummary: params.recipient.username
      ? `@${params.recipient.username}`
      : params.recipient.email,
    subject: params.subject,
    body: params.body,
    attachmentTitle: '',
    attachmentNoteId: null,
    isRead: false,
    createdAt: now,
  });

  localPushNotification({
    userId: params.recipient.id,
    senderId: params.senderId ?? null,
    senderLabel: params.senderLabel || 'ASAN System',
    title: params.notifTitle || params.subject,
    message: params.notifMessage || params.body.slice(0, 140),
    type: params.notifType || 'info',
  });
}

function localIssueProKeyForUser(params: {
  targetUser: StoreUser;
  issuedByUserId: number | null;
  subject: string;
  introText: string;
  durationMonths?: number;
  isAdminMail?: boolean;
}) {
  const store = getLocalStore();
  const months = params.durationMonths === 12 ? 12 : 1;
  let keyCode = generate8CharKey();
  while (
    keyCode === CONSTANT_ADMIN_LICENSE_KEY ||
    store.licenseKeys.some((k) => k.keyCode === keyCode)
  ) {
    keyCode = generate8CharKey();
  }
  const now = new Date();
  const activationExpiresAt = addYearsIso(now, 1);

  const keyRec = {
    id: nextSeq('licenseKeys'),
    keyCode,
    keyType: 'pro',
    durationMonths: months,
    issuedToUserId: params.targetUser.id,
    issuedToEmail: params.targetUser.email,
    issuedByUserId: params.issuedByUserId,
    activationExpiresAt,
    activatedByUserId: null,
    activatedAt: '',
    subStartsAt: '',
    subEndsAt: '',
    status: 'unused',
    createdAt: now,
  };
  store.licenseKeys.unshift(keyRec);

  localSendSystemMail({
    recipient: params.targetUser,
    senderId: params.issuedByUserId || params.targetUser.id,
    senderLabel: 'ASAN Licensing',
    isAdminMail: Boolean(params.isAdminMail ?? true),
    subject: params.subject,
    body: `${params.introText}\n\nPro License Key (8 chars): ${keyCode}\nPlan Term: ${
      months === 12 ? 'Annual Pro (12 months, 15% discount)' : 'Monthly Pro (1 month)'
    }\nActivation Valid Until: ${activationExpiresAt.slice(0, 10)} (1 year)\n\nGo to Subscriptions in ASAN-Study_tool to activate this key.`,
    notifTitle: params.subject,
    notifMessage: `Your 8-char Pro key ${keyCode} (${months === 12 ? 'Annual' : 'Monthly'}) is in Tool Mail.`,
    notifType: 'license',
  });

  persistLocalStore();
  return keyRec;
}

function localMaintainLifecycle(user: StoreUser): StoreUser {
  const store = getLocalStore();
  const now = new Date();
  let changed = false;

  // Ensure every user has a unique 5-char uppercase shortUid
  if (!user.shortUid || user.shortUid.length !== 5) {
    const takenUids = new Set(store.users.map((u) => u.shortUid).filter(Boolean));
    user.shortUid = generate5CharUid(takenUids);
    changed = true;
  }
  if (!user.viewPlanMode) {
    user.viewPlanMode = 'auto';
    changed = true;
  }

  // Owner is always authorized admin
  if (user.email.toLowerCase() === ADMIN_OWNER_EMAIL) {
    if (user.role !== 'admin' || !user.adminAuthorized) {
      user.role = 'admin';
      user.adminAuthorized = true;
      changed = true;
    }
  }

  // Check Pro expiration + 3-day before expiry reminder
  if (user.plan === 'pro' && user.proExpiresAt) {
    const exp = new Date(user.proExpiresAt);
    if (!Number.isNaN(exp.getTime())) {
      const msLeft = exp.getTime() - now.getTime();
      const threeDaysMs = 3 * 24 * 60 * 60 * 1000;
      if (msLeft < 0) {
        user.plan = 'basic';
        user.proStartedAt = '';
        user.proExpiresAt = '';
        user.lastExpiryReminderFor = '';
        changed = true;
        localSendSystemMail({
          recipient: user,
          senderLabel: 'ASAN Subscriptions',
          subject: 'Your ASAN-Study_tool Pro Plan Has Expired',
          body: `Hello ${user.displayName},\n\nYour ASAN-Study_tool Pro subscription ended on ${exp
            .toISOString()
            .slice(0, 10)} and your account has been switched back to the Basic Plan.\n\nRenew anytime in Subscriptions for 500 points (1 month), 5,100 points (Annual Pro — 15% discount), or activate an 8-character License Key.`,
          notifTitle: 'Pro Subscription Expired',
          notifMessage:
            'Your Pro Plan expired and returned to Basic. Renew with 500 pts (Monthly), 5,100 pts (Annual -15%), or a license key.',
          notifType: 'warning',
        });
      } else if (
        msLeft <= threeDaysMs &&
        user.lastExpiryReminderFor !== user.proExpiresAt
      ) {
        const daysLeft = Math.max(1, Math.ceil(msLeft / (24 * 60 * 60 * 1000)));
        user.lastExpiryReminderFor = user.proExpiresAt;
        changed = true;
        localSendSystemMail({
          recipient: user,
          senderLabel: 'ASAN Subscriptions',
          subject: `Renewal Reminder: Your Pro Plan Expires in ${daysLeft} Day(s)`,
          body: `Hello ${user.displayName},\n\nThis is a friendly reminder that your ASAN-Study_tool Pro Plan expires on ${exp
            .toISOString()
            .slice(0, 10)} (${daysLeft} day(s) remaining).\n\nRenew now in Subscriptions using 500 points (Monthly) or 5,100 points (Annual — 15% discount) so your Pro workspace, PDF studio, and Exam Master Google Sheets sync continue without interruption.`,
          notifTitle: `Pro Expires in ${daysLeft} Day(s)`,
          notifMessage: `Your Pro plan expires on ${exp.toISOString().slice(0, 10)}. Renew in Subscriptions.`,
          notifType: 'warning',
        });
      }
    }
  }

  // Admin first login gift: free 8-char Pro license key
  if (user.role === 'admin' && !user.adminFirstGiftClaimed) {
    user.adminFirstGiftClaimed = true;
    changed = true;
    localIssueProKeyForUser({
      targetUser: user,
      issuedByUserId: user.id,
      subject: 'Welcome Admin — Free Pro License Key Gift',
      introText:
        'As a hand-selected ASAN-Study_tool Admin, here is your complimentary 8-character Pro License Key along with your weekly 150-point stipend starting every Sunday.',
      durationMonths: 1,
      isAdminMail: true,
    });
  }

  // Weekly Sunday Stipends (Admin: 150 pts, Approved Contributor: 120 pts)
  const currentWeek = getSundayWeekKey(now);
  if (user.lastWeeklyGrantWeek !== currentWeek) {
    if (user.role === 'admin') {
      user.lastWeeklyGrantWeek = currentWeek;
      changed = true;
      localAwardPoints(
        user.id,
        150,
        `Weekly Admin Stipend (Week of ${currentWeek})`,
        'weekly_admin'
      );
      localPushNotification({
        userId: user.id,
        title: '+150 Points Weekly Admin Stipend',
        message: `Sunday weekly admin reward (+150 pts) credited for week ${currentWeek}.`,
        type: 'points',
      });
    } else if (user.role === 'contributor' && user.contributorApproved) {
      user.lastWeeklyGrantWeek = currentWeek;
      changed = true;
      localAwardPoints(
        user.id,
        120,
        `Weekly Contributor Stipend (Week of ${currentWeek})`,
        'weekly_contributor'
      );
      localPushNotification({
        userId: user.id,
        title: '+120 Points Weekly Contributor Stipend',
        message: `Your contributor work is admin-approved. +120 pts credited for week ${currentWeek}.`,
        type: 'points',
      });
    }
  }

  // Check if any unused key issued to this email can be marked expired if past activation window
  store.licenseKeys.forEach((k) => {
    if (k.status === 'unused' && new Date(k.activationExpiresAt).getTime() < now.getTime()) {
      k.status = 'expired';
      changed = true;
    }
  });

  if (changed) {
    user.updatedAt = now;
    persistLocalStore();
  }
  return user;
}

// --- PUBLIC EXPORTED FUNCTIONS ---
export async function getOrCreateUser(
  uid: string,
  email: string,
  displayName?: string,
  photoUrl?: string
) {
  const normalizedEmail = email.trim();
  const isOwner = normalizedEmail.toLowerCase() === ADMIN_OWNER_EMAIL;

  try {
    const existing = await db.select().from(users).where(eq(users.uid, uid)).limit(1);
    let userRecord = existing[0];

    if (!userRecord) {
      const base = sanitizeUsernameBase(normalizedEmail, displayName);
      const allUsers = await db
        .select({ username: users.username, shortUid: users.shortUid })
        .from(users);
      const taken = new Set(allUsers.map((u) => u.username.toLowerCase()));
      const takenShortUids = new Set(allUsers.map((u) => u.shortUid).filter(Boolean));
      let candidate = base;
      let suffix = 1;
      while (taken.has(candidate)) {
        candidate = `${base}${suffix++}`;
      }
      const shortUid = generate5CharUid(takenShortUids);

      const [inserted] = await db
        .insert(users)
        .values({
          uid,
          shortUid,
          email: normalizedEmail,
          displayName: displayName || normalizedEmail.split('@')[0] || 'Student',
          username: candidate,
          photoUrl: photoUrl || '',
          plan: 'basic',
          viewPlanMode: 'auto',
          role: isOwner ? 'admin' : 'user',
          points: 500,
          adminAuthorized: isOwner,
        })
        .returning();
      userRecord = inserted;

      await db.insert(pointTransactions).values({
        userId: userRecord.id,
        amount: 500,
        reason: 'Welcome Bonus (Initial Login Balance)',
        category: 'initial',
      });

      const [starterNotebook] = await db
        .insert(notebooks)
        .values({
          userId: userRecord.id,
          title: 'Academic Study Notebook',
          subject: 'Physics & Calculus',
          color: '#2563EB',
        })
        .returning();

      if (starterNotebook) {
        await db.insert(notePages).values({
          notebookId: starterNotebook.id,
          userId: userRecord.id,
          sectionName: 'Quick Start',
          title: 'A4 Study Document Guide',
          pagesData: [
            {
              id: 'page-1',
              pageNumber: 1,
              title: 'Page 1 — A4 Structured Notes',
              blocks: [
                {
                  id: 'b-1',
                  type: 'heading',
                  content: 'Welcome to ASAN-Study_tool A4 Notebooks',
                  fontSize: 16,
                },
                {
                  id: 'b-2',
                  type: 'text',
                  content:
                    'Write, paste images, add formulas, and distribute your notes across clean A4 pages. Export directly as a multi-page PDF or back up unlimited notes & tasks to your ASAN-user-content Google Drive folder.',
                  fontSize: 10,
                },
              ],
            },
          ],
        });
      }
    } else {
      let shortUid = existing[0].shortUid;
      if (!shortUid || shortUid.length !== 5) {
        const allU = await db.select({ shortUid: users.shortUid }).from(users);
        shortUid = generate5CharUid(new Set(allU.map((x) => x.shortUid).filter(Boolean)));
      }
      const [updated] = await db
        .update(users)
        .set({
          shortUid,
          email: normalizedEmail || existing[0].email,
          displayName: displayName || existing[0].displayName || 'Student',
          photoUrl: photoUrl || existing[0].photoUrl || '',
          ...(isOwner ? { role: 'admin', adminAuthorized: true } : {}),
          updatedAt: new Date(),
        })
        .where(eq(users.id, existing[0].id))
        .returning();
      userRecord = updated;
    }

    // Check lifecycle (expiration, 3-day reminder, admin first gift, weekly stipend) in SQL
    const now = new Date();
    if (userRecord.plan === 'pro' && userRecord.proExpiresAt) {
      const exp = new Date(userRecord.proExpiresAt);
      if (!Number.isNaN(exp.getTime())) {
        const msLeft = exp.getTime() - now.getTime();
        const threeDaysMs = 3 * 24 * 60 * 60 * 1000;
        if (msLeft < 0) {
          const [downgraded] = await db
            .update(users)
            .set({
              plan: 'basic',
              proStartedAt: '',
              proExpiresAt: '',
              lastExpiryReminderFor: '',
              updatedAt: now,
            })
            .where(eq(users.id, userRecord.id))
            .returning();
          userRecord = downgraded;
          await db.insert(userMessages).values({
            senderId: userRecord.id,
            recipientId: userRecord.id,
            senderEmail: ADMIN_OWNER_EMAIL,
            senderUsername: 'asan_system',
            recipientEmail: userRecord.email,
            recipientUsername: userRecord.username,
            visibility: 'direct',
            isAdminMail: true,
            recipientSummary: `@${userRecord.username}`,
            subject: 'Your ASAN-Study_tool Pro Plan Has Expired',
            body: `Hello ${userRecord.displayName},\n\nYour Pro Plan expired on ${exp.toISOString().slice(0, 10)} and your account returned to Basic.\nRenew in Subscriptions with 500 points (Monthly), 5,100 points (Annual — 15% discount), or an 8-character License Key.`,
          });
          await db.insert(notifications).values({
            userId: userRecord.id,
            senderLabel: 'ASAN Subscriptions',
            title: 'Pro Subscription Expired',
            message: 'Your Pro Plan expired and returned to Basic. Renew anytime in Subscriptions.',
            type: 'warning',
          });
        } else if (msLeft <= threeDaysMs && userRecord.lastExpiryReminderFor !== userRecord.proExpiresAt) {
          const daysLeft = Math.max(1, Math.ceil(msLeft / (24 * 60 * 60 * 1000)));
          const [reminded] = await db
            .update(users)
            .set({ lastExpiryReminderFor: userRecord.proExpiresAt, updatedAt: now })
            .where(eq(users.id, userRecord.id))
            .returning();
          userRecord = reminded;
          await db.insert(userMessages).values({
            senderId: userRecord.id,
            recipientId: userRecord.id,
            senderEmail: ADMIN_OWNER_EMAIL,
            senderUsername: 'asan_system',
            recipientEmail: userRecord.email,
            recipientUsername: userRecord.username,
            visibility: 'direct',
            isAdminMail: true,
            recipientSummary: `@${userRecord.username}`,
            subject: `Renewal Reminder: Your Pro Plan Expires in ${daysLeft} Day(s)`,
            body: `Hello ${userRecord.displayName},\n\nYour ASAN-Study_tool Pro Plan expires on ${exp.toISOString().slice(0, 10)}. Renew in Subscriptions with 500 pts (Monthly) or 5,100 pts (Annual — 15% discount).`,
          });
          await db.insert(notifications).values({
            userId: userRecord.id,
            senderLabel: 'ASAN Subscriptions',
            title: `Pro Expires in ${daysLeft} Day(s)`,
            message: `Your Pro plan expires on ${exp.toISOString().slice(0, 10)}. Renew in Subscriptions.`,
            type: 'warning',
          });
        }
      }
    }

    if (userRecord.role === 'admin' && !userRecord.adminFirstGiftClaimed) {
      const giftKey = generate8CharKey();
      const activationExpiresAt = addYearsIso(now, 1);
      await db.insert(licenseKeys).values({
        keyCode: giftKey,
        keyType: 'pro',
        durationMonths: 1,
        issuedToUserId: userRecord.id,
        issuedToEmail: userRecord.email,
        issuedByUserId: userRecord.id,
        activationExpiresAt,
        status: 'unused',
      });
      await db.insert(userMessages).values({
        senderId: userRecord.id,
        recipientId: userRecord.id,
        senderEmail: ADMIN_OWNER_EMAIL,
        senderUsername: 'asan_admin',
        recipientEmail: userRecord.email,
        recipientUsername: userRecord.username,
        visibility: 'direct',
        isAdminMail: true,
        recipientSummary: userRecord.username || userRecord.email,
        subject: 'Welcome Admin — Free Pro License Key Gift',
        body: `Your free 8-character Pro License Key: ${giftKey}\nValid 1 year to activate (${activationExpiresAt.slice(0, 10)}) for 1 month of Pro.`,
      });
      const [u2] = await db
        .update(users)
        .set({ adminFirstGiftClaimed: true, updatedAt: now })
        .where(eq(users.id, userRecord.id))
        .returning();
      userRecord = u2;
    }

    const weekKey = getSundayWeekKey(now);
    if (userRecord.lastWeeklyGrantWeek !== weekKey) {
      const stipend =
        userRecord.role === 'admin'
          ? 150
          : userRecord.role === 'contributor' && userRecord.contributorApproved
            ? 120
            : 0;
      if (stipend > 0) {
        const [u3] = await db
          .update(users)
          .set({
            points: userRecord.points + stipend,
            lastWeeklyGrantWeek: weekKey,
            updatedAt: now,
          })
          .where(eq(users.id, userRecord.id))
          .returning();
        userRecord = u3;
        await db.insert(pointTransactions).values({
          userId: userRecord.id,
          amount: stipend,
          reason:
            userRecord.role === 'admin'
              ? `Weekly Admin Stipend (Week of ${weekKey})`
              : `Weekly Contributor Stipend (Week of ${weekKey})`,
          category: userRecord.role === 'admin' ? 'weekly_admin' : 'weekly_contributor',
        });
      }
    }

    return userRecord;
  } catch (error) {
    if (!isDbUnavailableError(error)) {
      console.error('getOrCreateUser failed:', error);
      throw new Error('Failed to synchronize user profile.', { cause: error });
    }

    // Fallback to localStore
    const store = getLocalStore();
    let user = store.users.find((u) => u.uid === uid);
    const now = new Date();
    if (!user) {
      const base = sanitizeUsernameBase(normalizedEmail, displayName);
      const taken = new Set(store.users.map((u) => u.username.toLowerCase()));
      const takenUids = new Set(store.users.map((u) => u.shortUid).filter(Boolean));
      let candidate = base;
      let suffix = 1;
      while (taken.has(candidate)) {
        candidate = `${base}${suffix++}`;
      }
      const shortUid = generate5CharUid(takenUids);
      const userId = nextSeq('users');
      user = {
        id: userId,
        uid,
        shortUid,
        email: normalizedEmail,
        displayName: displayName || normalizedEmail.split('@')[0] || 'Student',
        username: candidate,
        photoUrl: photoUrl || '',
        plan: 'basic',
        viewPlanMode: 'auto',
        role: isOwner ? 'admin' : 'user',
        points: 500,
        proStartedAt: '',
        proExpiresAt: '',
        lastExpiryReminderFor: '',
        contributorApproved: false,
        contributorRequested: false,
        adminAuthorized: isOwner,
        adminFirstGiftClaimed: false,
        lastWeeklyGrantWeek: '',
        spectraUrl: 'https://www.khanacademy.org',
        driveFolderId: '',
        scheduleSheetId: '',
        createdAt: now,
        updatedAt: now,
      };
      store.users.push(user);
      store.pointTransactions.unshift({
        id: nextSeq('pointTransactions'),
        userId,
        amount: 500,
        reason: 'Welcome Bonus (Initial Login Balance)',
        category: 'initial',
        createdAt: now,
      });

      const nbId = nextSeq('notebooks');
      store.notebooks.push({
        id: nbId,
        userId,
        title: 'Academic Study Notebook',
        subject: 'Physics & Calculus',
        color: '#2563EB',
        createdAt: now,
        updatedAt: now,
      });
      store.notePages.push({
        id: nextSeq('notePages'),
        notebookId: nbId,
        userId,
        sectionName: 'Quick Start',
        title: 'A4 Study Document Guide',
        pagesData: [
          {
            id: 'page-1',
            pageNumber: 1,
            title: 'Page 1 — A4 Structured Notes',
            blocks: [
              {
                id: 'b-1',
                type: 'heading',
                content: 'Welcome to ASAN-Study_tool A4 Notebooks',
                fontSize: 16,
              },
              {
                id: 'b-2',
                type: 'text',
                content:
                  'Write, paste images, add formulas, and distribute your notes across clean A4 pages. Export directly as a multi-page PDF or back up unlimited notes & tasks to your ASAN-user-content Google Drive folder.',
                fontSize: 10,
              },
            ],
          },
        ],
        createdAt: now,
        updatedAt: now,
      });
      persistLocalStore();
    } else {
      user.email = normalizedEmail || user.email;
      user.displayName = displayName || user.displayName || 'Student';
      user.photoUrl = photoUrl || user.photoUrl || '';
      if (isOwner) {
        user.role = 'admin';
        user.adminAuthorized = true;
      }
      user.updatedAt = now;
      persistLocalStore();
    }

    return localMaintainLifecycle(user);
  }
}

export async function updateUserProfile(
  userId: number,
  updates: {
    displayName?: string;
    username?: string;
    spectraUrl?: string;
    driveFolderId?: string;
    scheduleSheetId?: string;
    viewPlanMode?: 'auto' | 'basic';
  }
) {
  let cleanUsername: string | undefined;
  if (updates.username !== undefined) {
    cleanUsername = updates.username
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9_.-]/g, '')
      .slice(0, 32);
    if (!cleanUsername || cleanUsername.length < 3) {
      throw new Error('Username must be at least 3 characters (letters, numbers, _, ., -).');
    }
  }

  try {
    if (cleanUsername) {
      const existing = await db
        .select({ id: users.id })
        .from(users)
        .where(eq(users.username, cleanUsername));
      if (existing.some((r) => r.id !== userId)) {
        throw new Error(`Username "@${cleanUsername}" is already taken.`);
      }
    }
    const [updated] = await db
      .update(users)
      .set({
        ...(updates.displayName !== undefined ? { displayName: updates.displayName } : {}),
        ...(cleanUsername !== undefined ? { username: cleanUsername } : {}),
        ...(updates.spectraUrl !== undefined ? { spectraUrl: updates.spectraUrl } : {}),
        ...(updates.driveFolderId !== undefined ? { driveFolderId: updates.driveFolderId } : {}),
        ...(updates.scheduleSheetId !== undefined ? { scheduleSheetId: updates.scheduleSheetId } : {}),
        ...(updates.viewPlanMode !== undefined ? { viewPlanMode: updates.viewPlanMode } : {}),
        updatedAt: new Date(),
      })
      .where(eq(users.id, userId))
      .returning();
    return updated;
  } catch (error) {
    if (!isDbUnavailableError(error)) {
      throw error instanceof Error ? error : new Error('Failed to update profile.', { cause: error });
    }
    const store = getLocalStore();
    const user = store.users.find((u) => u.id === userId);
    if (!user) throw new Error('User not found.');
    if (cleanUsername) {
      const clash = store.users.find(
        (u) => u.id !== userId && u.username.toLowerCase() === cleanUsername
      );
      if (clash) throw new Error(`Username "@${cleanUsername}" is already taken.`);
      user.username = cleanUsername;
    }
    if (updates.displayName !== undefined) user.displayName = updates.displayName;
    if (updates.spectraUrl !== undefined) user.spectraUrl = updates.spectraUrl;
    if (updates.driveFolderId !== undefined) user.driveFolderId = updates.driveFolderId;
    if (updates.scheduleSheetId !== undefined) user.scheduleSheetId = updates.scheduleSheetId;
    if (updates.viewPlanMode !== undefined) user.viewPlanMode = updates.viewPlanMode;
    user.updatedAt = new Date();
    persistLocalStore();
    return user;
  }
}

export async function updateUserPlan(userId: number, plan: 'basic' | 'pro') {
  const now = new Date();
  const proStartedAt = plan === 'pro' ? now.toISOString() : '';
  const proExpiresAt = plan === 'pro' ? addMonthsIso(now, 1) : '';
  try {
    const [updated] = await db
      .update(users)
      .set({ plan, proStartedAt, proExpiresAt, updatedAt: now })
      .where(eq(users.id, userId))
      .returning();
    return updated;
  } catch (error) {
    if (!isDbUnavailableError(error)) {
      throw new Error('Failed to update plan.', { cause: error });
    }
    const store = getLocalStore();
    const user = store.users.find((u) => u.id === userId);
    if (!user) throw new Error('User not found.');
    user.plan = plan;
    user.proStartedAt = proStartedAt;
    user.proExpiresAt = proExpiresAt;
    user.updatedAt = now;
    persistLocalStore();
    return user;
  }
}

export async function listToolUsers() {
  try {
    const rows = await db
      .select({
        id: users.id,
        shortUid: users.shortUid,
        email: users.email,
        displayName: users.displayName,
        username: users.username,
        plan: users.plan,
        role: users.role,
        contributorApproved: users.contributorApproved,
      })
      .from(users);
    return rows;
  } catch (error) {
    if (!isDbUnavailableError(error)) {
      throw new Error('Failed to load tool users.', { cause: error });
    }
    const store = getLocalStore();
    let changed = false;
    const taken = new Set(store.users.map((x) => x.shortUid).filter(Boolean));
    store.users.forEach((u) => {
      if (!u.shortUid || u.shortUid.length !== 5) {
        u.shortUid = generate5CharUid(taken);
        taken.add(u.shortUid);
        changed = true;
      }
    });
    if (changed) persistLocalStore();
    return store.users.map((u) => ({
      id: u.id,
      shortUid: u.shortUid,
      email: u.email,
      displayName: u.displayName,
      username: u.username,
      plan: u.plan,
      role: u.role,
      contributorApproved: u.contributorApproved,
    }));
  }
}

export async function listPublicCreditsContributors() {
  try {
    const rows = await db
      .select({
        id: users.id,
        displayName: users.displayName,
        username: users.username,
        shortUid: users.shortUid,
        plan: users.plan,
        role: users.role,
        contributorApproved: users.contributorApproved,
        photoUrl: users.photoUrl,
      })
      .from(users);
    return rows.filter((u) => u.role === 'contributor' && u.contributorApproved);
  } catch (error) {
    if (!isDbUnavailableError(error)) {
      throw new Error('Failed to load contributors list.', { cause: error });
    }
    return getLocalStore()
      .users.filter((u) => u.role === 'contributor' && u.contributorApproved)
      .map((u) => ({
        id: u.id,
        displayName: u.displayName,
        username: u.username,
        shortUid: u.shortUid,
        plan: u.plan,
        role: u.role,
        contributorApproved: u.contributorApproved,
        photoUrl: u.photoUrl,
      }));
  }
}

export async function awardPoints(
  userId: number,
  amount: number,
  reason: string,
  category: string
) {
  if (amount === 0) return null;
  try {
    const [u] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
    if (!u) return null;
    const nextPoints = Math.max(0, u.points + amount);
    const [updated] = await db
      .update(users)
      .set({ points: nextPoints, updatedAt: new Date() })
      .where(eq(users.id, userId))
      .returning();
    await db.insert(pointTransactions).values({
      userId,
      amount,
      reason,
      category,
    });
    return updated;
  } catch (error) {
    if (!isDbUnavailableError(error)) throw error;
    return localAwardPoints(userId, amount, reason, category) || null;
  }
}

export async function getPointTransactions(userId: number) {
  try {
    return await db
      .select()
      .from(pointTransactions)
      .where(eq(pointTransactions.userId, userId))
      .orderBy(desc(pointTransactions.createdAt));
  } catch (error) {
    if (!isDbUnavailableError(error)) throw error;
    return getLocalStore().pointTransactions.filter((t) => t.userId === userId);
  }
}

export async function purchaseProWithPoints(
  userId: number,
  term: 'monthly' | 'annual' = 'monthly'
) {
  const isAnnual = term === 'annual';
  const PRO_COST = isAnnual ? 5100 : 500; // Annual = 15% discount off 6,000 pts (12 * 500)
  const durationMonths = isAnnual ? 12 : 1;
  const termLabel = isAnnual
    ? 'Annual Pro Plan (12 Months — 15% Off)'
    : 'Monthly Pro Plan (1 Month)';
  const now = new Date();
  try {
    const [u] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
    if (!u) throw new Error('User not found.');
    if (u.points < PRO_COST) {
      throw new Error(
        `Insufficient points. Need ${PRO_COST.toLocaleString()} points (you have ${u.points.toLocaleString()}).`
      );
    }
    const baseStart =
      u.plan === 'pro' && u.proExpiresAt && new Date(u.proExpiresAt) > now
        ? new Date(u.proExpiresAt)
        : now;
    const proStartedAt = u.plan === 'pro' && u.proStartedAt ? u.proStartedAt : now.toISOString();
    const proExpiresAt = addMonthsIso(baseStart, durationMonths);

    const [updated] = await db
      .update(users)
      .set({
        points: u.points - PRO_COST,
        plan: 'pro',
        proStartedAt,
        proExpiresAt,
        lastExpiryReminderFor: '',
        updatedAt: now,
      })
      .where(eq(users.id, userId))
      .returning();

    await db.insert(pointTransactions).values({
      userId,
      amount: -PRO_COST,
      reason: `${termLabel} Activation (${PRO_COST} Points)`,
      category: 'pro_purchase',
    });
    await db.insert(userMessages).values({
      senderId: userId,
      recipientId: userId,
      senderEmail: ADMIN_OWNER_EMAIL,
      senderUsername: 'asan_billing',
      recipientEmail: u.email,
      recipientUsername: u.username,
      visibility: 'direct',
      isAdminMail: true,
      recipientSummary: `@${u.username}`,
      subject: `Pro Plan Purchase Confirmation — ${termLabel}`,
      body: `Hello ${u.displayName},\n\nThank you for upgrading to ASAN-Study_tool ${termLabel}.\n\nPoints Deducted: ${PRO_COST.toLocaleString()} pts\nActive Until: ${proExpiresAt.slice(0, 10)}\n\nNote: If you test Lower-Plan (Basic) preview mode in Subscriptions, your Pro tenure continues counting toward ${proExpiresAt.slice(0, 10)}.`,
    });
    await db.insert(notifications).values({
      userId,
      senderLabel: 'Subscriptions',
      title: `${isAnnual ? 'Annual' : 'Monthly'} Pro Activated`,
      message: `Pro active until ${proExpiresAt.slice(0, 10)} (${PRO_COST.toLocaleString()} pts). Confirmation sent to Tool Mail.`,
      type: 'subscription',
    });
    return updated;
  } catch (error) {
    if (!isDbUnavailableError(error)) {
      throw error instanceof Error ? error : new Error('Failed to activate Pro.');
    }
    const store = getLocalStore();
    const u = store.users.find((x) => x.id === userId);
    if (!u) throw new Error('User not found.');
    if (u.points < PRO_COST) {
      throw new Error(
        `Insufficient points. Need ${PRO_COST.toLocaleString()} points (you have ${u.points.toLocaleString()}).`
      );
    }
    const baseStart =
      u.plan === 'pro' && u.proExpiresAt && new Date(u.proExpiresAt) > now
        ? new Date(u.proExpiresAt)
        : now;
    const proStartedAt = u.plan === 'pro' && u.proStartedAt ? u.proStartedAt : now.toISOString();
    const proExpiresAt = addMonthsIso(baseStart, durationMonths);
    u.points -= PRO_COST;
    u.plan = 'pro';
    u.proStartedAt = proStartedAt;
    u.proExpiresAt = proExpiresAt;
    u.lastExpiryReminderFor = '';
    u.updatedAt = now;
    store.pointTransactions.unshift({
      id: nextSeq('pointTransactions'),
      userId,
      amount: -PRO_COST,
      reason: `${termLabel} Activation (${PRO_COST} Points)`,
      category: 'pro_purchase',
      createdAt: now,
    });
    localSendSystemMail({
      recipient: u,
      senderLabel: 'Subscriptions',
      subject: `Pro Plan Purchase Confirmation — ${termLabel}`,
      body: `Hello ${u.displayName},\n\nThank you for upgrading to ASAN-Study_tool ${termLabel}.\n\nPoints Deducted: ${PRO_COST.toLocaleString()} pts\nActive Until: ${proExpiresAt.slice(0, 10)}\n\nNote: Using Lower-Plan (Basic) preview mode does not pause your Pro tenure end date.`,
      notifTitle: `${isAnnual ? 'Annual' : 'Monthly'} Pro Activated`,
      notifMessage: `Pro active until ${proExpiresAt.slice(0, 10)} (${PRO_COST.toLocaleString()} pts). Confirmation sent to Tool Mail.`,
      notifType: 'subscription',
    });
    persistLocalStore();
    return u;
  }
}

export async function generateProLicenseKey(params: {
  issuedByUserId: number;
  targetEmailOrUsername?: string;
  chargePoints?: boolean;
  term?: 'monthly' | 'annual';
}) {
  const isAnnual = params.term === 'annual';
  const durationMonths = isAnnual ? 12 : 1;
  const PRO_KEY_COST = isAnnual ? 5100 : 500;
  const now = new Date();
  const activationExpiresAt = addYearsIso(now, 1);

  try {
    const [issuer] = await db
      .select()
      .from(users)
      .where(eq(users.id, params.issuedByUserId))
      .limit(1);
    if (!issuer) throw new Error('Account not found.');

    if (params.chargePoints && issuer.points < PRO_KEY_COST) {
      throw new Error(
        `Insufficient points. Need ${PRO_KEY_COST.toLocaleString()} points to purchase a ${
          isAnnual ? 'Annual' : 'Monthly'
        } Pro License Key.`
      );
    }

    let target = issuer;
    if (params.targetEmailOrUsername && params.targetEmailOrUsername.trim()) {
      const raw = params.targetEmailOrUsername.trim();
      const q = raw.toLowerCase().replace(/^@/, '');
      const all = await db.select().from(users);
      const found = all.find(
        (u) =>
          u.email.toLowerCase() === q ||
          u.username.toLowerCase() === q ||
          (u.shortUid && u.shortUid.toUpperCase() === raw.toUpperCase())
      );
      if (!found) {
        throw new Error(`Registered user "${params.targetEmailOrUsername}" not found.`);
      }
      target = found;
    }

    if (params.chargePoints) {
      await db
        .update(users)
        .set({ points: issuer.points - PRO_KEY_COST, updatedAt: now })
        .where(eq(users.id, issuer.id));
      await db.insert(pointTransactions).values({
        userId: issuer.id,
        amount: -PRO_KEY_COST,
        reason: `Purchased 8-char ${isAnnual ? 'Annual (15% off)' : 'Monthly'} Pro License Key for ${target.email}`,
        category: 'pro_key_purchase',
      });
    }

    const keyCode = generate8CharKey();
    const [createdKey] = await db
      .insert(licenseKeys)
      .values({
        keyCode,
        keyType: 'pro',
        durationMonths,
        issuedToUserId: target.id,
        issuedToEmail: target.email,
        issuedByUserId: issuer.id,
        activationExpiresAt,
        status: 'unused',
      })
      .returning();

    await db.insert(userMessages).values({
      senderId: issuer.id,
      recipientId: target.id,
      senderEmail: issuer.email,
      senderUsername: issuer.username,
      recipientEmail: target.email,
      recipientUsername: target.username,
      visibility: 'direct',
      isAdminMail: issuer.role === 'admin',
      recipientSummary: target.username || target.email,
      subject: `Your ASAN-Study_tool 8-Character Pro License Key (${keyCode})`,
      body: `Pro License Key: ${keyCode}\nPlan Term: ${
        isAnnual ? 'Annual Pro (12 months, 15% discount)' : 'Monthly Pro (1 month)'
      }\nActivation Valid Until: ${activationExpiresAt.slice(0, 10)} (1 year)\n\nEnter this key in Subscriptions -> Activate License Key.`,
    });

    await db.insert(notifications).values({
      userId: target.id,
      senderId: issuer.id,
      senderLabel: issuer.role === 'admin' ? 'Admin Licensing' : 'Subscriptions',
      title: `Pro License Key Sent (${keyCode})`,
      message: `Check Tool Mail for your 8-character ${
        isAnnual ? 'Annual' : 'Monthly'
      } Pro key ${keyCode}.`,
      type: 'license',
    });

    return { key: createdKey, recipientEmail: target.email };
  } catch (error) {
    if (!isDbUnavailableError(error)) {
      throw error instanceof Error ? error : new Error('Failed to generate license key.');
    }
    const store = getLocalStore();
    const issuer = store.users.find((u) => u.id === params.issuedByUserId);
    if (!issuer) throw new Error('Account not found.');
    if (params.chargePoints && issuer.points < PRO_KEY_COST) {
      throw new Error(
        `Insufficient points. Need ${PRO_KEY_COST.toLocaleString()} points to purchase a ${
          isAnnual ? 'Annual' : 'Monthly'
        } Pro License Key.`
      );
    }

    let target = issuer;
    if (params.targetEmailOrUsername && params.targetEmailOrUsername.trim()) {
      const raw = params.targetEmailOrUsername.trim();
      const q = raw.toLowerCase().replace(/^@/, '');
      const found = store.users.find(
        (u) =>
          u.email.toLowerCase() === q ||
          u.username.toLowerCase() === q ||
          (u.shortUid && u.shortUid.toUpperCase() === raw.toUpperCase())
      );
      if (!found) {
        throw new Error(`Registered user "${params.targetEmailOrUsername}" not found.`);
      }
      target = found;
    }

    if (params.chargePoints) {
      localAwardPoints(
        issuer.id,
        -PRO_KEY_COST,
        `Purchased 8-char ${isAnnual ? 'Annual (15% off)' : 'Monthly'} Pro License Key for ${target.email}`,
        'pro_key_purchase'
      );
    }

    const createdKey = localIssueProKeyForUser({
      targetUser: target,
      issuedByUserId: issuer.id,
      subject: `Your ASAN-Study_tool 8-Character Pro License Key (@${target.username})`,
      introText: `Your ASAN-Study_tool ${
        isAnnual ? 'Annual (12 months, 15% discount)' : 'Monthly (1 month)'
      } Pro License Key has been generated.`,
      durationMonths,
      isAdminMail: issuer.role === 'admin',
    });
    return { key: createdKey, recipientEmail: target.email };
  }
}

export async function redeemLicenseKey(userId: number, rawKeyCode: string) {
  const keyCode = rawKeyCode.trim().toUpperCase();
  if (keyCode.length !== 8) {
    throw new Error('License keys must be exactly 8 characters.');
  }
  const now = new Date();

  try {
    const [u] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
    if (!u) throw new Error('User not found.');

    if (keyCode === CONSTANT_ADMIN_LICENSE_KEY) {
      if (!u.adminAuthorized && u.email.toLowerCase() !== ADMIN_OWNER_EMAIL) {
        throw new Error(
          'Admin access is strictly hand-selected by the workspace owner. Public Admin claims are disabled.'
        );
      }
      const [updated] = await db
        .update(users)
        .set({ role: 'admin', adminAuthorized: true, updatedAt: now })
        .where(eq(users.id, userId))
        .returning();
      const refreshed = await getOrCreateUser(updated.uid, updated.email, updated.displayName, updated.photoUrl);
      return { user: refreshed, kind: 'admin' as const, message: 'Admin responsibility activated.' };
    }

    const [keyRow] = await db
      .select()
      .from(licenseKeys)
      .where(eq(licenseKeys.keyCode, keyCode))
      .limit(1);
    if (!keyRow) throw new Error('Invalid 8-character license key.');
    if (keyRow.status !== 'unused') throw new Error(`This license key is already ${keyRow.status}.`);
    if (new Date(keyRow.activationExpiresAt).getTime() < now.getTime()) {
      await db.update(licenseKeys).set({ status: 'expired' }).where(eq(licenseKeys.id, keyRow.id));
      throw new Error('This license key expired before activation (1-year activation window ended).');
    }

    const months = keyRow.durationMonths === 12 ? 12 : 1;
    const baseStart =
      u.plan === 'pro' && u.proExpiresAt && new Date(u.proExpiresAt) > now
        ? new Date(u.proExpiresAt)
        : now;
    const subStartsAt = u.plan === 'pro' && u.proStartedAt ? u.proStartedAt : now.toISOString();
    const subEndsAt = addMonthsIso(baseStart, months);

    await db
      .update(licenseKeys)
      .set({
        status: 'active',
        activatedByUserId: userId,
        activatedAt: now.toISOString(),
        subStartsAt,
        subEndsAt,
      })
      .where(eq(licenseKeys.id, keyRow.id));

    const [updated] = await db
      .update(users)
      .set({
        plan: 'pro',
        viewPlanMode: 'auto',
        proStartedAt: subStartsAt,
        proExpiresAt: subEndsAt,
        lastExpiryReminderFor: '',
        updatedAt: now,
      })
      .where(eq(users.id, userId))
      .returning();

    await db.insert(userMessages).values({
      senderId: userId,
      recipientId: userId,
      senderEmail: ADMIN_OWNER_EMAIL,
      senderUsername: 'asan_billing',
      recipientEmail: u.email,
      recipientUsername: u.username,
      visibility: 'direct',
      isAdminMail: true,
      recipientSummary: `@${u.username}`,
      subject: `Pro License Activated (${keyCode})`,
      body: `Your 8-character Pro License Key ${keyCode} (${
        months === 12 ? 'Annual 12-month term' : 'Monthly 1-month term'
      }) is active until ${subEndsAt.slice(0, 10)}.`,
    });
    await db.insert(notifications).values({
      userId,
      senderLabel: 'Subscriptions',
      title: `License ${keyCode} Activated`,
      message: `Pro Plan active from ${subStartsAt.slice(0, 10)} to ${subEndsAt.slice(0, 10)}.`,
      type: 'subscription',
    });

    return {
      user: updated,
      kind: 'pro' as const,
      message: `Pro plan activated until ${subEndsAt.slice(0, 10)}.`,
    };
  } catch (error) {
    if (!isDbUnavailableError(error)) {
      throw error instanceof Error ? error : new Error('Failed to redeem key.');
    }
    const store = getLocalStore();
    const u = store.users.find((x) => x.id === userId);
    if (!u) throw new Error('User not found.');

    if (keyCode === CONSTANT_ADMIN_LICENSE_KEY) {
      if (!u.adminAuthorized && u.email.toLowerCase() !== ADMIN_OWNER_EMAIL) {
        throw new Error(
          'Admin access is strictly hand-selected by the workspace owner. Public Admin claims are disabled.'
        );
      }
      u.role = 'admin';
      u.adminAuthorized = true;
      u.updatedAt = now;
      persistLocalStore();
      const refreshed = localMaintainLifecycle(u);
      return { user: refreshed, kind: 'admin' as const, message: 'Admin responsibility activated.' };
    }

    const keyRow = store.licenseKeys.find((k) => k.keyCode === keyCode);
    if (!keyRow) throw new Error('Invalid 8-character license key.');
    if (keyRow.status !== 'unused') throw new Error(`This license key is already ${keyRow.status}.`);
    if (new Date(keyRow.activationExpiresAt).getTime() < now.getTime()) {
      keyRow.status = 'expired';
      persistLocalStore();
      throw new Error('This license key expired before activation (1-year activation window ended).');
    }

    const months = keyRow.durationMonths === 12 ? 12 : 1;
    const baseStart =
      u.plan === 'pro' && u.proExpiresAt && new Date(u.proExpiresAt) > now
        ? new Date(u.proExpiresAt)
        : now;
    const subStartsAt = u.plan === 'pro' && u.proStartedAt ? u.proStartedAt : now.toISOString();
    const subEndsAt = addMonthsIso(baseStart, months);

    keyRow.status = 'active';
    keyRow.activatedByUserId = userId;
    keyRow.activatedAt = now.toISOString();
    keyRow.subStartsAt = subStartsAt;
    keyRow.subEndsAt = subEndsAt;

    u.plan = 'pro';
    u.viewPlanMode = 'auto';
    u.proStartedAt = subStartsAt;
    u.proExpiresAt = subEndsAt;
    u.lastExpiryReminderFor = '';
    u.updatedAt = now;

    localSendSystemMail({
      recipient: u,
      senderLabel: 'Subscriptions',
      subject: `Pro License Activated (${keyCode})`,
      body: `Your 8-character Pro License Key ${keyCode} (${
        months === 12 ? 'Annual 12-month term' : 'Monthly 1-month term'
      }) is active until ${subEndsAt.slice(0, 10)}.`,
      notifTitle: `License ${keyCode} Activated`,
      notifMessage: `Pro Plan active from ${subStartsAt.slice(0, 10)} to ${subEndsAt.slice(0, 10)}.`,
      notifType: 'subscription',
    });
    persistLocalStore();

    return {
      user: u,
      kind: 'pro' as const,
      message: `Pro plan activated until ${subEndsAt.slice(0, 10)}.`,
    };
  }
}

export async function getUserLicenseKeys(userId: number, email: string) {
  try {
    return await db
      .select()
      .from(licenseKeys)
      .where(
        or(
          eq(licenseKeys.issuedToUserId, userId),
          eq(licenseKeys.activatedByUserId, userId),
          eq(licenseKeys.issuedByUserId, userId),
          eq(licenseKeys.issuedToEmail, email)
        )
      )
      .orderBy(desc(licenseKeys.createdAt));
  } catch (error) {
    if (!isDbUnavailableError(error)) throw error;
    return getLocalStore().licenseKeys.filter(
      (k) =>
        k.issuedToUserId === userId ||
        k.activatedByUserId === userId ||
        k.issuedByUserId === userId ||
        k.issuedToEmail.toLowerCase() === email.toLowerCase()
    );
  }
}

export async function requestContributorRole(userId: number) {
  try {
    const [updated] = await db
      .update(users)
      .set({ contributorRequested: true, updatedAt: new Date() })
      .where(eq(users.id, userId))
      .returning();
    return updated;
  } catch (error) {
    if (!isDbUnavailableError(error)) throw error;
    const store = getLocalStore();
    const u = store.users.find((x) => x.id === userId);
    if (!u) throw new Error('User not found.');
    u.contributorRequested = true;
    u.updatedAt = new Date();
    persistLocalStore();
    return u;
  }
}

export async function setContributorStatus(
  targetUserId: number,
  opts: { approve: boolean; role?: 'user' | 'contributor' }
) {
  const nextRole = opts.role || (opts.approve ? 'contributor' : 'user');
  try {
    const [updated] = await db
      .update(users)
      .set({
        role: nextRole,
        contributorApproved: opts.approve,
        contributorRequested: false,
        updatedAt: new Date(),
      })
      .where(eq(users.id, targetUserId))
      .returning();
    if (updated) {
      await db.insert(userMessages).values({
        senderId: targetUserId,
        recipientId: targetUserId,
        senderEmail: ADMIN_OWNER_EMAIL,
        senderUsername: 'asan_admin',
        recipientEmail: updated.email,
        recipientUsername: updated.username,
        visibility: 'direct',
        isAdminMail: true,
        recipientSummary: `@${updated.username}`,
        subject: opts.approve
          ? 'Contributor Tag Approved — Welcome to ASAN Contributors!'
          : 'Contributor Tag Paused by Admin',
        body: opts.approve
          ? `Hello ${updated.displayName},\n\nAn ASAN-Study_tool Admin has approved your Contributor tag.\nYou now receive:\n- Access to Study Material Notes repository (up to 500 MB per upload)\n- Weekly +120 points every Sunday while approved\n- Red contributor ring highlight & public Contributors credit.`
          : `Hello ${updated.displayName},\n\nYour Contributor status has been paused by an Admin. Your uploaded materials remain safe.`,
      });
      await db.insert(notifications).values({
        userId: targetUserId,
        senderLabel: 'Admin Oversight',
        title: opts.approve
          ? 'Contributor Access Approved (+120 pts/week)'
          : 'Contributor Status Updated',
        message: opts.approve
          ? 'Confirmation sent to Tool Mail. You now receive 120 pts every Sunday while approved.'
          : 'Your contributor stipend or access has been paused by an Admin.',
        type: 'contributor',
      });
    }
    return updated;
  } catch (error) {
    if (!isDbUnavailableError(error)) throw error;
    const store = getLocalStore();
    const u = store.users.find((x) => x.id === targetUserId);
    if (!u) throw new Error('User not found.');
    if (u.role !== 'admin') {
      u.role = nextRole;
    }
    u.contributorApproved = opts.approve;
    u.contributorRequested = false;
    u.updatedAt = new Date();
    localSendSystemMail({
      recipient: u,
      senderLabel: 'Admin Oversight',
      subject: opts.approve
        ? 'Contributor Tag Approved — Welcome to ASAN Contributors!'
        : 'Contributor Tag Paused by Admin',
      body: opts.approve
        ? `Hello ${u.displayName},\n\nAn ASAN-Study_tool Admin has approved your Contributor tag.\nYou now receive:\n- Access to Study Material Notes repository\n- Weekly +120 points every Sunday while approved\n- Red contributor glow & public Contributors credit.`
        : `Hello ${u.displayName},\n\nYour Contributor status has been paused by an Admin.`,
      notifTitle: opts.approve
        ? 'Contributor Access Approved (+120 pts/week)'
        : 'Contributor Status Updated',
      notifMessage: opts.approve
        ? 'Confirmation sent to Tool Mail. You now receive 120 pts every Sunday while approved.'
        : 'Your contributor stipend or access has been paused by an Admin.',
      notifType: 'contributor',
    });
    persistLocalStore();
    return u;
  }
}

export async function authorizeAdminEmail(targetEmail: string, authorize: boolean) {
  const clean = targetEmail.trim().toLowerCase();
  try {
    const all = await db.select().from(users);
    const target = all.find(
      (u) =>
        u.email.toLowerCase() === clean ||
        u.username.toLowerCase() === clean.replace(/^@/, '') ||
        (u.shortUid && u.shortUid.toUpperCase() === clean.toUpperCase())
    );
    if (!target) throw new Error(`No registered account found for ${targetEmail}.`);
    const [updated] = await db
      .update(users)
      .set({
        adminAuthorized: authorize,
        role: authorize ? 'admin' : 'user',
        updatedAt: new Date(),
      })
      .where(eq(users.id, target.id))
      .returning();

    await db.insert(userMessages).values({
      senderId: updated.id,
      recipientId: updated.id,
      senderEmail: ADMIN_OWNER_EMAIL,
      senderUsername: 'asan_admin',
      recipientEmail: updated.email,
      recipientUsername: updated.username,
      visibility: 'direct',
      isAdminMail: true,
      recipientSummary: `@${updated.username}`,
      subject: authorize
        ? 'Admin Tag Authorized — ASAN-Study_tool Administration'
        : 'Admin Tag Revoked',
      body: authorize
        ? `Hello ${updated.displayName},\n\nYou have been hand-selected and authorized as an ASAN-Study_tool Admin.\nBenefits & Duties:\n- Constant Admin License Key access\n- Server Storage (5 GB) & Member Directory oversight\n- +150 points every Sunday + complimentary 8-char Pro key.`
        : `Hello ${updated.displayName},\n\nYour Admin tag has been revoked by the workspace owner.`,
    });
    await db.insert(notifications).values({
      userId: updated.id,
      senderLabel: 'Admin Oversight',
      title: authorize ? 'Admin Tag Authorized' : 'Admin Tag Revoked',
      message: authorize
        ? 'Admin responsibility confirmation sent to Tool Mail.'
        : 'Admin access removed for your account.',
      type: 'admin',
    });

    return await getOrCreateUser(updated.uid, updated.email, updated.displayName, updated.photoUrl);
  } catch (error) {
    if (!isDbUnavailableError(error)) {
      throw error instanceof Error ? error : new Error('Failed to authorize admin.');
    }
    const store = getLocalStore();
    const target = store.users.find(
      (u) =>
        u.email.toLowerCase() === clean ||
        u.username.toLowerCase() === clean.replace(/^@/, '') ||
        (u.shortUid && u.shortUid.toUpperCase() === clean.toUpperCase())
    );
    if (!target) throw new Error(`No registered account found for ${targetEmail}.`);
    target.adminAuthorized = authorize;
    target.role = authorize ? 'admin' : 'user';
    target.updatedAt = new Date();
    localSendSystemMail({
      recipient: target,
      senderLabel: 'Admin Oversight',
      subject: authorize
        ? 'Admin Tag Authorized — ASAN-Study_tool Administration'
        : 'Admin Tag Revoked',
      body: authorize
        ? `Hello ${target.displayName},\n\nYou have been authorized as an ASAN-Study_tool Admin with +150 pts/week every Sunday and Admin Console access.`
        : `Hello ${target.displayName},\n\nYour Admin tag has been revoked by the workspace owner.`,
      notifTitle: authorize ? 'Admin Tag Authorized' : 'Admin Tag Revoked',
      notifMessage: authorize
        ? 'Admin responsibility confirmation sent to Tool Mail.'
        : 'Admin access removed for your account.',
      notifType: 'admin',
    });
    persistLocalStore();
    return localMaintainLifecycle(target);
  }
}

export async function listAllUsersForAdmin() {
  try {
    return await db.select().from(users).orderBy(desc(users.createdAt));
  } catch (error) {
    if (!isDbUnavailableError(error)) throw error;
    const store = getLocalStore();
    const taken = new Set(store.users.map((x) => x.shortUid).filter(Boolean));
    let changed = false;
    store.users.forEach((u) => {
      if (!u.shortUid || u.shortUid.length !== 5) {
        u.shortUid = generate5CharUid(taken);
        taken.add(u.shortUid);
        changed = true;
      }
    });
    if (changed) persistLocalStore();
    return [...store.users].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  }
}
