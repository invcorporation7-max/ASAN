import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Bell,
  BookOpen,
  Calendar,
  CheckSquare,
  Clock,
  Cloud,
  CreditCard,
  FolderOpen,
  Globe,
  Info,
  Layers,
  LayoutDashboard,
  LogIn,
  LogOut,
  Mail,
  Menu,
  MessageSquare,
  MoreHorizontal,
  Search,
  ShieldCheck,
  Sparkles,
  X,
} from 'lucide-react';
import { AdminView } from './components/AdminView';
import { AuthGate } from './components/AuthGate';
import { CalendarView } from './components/CalendarView';
import { DashboardView } from './components/DashboardView';
import {
  AboutCreatorsView,
  ContactView,
  MoreFeaturesView,
  PlansView,
  SpectraView,
} from './components/InfoViews';
import { MessagesView } from './components/MessagesView';
import { NotesView } from './components/NotesView';
import { NotificationsView } from './components/NotificationsView';
import { PdfStudioView } from './components/PdfStudioView';
import { ProGateCard } from './components/ProGateCard';
import { OfflineIndicator, PWAInstallButton } from './components/PWAInstallBanner';
import { StudyMaterialView } from './components/StudyMaterialView';
import { SubscriptionsView } from './components/SubscriptionsView';
import { TasksView } from './components/TasksView';
import { TimersView } from './components/TimersView';
import { UserAvatarBadge } from './components/UserAvatarBadge';
import { WorkspaceView } from './components/WorkspaceView';
import { AuthProvider, useAuth } from './context/AuthContext';
import { apiFetch } from './lib/api';
import { loadGuestWorkspace } from './lib/guestStore';
import type {
  CalendarEventItem,
  ExamScheduleItem,
  NavSection,
  NotificationItem,
  StudyLogItem,
  StudyMaterialItem,
  StudyNotebook,
  StudyNotePage,
  StudyTask,
} from './types';

