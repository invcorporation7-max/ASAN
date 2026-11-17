import { auth, getAccessToken } from './firebase';
import type { ExamBlueprintItem } from '../types';

const API_BASE = (import.meta.env.VITE_API_BASE_URL as string | undefined)?.replace(/\/$/, '') || '';

export function apiUrl(path: string): string {
  return path.startsWith('http') ? path : `${API_BASE}${path}`;
}

export async function apiFetch<T>(
  path: string,
  options: RequestInit = {}
): Promise<T> {
  const user = auth.currentUser;
  if (!user) {
    throw new Error('Sign in with Google to sync this feature with your cloud account.');
  }

  const execute = async (forceRefresh: boolean) => {
    const idToken = await user.getIdToken(forceRefresh);
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...(options.headers as Record<string, string> | undefined),
      Authorization: `Bearer ${idToken}`,
    };
    return fetch(apiUrl(path), { ...options, headers });
  };

  let res = await execute(false);
  if (res.status === 401) {
    res = await execute(true);
  }

  if (!res.ok) {
    let errText = `Request failed (${res.status})`;
    try {
      const data = await res.json();
      if (data?.error) errText = data.error;
    } catch {
      // ignore json parse error
    }
    throw new Error(errText);
  }

  return (await res.json()) as T;
}

export async function uploadStudyMaterialBinary<T>(
  file: File,
  metadata: {
    title: string;
    subject: string;
    category: string;
    pageCount?: number;
    hourlyRentCost: number;
    buyCost?: number;
  }
): Promise<T> {
  const user = auth.currentUser;
  if (!user) {
    throw new Error('Sign in with Google to upload study materials or question papers.');
  }
  const sendUpload = async (forceRefresh: boolean) => {
    const idToken = await user.getIdToken(forceRefresh);
    return fetch(apiUrl('/api/study-materials/upload'), {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${idToken}`,
        'Content-Type': 'application/octet-stream',
        'x-material-title': encodeURIComponent(metadata.title),
        'x-material-subject': encodeURIComponent(metadata.subject),
        'x-material-category': encodeURIComponent(metadata.category),
        'x-file-name': encodeURIComponent(file.name),
        'x-mime-type': encodeURIComponent(file.type || 'application/octet-stream'),
        'x-page-count': String(Math.max(1, Math.round(metadata.pageCount || 1))),
        'x-hourly-rent-cost': String(Math.max(5, Math.min(100, Math.round(metadata.hourlyRentCost)))),
        ...(metadata.buyCost && metadata.buyCost >= 5
          ? { 'x-buy-cost': String(Math.round(metadata.buyCost)) }
          : {}),
      },
      body: file,
    });
  };

  let res = await sendUpload(false);
  if (res.status === 401) {
    res = await sendUpload(true);
  }
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || `Upload failed (${res.status})`);
  }
  return (await res.json()) as T;
}

export async function downloadStudyMaterialFile(id: number, fileName: string): Promise<void> {
  const user = auth.currentUser;
  if (!user) throw new Error('Sign in required to download study materials.');
  const idToken = await user.getIdToken();
  const res = await fetch(apiUrl(`/api/study-materials/${id}/download`), {
    headers: { Authorization: `Bearer ${idToken}` },
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || 'Download failed');
  }
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export function buildGmailLicenseComposeUrl(params: {
  recipientEmail: string;
  keyCode: string;
  activationExpiresAt: string;
}) {
  const subject = `Your ASAN-Study_tool Pro License Key: ${params.keyCode}`;
  const body = [
    `Hello,`,
    ``,
    `Here is your ASAN-Study_tool 8-character Pro License Key:`,
    `License Key: ${params.keyCode}`,
    `Valid for Activation Until: ${params.activationExpiresAt.slice(0, 10)} (1 year)`,
    `Subscription Duration: 1 month from activation`,
    ``,
    `Open ASAN-Study_tool -> Subscriptions -> Activate License Key to redeem.`,
  ].join('\n');

  return `https://mail.google.com/mail/?view=cm&fs=1&to=${encodeURIComponent(
    params.recipientEmail
  )}&su=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}

export function buildGmailConfirmationUrl(params: {
  recipientEmail: string;
  subject: string;
  body: string;
}) {
  return `https://mail.google.com/mail/?view=cm&fs=1&to=${encodeURIComponent(
    params.recipientEmail
  )}&su=${encodeURIComponent(params.subject)}&body=${encodeURIComponent(params.body)}`;
}

function requireWorkspaceToken(): string {
  const token = getAccessToken();
  if (!token) {
    throw new Error(
      'Google Drive is not connected yet. Connect your ASAN-user-content Drive folder first when you want to sync.'
    );
  }
  return token;
}

// --- FOLDER-SCOPED GOOGLE DRIVE (STRICTLY INSIDE ASAN-user-content) ---
export interface DriveFileItem {
  id: string;
  name: string;
  mimeType: string;
  modifiedTime?: string;
  webViewLink?: string;
  size?: string;
}

const APP_DRIVE_FOLDER_NAME = 'ASAN-user-content';

export async function ensureNamedDriveFolder(
  folderName: string,
  existingFolderId?: string
): Promise<{ id: string; name: string; webViewLink?: string }> {
  const token = requireWorkspaceToken();

  if (existingFolderId) {
    const checkRes = await fetch(
      `https://www.googleapis.com/drive/v3/files/${existingFolderId}?fields=id,name,trashed,webViewLink`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    if (checkRes.ok) {
      const existing = await checkRes.json();
      if (existing?.id && !existing.trashed && existing.name === folderName) {
        return existing;
      }
    }
  }

  const q = encodeURIComponent(
    `mimeType='application/vnd.google-apps.folder' and name='${folderName}' and trashed=false`
  );
  const searchRes = await fetch(
    `https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(id,name,webViewLink)&pageSize=1`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  if (searchRes.ok) {
    const searchData = await searchRes.json();
    if (searchData.files && searchData.files.length > 0) {
      return searchData.files[0];
    }
  }

  const createRes = await fetch(
    'https://www.googleapis.com/drive/v3/files?fields=id,name,webViewLink',
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        name: folderName,
        mimeType: 'application/vnd.google-apps.folder',
      }),
    }
  );
  const created = await createRes.json();
  if (!createRes.ok) {
    throw new Error(created.error?.message || `Failed to create Drive folder "${folderName}"`);
  }
  return created;
}

