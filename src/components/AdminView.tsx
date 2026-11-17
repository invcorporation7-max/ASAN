import React, { useCallback, useEffect, useState } from 'react';
import {
  BarChart3,
  Check,
  CloudUpload,
  ExternalLink,
  HardDrive,
  KeyRound,
  Mail,
  ShieldCheck,
  Trash2,
  UserCheck,
  UserX,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import {
  apiFetch,
  apiUrl,
  buildGmailLicenseComposeUrl,
  ensureNamedDriveFolder,
  uploadFileToDriveFolder,
} from '../lib/api';
import type {
  DbUser,
  LicenseKeyItem,
  MaterialPurchaseItem,
  StudyMaterialItem,
} from '../types';
import { ConfirmDialog } from './ConfirmDialog';
import { UserAvatarBadge } from './UserAvatarBadge';

interface AdminOverviewResponse {
  constantAdminKey: string;
  storage: {
    usedBytes: number;
    quotaBytes: number;
    fileCount: number;
    driveMirrorFolder: string;
  };
  analytics: {
    totalUsers: number;
    basicUsers: number;
    proUsers: number;
    adminUsers: number;
    approvedContributors: number;
    pendingContributorRequests: number;
    totalTasks: number;
    totalNoteDocs: number;
    totalMessages: number;
    totalPointsCirculating: number;
    totalPointsAwarded: number;
    activeProKeys: number;
    unusedProKeys: number;
    totalMaterialPurchases: number;
    totalMaterialRevenuePts: number;
  };
  users: DbUser[];
  materials: StudyMaterialItem[];
  materialPurchases: MaterialPurchaseItem[];
  licenseKeys: LicenseKeyItem[];
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

export const AdminView: React.FC = () => {
  const { dbUser, workspaceToken, connectBasicDrive, refreshProfile } = useAuth();
  const [data, setData] = useState<AdminOverviewResponse | null>(null);
  const [loading, setLoading] = useState(true);

  // Admin forms
  const [keyRecipient, setKeyRecipient] = useState('');
  const [keyTerm, setKeyTerm] = useState<'monthly' | 'annual'>('monthly');
  const [generatedKeyInfo, setGeneratedKeyInfo] = useState<{
    keyCode: string;
    recipientEmail: string;
    activationExpiresAt: string;
  } | null>(null);
  const [adminEmailInput, setAdminEmailInput] = useState('');
  const [adminMailTarget, setAdminMailTarget] = useState('');
  const [adminMailSubject, setAdminMailSubject] = useState('');
  const [adminMailBody, setAdminMailBody] = useState('');

  const [busy, setBusy] = useState(false);
  const [statusMsg, setStatusMsg] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [deleteMaterialTarget, setDeleteMaterialTarget] = useState<StudyMaterialItem | null>(null);

  const loadOverview = useCallback(async () => {
    setLoading(true);
    try {
      const res = await apiFetch<AdminOverviewResponse>('/api/admin/overview');
      setData(res);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Failed to load admin overview');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadOverview();
  }, [loadOverview]);

  if (dbUser?.role !== 'admin') {
    return (
      <div className="mx-auto max-w-xl py-10">
        <div className="rounded-xl border border-slate-200 bg-white p-8 text-center space-y-2">
          <ShieldCheck className="mx-auto h-6 w-6 text-slate-400" />
          <h1 className="font-display text-lg font-bold text-slate-900">
            Admin Responsibility Restricted
          </h1>
          <p className="text-xs text-slate-500">
            Admin is an extra responsibility assigned strictly to hand-selected users by the workspace owner. There is no public option to claim Admin.
          </p>
        </div>
      </div>
    );
  }

  const handleGenerateProKey = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setErrorMsg(null);
    setStatusMsg(null);
    try {
      const res = await apiFetch<{ key: LicenseKeyItem; recipientEmail: string }>(
        '/api/admin/generate-key',
        {
          method: 'POST',
          body: JSON.stringify({
            recipientEmail: keyRecipient.trim() || dbUser.email,
            term: keyTerm,
          }),
        }
      );
      setGeneratedKeyInfo({
        keyCode: res.key.keyCode,
        recipientEmail: res.recipientEmail,
        activationExpiresAt: res.key.activationExpiresAt,
      });
      setKeyRecipient('');
      setStatusMsg(
        `Generated ${keyTerm === 'annual' ? 'Annual (12m)' : 'Monthly (1m)'} Pro Key ${
          res.key.keyCode
        } and delivered to ${res.recipientEmail} via Admin Tool Mail.`
      );
      await loadOverview();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Key generation failed');
    } finally {
      setBusy(false);
    }
  };

  const handleAuthorizeAdmin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!adminEmailInput.trim()) return;
    setBusy(true);
    setErrorMsg(null);
    setStatusMsg(null);
    try {
      await apiFetch('/api/admin/authorize-admin', {
        method: 'POST',
        body: JSON.stringify({ email: adminEmailInput.trim(), authorize: true }),
      });
      setStatusMsg(`Hand-selected ${adminEmailInput.trim()} as Workspace Admin.`);
      setAdminEmailInput('');
      await Promise.all([loadOverview(), refreshProfile()]);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Failed to authorize admin');
    } finally {
      setBusy(false);
    }
  };

  const handleToggleContributor = async (userId: number, approve: boolean) => {
    setBusy(true);
    setErrorMsg(null);
    try {
      await apiFetch('/api/admin/contributors', {
        method: 'POST',
        body: JSON.stringify({ userId, approve }),
      });
      setStatusMsg(
        approve
          ? 'Approved Contributor access (+120 points/week starting Sunday).'
          : 'Paused Contributor access & weekly stipend.'
      );
      await loadOverview();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Failed to update contributor');
    } finally {
      setBusy(false);
    }
  };

  const handleSendAdminMail = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setErrorMsg(null);
    setStatusMsg(null);
    try {
      const target = adminMailTarget.trim();
      const isPublic = !target || target.toLowerCase() === 'all';
      await apiFetch('/api/messages', {
        method: 'POST',
        body: JSON.stringify({
          recipients: isPublic ? [] : target.split(',').map((s) => s.trim()),
          visibility: isPublic ? 'public' : 'direct',
          isAdminMail: true,
          subject: adminMailSubject.trim(),
          body: adminMailBody.trim(),
        }),
      });
      setAdminMailTarget('');
      setAdminMailSubject('');
      setAdminMailBody('');
      setStatusMsg(
        isPublic
          ? 'Admin Mail broadcast published to all users.'
          : `Admin Mail delivered to ${target}.`
      );
      await loadOverview();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Failed to send Admin Mail');
    } finally {
      setBusy(false);
    }
  };

  const handleSyncToAsanUserContent = async (item: StudyMaterialItem) => {
    setErrorMsg(null);
    setStatusMsg(null);
    try {
      if (!workspaceToken) {
        const tok = await connectBasicDrive();
        if (!tok) return;
      }
      const folder = await ensureNamedDriveFolder('ASAN-user-content');
      const idToken = await (await import('../lib/firebase')).auth.currentUser?.getIdToken();
      const res = await fetch(apiUrl(`/api/study-materials/${item.id}/download`), {
        headers: { Authorization: `Bearer ${idToken}` },
      });
      if (!res.ok) throw new Error('Unable to read stored file');
      const blob = await res.blob();
      const driveFile = new File([blob], item.fileName, { type: item.mimeType });
      const uploaded = await uploadFileToDriveFolder(driveFile, folder.id);
      await apiFetch(`/api/study-materials/${item.id}/drive`, {
        method: 'PATCH',
        body: JSON.stringify({
          driveFileId: uploaded.id,
          driveWebLink: uploaded.webViewLink || '',
        }),
      });
      setStatusMsg(`Mirrored "${item.fileName}" into Drive folder ASAN-user-content.`);
      await loadOverview();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Failed to mirror file to Drive');
    }
  };

  const handleConfirmDeleteMaterial = async () => {
    if (!deleteMaterialTarget) return;
    setBusy(true);
    try {
      await apiFetch(`/api/study-materials/${deleteMaterialTarget.id}`, { method: 'DELETE' });
      setStatusMsg(`Deleted material "${deleteMaterialTarget.title}".`);
      setDeleteMaterialTarget(null);
      await loadOverview();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Failed to delete material');
    } finally {
      setBusy(false);
    }
  };

  const usedPct = data
    ? Math.min(100, Math.round((data.storage.usedBytes / data.storage.quotaBytes) * 100))
    : 0;

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="font-display text-2xl font-bold text-slate-900">
            Admin Console · Storage, Analytics &amp; Oversight
          </h1>
          <p className="mt-0.5 text-xs text-slate-500">
            Admin is an extra responsibility (+150 pts/week from Sunday &amp; free Pro key gift on first login). Admins can hold Basic or Pro plans themselves.
          </p>
        </div>

        {data && (
          <div className="rounded-lg border border-slate-200 bg-white px-3.5 py-2 text-xs">
            <span className="text-slate-500">Constant Admin Key: </span>
            <strong className="font-mono text-slate-900 tracking-wider">
              {data.constantAdminKey}
            </strong>
          </div>
        )}
      </div>

      {statusMsg && (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-2.5 text-xs text-emerald-800">
          {statusMsg}
        </div>
      )}
      {errorMsg && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-2.5 text-xs text-red-700">
          {errorMsg}
        </div>
      )}

      {loading || !data ? (
        <div className="py-12 text-center text-xs text-slate-500">
          Loading Admin analytics &amp; server storage metrics...
        </div>
      ) : (
        <>
          {/* Storage & Analytics Metrics Strip */}
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            <div className="rounded-xl border border-slate-200 bg-white p-5 space-y-2">
              <div className="flex items-center justify-between text-xs font-medium text-slate-500">
                <span>Server Storage Pool</span>
                <HardDrive className="h-4 w-4 text-blue-600" />
              </div>
              <div className="font-display text-xl font-bold text-slate-900 tabular-nums">
                {formatBytes(data.storage.usedBytes)} / 5.00 GB
              </div>
              <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-100">
                <div
                  className="h-full bg-blue-600"
                  style={{ width: `${Math.max(2, usedPct)}%` }}
                />
              </div>
              <div className="text-[11px] text-slate-500 tabular-nums">
                {data.storage.fileCount} files · Mirror: {data.storage.driveMirrorFolder}
              </div>
            </div>

            <div className="rounded-xl border border-slate-200 bg-white p-5">
              <div className="flex items-center justify-between text-xs font-medium text-slate-500">
                <span>Registered Users</span>
                <BarChart3 className="h-4 w-4 text-emerald-600" />
              </div>
              <div className="mt-2 font-display text-2xl font-bold text-slate-900 tabular-nums">
                {data.analytics.totalUsers}
              </div>
              <div className="mt-1 text-xs text-slate-500 tabular-nums">
                {data.analytics.proUsers} Pro · {data.analytics.basicUsers} Basic ·{' '}
                {data.analytics.adminUsers} Admin
              </div>
            </div>

            <div className="rounded-xl border border-slate-200 bg-white p-5">
              <div className="text-xs font-medium text-slate-500">Contributors &amp; Requests</div>
              <div className="mt-2 font-display text-2xl font-bold text-slate-900 tabular-nums">
                {data.analytics.approvedContributors}
              </div>
              <div className="mt-1 text-xs text-slate-500 tabular-nums">
                {data.analytics.pendingContributorRequests} pending approval
              </div>
            </div>

            <div className="rounded-xl border border-slate-200 bg-white p-5">
              <div className="text-xs font-medium text-slate-500">Workspace Activity</div>
              <div className="mt-2 font-display text-2xl font-bold text-slate-900 tabular-nums">
                {data.analytics.totalPointsCirculating} pts
              </div>
              <div className="mt-1 text-xs text-slate-500 tabular-nums">
                {data.analytics.totalNoteDocs} notes · {data.analytics.totalTasks} tasks ·{' '}
                {data.analytics.activeProKeys} active keys
              </div>
            </div>
          </div>

          {/* Admin Actions: Pro Key Generator, Hand-Select Admin, Admin Mail */}
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
            {/* Issue Pro Key */}
            <form
              onSubmit={handleGenerateProKey}
              className="rounded-xl border border-slate-200 bg-white p-6 space-y-3"
            >
              <div className="flex items-center gap-2 text-sm font-semibold text-slate-900">
                <KeyRound className="h-4 w-4 text-blue-600" />
                Generate Expirable 8-Char Pro Key
              </div>
              <p className="text-xs text-slate-500">
                Valid 1 year to activate, grants 1 month or 12 months Pro from activation. Delivered automatically to Tool Mail.
              </p>
              <div className="flex items-center gap-1 rounded-lg bg-slate-100 p-1 text-xs">
                <button
                  type="button"
                  onClick={() => setKeyTerm('monthly')}
                  className={`flex-1 rounded py-1 font-medium ${
                    keyTerm === 'monthly' ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-600'
                  }`}
                >
                  Monthly (1m)
                </button>
                <button
                  type="button"
                  onClick={() => setKeyTerm('annual')}
                  className={`flex-1 rounded py-1 font-medium ${
                    keyTerm === 'annual' ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-600'
                  }`}
                >
                  Annual (12m)
                </button>
              </div>
              <input
                type="text"
                value={keyRecipient}
                onChange={(e) => setKeyRecipient(e.target.value)}
                placeholder="@username, 5-char UID (e.g. K7P9M), or email"
                className="w-full rounded-lg border border-slate-200 px-3 py-2 text-xs focus:border-blue-500 focus:outline-none"
              />
              <button
                type="submit"
                disabled={busy}
                className="w-full rounded-lg bg-blue-600 py-2 text-xs font-semibold text-white hover:bg-blue-700"
              >
                Generate &amp; Send {keyTerm === 'annual' ? 'Annual' : 'Monthly'} Pro Key
              </button>

              {generatedKeyInfo && (
                <div className="rounded-lg border border-blue-200 bg-blue-50 p-3 text-xs space-y-1.5">
                  <div className="font-mono font-bold text-blue-900">
                    {generatedKeyInfo.keyCode}
                  </div>
                  <a
                    href={buildGmailLicenseComposeUrl(generatedKeyInfo)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 font-medium text-blue-700 hover:underline"
                  >
                    Open in Gmail Mailbox
                    <ExternalLink className="h-3 w-3" />
                  </a>
                </div>
              )}
            </form>

            {/* Hand-Select Admin */}
            <form
              onSubmit={handleAuthorizeAdmin}
              className="rounded-xl border border-slate-200 bg-white p-6 space-y-3"
            >
              <div className="flex items-center gap-2 text-sm font-semibold text-slate-900">
                <ShieldCheck className="h-4 w-4 text-amber-600" />
                Hand-Select Workspace Admin
              </div>
              <p className="text-xs text-slate-500">
                Only hand-selected accounts can hold Admin responsibility or use constant Admin key <code className="font-mono">{data.constantAdminKey}</code>. Email confirmation sent automatically.
              </p>
              <input
                type="text"
                required
                value={adminEmailInput}
                onChange={(e) => setAdminEmailInput(e.target.value)}
                placeholder="email, @username, or 5-char UID"
                className="w-full rounded-lg border border-slate-200 px-3 py-2 text-xs focus:border-blue-500 focus:outline-none"
              />
              <button
                type="submit"
                disabled={busy}
                className="w-full rounded-lg border border-slate-300 bg-slate-900 py-2 text-xs font-semibold text-white hover:bg-slate-800"
              >
                Authorize Admin Responsibility
              </button>
            </form>

            {/* Quick Admin Mail */}
            <form
              onSubmit={handleSendAdminMail}
              className="rounded-xl border border-slate-200 bg-white p-6 space-y-3"
            >
              <div className="flex items-center gap-2 text-sm font-semibold text-slate-900">
                <Mail className="h-4 w-4 text-blue-600" />
                Send Official Admin Mail
              </div>
              <input
                type="text"
                value={adminMailTarget}
                onChange={(e) => setAdminMailTarget(e.target.value)}
                placeholder='@username, 5-char UID, or "all" for broadcast'
                className="w-full rounded-lg border border-slate-200 px-3 py-2 text-xs focus:border-blue-500 focus:outline-none"
              />
              <input
                type="text"
                required
                value={adminMailSubject}
                onChange={(e) => setAdminMailSubject(e.target.value)}
                placeholder="Subject"
                className="w-full rounded-lg border border-slate-200 px-3 py-2 text-xs focus:border-blue-500 focus:outline-none"
              />
              <textarea
                rows={2}
                required
                value={adminMailBody}
                onChange={(e) => setAdminMailBody(e.target.value)}
                placeholder="Admin announcement or direct message..."
                className="w-full rounded-lg border border-slate-200 px-3 py-2 text-xs focus:border-blue-500 focus:outline-none"
              />
              <button
                type="submit"
                disabled={busy}
                className="w-full rounded-lg bg-blue-600 py-2 text-xs font-semibold text-white hover:bg-blue-700"
              >
                Send Admin Mail
              </button>
            </form>
          </div>

          {/* Contributor & User Oversight */}
          <div className="rounded-xl border border-slate-200 bg-white p-6 space-y-4">
            <h2 className="font-display text-base font-semibold text-slate-900">
              Contributor Oversight &amp; User Directory ({data.users.length})
            </h2>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="border-b border-slate-200 text-slate-500">
                    <th className="py-2 pr-3 font-medium">Member / 5-Char UID</th>
                    <th className="py-2 pr-3 font-medium">Plan &amp; Role Tags</th>
                    <th className="py-2 pr-3 font-medium">Points</th>
                    <th className="py-2 pr-3 font-medium">Contributor Work</th>
                    <th className="py-2 font-medium text-right">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 tabular-nums">
                  {data.users.map((u) => {
                    const uploadCount = data.materials.filter(
                      (m) => m.uploaderId === u.id
                    ).length;
                    return (
                      <tr key={u.id}>
                        <td className="py-3 pr-3">
                          <div className="flex items-center gap-2.5">
                            <UserAvatarBadge
                              name={u.displayName}
                              photoUrl={u.photoUrl}
                              plan={u.plan}
                              role={u.role}
                              contributorApproved={u.contributorApproved}
                              size="sm"
                            />
                            <div className="min-w-0">
                              <div className="font-semibold text-slate-900">
                                {u.displayName}{' '}
                                <span className="font-mono text-blue-700">
                                  @{u.username}
                                </span>
                              </div>
                              <div className="text-[11px] text-slate-500 flex flex-wrap items-center gap-1.5">
                                <span className="rounded bg-slate-100 px-1.5 py-0.5 font-mono font-bold text-slate-800">
                                  {u.shortUid || `U${u.id}`}
                                </span>
                                <span>{u.email}</span>
                              </div>
                            </div>
                          </div>
                        </td>
                        <td className="py-3 pr-3">
                          <div className="flex flex-wrap items-center gap-1.5">
                            <span
                              className={`rounded px-2 py-0.5 text-[11px] font-semibold uppercase ${
                                u.plan === 'pro'
                                  ? 'bg-indigo-50 text-indigo-700 border border-indigo-200'
                                  : 'bg-blue-50 text-blue-700 border border-blue-200'
                              }`}
                            >
                              {u.plan}
                              {u.plan === 'pro' && u.proExpiresAt
                                ? ` → ${u.proExpiresAt.slice(0, 10)}`
                                : ''}
                            </span>
                            {u.contributorApproved && (
                              <span className="rounded bg-red-50 border border-red-200 px-2 py-0.5 text-[11px] font-semibold text-red-700">
                                Contributor
                              </span>
                            )}
                            {u.contributorRequested && !u.contributorApproved && (
                              <span className="rounded bg-amber-50 border border-amber-200 px-2 py-0.5 text-[11px] font-semibold text-amber-700">
                                Pending Req
                              </span>
                            )}
                            {u.role === 'admin' && (
                              <span className="rounded bg-amber-100 border border-amber-300 px-2 py-0.5 text-[11px] font-semibold text-amber-900">
                                Admin
                              </span>
                            )}
                          </div>
                        </td>
                        <td className="py-3 pr-3 font-mono font-semibold text-slate-900">
                          {u.points} pts
                        </td>
                        <td className="py-3 pr-3 text-slate-600">
                          {uploadCount} upload(s)
                          {u.contributorApproved
                            ? ' · Active (+120/wk)'
                            : u.contributorRequested
                              ? ' · Requested'
                              : ''}
                        </td>
                        <td className="py-3 text-right">
                          {u.role !== 'admin' && (
                            <div className="inline-flex items-center gap-1.5">
                              {!u.contributorApproved ? (
                                <button
                                  type="button"
                                  disabled={busy}
                                  onClick={() => handleToggleContributor(u.id, true)}
                                  className="inline-flex items-center gap-1 rounded-md bg-emerald-600 px-2.5 py-1 text-[11px] font-medium text-white hover:bg-emerald-700"
                                >
                                  <UserCheck className="h-3 w-3" />
                                  Approve Contributor
                                </button>
                              ) : (
                                <button
                                  type="button"
                                  disabled={busy}
                                  onClick={() => handleToggleContributor(u.id, false)}
                                  className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-white px-2.5 py-1 text-[11px] font-medium text-slate-700 hover:bg-slate-50"
                                >
                                  <UserX className="h-3 w-3" />
                                  Pause Stipend
                                </button>
                              )}
                            </div>
                          )}
                          {u.role === 'admin' && (
                            <span className="inline-flex items-center gap-1 text-[11px] font-medium text-amber-700">
                              <Check className="h-3 w-3" /> Admin
                            </span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {/* Server Storage Files & ASAN-user-content Mirror */}
          <div className="rounded-xl border border-slate-200 bg-white p-6 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <h2 className="font-display text-base font-semibold text-slate-900">
                  Study Material Notes &amp; Server Storage Files ({data.materials.length})
                </h2>
                <p className="text-xs text-slate-500">
                  Mirror uploaded contributor materials to invcorporation7@gmail.com Drive folder <code className="font-mono">ASAN-user-content</code> or prune server disk usage.
                </p>
              </div>
            </div>

            {data.materials.length === 0 ? (
              <p className="py-6 text-center text-xs text-slate-500">
                No files stored in the server material repository yet.
              </p>
            ) : (
              <div className="divide-y divide-slate-100">
                {data.materials.map((m) => (
                  <div
                    key={m.id}
                    className="flex flex-wrap items-center justify-between gap-3 py-3 text-xs"
                  >
                    <div className="min-w-0">
                      <div className="font-semibold text-slate-900">
                        {m.title} ({m.fileName})
                      </div>
                      <div className="text-slate-500 tabular-nums">
                        {m.pageCount || 1} pg · Rent {m.hourlyRentCost || 10} pts/hr · Buy{' '}
                        {m.buyCost || 40} pts · {formatBytes(m.fileSizeBytes)} ·{' '}
                        {m.category.replace('_', ' ')} · By {m.uploaderEmail}
                      </div>
                    </div>

                    <div className="flex items-center gap-2 shrink-0">
                      {m.driveWebLink ? (
                        <a
                          href={m.driveWebLink}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 text-emerald-700 font-medium hover:underline"
                        >
                          In ASAN-user-content
                          <ExternalLink className="h-3 w-3" />
                        </a>
                      ) : (
                        <button
                          type="button"
                          onClick={() => handleSyncToAsanUserContent(m)}
                          className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-slate-50 px-2.5 py-1 font-medium text-slate-700 hover:bg-slate-100"
                        >
                          <CloudUpload className="h-3.5 w-3.5 text-emerald-600" />
                          Sync to ASAN-user-content
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => setDeleteMaterialTarget(m)}
                        className="rounded p-1 text-slate-400 hover:bg-red-50 hover:text-red-600"
                        aria-label="Delete material"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Repository Purchases & Hourly Rentals (DB Log) */}
          <div className="rounded-xl border border-slate-200 bg-white p-6 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <h2 className="font-display text-base font-semibold text-slate-900">
                  Repository Purchases &amp; Hourly Rentals (DB Log)
                </h2>
                <p className="text-xs text-slate-500">
                  All repository point transactions, page-based hourly rentals (5–100 pts/hr), and permanent buys recorded directly in the database.
                </p>
              </div>
              <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-1.5 text-xs font-semibold text-amber-800 tabular-nums">
                {data.analytics.totalMaterialPurchases ?? 0} Tx ·{' '}
                {data.analytics.totalMaterialRevenuePts ?? 0} pts volume
              </div>
            </div>

            {!data.materialPurchases || data.materialPurchases.length === 0 ? (
              <p className="py-6 text-center text-xs text-slate-500">
                No material purchases or hourly rentals logged yet.
              </p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead>
                    <tr className="border-b border-slate-200 text-slate-500">
                      <th className="py-2 pr-3 font-medium">Buyer</th>
                      <th className="py-2 pr-3 font-medium">Material</th>
                      <th className="py-2 pr-3 font-medium">Type</th>
                      <th className="py-2 pr-3 font-medium">Pages / Rate</th>
                      <th className="py-2 pr-3 font-medium">Total Cost</th>
                      <th className="py-2 font-medium">Expiry / Date</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 tabular-nums">
                    {data.materialPurchases.map((p) => (
                      <tr key={p.id}>
                        <td className="py-2.5 pr-3">
                          <div className="font-medium text-slate-900">{p.buyerName}</div>
                          <div className="text-[11px] text-slate-500">{p.buyerEmail}</div>
                        </td>
                        <td className="py-2.5 pr-3 font-medium text-slate-800">
                          {p.materialTitle}
                        </td>
                        <td className="py-2.5 pr-3">
                          <span
                            className={`rounded px-2 py-0.5 text-[11px] font-semibold ${
                              p.accessType === 'buy'
                                ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                                : 'bg-blue-50 text-blue-700 border border-blue-200'
                            }`}
                          >
                            {p.accessType === 'buy' ? 'Buy (Permanent)' : `Rent (${p.hours}h)`}
                          </span>
                        </td>
                        <td className="py-2.5 pr-3 text-slate-600">
                          {p.pageCount} pg · {p.hourlyRate} pts/hr
                        </td>
                        <td className="py-2.5 pr-3 font-mono font-semibold text-amber-700">
                          {p.totalCost} pts
                        </td>
                        <td className="py-2.5 text-slate-500">
                          {p.expiresAt
                            ? `Until ${new Date(p.expiresAt).toLocaleString()}`
                            : new Date(p.createdAt).toLocaleDateString()}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}

      <ConfirmDialog
        open={Boolean(deleteMaterialTarget)}
        title="Delete Study Material?"
        description={`Delete "${deleteMaterialTarget?.title}" (${deleteMaterialTarget?.fileName}) from the server storage pool?`}
        confirmLabel="Delete Permanently"
        destructive
        busy={busy}
        onConfirm={handleConfirmDeleteMaterial}
        onCancel={() => setDeleteMaterialTarget(null)}
      />
    </div>
  );
};