const PRIMARY_NAV: {
  id: NavSection;
  label: string;
  icon: React.FC<{ className?: string }>;
  proOnly?: boolean;
}[] = [
  { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { id: 'calendar', label: 'Calendar', icon: Calendar },
  { id: 'tasks', label: 'My Tasks', icon: CheckSquare },
  { id: 'notes', label: 'My Notes', icon: BookOpen },
  { id: 'timers', label: 'Timers', icon: Clock },
  { id: 'messages', label: 'Tool Mail', icon: MessageSquare },
  { id: 'study-materials', label: 'Study Material Notes', icon: FolderOpen },
  { id: 'subscriptions', label: 'Subscriptions', icon: Sparkles },
  { id: 'notifications', label: 'Notifications', icon: Bell },
  { id: 'pdf-tool', label: 'PDF Tool', icon: Layers, proOnly: true },
  { id: 'workspace', label: 'Google Workspace', icon: Cloud, proOnly: true },
  { id: 'spectra', label: 'Spectra AI', icon: Globe, proOnly: true },
  { id: 'more', label: 'More Features', icon: MoreHorizontal },
];

const SECONDARY_NAV: {
  id: NavSection;
  label: string;
  icon: React.FC<{ className?: string }>;
}[] = [
  { id: 'plans', label: 'View Plans', icon: CreditCard },
  { id: 'about', label: 'About the Creators', icon: Info },
  { id: 'contact', label: 'Contact', icon: Mail },
];

const SECTION_LABELS: Record<NavSection, string> = {
  dashboard: 'Dashboard',
  calendar: 'Calendar',
  tasks: 'My Tasks',
  notes: 'My Notes',
  timers: 'Timers',
  messages: 'Tool Mail',
  'study-materials': 'Study Material Notes',
  subscriptions: 'Subscriptions',
  notifications: 'Notifications',
  admin: 'Admin Console',
  'pdf-tool': 'PDF Tool',
  workspace: 'Google Workspace',
  spectra: 'Spectra AI',
  more: 'More Features',
  plans: 'View Plans',
  about: 'About the Creators',
  contact: 'Contact',
};

interface SearchResultItem {
  id: string;
  title: string;
  subtitle: string;
  section: NavSection;
}

const MainShell: React.FC = () => {
  const {
    firebaseUser,
    dbUser,
    isGuest,
    effectivePlan,
    isEffectiveProOrAdmin,
    setViewPlanMode,
    loading,
    signIn,
    signOutUser,
  } = useAuth();
  const isProOrAdmin = isEffectiveProOrAdmin;
  const isAdmin = !isGuest && dbUser?.role === 'admin';

  const [section, setSection] = useState<NavSection>('dashboard');
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [preselectedMessageNoteId, setPreselectedMessageNoteId] = useState<number | null>(
    null
  );

  // Study Workspace State
  const [tasks, setTasks] = useState<StudyTask[]>([]);
  const [events, setEvents] = useState<CalendarEventItem[]>([]);
  const [notebooks, setNotebooks] = useState<StudyNotebook[]>([]);
  const [notePages, setNotePages] = useState<StudyNotePage[]>([]);
  const [exams, setExams] = useState<ExamScheduleItem[]>([]);
  const [studyLogs, setStudyLogs] = useState<StudyLogItem[]>([]);
  const [studyMaterials, setStudyMaterials] = useState<StudyMaterialItem[]>([]);
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const [unreadNotifCount, setUnreadNotifCount] = useState(0);
  const [dataLoading, setDataLoading] = useState(false);
  const [dataError, setDataError] = useState<string | null>(null);

  // Navbar Search & Bell Popover State
  const [searchQuery, setSearchQuery] = useState('');
  const [searchOpen, setSearchOpen] = useState(false);
  const [bellOpen, setBellOpen] = useState(false);
  const searchRef = useRef<HTMLDivElement>(null);
  const bellRef = useRef<HTMLDivElement>(null);

  const loadAllStudyData = useCallback(async () => {
    if (isGuest) {
      const guest = loadGuestWorkspace();
      setTasks(guest.tasks);
      setEvents(guest.events);
      setNotebooks(guest.notebooks);
      setNotePages(guest.notePages);
      setExams(guest.exams);
      setStudyLogs(guest.studyLogs);
      setStudyMaterials([]);
      setNotifications([]);
      setUnreadNotifCount(0);
      setDataError(null);
      return;
    }

    if (!firebaseUser) return;
    setDataLoading(true);
    setDataError(null);
    try {
      const [tasksRes, eventsRes, nbRes, examsRes, logsRes, matRes, notifRes] =
        await Promise.all([
          apiFetch<StudyTask[]>('/api/tasks'),
          apiFetch<CalendarEventItem[]>('/api/events'),
          apiFetch<{ notebooks: StudyNotebook[]; pages: StudyNotePage[] }>('/api/notebooks'),
          apiFetch<ExamScheduleItem[]>('/api/exams'),
          apiFetch<StudyLogItem[]>('/api/study-logs'),
          apiFetch<{ materials: StudyMaterialItem[] }>('/api/study-materials').catch(() => ({
            materials: [],
          })),
          apiFetch<NotificationItem[]>('/api/notifications').catch(() => []),
        ]);
      setTasks(tasksRes);
      setEvents(eventsRes);
      setNotebooks(nbRes.notebooks);
      setNotePages(nbRes.pages);
      setExams(examsRes);
      setStudyLogs(logsRes);
      setStudyMaterials(matRes.materials || []);
      setNotifications(notifRes);
      setUnreadNotifCount(notifRes.filter((n) => !n.isRead).length);
    } catch (err) {
      setDataError(
        err instanceof Error ? err.message : 'Unable to sync study data from database'
      );
    } finally {
      setDataLoading(false);
    }
  }, [firebaseUser, isGuest]);

  useEffect(() => {
    if (firebaseUser || isGuest) {
      loadAllStudyData();
    }
  }, [firebaseUser, isGuest, loadAllStudyData]);

  // Close navbar popovers on outside click
  useEffect(() => {
    const onDocClick = (e: MouseEvent) => {
      if (searchRef.current && !searchRef.current.contains(e.target as Node)) {
        setSearchOpen(false);
      }
      if (bellRef.current && !bellRef.current.contains(e.target as Node)) {
        setBellOpen(false);
      }
    };
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, []);

  // Build unified instant search index across navigation + user items
  const searchResults = useMemo<SearchResultItem[]>(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return [];
    const results: SearchResultItem[] = [];

    (Object.keys(SECTION_LABELS) as NavSection[]).forEach((secId) => {
      if (secId === 'admin' && !isAdmin) return;
      const label = SECTION_LABELS[secId];
      if (label.toLowerCase().includes(q)) {
        results.push({
          id: `sec-${secId}`,
          title: label,
          subtitle: 'Section',
          section: secId,
        });
      }
    });

    tasks.forEach((t) => {
      if (
        t.title.toLowerCase().includes(q) ||
        t.subject.toLowerCase().includes(q)
      ) {
        results.push({
          id: `task-${t.id}`,
          title: t.title,
          subtitle: `Task · ${t.subject} · ${t.status}`,
          section: 'tasks',
        });
      }
    });

    notePages.forEach((p) => {
      if (
        p.title.toLowerCase().includes(q) ||
        p.sectionName.toLowerCase().includes(q)
      ) {
        results.push({
          id: `note-${p.id}`,
          title: p.title,
          subtitle: `A4 Note · ${p.sectionName}`,
          section: 'notes',
        });
      }
    });

    events.forEach((ev) => {
      if (
        ev.title.toLowerCase().includes(q) ||
        ev.eventDate.includes(q)
      ) {
        results.push({
          id: `ev-${ev.id}`,
          title: ev.title,
          subtitle: `Calendar · ${ev.eventDate} ${ev.eventTime || ''}`,
          section: 'calendar',
        });
      }
    });

    exams.forEach((ex) => {
      if (
        ex.subject.toLowerCase().includes(q) ||
        ex.examType.toLowerCase().includes(q) ||
        ex.paperName.toLowerCase().includes(q)
      ) {
        results.push({
          id: `exam-${ex.id}`,
          title: `${ex.subject} (${ex.examType})`,
          subtitle: `Exam Timer · ${ex.writingMinutes}m writing`,
          section: 'timers',
        });
      }
    });

    studyMaterials.forEach((m) => {
      if (
        m.title.toLowerCase().includes(q) ||
        m.subject.toLowerCase().includes(q) ||
        m.fileName.toLowerCase().includes(q)
      ) {
        results.push({
          id: `mat-${m.id}`,
          title: m.title,
          subtitle: `Study Material · ${m.subject}`,
          section: 'study-materials',
        });
      }
    });

    return results.slice(0, 10);
  }, [searchQuery, tasks, notePages, events, exams, studyMaterials, isAdmin]);

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50 text-sm text-slate-600">
        Loading ASAN-Study_tool...
      </div>
    );
  }

  if (!firebaseUser && !isGuest) {
    return <AuthGate />;
  }

  const handleNavClick = (id: NavSection) => {
    setSection(id);
    setMobileMenuOpen(false);
    setBellOpen(false);
    setSearchOpen(false);
  };

  const renderSidebarContent = () => (
    <div className="flex h-full flex-col justify-between bg-white border-r border-slate-200 px-4 py-5 overflow-y-auto">
      <div className="space-y-5">
        <div className="flex items-center gap-2.5 px-2">
          <img
            src="/pwa-192x192.png"
            alt="ASAN-Study_tool"
            className="h-7 w-7 rounded-md object-cover shadow-xs shrink-0"
          />
          <span className="font-display text-lg font-bold tracking-tight text-slate-900 whitespace-nowrap">
            ASAN-Study_tool
          </span>
        </div>

        <nav className="space-y-1" aria-label="Main navigation">
          {PRIMARY_NAV.map((item) => {
            const Icon = item.icon;
            const active = section === item.id;
            const locked = Boolean(item.proOnly && !isProOrAdmin);
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => handleNavClick(item.id)}
                className={`flex w-full items-center justify-between gap-2 rounded-lg px-3 py-2 text-sm font-medium transition-colors whitespace-nowrap ${
                  active
                    ? 'bg-blue-50 text-blue-700'
                    : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900'
                }`}
              >
                <span className="flex items-center gap-3 min-w-0">
                  <Icon
                    className={`h-4 w-4 shrink-0 ${
                      active ? 'text-blue-600' : 'text-slate-400'
                    }`}
                  />
                  <span className="truncate">{item.label}</span>
                </span>
                {item.id === 'notifications' && unreadNotifCount > 0 && (
                  <span className="rounded-full bg-blue-600 px-1.5 py-0.5 text-[10px] font-semibold text-white tabular-nums">
                    {unreadNotifCount}
                  </span>
                )}
                {locked && (
                  <span className="text-[10px] font-medium text-slate-400">
                    Pro
                  </span>
                )}
              </button>
            );
          })}

          {isAdmin && (
            <button
              type="button"
              onClick={() => handleNavClick('admin')}
              className={`flex w-full items-center justify-between gap-2 rounded-lg px-3 py-2 text-sm font-medium transition-colors whitespace-nowrap ${
                section === 'admin'
                  ? 'bg-amber-50 text-amber-800'
                  : 'text-slate-700 hover:bg-amber-50/60 hover:text-amber-900'
              }`}
            >
              <span className="flex items-center gap-3 min-w-0">
                <ShieldCheck
                  className={`h-4 w-4 shrink-0 ${
                    section === 'admin' ? 'text-amber-700' : 'text-amber-600'
                  }`}
                />
                <span className="truncate">Admin Console</span>
              </span>
            </button>
          )}
        </nav>
      </div>

      <div className="space-y-4 border-t border-slate-100 pt-4 mt-4">
        <nav className="space-y-1" aria-label="Information navigation">
          {SECONDARY_NAV.map((item) => {
            const Icon = item.icon;
            const active = section === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => handleNavClick(item.id)}
                className={`flex w-full items-center gap-3 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors whitespace-nowrap ${
                  active
                    ? 'bg-slate-100 text-slate-900'
                    : 'text-slate-500 hover:bg-slate-50 hover:text-slate-900'
                }`}
              >
                <Icon className="h-3.5 w-3.5 shrink-0" />
                <span>{item.label}</span>
              </button>
            );
          })}
        </nav>

        {isGuest ? (
          <div className="flex items-center justify-between gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5">
            <div className="min-w-0">
              <div className="truncate text-xs font-semibold text-slate-900">
                Free Tier (Local)
              </div>
              <div className="truncate text-[11px] text-slate-500">
                10 Notes · 150 Tasks max
              </div>
            </div>
            <button
              type="button"
              onClick={signIn}
              title="Sign in with Google"
              aria-label="Sign in with Google"
              className="inline-flex items-center gap-1 rounded-md bg-blue-600 px-2.5 py-1.5 text-[11px] font-semibold text-white hover:bg-blue-700 shrink-0"
            >
              <LogIn className="h-3 w-3" />
              Sign In
            </button>
          </div>
        ) : (
          <div className="flex items-center justify-between gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5">
            <div className="flex items-center gap-2.5 min-w-0">
              {dbUser && (
                <UserAvatarBadge
                  name={dbUser.displayName || firebaseUser?.displayName || 'Student'}
                  photoUrl={dbUser.photoUrl}
                  plan={dbUser.plan}
                  role={dbUser.role}
                  contributorApproved={dbUser.contributorApproved}
                  size="sm"
                />
              )}
              <div className="min-w-0">
                <div className="truncate text-xs font-semibold text-slate-900">
                  {dbUser?.displayName || firebaseUser?.displayName || 'Student'}
                </div>
                <div className="truncate text-[11px] text-slate-500 tabular-nums">
                  {dbUser?.shortUid ? `${dbUser.shortUid} · ` : ''}
                  {effectivePlan.toUpperCase()}
                  {dbUser?.role === 'admin' ? ' · ADMIN' : ''}
                </div>
              </div>
            </div>
            <button
              type="button"
              onClick={signOutUser}
              title="Sign out"
              aria-label="Sign out"
              className="rounded-md p-1.5 text-slate-500 hover:bg-white hover:text-red-600 shrink-0"
            >
              <LogOut className="h-4 w-4" />
            </button>
          </div>
        )}
      </div>
    </div>
  );

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 flex">
      {/* Desktop Sidebar (256px) */}
      <aside className="no-print hidden lg:block w-64 shrink-0 sticky top-0 h-screen">
        {renderSidebarContent()}
      </aside>

      {/* Mobile Drawer */}
      {mobileMenuOpen && (
        <div className="no-print fixed inset-0 z-50 flex lg:hidden">
          <div
            className="fixed inset-0 bg-slate-900/40"
            onClick={() => setMobileMenuOpen(false)}
          />
          <div className="relative z-10 w-64 h-full">{renderSidebarContent()}</div>
        </div>
      )}

      {/* Main Content Shell */}
      <div className="flex flex-1 flex-col min-w-0">
        {/* Top Navbar: Breadcrumb | Search Input | Notifications Bell + Points/Plan CTA */}
        <header className="no-print sticky top-0 z-30 flex flex-wrap items-center justify-between gap-4 border-b border-slate-200 bg-white px-6 py-3">
          <div className="flex items-center gap-3 min-w-0">
            <button
              type="button"
              onClick={() => setMobileMenuOpen((v) => !v)}
              className="lg:hidden rounded-lg border border-slate-200 p-1.5 text-slate-700"
              aria-label="Toggle navigation menu"
            >
              {mobileMenuOpen ? <X className="h-4 w-4" /> : <Menu className="h-4 w-4" />}
            </button>
            <div className="flex items-center gap-2 text-sm text-slate-500 truncate">
              <img
                src="/pwa-192x192.png"
                alt=""
                className="hidden sm:block h-6 w-6 rounded-md object-cover shrink-0"
              />
              <span className="font-medium text-slate-800 whitespace-nowrap">
                ASAN-Study_tool
              </span>
              <span aria-hidden="true">/</span>
              <span className="font-semibold text-slate-900 truncate">
                {SECTION_LABELS[section]}
              </span>
            </div>
          </div>

          {/* Center Global Navbar Search */}
          <div ref={searchRef} className="relative flex-1 max-w-md min-w-[200px]">
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
              <input
                type="search"
                value={searchQuery}
                onFocus={() => setSearchOpen(true)}
                onChange={(e) => {
                  setSearchQuery(e.target.value);
                  setSearchOpen(true);
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Escape') {
                    setSearchOpen(false);
                  } else if (e.key === 'Enter' && searchResults.length > 0) {
                    e.preventDefault();
                    handleNavClick(searchResults[0].section);
                    setSearchQuery('');
                  }
                }}
                placeholder="Search notes, tasks, calendar, exams, tools..."
                className="w-full rounded-lg border border-slate-200 bg-slate-50 pl-9 pr-3 py-1.5 text-xs text-slate-800 focus:border-blue-500 focus:bg-white focus:outline-none"
              />
            </div>

            {searchOpen && searchQuery.trim().length > 0 && (
              <div className="absolute left-0 right-0 mt-1.5 rounded-xl border border-slate-200 bg-white shadow-lg overflow-hidden z-40">
                {searchResults.length === 0 ? (
                  <div className="px-4 py-3 text-xs text-slate-500">
                    No matching items or sections for &ldquo;{searchQuery}&rdquo;.
                  </div>
                ) : (
                  <div className="divide-y divide-slate-100 max-h-72 overflow-y-auto">
                    {searchResults.map((res) => (
                      <button
                        key={res.id}
                        type="button"
                        onClick={() => {
                          handleNavClick(res.section);
                          setSearchQuery('');
                        }}
                        className="flex w-full items-center justify-between gap-2 px-4 py-2.5 text-left hover:bg-slate-50"
                      >
                        <div className="min-w-0">
                          <div className="truncate text-xs font-semibold text-slate-900">
                            {res.title}
                          </div>
                          <div className="truncate text-[11px] text-slate-500">
                            {res.subtitle}
                          </div>
                        </div>
                        <span className="text-[11px] font-medium text-blue-600 shrink-0">
                          Open
                        </span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Right: Notification Bell Popover + Points/Plan CTA */}
          <div className="flex items-center gap-2.5 shrink-0">
            <div ref={bellRef} className="relative">
              <button
                type="button"
                onClick={() => setBellOpen((v) => !v)}
                aria-label="Notifications"
                className="relative rounded-lg border border-slate-200 bg-white p-2 text-slate-600 hover:bg-slate-50 hover:text-slate-900"
              >
                <Bell className="h-4 w-4" />
                {unreadNotifCount > 0 && (
                  <span className="absolute -right-1 -top-1 flex h-4 min-w-[16px] items-center justify-center rounded-full bg-blue-600 px-1 text-[10px] font-bold text-white tabular-nums">
                    {unreadNotifCount}
                  </span>
                )}
              </button>

              {bellOpen && (
                <div className="absolute right-0 mt-2 w-80 rounded-xl border border-slate-200 bg-white shadow-lg z-40 overflow-hidden">
                  <div className="flex items-center justify-between border-b border-slate-100 px-4 py-2.5">
                    <span className="text-xs font-semibold text-slate-900">
                      Notifications
                    </span>
                    <button
                      type="button"
                      onClick={() => handleNavClick('notifications')}
                      className="text-[11px] font-medium text-blue-600 hover:underline"
                    >
                      Send / View All
                    </button>
                  </div>
                  {isGuest ? (
                    <div className="p-4 text-xs text-slate-500 space-y-2">
                      <p>Sign in to send and receive real-time study notifications.</p>
                      <button
                        type="button"
                        onClick={signIn}
                        className="rounded-md bg-blue-600 px-3 py-1.5 text-[11px] font-medium text-white"
                      >
                        Sign in with Google
                      </button>
                    </div>
                  ) : notifications.length === 0 ? (
                    <div className="p-4 text-center text-xs text-slate-500">
                      No notifications yet.
                    </div>
                  ) : (
                    <div className="divide-y divide-slate-100 max-h-64 overflow-y-auto">
                      {notifications.slice(0, 6).map((n) => (
                        <div key={n.id} className="px-4 py-2.5 space-y-0.5">
                          <div className="flex items-center justify-between gap-2">
                            <span className="truncate text-xs font-semibold text-slate-900">
                              {n.title}
                            </span>
                            {!n.isRead && (
                              <span className="text-[10px] font-semibold text-blue-600 shrink-0">
                                New
                              </span>
                            )}
                          </div>
                          <p className="line-clamp-2 text-[11px] text-slate-600">
                            {n.message}
                          </p>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>

            <PWAInstallButton />

            {!isGuest &&
              dbUser?.viewPlanMode === 'basic' &&
              (dbUser.plan === 'pro' || dbUser.role === 'admin') && (
                <button
                  type="button"
                  onClick={() => setViewPlanMode('auto')}
                  className="rounded-lg border border-blue-200 bg-blue-50 px-2.5 py-1.5 text-xs font-semibold text-blue-700 hover:bg-blue-100 whitespace-nowrap shrink-0"
                >
                  Basic Preview · Exit
                </button>
              )}

            {isGuest ? (
              <button
                type="button"
                onClick={signIn}
                className="rounded-lg bg-blue-600 px-3.5 py-1.5 text-xs font-semibold text-white hover:bg-blue-700 whitespace-nowrap shrink-0"
              >
                Free Tier · Sign In
              </button>
            ) : (
              <button
                type="button"
                onClick={() => handleNavClick('subscriptions')}
                className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-medium text-slate-800 hover:bg-slate-100 whitespace-nowrap shrink-0 tabular-nums"
              >
                {dbUser && (
                  <UserAvatarBadge
                    name={dbUser.displayName}
                    photoUrl={dbUser.photoUrl}
                    plan={dbUser.plan}
                    role={dbUser.role}
                    contributorApproved={dbUser.contributorApproved}
                    size="sm"
                  />
                )}
                <span>
                  {dbUser?.points ?? 0} pts · {effectivePlan.toUpperCase()}
                  {dbUser?.shortUid ? ` · ${dbUser.shortUid}` : ''}
                </span>
              </button>
            )}
          </div>
        </header>

        <main className="flex-1 p-6 lg:p-8 max-w-[1440px] w-full mx-auto">
          {dataError && (
            <div className="mb-6 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-xs text-red-700">
              {dataError}
            </div>
          )}

          {dataLoading && tasks.length === 0 && notePages.length === 0 ? (
            <div className="space-y-4">
              <div className="h-10 w-64 animate-pulse rounded-lg bg-slate-200" />
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-4">
                <div className="h-24 animate-pulse rounded-xl bg-slate-200" />
                <div className="h-24 animate-pulse rounded-xl bg-slate-200" />
                <div className="h-24 animate-pulse rounded-xl bg-slate-200" />
                <div className="h-24 animate-pulse rounded-xl bg-slate-200" />
              </div>
            </div>
          ) : (
            <>
              {section === 'dashboard' && (
                <DashboardView
                  dbUser={dbUser}
                  tasks={tasks}
                  events={events}
                  notebooks={notebooks}
                  notePages={notePages}
                  exams={exams}
                  studyLogs={studyLogs}
                  onNavigate={setSection}
                />
              )}
              {section === 'calendar' && (
                <CalendarView
                  events={events}
                  tasks={tasks}
                  exams={exams}
                  onRefresh={loadAllStudyData}
                />
              )}
              {section === 'tasks' && (
                <TasksView tasks={tasks} onRefresh={loadAllStudyData} />
              )}
              {section === 'notes' && (
                <NotesView
                  notebooks={notebooks}
                  notePages={notePages}
                  onRefresh={loadAllStudyData}
                  onShareViaMessage={(docId) => {
                    setPreselectedMessageNoteId(docId);
                    setSection('messages');
                  }}
                />
              )}
              {section === 'timers' && (
                <TimersView
                  exams={exams}
                  studyLogs={studyLogs}
                  onRefresh={loadAllStudyData}
                />
              )}
              {section === 'messages' && (
                <MessagesView
                  notePages={notePages}
                  preselectedNoteId={preselectedMessageNoteId}
                />
              )}
              {section === 'study-materials' && <StudyMaterialView />}
              {section === 'subscriptions' && <SubscriptionsView />}
              {section === 'notifications' && (
                <NotificationsView onCountChange={setUnreadNotifCount} />
              )}
              {section === 'admin' && <AdminView />}
              {section === 'pdf-tool' &&
                (isProOrAdmin ? (
                  <PdfStudioView />
                ) : (
                  <ProGateCard
                    featureName="PDF Tool · A4 Booklet & Imposition Studio"
                    description="Create imposed Full, Half, and Quarter A4 booklets with clipboard image & 10pt text placeholders, Autocorrect, fold/cut guidelines, and direct PDF/PNG export. Excluded from Free & Basic plans."
                    onNavigate={setSection}
                  />
                ))}
              {section === 'workspace' &&
                (isProOrAdmin ? (
                  <WorkspaceView tasks={tasks} events={events} exams={exams} />
                ) : (
                  <ProGateCard
                    featureName="Google Workspace (Opt-In Drive Folder & Sheets Sync)"
                    description="Connect your dedicated ASAN-user-content Google Drive folder, maintain schedules in Google Sheets, export Google Docs, and launch Google Meet rooms. Excluded from Free & Basic plans."
                    onNavigate={setSection}
                  />
                ))}
              {section === 'spectra' &&
                (isProOrAdmin ? (
                  <SpectraView />
                ) : (
                  <ProGateCard
                    featureName="Spectra AI External Portal"
                    description="Configure and launch your external Spectra AI portal directly from your study workspace. Excluded from Free & Basic plans."
                    onNavigate={setSection}
                  />
                ))}
              {section === 'more' && <MoreFeaturesView />}
              {section === 'plans' && <PlansView onNavigate={setSection} />}
              {section === 'about' && <AboutCreatorsView />}
              {section === 'contact' && <ContactView />}
            </>
          )}
        </main>
      </div>
      <OfflineIndicator />
    </div>
  );
};

export default function App() {
  return (
    <AuthProvider>
      <MainShell />
    </AuthProvider>
  );
}