export async function ensureAppDriveFolder(
  existingFolderId?: string
): Promise<{ id: string; name: string; webViewLink?: string }> {
  return ensureNamedDriveFolder(APP_DRIVE_FOLDER_NAME, existingFolderId);
}

async function createDriveWorkspaceFile(
  name: string,
  mimeType: string,
  folderId: string
): Promise<{ id: string; name: string; webViewLink?: string }> {
  const token = requireWorkspaceToken();
  const res = await fetch(
    'https://www.googleapis.com/drive/v3/files?fields=id,name,webViewLink',
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        name,
        mimeType,
        parents: [folderId],
      }),
    }
  );
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.error?.message || `Failed to create "${name}" inside ASAN-user-content`);
  }
  return data;
}

export async function listDriveFilesInFolder(
  folderId: string
): Promise<DriveFileItem[]> {
  const token = requireWorkspaceToken();
  const q = encodeURIComponent(`'${folderId}' in parents and trashed = false`);
  const res = await fetch(
    `https://www.googleapis.com/drive/v3/files?q=${q}&pageSize=50&fields=files(id,name,mimeType,modifiedTime,webViewLink,size)&orderBy=modifiedTime desc`,
    {
      headers: { Authorization: `Bearer ${token}` },
    }
  );
  const data = await res.json();
  if (!res.ok) {
    throw new Error(
      data.error?.message || 'Failed to list files inside ASAN-user-content folder'
    );
  }
  return data.files || [];
}

export async function uploadFileToDriveFolder(
  file: File,
  folderId: string
): Promise<{ id: string; webViewLink?: string; name: string }> {
  const token = requireWorkspaceToken();
  const metadata = {
    name: file.name,
    mimeType: file.type || 'application/pdf',
    parents: [folderId],
  };

  const form = new FormData();
  form.append(
    'metadata',
    new Blob([JSON.stringify(metadata)], { type: 'application/json' })
  );
  form.append('file', file);

  const res = await fetch(
    'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,webViewLink',
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: form,
    }
  );
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.error?.message || 'Failed to upload file to app folder');
  }
  return data;
}

