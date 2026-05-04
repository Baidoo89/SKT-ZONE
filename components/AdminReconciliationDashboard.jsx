"use client";

import { useCallback, useEffect, useState } from "react";
import {
  AlertTriangle,
  ArrowUpRight,
  BadgeCheck,
  Banknote,
  CircleDollarSign,
  Clock3,
  CreditCard,
  DatabaseZap,
  Loader2,
  LogOut,
  RefreshCw,
  ReceiptText,
  ShieldCheck,
  Sparkles,
  UserRound,
  Wallet,
  Zap,
} from "lucide-react";
import ClientClock from "./ClientClock.jsx";

const EMPTY_FORM = {
  userRef: "",
  amount: "",
  momoRef: "",
};
const ADMIN_NAME_STORAGE_KEY = "dataflow_admin_name";
const ADMIN_KEY_STORAGE_KEY = "dataflow_admin_action_key";

function formatCurrency(amount) {
  return new Intl.NumberFormat("en-GH", {
    style: "currency",
    currency: "GHS",
    maximumFractionDigits: 0,
  }).format(Number(amount ?? 0));
}

function formatDateTime(value) {
  return new Intl.DateTimeFormat("en-GB", {
    weekday: "short",
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(new Date(value));
}

function sourceBadgeClass(source) {
  switch (source) {
    case "Paystack":
      return "bg-sky-50 text-sky-700 ring-sky-200";
    case "Manual Admin":
      return "bg-indigo-50 text-indigo-700 ring-indigo-200";
    case "Debt Clearance":
      return "bg-rose-50 text-rose-700 ring-rose-200";
    default:
      return "bg-slate-100 text-slate-700 ring-slate-200";
  }
}

function sourceDotClass(source) {
  switch (source) {
    case "Paystack":
      return "bg-sky-500";
    case "Manual Admin":
      return "bg-indigo-500";
    case "Debt Clearance":
      return "bg-rose-500";
    default:
      return "bg-slate-400";
  }
}

export default function AdminReconciliationDashboard({ initialSessionAuthEnabled = false }) {
  const [adminName, setAdminName] = useState("Admin Desk");
  const [adminKey, setAdminKey] = useState("");
  const [authState, setAuthState] = useState({
    sessionAuthEnabled: Boolean(initialSessionAuthEnabled),
    authenticated: false,
    user: null,
    loading: true,
  });
  const [loginForm, setLoginForm] = useState({ username: "", password: "" });
  const [loginPending, setLoginPending] = useState(false);
  const [dashboard, setDashboard] = useState({
    ledgerRows: [],
    debtors: [],
    latestAudit: null,
    auditHistory: [],
    totals: {
      cashInToday: 0,
      paystackSync: 0,
      activeDebtBoard: 0,
      activeDebtAmount: 0,
      totalDebtors: 0,
    },
    settings: {
      actionAuthEnabled: false,
      sessionAuthEnabled: false,
    },
    fetchedAt: null,
  });
  const [paystackFeed, setPaystackFeed] = useState({
    transactions: [],
    configured: false,
    loading: true,
    note: "",
    fetchedAt: null,
  });
  const [loading, setLoading] = useState(true);
  const [pendingAction, setPendingAction] = useState(null);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [form, setForm] = useState(EMPTY_FORM);
  const [debtForm, setDebtForm] = useState({ userRef: "", displayName: "", amount: "", priorityRank: 0 });
  const [suggestions, setSuggestions] = useState({}); // map debtorId -> matches
  const currentOperator = adminName.trim() || "Admin Desk";

  useEffect(() => {
    const savedAdminName = window.localStorage.getItem(ADMIN_NAME_STORAGE_KEY);
    if (savedAdminName?.trim()) {
      setAdminName(savedAdminName.trim());
    }

    const savedAdminKey = window.localStorage.getItem(ADMIN_KEY_STORAGE_KEY);
    if (savedAdminKey?.trim()) {
      setAdminKey(savedAdminKey);
    }
  }, []);

  const loadSession = useCallback(async (attempt = 0) => {
    try {
      const response = await fetch("/api/auth/session", {
        method: "GET",
        cache: "no-store",
      });

      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        throw new Error(payload.error || "Failed to verify admin session.");
      }

      const payload = await response.json();

      setAuthState((current) => ({
        ...current,
        sessionAuthEnabled: Boolean(payload.sessionAuthEnabled) || current.sessionAuthEnabled,
        authenticated: Boolean(payload.authenticated),
        user: payload.user ?? null,
        loading: false,
      }));
    } catch (err) {
      if (attempt < 1) {
        window.setTimeout(() => {
          void loadSession(attempt + 1);
        }, 300);
        return;
      }

      setAuthState((current) => ({ ...current, loading: false }));
    }
  }, []);

  useEffect(() => {
    window.localStorage.setItem(ADMIN_NAME_STORAGE_KEY, currentOperator);
  }, [currentOperator]);

  useEffect(() => {
    if (adminKey.trim()) {
      window.localStorage.setItem(ADMIN_KEY_STORAGE_KEY, adminKey.trim());
      return;
    }

    window.localStorage.removeItem(ADMIN_KEY_STORAGE_KEY);
  }, [adminKey]);

  const loadSnapshot = useCallback(async ({ silent = false, attempt = 0 } = {}) => {
    if (!silent) {
      setLoading(true);
    }

    try {
      const response = await fetch("/api/reconciliation", {
        method: "GET",
        cache: "no-store",
      });
      
      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        throw new Error(payload.error || "Failed to load reconciliation data.");
      }

      const payload = await response.json();
      setDashboard(payload.snapshot);
      setError("");
    } catch (fetchError) {
      if (attempt < 2) {
        window.setTimeout(() => {
          void loadSnapshot({ silent: true, attempt: attempt + 1 });
        }, 500);
        return;
      }

      setError(fetchError instanceof Error ? fetchError.message : "Failed to load reconciliation data.");
    } finally {
      setLoading(false);
    }
  }, []);

  const loadPaystackFeed = useCallback(async ({ silent = false, attempt = 0 } = {}) => {
    if (!silent) {
      setPaystackFeed((current) => ({ ...current, loading: true }));
    }

    try {
      const response = await fetch("/api/paystack/transactions?perPage=8", {
        method: "GET",
        cache: "no-store",
      });
      const payload = await response.json().catch(() => ({}));

      if (!response.ok) {
        throw new Error(payload.error || "Failed to load Paystack transactions.");
      }

      setPaystackFeed({
        transactions: Array.isArray(payload.transactions) ? payload.transactions : [],
        configured: Boolean(payload.configured),
        loading: false,
        note: String(payload.note ?? ""),
        fetchedAt: payload.fetchedAt ?? new Date().toISOString(),
      });
    } catch {
      if (attempt < 1) {
        window.setTimeout(() => {
          void loadPaystackFeed({ silent: true, attempt: attempt + 1 });
        }, 400);
        return;
      }

      setPaystackFeed((current) => ({
        ...current,
        loading: false,
        note: current.configured ? "Unable to refresh Paystack feed right now." : current.note,
      }));
    }
  }, []);

  useEffect(() => {
    void loadSnapshot();
  }, [loadSnapshot]);

  useEffect(() => {
    void loadSession();
  }, [loadSession]);

  useEffect(() => {
    void loadPaystackFeed();
  }, [loadPaystackFeed]);

  useEffect(() => {
    const refreshTimer = window.setInterval(() => {
      void loadSnapshot({ silent: true });
      void loadPaystackFeed({ silent: true });
    }, 300000);

    return () => window.clearInterval(refreshTimer);
  }, [loadPaystackFeed, loadSnapshot]);

  const submitAction = async (body, successMessage) => {
    setPendingAction(body.action);
    setError("");
    setNotice("");

    try {
      const response = await fetch("/api/reconciliation", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(adminKey.trim() ? { "x-admin-key": adminKey.trim() } : {}),
        },
        body: JSON.stringify(body),
      });

      const payload = await response.json();

      if (!response.ok) {
        if (response.status === 401) {
          await loadSession();
        }
        throw new Error(payload.error || "Request failed.");
      }

      if (payload.snapshot) {
        setDashboard(payload.snapshot);
      } else {
        await loadSnapshot({ silent: true });
      }

      setNotice(successMessage || payload.message || "Updated successfully.");
      if (body.action === "topup") {
        setForm(EMPTY_FORM);
      }
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : "Request failed.");
    } finally {
      setPendingAction(null);
    }
  };

  const handleTopupSubmit = async (event) => {
    event.preventDefault();
    const amount = Number(form.amount);

    await submitAction(
      {
        action: "topup",
        userRef: form.userRef,
        amount,
        momoRef: form.momoRef,
        processedBy: currentOperator,
      },
      "Wallet credited and logged."
    );
  };

  const handleClearDebt = async (userRef, amount = null, momoRef = null) => {
    let amountToUse = amount;
    if (!Number.isFinite(amountToUse)) {
      // ask for optional amount to clear (blank = full clear)
      const input = window.prompt("Enter amount to clear (leave blank to clear full debt):");
      if (input === null) return;
      if (String(input).trim() !== "") {
        const parsed = Number(input);
        if (!Number.isFinite(parsed) || parsed <= 0) {
          window.alert("Please enter a valid positive number.");
          return;
        }
        amountToUse = parsed;
      }
    }

    await submitAction(
      {
        action: "clearDebt",
        userRef,
        amount: amountToUse,
        momoRef: momoRef ?? undefined,
        processedBy: currentOperator,
      },
      "Debt cleared and logged."
    );
  };

  const handleCreateDebt = async (event) => {
    event.preventDefault();
    const amount = Number(debtForm.amount);
    if (!debtForm.userRef || !Number.isFinite(amount) || amount <= 0) {
      setError("Provide a valid user and amount for the debt.");
      return;
    }

    await submitAction(
      {
        action: "createDebt",
        userRef: debtForm.userRef,
        displayName: debtForm.displayName || debtForm.userRef,
        amount,
        priorityRank: Number(debtForm.priorityRank) || 0,
        processedBy: currentOperator,
      },
      "Debt record created."
    );

    setDebtForm({ userRef: "", displayName: "", amount: "", priorityRank: 0 });
  };

  const handleSuggestMatches = async (userRef, debtorId, amount) => {
    try {
      setSuggestions((s) => ({ ...s, [debtorId]: { loading: true, matches: [] } }));
      const response = await fetch("/api/reconciliation", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(adminKey.trim() ? { "x-admin-key": adminKey.trim() } : {}),
        },
        body: JSON.stringify({ action: "suggestMatches", userRef, amount }),
      });

      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload.error || "Failed to get suggestions.");
      }

      setSuggestions((s) => ({ ...s, [debtorId]: { loading: false, matches: payload.matches || [] } }));
    } catch (err) {
      setSuggestions((s) => ({ ...s, [debtorId]: { loading: false, matches: [] } }));
      setError(err instanceof Error ? err.message : "Failed to fetch suggestions.");
    }
  };

  const handleReconcile = async () => {
    await submitAction(
      {
        action: "reconcile",
      },
      "End-of-day reconciliation recorded."
    );
  };

  const handleLogin = async (event) => {
    event.preventDefault();
    setLoginPending(true);
    setNotice("");
    setError("");

    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(loginForm),
      });
      const payload = await response.json();

      if (!response.ok) {
        throw new Error(payload.error || "Login failed.");
      }

      setAuthState({
        sessionAuthEnabled: true,
        authenticated: true,
        user: payload.user ?? loginForm.username,
        loading: false,
      });
      setNotice("Signed in successfully.");
      setLoginForm({ username: "", password: "" });
    } catch (loginError) {
      setError(loginError instanceof Error ? loginError.message : "Login failed.");
    } finally {
      setLoginPending(false);
    }
  };

  const handleLogout = async () => {
    try {
      await fetch("/api/auth/logout", {
        method: "POST",
      });
    } finally {
      setAuthState((current) => ({
        ...current,
        authenticated: false,
        user: null,
      }));
      setNotice("You have been signed out.");
    }
  };

  const totalCashInToday = dashboard.totals.cashInToday;
  const paystackSync = dashboard.totals.paystackSync;
  const activeDebtBoard = dashboard.totals.activeDebtBoard;
  const activeDebtAmount = dashboard.totals.activeDebtAmount;
  const totalDebtors = dashboard.totals.totalDebtors;
  const latestAudit = dashboard.latestAudit;
  const auditHistory = dashboard.auditHistory;
  const actionAuthEnabled = Boolean(dashboard.settings?.actionAuthEnabled);
  
  // Check session auth from BOTH auth state AND dashboard settings
  const sessionAuthFromAuthState = Boolean(authState.sessionAuthEnabled);
  const sessionAuthFromSettings = Boolean(dashboard.settings?.sessionAuthEnabled);
  const sessionAuthEnabled = sessionAuthFromAuthState || sessionAuthFromSettings || Boolean(initialSessionAuthEnabled);
  
  const actionReady = sessionAuthEnabled
    ? authState.authenticated && Boolean(adminName.trim())
    : (!actionAuthEnabled || Boolean(adminKey.trim())) && Boolean(adminName.trim());
  const matchStatus = latestAudit?.matchStatus ?? "PENDING";
  const matchProgress = latestAudit ? 100 : 0;
  const ledgerRows = dashboard.ledgerRows;
  const paystackTransactions = paystackFeed.transactions;
  const isBootstrapping = loading || authState.loading;
  const displayError = isBootstrapping ? "" : error;
  const displayNotice = isBootstrapping ? "" : notice;

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <div className="mx-auto min-w-0 max-w-7xl px-2 py-2 sm:px-6 sm:py-6 lg:px-8">
        <div className="min-w-0 space-y-3 sm:space-y-6">
          <header className="min-w-0 rounded-3xl border border-slate-200 bg-white p-3 shadow-sm shadow-slate-200/60 sm:p-6">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
              <div className="space-y-2">
                <div className="inline-flex items-center gap-2 rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold uppercase tracking-[0.24em] text-slate-600">
                  <Sparkles className="h-4 w-4 text-indigo-600" />
                  SK T ZONE Admin
                </div>
                <div>
                  <h1 className="text-2xl font-semibold tracking-tight text-slate-900 sm:text-3xl">
                    SK T ZONE — Admin Reconciliation Hub
                  </h1>
                  <p className="mt-1 text-sm text-slate-500">
                    Live reconciliation and settlement dashboard for SK T ZONE operations.
                  </p>
                </div>
              </div>

              <div className="min-w-0 flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center">
                <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 shadow-sm sm:min-w-52">
                  <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-[0.2em] text-slate-500">
                    <Clock3 className="h-4 w-4 text-slate-400" />
                    Current Time
                  </div>
                  <div className="mt-1 text-sm font-semibold text-slate-900"><ClientClock /></div>
                </div>

                <div className="rounded-2xl border border-slate-200 bg-white p-3 shadow-sm sm:min-w-68">
                  <div className="mb-2 text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">
                    Operator: {authState.user || currentOperator}
                  </div>

                  <div>
                    <label className="mb-2 block text-sm font-medium text-slate-700" htmlFor="adminName">
                      Processed By
                    </label>
                    <div className="relative">
                      <UserRound className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                      <input
                        id="adminName"
                        type="text"
                        value={adminName}
                        onChange={(event) => setAdminName(event.target.value)}
                        placeholder="Admin Desk"
                        className="w-full rounded-2xl border border-slate-200 bg-slate-50 py-2.5 pl-10 pr-4 text-sm text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-indigo-500 focus:bg-white focus:ring-4 focus:ring-indigo-100"
                      />
                    </div>
                  </div>

                  {sessionAuthEnabled && !authState.authenticated ? (
                    <form className="mt-3 space-y-3" onSubmit={handleLogin}>
                      <div>
                        <label className="mb-2 block text-sm font-medium text-slate-700" htmlFor="loginUsername">
                          Admin Username
                        </label>
                        <input
                          id="loginUsername"
                          type="text"
                          value={loginForm.username}
                          onChange={(event) =>
                            setLoginForm((current) => ({ ...current, username: event.target.value }))
                          }
                          placeholder="admin"
                          className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-2.5 text-sm text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-indigo-500 focus:bg-white focus:ring-4 focus:ring-indigo-100"
                        />
                      </div>
                      <div>
                        <label className="mb-2 block text-sm font-medium text-slate-700" htmlFor="loginPassword">
                          Password
                        </label>
                        <input
                          id="loginPassword"
                          type="password"
                          value={loginForm.password}
                          onChange={(event) =>
                            setLoginForm((current) => ({ ...current, password: event.target.value }))
                          }
                          placeholder="••••••••"
                          className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-2.5 text-sm text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-indigo-500 focus:bg-white focus:ring-4 focus:ring-indigo-100"
                        />
                      </div>
                      <button
                        type="submit"
                        disabled={loginPending}
                        className="inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-70"
                      >
                        {loginPending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                        Sign In
                      </button>
                    </form>
                  ) : authState.authenticated ? (
                    <div className="mt-3 flex items-center justify-between rounded-2xl bg-emerald-50 px-3 py-2 text-xs text-emerald-700 font-medium">
                      <span className="flex items-center gap-2">
                        <BadgeCheck className="h-4 w-4" />
                        Signed in as {authState.user}
                      </span>
                      <button
                        type="button"
                        onClick={handleLogout}
                        className="inline-flex items-center gap-1 font-semibold text-emerald-600 hover:text-emerald-700"
                      >
                        <LogOut className="h-3.5 w-3.5" />
                        Sign Out
                      </button>
                    </div>
                  ) : (
                    <div className="mt-3 rounded-2xl bg-amber-50 px-3 py-2 text-xs text-amber-700 border border-amber-200">
                      {sessionAuthFromSettings && !sessionAuthFromAuthState && authState.loading ? (
                        <span>Loading session status...</span>
                      ) : (
                        <span>Session authentication not configured or unavailable</span>
                      )}
                    </div>
                  )}

                  {!sessionAuthEnabled && actionAuthEnabled && (
                    <div className="mt-3">
                      <label className="mb-2 block text-sm font-medium text-slate-700" htmlFor="adminActionKey">
                        Action Key
                      </label>
                      <input
                        id="adminActionKey"
                        type="password"
                        value={adminKey}
                        onChange={(event) => setAdminKey(event.target.value)}
                        placeholder="Enter admin action key"
                        className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-2.5 text-sm text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-indigo-500 focus:bg-white focus:ring-4 focus:ring-indigo-100"
                      />
                    </div>
                  )}
                </div>

                <button
                  type="button"
                  onClick={handleReconcile}
                  disabled={pendingAction !== null || !actionReady}
                  className="inline-flex w-full sm:w-auto items-center justify-center gap-2 rounded-2xl bg-indigo-600 px-5 py-3 text-sm font-semibold text-white shadow-sm transition hover:bg-indigo-700 hover:shadow-md focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-70"
                >
                  {pendingAction === "reconcile" ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <ShieldCheck className="h-4 w-4" />
                  )}
                  Run End-of-Day Reconciliation
                </button>
              </div>
            </div>
          </header>

          {isBootstrapping ? (
            <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600">
              Loading dashboard and auth status...
            </div>
          ) : null}

          {(displayNotice || displayError) && (
            <div
              className={`rounded-2xl border p-4 text-sm shadow-sm ${
                displayError
                  ? "border-rose-200 bg-rose-50 text-rose-700"
                  : "border-emerald-200 bg-emerald-50 text-emerald-700"
              }`}
            >
              {displayError || displayNotice}
            </div>
          )}

          {actionAuthEnabled && (
            <div className="rounded-2xl border border-indigo-200 bg-indigo-50 px-4 py-3 text-sm text-indigo-700">
              {sessionAuthEnabled
                ? "Write protection is active. Sign in with admin credentials to run protected actions."
                : "Write protection is active. Enter a valid action key to run top-ups, debt clearance, or reconciliation."}
            </div>
          )}

          <section className="grid gap-3 md:grid-cols-3">
            <MetricCard
              title="Total Cash In Today"
              value={formatCurrency(totalCashInToday)}
              detail="Across all captured channels"
              icon={<Banknote className="h-5 w-5" />}
              accent="emerald"
            />
            <MetricCard
              title="Paystack API Sync"
              value={`${paystackSync.toFixed(1)}%`}
              detail="Queue latency and webhook alignment"
              icon={<DatabaseZap className="h-5 w-5" />}
              accent="sky"
            />
            <MetricCard
              title="Active Debt Owed"
              value={formatCurrency(activeDebtAmount)}
              detail={`${totalDebtors} debtor account(s) across ${activeDebtBoard} debt record(s)`}
              icon={<AlertTriangle className="h-5 w-5" />}
              accent="rose"
            />
          </section>

          <section className="rounded-3xl border border-slate-200 bg-white p-3 shadow-sm shadow-slate-200/60 sm:p-6">
            <div className="flex flex-col gap-4 border-b border-slate-200 pb-4 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h2 className="text-lg font-semibold text-slate-900">Live Paystack Feed</h2>
                <p className="mt-1 text-sm text-slate-500">
                  Direct transaction feed from Paystack. This is separate from the internal debt board.
                </p>
              </div>
              <div
                className={`inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs font-semibold ring-1 ring-inset ${
                  paystackFeed.loading
                    ? "bg-slate-100 text-slate-700 ring-slate-200"
                    : paystackFeed.configured
                      ? "bg-emerald-50 text-emerald-700 ring-emerald-200"
                      : "bg-amber-50 text-amber-700 ring-amber-200"
                }`}
              >
                <DatabaseZap className="h-4 w-4" />
                {paystackFeed.loading
                  ? "Syncing Paystack..."
                  : paystackFeed.configured
                    ? "Live feed connected"
                    : "Awaiting Paystack key"}
              </div>
            </div>

            {paystackFeed.note ? (
              <div className="mt-4 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600">
                {paystackFeed.note}
              </div>
            ) : null}

            <div className="mt-4 overflow-hidden rounded-2xl border border-slate-200">
              <div className="overflow-x-auto">
                <table className="w-full table-fixed divide-y divide-slate-200 text-left text-xs sm:text-sm">
                  <thead className="sticky top-0 bg-slate-50 text-xs uppercase tracking-[0.16em] text-slate-500">
                    <tr>
                      <th className="w-24 px-3 py-3 font-semibold sm:w-32 sm:px-4">Time</th>
                      <th className="w-32 px-3 py-3 font-semibold sm:w-52 sm:px-4">Customer</th>
                      <th className="w-28 px-3 py-3 font-semibold sm:w-48 sm:px-4">Reference</th>
                      <th className="w-20 px-3 py-3 font-semibold sm:w-28 sm:px-4">Amount</th>
                      <th className="w-20 px-3 py-3 font-semibold sm:w-28 sm:px-4">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 bg-white">
                    {!paystackTransactions.length && !paystackFeed.loading ? (
                      <tr>
                        <td colSpan={5} className="px-3 py-6 text-center text-slate-500 sm:px-4 sm:py-8">
                          No Paystack transactions found yet.
                        </td>
                      </tr>
                    ) : (
                      paystackTransactions.map((transaction) => (
                        <tr key={transaction.id} className="transition hover:bg-slate-50">
                          <td className="px-3 py-3 align-top text-slate-700 sm:px-4">
                            <div className="truncate font-medium">{transaction.createdAt ? formatDateTime(transaction.createdAt) : "-"}</div>
                          </td>
                          <td className="px-3 py-3 align-top text-slate-700 sm:px-4">
                            <div className="min-w-0">
                              <div className="font-medium text-slate-900">{transaction.customerName}</div>
                              {transaction.customerEmail ? (
                                <div className="truncate text-[11px] text-slate-500 sm:text-xs">{transaction.customerEmail}</div>
                              ) : null}
                            </div>
                          </td>
                          <td className="px-3 py-3 align-top text-slate-700 sm:px-4">
                            <div className="max-w-48 truncate font-medium text-slate-900">{transaction.reference}</div>
                          </td>
                          <td className="px-3 py-3 align-top whitespace-nowrap font-semibold text-emerald-600 sm:px-4">
                            {formatCurrency(transaction.amount)}
                          </td>
                          <td className="px-3 py-3 align-top text-slate-700 sm:px-4">
                            <span
                              className={`inline-flex whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-semibold ${
                                transaction.status === "success"
                                  ? "bg-emerald-50 text-emerald-700"
                                  : "bg-slate-100 text-slate-700"
                              }`}
                            >
                              {transaction.status}
                            </span>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </section>

          <section className="grid min-w-0 gap-3 xl:grid-cols-3 xl:gap-6">
            <div className="min-w-0 w-full xl:col-span-2 rounded-3xl border border-slate-200 bg-white p-3 shadow-sm shadow-slate-200/60 sm:p-6">
              <div className="min-w-0 flex flex-col gap-4 border-b border-slate-200 pb-4 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <h2 className="text-lg font-semibold text-slate-900">Internal Settlement Ledger</h2>
                  <p className="mt-1 text-sm text-slate-500">
                    Reconciliation-ready log of admin credits and debt settlements.
                  </p>
                </div>
                <div className="inline-flex items-center gap-2 rounded-full bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-700 ring-1 ring-inset ring-emerald-200">
                  <BadgeCheck className="h-4 w-4" />
                  {loading ? "Syncing..." : "All entries verified"}
                </div>
              </div>

              <div className="mt-4 min-w-0 overflow-hidden rounded-2xl border border-slate-200">
                <div className="min-w-0 overflow-x-auto">
                  <table className="w-full table-fixed divide-y divide-slate-200 text-left text-xs sm:text-sm">
                    <thead className="sticky top-0 bg-slate-50 text-xs uppercase tracking-[0.16em] text-slate-500">
                      <tr>
                        <th className="w-24 px-3 py-3 font-semibold sm:w-32 sm:px-4">Time</th>
                        <th className="w-28 px-3 py-3 font-semibold sm:w-48 sm:px-4">User</th>
                        <th className="w-28 px-3 py-3 font-semibold sm:w-40 sm:px-4">Source</th>
                        <th className="w-20 px-3 py-3 font-semibold sm:w-28 sm:px-4">Amount</th>
                        <th className="w-28 px-3 py-3 font-semibold sm:w-40 sm:px-4">Processed By</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 bg-white">
                      {!ledgerRows.length && !loading ? (
                        <tr>
                          <td colSpan={5} className="px-3 py-6 text-center text-slate-500 sm:px-4 sm:py-8">
                            No ledger entries yet. Use the top-up form or run a reconciliation action.
                          </td>
                        </tr>
                      ) : (
                        ledgerRows.map((row) => (
                          <tr key={row.id} className="transition hover:bg-slate-50">
                            <td className="px-3 py-3 align-top font-medium text-slate-700 sm:px-4">{row.time}</td>
                            <td className="px-3 py-3 align-top text-slate-700 sm:px-4">
                              <div className="min-w-0 truncate">{row.user}</div>
                            </td>
                            <td className="px-3 py-3 align-top sm:px-4">
                              <span
                                className={`inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs font-semibold ring-1 ring-inset ${sourceBadgeClass(row.source)}`}
                              >
                                <span className={`h-2 w-2 rounded-full ${sourceDotClass(row.source)}`} />
                                {row.source}
                              </span>
                            </td>
                            <td className="px-3 py-3 align-top whitespace-nowrap font-semibold text-emerald-600 sm:px-4">{formatCurrency(row.amount)}</td>
                            <td className="px-3 py-3 align-top text-slate-600 sm:px-4">
                              <div className="min-w-0 truncate">{row.admin}</div>
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>

            <div className="min-w-0 space-y-6">
              <div className="min-w-0 rounded-3xl border border-slate-200 bg-white p-3 shadow-sm shadow-slate-200/60 sm:p-6">
                <div className="min-w-0 flex items-center gap-3">
                  <div className="rounded-2xl bg-indigo-50 p-3 text-indigo-600">
                    <Wallet className="h-5 w-5" />
                  </div>
                  <div>
                    <h2 className="text-lg font-semibold text-slate-900">Manual Top-up Entry</h2>
                    <p className="text-sm text-slate-500">Credit wallets and attach a verifiable payment reference.</p>
                  </div>
                </div>

                <form className="mt-6 space-y-4" onSubmit={handleTopupSubmit}>
                  <div>
                    <label className="mb-2 block text-sm font-medium text-slate-700" htmlFor="userRef">
                      User ID / Phone
                    </label>
                    <div className="relative">
                      <UserRound className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                      <input
                        id="userRef"
                        type="text"
                        value={form.userRef}
                        onChange={(event) => setForm((current) => ({ ...current, userRef: event.target.value }))}
                        placeholder="e.g. 0244 123 456"
                        className="w-full rounded-2xl border border-slate-200 bg-slate-50 py-3 pl-10 pr-4 text-sm text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-indigo-500 focus:bg-white focus:ring-4 focus:ring-indigo-100"
                      />
                    </div>
                  </div>

                  <div>
                    <label className="mb-2 block text-sm font-medium text-slate-700" htmlFor="amount">
                      Amount
                    </label>
                    <div className="relative">
                      <CircleDollarSign className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                      <input
                        id="amount"
                        type="number"
                        min="1"
                        step="1"
                        value={form.amount}
                        onChange={(event) => setForm((current) => ({ ...current, amount: event.target.value }))}
                        placeholder="0"
                        className="w-full rounded-2xl border border-slate-200 bg-slate-50 py-3 pl-10 pr-4 text-sm text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-indigo-500 focus:bg-white focus:ring-4 focus:ring-indigo-100"
                      />
                    </div>
                  </div>

                  <div>
                    <label className="mb-2 block text-sm font-medium text-slate-700" htmlFor="momoRef">
                      Momo Ref #
                    </label>
                    <div className="relative">
                      <ReceiptText className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                      <input
                        id="momoRef"
                        type="text"
                        value={form.momoRef}
                        onChange={(event) => setForm((current) => ({ ...current, momoRef: event.target.value }))}
                        placeholder="TXN-REF-000128"
                        className="w-full rounded-2xl border border-slate-200 bg-slate-50 py-3 pl-10 pr-4 text-sm text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-indigo-500 focus:bg-white focus:ring-4 focus:ring-indigo-100"
                      />
                    </div>
                  </div>

                  <button
                    type="submit"
                    disabled={pendingAction !== null || !adminName.trim() || !actionReady}
                    className="inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-indigo-600 px-4 py-3 text-sm font-semibold text-white shadow-sm transition hover:bg-indigo-700 hover:shadow-md focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-70"
                  >
                    {pendingAction === "topup" ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <CreditCard className="h-4 w-4" />
                    )}
                    Credit Wallet &amp; Log
                  </button>
                </form>
              </div>

              <div className="min-w-0 rounded-3xl border border-rose-200 bg-white p-3 shadow-sm shadow-rose-100/70 sm:p-6">
                <div className="min-w-0 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div>
                    <h2 className="text-lg font-semibold text-slate-900">Admin Debt Board</h2>
                    <p className="mt-1 text-sm text-slate-500">
                      Manual debt records and settlements. Add debt, suggest candidate matches, then clear with proof.
                    </p>
                  </div>
                  <div className="rounded-2xl bg-rose-50 px-3 py-2 text-right">
                    <div className="text-xs font-medium uppercase tracking-[0.2em] text-rose-500">Total Debtors</div>
                    <div className="text-2xl font-semibold text-rose-600">{totalDebtors}</div>
                  </div>
                </div>

                <div className="mt-4 grid gap-3 sm:grid-cols-3">
                  <AuditStat label="Outstanding Debt" value={formatCurrency(activeDebtAmount)} />
                  <AuditStat label="Debtor Accounts" value={String(totalDebtors)} />
                  <AuditStat label="Open Debt Records" value={String(activeDebtBoard)} />
                </div>

                <div className="mt-4 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
                  Confirm payment first, then clear the debt here. Paystack transactions appear in the live feed above.
                </div>

                <div className="mt-6 space-y-3">
                  <form className="mb-4 rounded-3xl border border-rose-200 bg-linear-to-br from-rose-50 via-rose-50 to-amber-50 p-4 sm:p-5" onSubmit={handleCreateDebt}>
                    <div className="mb-3">
                      <h3 className="text-sm font-semibold uppercase tracking-[0.16em] text-rose-700">Create Debt Entry</h3>
                      <p className="mt-1 text-xs text-rose-600">Use this when admin manually credits a customer who will pay later.</p>
                    </div>

                    <div className="grid gap-3 sm:grid-cols-2 md:grid-cols-3">
                      <div>
                        <label className="mb-1 block text-xs font-semibold text-rose-700">User ID / Phone</label>
                        <input
                          type="text"
                          value={debtForm.userRef}
                          onChange={(e) => setDebtForm((d) => ({ ...d, userRef: e.target.value }))}
                          placeholder="e.g. 0244 123 456"
                          className="w-full rounded-xl border border-rose-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-rose-500 focus:ring-4 focus:ring-rose-100"
                        />
                      </div>
                      <div>
                        <label className="mb-1 block text-xs font-semibold text-rose-700">Display Name</label>
                        <input
                          type="text"
                          value={debtForm.displayName}
                          onChange={(e) => setDebtForm((d) => ({ ...d, displayName: e.target.value }))}
                          placeholder="Customer name (optional)"
                          className="w-full rounded-xl border border-rose-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-rose-500 focus:ring-4 focus:ring-rose-100"
                        />
                      </div>
                      <div>
                        <label className="mb-1 block text-xs font-semibold text-rose-700">Debt Amount</label>
                        <input
                          type="number"
                          min="1"
                          value={debtForm.amount}
                          onChange={(e) => setDebtForm((d) => ({ ...d, amount: e.target.value }))}
                          placeholder="0"
                          className="w-full rounded-xl border border-rose-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-rose-500 focus:ring-4 focus:ring-rose-100"
                        />
                      </div>
                    </div>

                      <button
                      type="submit"
                      disabled={pendingAction !== null || !actionReady}
                        className="mt-3 inline-flex w-full items-center justify-center rounded-xl bg-rose-600 px-4 py-3 text-sm font-semibold text-white shadow-sm transition hover:bg-rose-700 disabled:opacity-70 sm:w-auto sm:py-2"
                    >
                      Create Debt
                    </button>
                  </form>

                  {!dashboard.debtors.length && !loading ? (
                    <div className="rounded-2xl border border-dashed border-slate-200 px-4 py-8 text-center text-sm text-slate-500">
                      No open debtors are currently listed.
                    </div>
                  ) : (
                    dashboard.debtors.map((debtor) => (
                      <div
                        key={debtor.id}
                        className="rounded-3xl border border-slate-200 p-4 transition hover:border-rose-200 hover:bg-rose-50/40"
                      >
                        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                          <div>
                            <div className="font-semibold text-slate-900">{debtor.name}</div>
                            <div className="mt-1 text-sm text-slate-500">{debtor.user}</div>
                          </div>
                          <div className="text-left sm:text-right">
                            <div className="text-sm font-semibold text-rose-600">{formatCurrency(debtor.debt)}</div>
                            <div className="mt-2 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-end sm:gap-2">
                              <button
                                type="button"
                                onClick={() => handleClearDebt(debtor.user)}
                                disabled={pendingAction !== null || !actionReady}
                                className="inline-flex items-center justify-center gap-1 rounded-xl border border-indigo-200 bg-indigo-50 px-3 py-2 text-xs font-semibold text-indigo-700 transition hover:bg-indigo-100 disabled:cursor-not-allowed disabled:opacity-70"
                              >
                                {pendingAction === "clearDebt" ? (
                                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                ) : (
                                  <ArrowUpRight className="h-3.5 w-3.5" />
                                )}
                                Clear Debt
                              </button>

                              <button
                                type="button"
                                onClick={() => handleSuggestMatches(debtor.user, debtor.id, debtor.debt)}
                                disabled={pendingAction !== null}
                                className="inline-flex items-center justify-center gap-1 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-70"
                              >
                                Suggest Matches
                              </button>
                            </div>
                          </div>
                        </div>
                        {suggestions[debtor.id] ? (
                          <div className="mt-3 rounded-2xl border border-slate-100 bg-white p-3 text-sm">
                            {suggestions[debtor.id].loading ? (
                              <div className="text-slate-500">Searching for matches...</div>
                            ) : suggestions[debtor.id].matches.length ? (
                              suggestions[debtor.id].matches.map((m) => (
                                <div key={m.id} className="flex flex-col gap-3 border-b border-slate-100 py-2 sm:flex-row sm:items-center sm:justify-between">
                                  <div>
                                    <div className="font-medium text-slate-900">{m.momoRef || m.user}</div>
                                    <div className="text-xs text-slate-500">{formatCurrency(m.amount)} • {m.user}</div>
                                  </div>
                                  <div className="text-right">
                                    <button
                                      type="button"
                                      onClick={() => handleClearDebt(debtor.user, m.amount, m.momoRef)}
                                      className="inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-indigo-600 px-3 py-2 text-xs font-semibold text-white sm:w-auto"
                                    >
                                      Apply Match
                                    </button>
                                  </div>
                                </div>
                              ))
                            ) : (
                              <div className="text-slate-500">No candidate matches found.</div>
                            )}
                          </div>
                        ) : null}
                      </div>
                    ))
                  )}
                </div>
              </div>
            </div>
          </section>

          <section className="min-w-0 rounded-3xl border border-slate-200 bg-white p-3 shadow-sm shadow-slate-200/60 sm:p-6">
            <div className="min-w-0 flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
              <div>
                <h2 className="text-lg font-semibold text-slate-900">Profit &amp; Audit Status</h2>
                <p className="mt-1 text-sm text-slate-500">
                  {latestAudit?.notes || "Run a reconciliation to generate the latest audit snapshot."}
                </p>
              </div>
              <div
                className={`inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm font-semibold ring-1 ring-inset ${
                  matchStatus === "MATCH"
                    ? "bg-emerald-50 text-emerald-700 ring-emerald-200"
                    : "bg-slate-100 text-slate-700 ring-slate-200"
                }`}
              >
                <ShieldCheck className="h-4 w-4" />
                {matchStatus === "MATCH" ? "MATCH: No Losses Detected" : "PENDING: Awaiting Reconciliation"}
              </div>
            </div>

              <div className="mt-5 min-w-0">
              <div className="mb-2 flex items-center justify-between text-sm text-slate-500">
                <span>Audit confidence</span>
                <span>{matchProgress}%</span>
              </div>
              <div className="h-3 overflow-hidden rounded-full bg-slate-100">
                <div
                  className="h-full rounded-full bg-linear-to-r from-emerald-500 via-emerald-400 to-indigo-600"
                  style={{ width: `${matchProgress}%` }}
                />
              </div>
              <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <AuditStat label="Cash In Today" value={formatCurrency(totalCashInToday)} />
                <AuditStat label="Paystack Sync" value={`${paystackSync.toFixed(1)}%`} />
                <AuditStat label="Open Debtors" value={String(totalDebtors)} />
                <AuditStat label="Debt Owed" value={formatCurrency(activeDebtAmount)} />
              </div>
            </div>

              <div className="mt-5 min-w-0 rounded-2xl border border-slate-200">
              <div className="border-b border-slate-200 bg-slate-50 px-4 py-3 text-sm font-semibold text-slate-700">
                Recent Audit Runs
              </div>
              <div className="min-w-0 overflow-x-auto">
                <table className="w-full table-fixed divide-y divide-slate-200 text-left text-xs sm:text-sm">
                  <thead className="bg-white text-xs uppercase tracking-[0.16em] text-slate-500">
                    <tr>
                      <th className="w-28 px-3 py-3 font-semibold sm:w-48 sm:px-4">Date</th>
                      <th className="w-24 px-3 py-3 font-semibold sm:w-32 sm:px-4">Cash In</th>
                      <th className="w-20 px-3 py-3 font-semibold sm:w-24 sm:px-4">Sync</th>
                      <th className="w-20 px-3 py-3 font-semibold sm:w-24 sm:px-4">Debtors</th>
                      <th className="w-20 px-3 py-3 font-semibold sm:w-28 sm:px-4">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 bg-white">
                    {auditHistory.length === 0 ? (
                      <tr>
                        <td colSpan={5} className="px-3 py-6 text-center text-slate-500 sm:px-4 sm:py-8">
                          No audit history available yet.
                        </td>
                      </tr>
                    ) : (
                      auditHistory.map((audit) => (
                        <tr key={audit.id} className="transition hover:bg-slate-50">
                          <td className="px-3 py-3 align-top text-slate-700 sm:px-4">{formatDateTime(audit.createdAt)}</td>
                          <td className="px-3 py-3 align-top whitespace-nowrap text-slate-700 sm:px-4">{formatCurrency(audit.totalCashIn)}</td>
                          <td className="px-3 py-3 align-top whitespace-nowrap text-slate-700 sm:px-4">{audit.paystackSync.toFixed(1)}%</td>
                          <td className="px-3 py-3 align-top whitespace-nowrap text-slate-700 sm:px-4">{audit.activeDebtBoard}</td>
                          <td className="px-3 py-3 align-top sm:px-4">
                            <span
                              className={`inline-flex whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-semibold ${
                                audit.matchStatus === "MATCH"
                                  ? "bg-emerald-50 text-emerald-700"
                                  : "bg-slate-100 text-slate-700"
                              }`}
                            >
                              {audit.matchStatus}
                            </span>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="mt-5 flex flex-col gap-3 rounded-2xl bg-slate-50 px-4 py-3 text-sm text-slate-500 sm:flex-row sm:items-center sm:justify-between">
              <span>{dashboard.fetchedAt ? `Last synced ${formatDateTime(dashboard.fetchedAt)}` : "Waiting for first snapshot"}</span>
              <button
                type="button"
                onClick={() => loadSnapshot()}
                disabled={pendingAction !== null}
                className="inline-flex items-center justify-center gap-2 rounded-xl border border-indigo-200 bg-white px-3 py-2 font-semibold text-indigo-600 transition hover:bg-indigo-50 hover:text-indigo-700 disabled:cursor-not-allowed disabled:opacity-70"
              >
                {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                Refresh Data
              </button>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}

function MetricCard({ title, value, detail, icon, accent }) {
  const palette = {
    teal: {
      wrapper: "bg-teal-50 text-teal-600",
      icon: "from-teal-500 to-teal-600",
    },
    sky: {
      wrapper: "bg-sky-50 text-sky-600",
      icon: "from-sky-500 to-sky-600",
    },
    amber: {
      wrapper: "bg-amber-50 text-amber-600",
      icon: "from-amber-500 to-amber-600",
    },
  };

  const theme = palette[accent] ?? palette.teal;

  return (
    <div className="group rounded-2xl border border-slate-200 bg-white p-6 shadow-sm shadow-slate-200/60 transition hover:shadow-md">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-sm font-medium text-slate-500">{title}</p>
          <div className="mt-2 text-2xl font-semibold tracking-tight text-slate-900">{value}</div>
          <p className="mt-1 text-sm text-slate-500">{detail}</p>
        </div>
        <div className={`rounded-2xl p-3 ${theme.wrapper}`}>
          <div className={`rounded-xl bg-linear-to-br ${theme.icon} p-2 text-white shadow-sm`}>{icon}</div>
        </div>
      </div>
      <div className="mt-5 h-px w-full bg-slate-100" />
      <div className="mt-4 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">
        <Zap className="h-4 w-4" />
        Live operational metric
      </div>
    </div>
  );
}

function AuditStat({ label, value }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
      <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">{label}</div>
      <div className="mt-1 text-sm font-semibold text-slate-900">{value}</div>
    </div>
  );
}
