import React from 'react';
import { BookOpen, Calendar, Clock, Coins, Lock, Mail } from 'lucide-react';
import { useAuth } from '../context/AuthContext';

export const AuthGate: React.FC = () => {
  const { signIn, continueFreeGuest, loading, error } = useAuth();

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 flex flex-col">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-8 px-6 py-4">
          <div className="flex items-center gap-2.5 shrink-0">
            <img
              src="/pwa-192x192.png"
              alt="ASAN-Study_tool"
              className="h-8 w-8 rounded-lg object-cover shadow-xs"
            />
            <span className="font-display text-lg font-bold tracking-tight text-slate-900 whitespace-nowrap">
              ASAN-Study_tool
            </span>
          </div>
          <div className="flex items-center gap-6 text-sm font-medium text-slate-600">
            <span className="hidden sm:inline whitespace-nowrap shrink-0">
              Free Tier · Basic (500 Pts on Login) · Pro
            </span>
          </div>
          <div className="flex items-center gap-2.5 shrink-0">
            <button
              type="button"
              onClick={continueFreeGuest}
              className="rounded-lg border border-slate-200 bg-white px-3.5 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50 transition-colors whitespace-nowrap"
            >
              Free Tier (No Login)
            </button>
            <button
              type="button"
              onClick={signIn}
              disabled={loading}
              className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 transition-colors whitespace-nowrap disabled:opacity-60"
            >
              {loading ? 'Signing in...' : 'Sign In'}
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto grid max-w-6xl flex-1 grid-cols-1 items-center gap-12 px-6 py-12 lg:grid-cols-12">
        <div className="lg:col-span-7 space-y-6">
          <div className="text-xs font-medium tracking-wide text-slate-500">
            Academic Workspace · Free Tier or Basic with 500 Welcome Points
          </div>
          <h1 className="font-display text-4xl font-bold tracking-tight text-slate-900 sm:text-5xl text-balance">
            Structured A4 notebooks, exam timers, and study planning in one workspace.
          </h1>
          <p className="max-w-xl text-base leading-relaxed text-slate-600">
            Start right away on the Free Tier (up to 10 A4 PDF notes &amp; 150 tasks locally), or sign in with Google for the Basic plan with <strong>500 initial points</strong>, unlimited PDF notes &amp; tasks stored in your own Google Drive folder, Tool Mail, and 8-character Pro License Keys.
          </p>

          <div className="pt-2 flex flex-wrap items-center gap-4">
            <button
              type="button"
              onClick={signIn}
              disabled={loading}
              className="gsi-material-button shadow-xs"
            >
              <div className="gsi-material-button-state"></div>
              <div className="gsi-material-button-content-wrapper">
                <div className="gsi-material-button-icon">
                  <svg
                    version="1.1"
                    xmlns="http://www.w3.org/2000/svg"
                    viewBox="0 0 48 48"
                    style={{ display: 'block' }}
                  >
                    <path
                      fill="#EA4335"
                      d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"
                    />
                    <path
                      fill="#4285F4"
                      d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"
                    />
                    <path
                      fill="#FBBC05"
                      d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"
                    />
                    <path
                      fill="#34A853"
                      d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"
                    />
                  </svg>
                </div>
                <span className="gsi-material-button-contents">
                  Sign in with Google (Basic · 500 Pts)
                </span>
              </div>
            </button>

            <button
              type="button"
              onClick={continueFreeGuest}
              className="rounded-lg border border-slate-300 bg-white px-4 py-2.5 text-sm font-medium text-slate-800 hover:bg-slate-100 transition-colors whitespace-nowrap"
            >
              Continue on Free Tier (No Login)
            </button>
          </div>

          <p className="text-xs text-slate-500">
            No Drive or external permissions are ever requested on login. Drive folder access is strictly opt-in.
          </p>

          {error && (
            <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
              {error}
            </div>
          )}
        </div>

        <div className="lg:col-span-5">
          <div className="rounded-xl border border-slate-200 bg-white p-6 space-y-5">
            <h2 className="font-display text-base font-semibold text-slate-900">
              Tier &amp; Points Structure
            </h2>
            <div className="divide-y divide-slate-100">
              <div className="flex items-start gap-3 py-3 first:pt-0">
                <BookOpen className="mt-0.5 h-4 w-4 text-blue-600 shrink-0" />
                <div>
                  <div className="text-sm font-medium text-slate-900">
                    Free Tier vs Basic Login
                  </div>
                  <p className="text-xs text-slate-500">
                    Free Tier supports up to 10 A4 PDF notes &amp; 150 tasks locally. Basic (Google Sign-In) unlocks unlimited PDFs &amp; tasks with optional ASAN-user-content Drive folder .txt storage.
                  </p>
                </div>
              </div>
              <div className="flex items-start gap-3 py-3">
                <Coins className="mt-0.5 h-4 w-4 text-amber-600 shrink-0" />
                <div>
                  <div className="text-sm font-medium text-slate-900">
                    500 Initial Points &amp; Study Rewards
                  </div>
                  <p className="text-xs text-slate-500">
                    Earn +75 pts uploading question papers, +10 pts per 30 mins on Exam Timers, and +5 pts per study-verified Calendar event. Unlock Pro for 500 pts/month.
                  </p>
                </div>
              </div>
              <div className="flex items-start gap-3 py-3">
                <Clock className="mt-0.5 h-4 w-4 text-blue-600 shrink-0" />
                <div>
                  <div className="text-sm font-medium text-slate-900">
                    Exam Test Timers &amp; Microsecond Stopwatch
                  </div>
                  <p className="text-xs text-slate-500">
                    JEE, NEET, CBSE, ISC &amp; CUET timers with seating schedules, reading/writing phases, and automated audio alarms.
                  </p>
                </div>
              </div>
              <div className="flex items-start gap-3 py-3">
                <Mail className="mt-0.5 h-4 w-4 text-blue-600 shrink-0" />
                <div>
                  <div className="text-sm font-medium text-slate-900">
                    Tool Mail (Username, User ID, Public &amp; Self)
                  </div>
                  <p className="text-xs text-slate-500">
                    Send direct, multi-recipient, self-archived, or public mail to ASAN-Study_tool users with live suggestions.
                  </p>
                </div>
              </div>
              <div className="flex items-start gap-3 py-3 last:pb-0">
                <Lock className="mt-0.5 h-4 w-4 text-slate-400 shrink-0" />
                <div>
                  <div className="text-sm font-medium text-slate-700">
                    Pro Plan &amp; 8-Char License Keys
                  </div>
                  <p className="text-xs text-slate-500">
                    Pro requires sign-in (500 pts/month or 8-char License Key) and unlocks PDF Booklet Studio, Spectra AI, and full Google Sheets/Docs/Meet Workspace.
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
};