export async function saveTextToDriveFolder(
  fileName: string,
  textContent: string,
  folderId: string
): Promise<{ id: string; webViewLink?: string; name: string }> {
  const token = requireWorkspaceToken();
  // Check if file already exists in folder to update instead of duplicating
  const q = encodeURIComponent(
    `'${folderId}' in parents and name='${fileName}' and trashed=false`
  );
  const searchRes = await fetch(
    `https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(id,name)&pageSize=1`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  const searchData = searchRes.ok ? await searchRes.json() : { files: [] };
  const existingId = searchData.files?.[0]?.id as string | undefined;

  if (existingId) {
    const updateRes = await fetch(
      `https://www.googleapis.com/upload/drive/v3/files/${existingId}?uploadType=media&fields=id,name,webViewLink`,
      {
        method: 'PATCH',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'text/plain',
        },
        body: textContent,
      }
    );
    const updated = await updateRes.json();
    if (!updateRes.ok) {
      throw new Error(updated.error?.message || 'Failed to update Drive .txt file');
    }
    return updated;
  }

  const txtFile = new File([textContent], fileName, { type: 'text/plain' });
  return uploadFileToDriveFolder(txtFile, folderId);
}

export async function saveJsonToDriveFolder(
  fileName: string,
  payload: unknown,
  folderId: string
): Promise<{ id: string; webViewLink?: string; name: string }> {
  const jsonFile = new File(
    [JSON.stringify(payload, null, 2)],
    fileName,
    { type: 'application/json' }
  );
  return uploadFileToDriveFolder(jsonFile, folderId);
}

export async function deleteDriveFile(fileId: string): Promise<void> {
  const token = requireWorkspaceToken();
  const res = await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error?.message || 'Failed to delete Drive file');
  }
}

// --- GOOGLE DOCS (Created strictly inside ASAN-user-content) ---
export async function exportNoteToGoogleDoc(
  title: string,
  plainTextBody: string,
  folderId?: string
): Promise<{ documentId: string; url: string }> {
  const token = requireWorkspaceToken();
  const targetFolderId = folderId || (await ensureAppDriveFolder()).id;
  const createdDoc = await createDriveWorkspaceFile(
    title,
    'application/vnd.google-apps.document',
    targetFolderId
  );

  const documentId = createdDoc.id;
  if (plainTextBody.trim().length > 0) {
    const updateRes = await fetch(
      `https://docs.googleapis.com/v1/documents/${documentId}:batchUpdate`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          requests: [
            {
              insertText: {
                location: { index: 1 },
                text: plainTextBody,
              },
            },
          ],
        }),
      }
    );
    if (!updateRes.ok) {
      const errData = await updateRes.json().catch(() => ({}));
      throw new Error(errData.error?.message || 'Created Doc inside ASAN-user-content but failed to insert text');
    }
  }

  return {
    documentId,
    url: createdDoc.webViewLink || `https://docs.google.com/document/d/${documentId}/edit`,
  };
}

// --- GOOGLE SHEETS (Tasks Export & Schedule Sync — strictly inside ASAN-user-content) ---
export async function exportRowsToGoogleSheet(
  title: string,
  headers: string[],
  rows: (string | number)[][],
  folderId?: string
): Promise<{ spreadsheetId: string; spreadsheetUrl: string }> {
  const token = requireWorkspaceToken();
  const targetFolderId = folderId || (await ensureAppDriveFolder()).id;
  const createdFile = await createDriveWorkspaceFile(
    title,
    'application/vnd.google-apps.spreadsheet',
    targetFolderId
  );

  const spreadsheetId = createdFile.id;
  const metaRes = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}?fields=spreadsheetUrl,sheets.properties.title`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  const sheetData = metaRes.ok ? await metaRes.json() : {};
  const firstSheetTitle = sheetData.sheets?.[0]?.properties?.title || 'Sheet1';
  const values = [headers, ...rows];

  const writeRes = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(
      `${firstSheetTitle}!A1`
    )}:append?valueInputOption=USER_ENTERED`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ values }),
    }
  );
  if (!writeRes.ok) {
    const errData = await writeRes.json().catch(() => ({}));
    throw new Error(errData.error?.message || 'Created spreadsheet inside ASAN-user-content but failed to write rows');
  }

  return {
    spreadsheetId,
    spreadsheetUrl:
      sheetData.spreadsheetUrl ||
      createdFile.webViewLink ||
      `https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit`,
  };
}

export async function syncScheduleToGoogleSheet(
  existingSheetId: string,
  scheduleRows: (string | number)[][],
  folderId?: string
): Promise<{ spreadsheetId: string; spreadsheetUrl: string }> {
  const token = requireWorkspaceToken();
  const targetFolderId = folderId || (await ensureAppDriveFolder()).id;
  const headers = [
    'Date (YYYY-MM-DD)',
    'Time (HH:MM)',
    'Category',
    'Title / Subject',
    'Details / Duration',
    'Meet Link',
  ];

  let spreadsheetId = existingSheetId;
  let sheetTitle = 'Schedule';
  let spreadsheetUrl = spreadsheetId
    ? `https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit`
    : '';

  if (spreadsheetId) {
    const checkDriveRes = await fetch(
      `https://www.googleapis.com/drive/v3/files/${spreadsheetId}?fields=id,trashed,parents`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    const driveMeta = checkDriveRes.ok ? await checkDriveRes.json() : null;
    const inAppFolder =
      driveMeta &&
      !driveMeta.trashed &&
      Array.isArray(driveMeta.parents) &&
      driveMeta.parents.includes(targetFolderId);

    if (inAppFolder) {
      const metaRes = await fetch(
        `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}?fields=spreadsheetUrl,sheets.properties.title`,
        { headers: { Authorization: `Bearer ${token}` } }
      );
      if (metaRes.ok) {
        const meta = await metaRes.json();
        spreadsheetUrl = meta.spreadsheetUrl || spreadsheetUrl;
        sheetTitle = meta.sheets?.[0]?.properties?.title || 'Schedule';
      } else {
        spreadsheetId = '';
      }
    } else {
      spreadsheetId = '';
    }
  }

  if (!spreadsheetId) {
    const createdFile = await createDriveWorkspaceFile(
      'ASAN-user-content Schedule',
      'application/vnd.google-apps.spreadsheet',
      targetFolderId
    );
    spreadsheetId = createdFile.id;
    spreadsheetUrl =
      createdFile.webViewLink ||
      `https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit`;

    const metaRes = await fetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}?fields=spreadsheetUrl,sheets(properties(sheetId,title))`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    if (metaRes.ok) {
      const meta = await metaRes.json();
      spreadsheetUrl = meta.spreadsheetUrl || spreadsheetUrl;
      const firstProps = meta.sheets?.[0]?.properties;
      if (firstProps && firstProps.title !== 'Schedule') {
        await fetch(
          `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}:batchUpdate`,
          {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${token}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              requests: [
                {
                  updateSheetProperties: {
                    properties: { sheetId: firstProps.sheetId, title: 'Schedule' },
                    fields: 'title',
                  },
                },
              ],
            }),
          }
        ).catch(() => {});
      }
    }
    sheetTitle = 'Schedule';
  }

  await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(
      `${sheetTitle}!A1:F500`
    )}:clear`,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
    }
  );

  const writeRes = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(
      `${sheetTitle}!A1`
    )}?valueInputOption=USER_ENTERED`,
    {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ values: [headers, ...scheduleRows] }),
    }
  );
  if (!writeRes.ok) {
    const err = await writeRes.json().catch(() => ({}));
    throw new Error(err.error?.message || 'Failed to sync schedule rows to Sheet');
  }

  return { spreadsheetId, spreadsheetUrl };
}

export async function pullScheduleFromGoogleSheet(
  spreadsheetId: string
): Promise<
  {
    eventDate: string;
    eventTime: string;
    category: string;
    title: string;
    notes: string;
    meetLink: string;
  }[]
> {
  const token = requireWorkspaceToken();
  const metaRes = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}?fields=sheets.properties.title`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  const meta = await metaRes.json();
  if (!metaRes.ok) {
    throw new Error(meta.error?.message || 'Could not access Schedule Sheet');
  }
  const sheetTitle = meta.sheets?.[0]?.properties?.title || 'Schedule';

  const valRes = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(
      `${sheetTitle}!A2:F500`
    )}`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  const valData = await valRes.json();
  if (!valRes.ok) {
    throw new Error(valData.error?.message || 'Failed to read rows from Schedule Sheet');
  }

  const rows: string[][] = valData.values || [];
  return rows
    .filter((r) => r[0] && r[3])
    .map((r) => ({
      eventDate: String(r[0]).trim(),
      eventTime: String(r[1] || '09:00').trim(),
      category: String(r[2] || 'study').trim().toLowerCase(),
      title: String(r[3]).trim(),
      notes: String(r[4] || '').trim(),
      meetLink: String(r[5] || '').trim(),
    }));
}

// --- GOOGLE SHEETS MASTER EXAM BLUEPRINT ("master" -> "test_dates" inside ASAN-user-content) ---
// Exact 3-row x 4-column layout per card:
// Row 1: [Marks Scored (opt), Syllabus[], Subject, Question Paper]
// Row 2: [Total Marks, Date, Paper Code, Answer Sheet]
// Row 3: [Percentage, Time, Type, Corrected Answer Sheet]
export async function syncMasterExamSheet(
  cards: ExamBlueprintItem[],
  folderId?: string
): Promise<{ spreadsheetId: string; spreadsheetUrl: string }> {
  const token = requireWorkspaceToken();
  const targetFolderId = folderId || (await ensureAppDriveFolder()).id;

  // Search strictly inside ASAN-user-content for spreadsheet named "master"
  const q = encodeURIComponent(
    `'${targetFolderId}' in parents and mimeType='application/vnd.google-apps.spreadsheet' and name='master' and trashed=false`
  );
  const searchRes = await fetch(
    `https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(id,name,webViewLink)&pageSize=1`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  const searchData = searchRes.ok ? await searchRes.json() : { files: [] };
  let spreadsheetId = searchData.files?.[0]?.id as string | undefined;
  let spreadsheetUrl = spreadsheetId
    ? `https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit`
    : '';

  if (!spreadsheetId) {
    const createdFile = await createDriveWorkspaceFile(
      'master',
      'application/vnd.google-apps.spreadsheet',
      targetFolderId
    );
    spreadsheetId = createdFile.id;
    spreadsheetUrl =
      createdFile.webViewLink ||
      `https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit`;

    const metaRes = await fetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}?fields=spreadsheetUrl,sheets(properties(sheetId,title))`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    if (metaRes.ok) {
      const meta = await metaRes.json();
      spreadsheetUrl = meta.spreadsheetUrl || spreadsheetUrl;
      const firstProps = meta.sheets?.[0]?.properties;
      if (firstProps && firstProps.title !== 'test_dates') {
        await fetch(
          `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}:batchUpdate`,
          {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${token}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              requests: [
                {
                  updateSheetProperties: {
                    properties: { sheetId: firstProps.sheetId, title: 'test_dates' },
                    fields: 'title',
                  },
                },
              ],
            }),
          }
        ).catch(() => {});
      }
    }
  } else {
    // Ensure "test_dates" tab exists
    const metaRes = await fetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}?fields=spreadsheetUrl,sheets.properties.title`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    const meta = await metaRes.json();
    if (metaRes.ok) {
      spreadsheetUrl = meta.spreadsheetUrl || spreadsheetUrl;
      const hasTab = (meta.sheets || []).some(
        (s: { properties?: { title?: string } }) => s.properties?.title === 'test_dates'
      );
      if (!hasTab) {
        await fetch(
          `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}:batchUpdate`,
          {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${token}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              requests: [{ addSheet: { properties: { title: 'test_dates' } } }],
            }),
          }
        );
      }
    }
  }

  await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(
      'test_dates!A1:D600'
    )}:clear`,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
    }
  );

  const values: (string | number)[][] = [];
  for (const c of cards) {
    const pct =
      c.marksScored !== null && c.marksScored !== undefined && c.totalMarks > 0
        ? `${((c.marksScored / c.totalMarks) * 100).toFixed(1)}%`
        : c.percentage || '';
    values.push([
      c.marksScored !== null && c.marksScored !== undefined ? c.marksScored : '',
      c.syllabus.join(', '),
      c.subject,
      c.questionPaperUrl || '',
    ]);
    values.push([c.totalMarks, c.examDate, c.paperCode, c.answerSheetUrl || '']);
    values.push([pct, c.examTime, c.examType, c.correctedAnswerSheetUrl || '']);
  }

  if (values.length > 0) {
    const writeRes = await fetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(
        'test_dates!A1'
      )}?valueInputOption=USER_ENTERED`,
      {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ values }),
      }
    );
    if (!writeRes.ok) {
      const err = await writeRes.json().catch(() => ({}));
      throw new Error(err.error?.message || 'Failed to write rows to master -> test_dates');
    }
  }

  return { spreadsheetId: spreadsheetId!, spreadsheetUrl };
}

export async function pullMasterExamSheet(folderId?: string): Promise<
  Omit<ExamBlueprintItem, 'id' | 'userId' | 'createdAt' | 'updatedAt'>[]
> {
  const token = requireWorkspaceToken();
  const targetFolderId = folderId || (await ensureAppDriveFolder()).id;
  const q = encodeURIComponent(
    `'${targetFolderId}' in parents and mimeType='application/vnd.google-apps.spreadsheet' and name='master' and trashed=false`
  );
  const searchRes = await fetch(
    `https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(id)&pageSize=1`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  const searchData = searchRes.ok ? await searchRes.json() : { files: [] };
  const spreadsheetId = searchData.files?.[0]?.id as string | undefined;
  if (!spreadsheetId) {
    throw new Error('Google Sheet named "master" not found inside ASAN-user-content. Sync cards first to create it.');
  }

  const valRes = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(
      'test_dates!A1:D600'
    )}`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  const valData = await valRes.json();
  if (!valRes.ok) {
    throw new Error(valData.error?.message || 'Could not read "test_dates" sheet inside "master"');
  }

  const rawRows: string[][] = valData.values || [];
  const cleanRows = rawRows.filter((r) => r.some((cell) => String(cell || '').trim() !== ''));
  const cards: Omit<ExamBlueprintItem, 'id' | 'userId' | 'createdAt' | 'updatedAt'>[] = [];

  for (let i = 0; i + 2 < cleanRows.length; i += 3) {
    const r1 = cleanRows[i];
    const r2 = cleanRows[i + 1];
    const r3 = cleanRows[i + 2];
    const marksRaw = String(r1[0] || '').trim();
    const totalRaw = Number(r2[0] || 100);
    const totalMarks = Number.isFinite(totalRaw) && totalRaw > 0 ? totalRaw : 100;
    const marksScored = marksRaw !== '' && Number.isFinite(Number(marksRaw)) ? Number(marksRaw) : null;
    const subject = String(r1[2] || '').trim();
    const paperCode = String(r2[2] || '').trim().toUpperCase();
    const examDate = String(r2[1] || '').trim();
    if (!subject || !examDate) continue;

    cards.push({
      paperCode,
      subject,
      examType: String(r3[2] || 'JEE Main').trim(),
      examDate,
      examTime: String(r3[1] || '09:00').trim(),
      totalMarks,
      marksScored,
      percentage:
        marksScored !== null
          ? `${((marksScored / totalMarks) * 100).toFixed(1)}%`
          : String(r3[0] || '').trim(),
      syllabus: String(r1[1] || '')
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean),
      questionPaperUrl: String(r1[3] || '').trim(),
      answerSheetUrl: String(r2[3] || '').trim(),
      correctedAnswerSheetUrl: String(r3[3] || '').trim(),
    });
  }

  return cards;
}

// --- GOOGLE MEET ---
export async function createGoogleMeetRoom(): Promise<{
  meetingUri: string;
  meetingCode: string;
  name: string;
}> {
  const token = requireWorkspaceToken();
  const res = await fetch('https://meet.googleapis.com/v2/spaces', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({}),
  });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.error?.message || 'Failed to create Google Meet study room');
  }
  return {
    meetingUri: data.meetingUri,
    meetingCode: data.meetingCode,
    name: data.name,
  };
}
