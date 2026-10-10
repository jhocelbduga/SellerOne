import React, { createContext, useContext, useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  Activity, ArrowDownLeft, ArrowDownToLine, ArrowLeftRight, ArrowUpRight, Bell,
  Boxes, BriefcaseBusiness, ChartNoAxesCombined, ChevronDown, ChevronLeft,
  ChevronRight, CircleHelp, ClipboardList, FileBarChart, FileText, LayoutDashboard,
  LifeBuoy, LogOut, Menu, MoreHorizontal, Package, Plus, Search, Settings,
  ShieldCheck, ShoppingBag, SlidersHorizontal, Sparkles, TrendingDown,
  TrendingUp, UserRound, UserRoundPlus, Users, Wallet, X,
} from "lucide-react";
import {
  BrowserRouter, Link, Navigate, Outlet, Route, Routes, useLocation, useNavigate, useParams,
} from "react-router-dom";
import "./styles.css";

type Role = "owner" | "admin" | "staff";
interface User {
  id: string;
  name: string;
  email: string;
  role: Role;
}
interface SessionState {
  user: User | null;
  needsSetup: boolean;
  refresh: () => Promise<void>;
}
interface Product {
  id: string;
  name: string;
  description?: string | null;
  active: boolean | number;
  variants: Variant[];
}
interface Variant {
  id: string;
  name: string;
  description?: string | null;
  sku: string;
  barcode?: string | null;
  attributes: Record<string, string>;
  unitCostMinor: number;
  currency: string;
  reorderPoint: number;
}
interface Customer {
  id: string;
  name: string;
  email?: string;
  phone?: string;
  address?: string;
  notes?: string;
  orderCount?: number;
  spentMinor?: number;
  createdAt?: string;
}

const SessionContext = createContext<SessionState>({
  user: null,
  needsSetup: false,
  refresh: async () => undefined,
});

async function api<T>(path: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(`/api${path}`, {
    ...options,
    headers: {
      ...(options.body ? { "content-type": "application/json" } : {}),
      ...options.headers,
    },
  });
  const payload = await response.json().catch(() => ({})) as Record<string, unknown>;
  if (!response.ok) {
    throw new Error(typeof payload.error === "string" ? payload.error : `Request failed (${response.status}).`);
  }
  return payload as T;
}

function money(minor: unknown, currency = "PHP"): string {
  return new Intl.NumberFormat("en-PH", { style: "currency", currency }).format(Number(minor ?? 0) / 100);
}

function dateLabel(value: unknown): string {
  if (!value) return "—";
  return new Intl.DateTimeFormat("en-PH", { dateStyle: "medium" }).format(new Date(String(value)));
}

function initials(name: string): string {
  return name.trim().split(/\s+/).slice(0, 2).map((part) => part[0]?.toUpperCase() ?? "").join("");
}

function SessionProvider(): React.JSX.Element {
  const [user, setUser] = useState<User | null>(null);
  const [needsSetup, setNeedsSetup] = useState(false);
  const [ready, setReady] = useState(false);
  const refresh = async () => {
    try {
      const status = await api<{ user: User | null; needsSetup: boolean }>("/auth/status");
      setUser(status.user);
      setNeedsSetup(status.needsSetup);
    } finally {
      setReady(true);
    }
  };
  useEffect(() => { void refresh().catch(() => setReady(true)); }, []);
  if (!ready) return <div className="boot-screen"><span className="brand-glyph">S</span><span>Opening your workspace…</span></div>;
  return (
    <SessionContext.Provider value={{ user, needsSetup, refresh }}>
      <Routes>
        <Route path="/login" element={<AuthPage mode="login" />} />
        <Route path="/setup" element={<AuthPage mode="setup" />} />
        <Route path="/register" element={<AuthPage mode="register" />} />
        <Route path="/forgot-password" element={<AuthPage mode="forgot" />} />
        <Route path="/reset-password" element={<AuthPage mode="reset" />} />
        <Route element={<ProtectedLayout />}>
          <Route index element={<DashboardPage />} />
          <Route path="dashboard" element={<DashboardPage />} />
          <Route path="products" element={<ProductsPage />} />
          <Route path="products/new" element={<ProductFormPage />} />
          <Route path="products/:id/edit" element={<ProductFormPage />} />
          <Route path="inventory" element={<InventoryPage />} />
          <Route path="orders" element={<OrdersPage />} />
          <Route path="orders/:id" element={<OrderDetailsPage />} />
          <Route path="customers" element={<CustomersPage />} />
          <Route path="customers/:id" element={<CustomerProfilePage />} />
          <Route path="sales" element={<SalesPage />} />
          <Route path="expenses" element={<ExpensesPage />} />
          <Route path="accounting" element={<AccountingPage />} />
          <Route path="reports" element={<ReportsPage />} />
          <Route path="settings" element={<SettingsPage />} />
          <Route path="users" element={<UsersPage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </SessionContext.Provider>
  );
}

const primaryNav = [
  { label: "Overview", items: [
    { to: "/", label: "Dashboard", icon: LayoutDashboard },
  ] },
  { label: "Manage", items: [
    { to: "/products", label: "Products", icon: Package },
    { to: "/inventory", label: "Inventory", icon: Boxes },
    { to: "/orders", label: "Orders", icon: ShoppingBag },
    { to: "/customers", label: "Customers", icon: Users },
  ] },
  { label: "Finance", items: [
    { to: "/sales", label: "Sales", icon: TrendingUp },
    { to: "/expenses", label: "Expenses", icon: TrendingDown },
    { to: "/accounting", label: "Accounting", icon: Wallet },
    { to: "/reports", label: "Reports", icon: ChartNoAxesCombined },
  ] },
];

function ProtectedLayout(): React.JSX.Element {
  const { user, needsSetup } = useContext(SessionContext);
  const location = useLocation();
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  if (needsSetup) return <Navigate to="/setup" replace />;
  if (!user) return <Navigate to="/login" state={{ from: location.pathname }} replace />;
  const current = [...primaryNav.flatMap((section) => section.items), ...(user.role !== "staff" ? [{ to: "/settings", label: "Settings", icon: Settings }] : [])]
    .find((item) => item.to === location.pathname);
  return (
    <div className="app-shell">
      <aside className={`sidebar ${mobileNavOpen ? "sidebar-open" : ""}`}>
        <Link className="brand" to="/">
          <span className="brand-glyph">S</span>
          <span className="brand-name">seller<span>one</span></span>
          <span className="brand-period">.</span>
        </Link>
        <div className="workspace-switcher">
          <span className="workspace-icon"><BriefcaseBusiness size={15} /></span>
          <span className="workspace-text"><strong>My workspace</strong><small>Business account</small></span>
          <ChevronDown size={15} className="muted" />
        </div>
        <nav className="side-nav" aria-label="Main navigation">
          {primaryNav.map((section) => (
            <div className="nav-section" key={section.label}>
              <span className="nav-heading">{section.label}</span>
              {section.items.map(({ to, label, icon: Icon }) => (
                <Link key={to} className={`nav-link ${location.pathname === to || (to !== "/" && location.pathname.startsWith(to)) ? "active" : ""}`} to={to} onClick={() => setMobileNavOpen(false)}>
                  <Icon size={17} strokeWidth={1.8} /><span>{label}</span>
                  {label === "Inventory" && <span className="nav-dot" />}
                </Link>
              ))}
            </div>
          ))}
          <div className="nav-section">
            <span className="nav-heading">Workspace</span>
            {user.role !== "staff" && <Link className={`nav-link ${location.pathname === "/users" ? "active" : ""}`} to="/users"><UserRoundPlus size={17} strokeWidth={1.8} /><span>User management</span></Link>}
            {user.role !== "staff" && <Link className={`nav-link ${location.pathname === "/settings" ? "active" : ""}`} to="/settings"><Settings size={17} strokeWidth={1.8} /><span>Settings</span></Link>}
          </div>
        </nav>
        <div className="sidebar-bottom">
          <div className="help-card"><span className="help-icon"><LifeBuoy size={17} /></span><strong>Need a hand?</strong><p>We’re here to help you get the most out of SellerOne.</p><button className="text-button" type="button">Visit help center <ChevronRight size={14} /></button></div>
          <div className="profile-mini">
            <span className="avatar avatar-sage">{initials(user.name)}</span>
            <span className="profile-meta"><strong>{user.name}</strong><small>{user.role === "owner" ? "Workspace owner" : user.role}</small></span>
            <button className="icon-button profile-more" type="button" aria-label="Account options"><MoreHorizontal size={19} /></button>
          </div>
        </div>
      </aside>
      {mobileNavOpen && <button className="mobile-scrim" aria-label="Close menu" onClick={() => setMobileNavOpen(false)} />}
      <section className="main-column">
        <header className="topbar">
          <button className="icon-button mobile-menu" aria-label="Open menu" onClick={() => setMobileNavOpen(true)}><Menu size={20} /></button>
          <div className="breadcrumbs"><span>Workspace</span><ChevronRight size={14} /><strong>{current?.label ?? (location.pathname.startsWith("/orders/") ? "Order details" : location.pathname.startsWith("/customers/") ? "Customer profile" : "Edit product")}</strong></div>
          <div className="topbar-actions">
            <span className="today-label">{new Intl.DateTimeFormat("en-PH", { weekday: "short", month: "short", day: "numeric" }).format(new Date())}</span>
            <button className="icon-button search-trigger" type="button"><Search size={18} /><span>Search</span><kbd>⌘ K</kbd></button>
            <button className="icon-button notification-button" type="button" aria-label="Notifications"><Bell size={18} /><i /></button>
            <span className="avatar avatar-top">{initials(user.name)}</span>
          </div>
        </header>
        <main className="page-content"><Outlet /></main>
        <footer className="app-footer"><span>SellerOne <span className="footer-dot">·</span> Your business, in sync.</span><span>Made for the way you sell <Sparkles size={13} /></span></footer>
      </section>
    </div>
  );
}

function AuthPage({ mode }: { mode: "login" | "setup" | "register" | "forgot" | "reset" }): React.JSX.Element {
  const { user, needsSetup, refresh } = useContext(SessionContext);
  const navigate = useNavigate();
  const location = useLocation();
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [developmentResetUrl, setDevelopmentResetUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const params = new URLSearchParams(location.search);
  const token = params.get("token") ?? "";
  const [form, setForm] = useState({ name: "", email: "", password: "", businessName: "", currency: "PHP", confirmPassword: "" });
  if (mode === "login" && user) return <Navigate to="/" replace />;
  if (mode === "setup" && !needsSetup && !user) return <Navigate to="/login" replace />;

  const update = (key: keyof typeof form) => (event: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    setForm((current) => ({ ...current, [key]: event.target.value }));
  };
  const onSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError("");
    setMessage("");
    setDevelopmentResetUrl("");
    setBusy(true);
    try {
      if ((mode === "setup" || mode === "register" || mode === "reset") && form.password !== form.confirmPassword) {
        throw new Error("Your passwords don’t match.");
      }
      if (mode === "forgot") {
        const result = await api<{ message: string; developmentResetUrl?: string }>("/auth/forgot-password", { method: "POST", body: JSON.stringify({ email: form.email }) });
        setMessage(result.message);
        setDevelopmentResetUrl(result.developmentResetUrl ?? "");
      } else if (mode === "reset") {
        await api("/auth/reset-password", { method: "POST", body: JSON.stringify({ token, password: form.password }) });
        setMessage("Your password has been updated. You can sign in now.");
      } else if (mode === "register") {
        if (!token) throw new Error("This invite link is missing its invitation token.");
        await api("/auth/register", { method: "POST", body: JSON.stringify({ token, password: form.password }) });
        await refresh();
        navigate("/", { replace: true });
      } else if (mode === "setup") {
        await api("/auth/setup", { method: "POST", body: JSON.stringify(form) });
        await refresh();
        navigate("/", { replace: true });
      } else {
        await api("/auth/login", { method: "POST", body: JSON.stringify({ email: form.email, password: form.password }) });
        await refresh();
        const from = (location.state as { from?: string } | null)?.from ?? "/";
        navigate(from, { replace: true });
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Something went wrong. Please try again.");
    } finally {
      setBusy(false);
    }
  };

  const titles = {
    login: ["Welcome back", "Your business, right where you left it."],
    setup: ["Let’s make it yours", "Start with the details of your business."],
    register: ["You’re invited", "Create your account to join this workspace."],
    forgot: ["Forgot your password?", "It happens. We’ll help you get back in."],
    reset: ["Choose a new password", "Make it strong, then you’re back in."],
  } as const;
  const [title, subtitle] = titles[mode];
  return (
    <div className="auth-screen">
      <div className="auth-visual">
        <Link className="brand brand-light" to="/login"><span className="brand-glyph">S</span><span className="brand-name">seller<span>one</span></span><span className="brand-period">.</span></Link>
        <div className="auth-art">
          <div className="art-orbit orbit-one" /><div className="art-orbit orbit-two" />
          <div className="art-window"><span className="art-window-title">Your business today <i /></span><div className="art-total">₱48,290<small>+12.8% this month <TrendingUp size={13} /></small></div><div className="art-bars">{[30, 48, 38, 64, 47, 80, 59, 93, 70, 86, 60, 100].map((height, index) => <i key={index} style={{ height: `${height}%` }} />)}</div><div className="art-footer"><span><i className="art-legend" /> Sales</span><span>Last 12 days</span></div></div>
          <span className="art-float float-package"><Package size={19} /></span><span className="art-float float-trend"><TrendingUp size={18} /></span><span className="art-float float-check"><ShieldCheck size={19} /></span>
        </div>
        <div className="auth-quote"><span className="quote-mark">“</span><p>Running a business is a lot. Keeping track of it shouldn’t be.</p><span>One clear view of everything that matters.</span></div>
        <div className="auth-visual-footer"><span>© 2026 SellerOne</span><span>Built for the independently minded.</span></div>
      </div>
      <div className="auth-panel">
        <div className="auth-panel-top"><Link className="brand auth-mobile-brand" to="/"><span className="brand-glyph">S</span><span className="brand-name">seller<span>one</span></span><span className="brand-period">.</span></Link><span className="auth-secure"><ShieldCheck size={14} /> Secure workspace</span></div>
        <div className="auth-form-wrap">
          <div className="auth-eyebrow"><span className="eyebrow-line" /> SELLERONE WORKSPACE</div>
          <h1>{title}</h1><p className="auth-subtitle">{subtitle}</p>
          {mode === "register" && !token && <div className="notice-box">SellerOne accounts are created by a workspace owner or administrator. Open your invitation link to register.</div>}
          {mode === "reset" && !token && <div className="notice-box" role="alert">This reset link is missing its token. <Link to="/forgot-password">Request a new reset link</Link>.</div>}
          {message ? <><div className="success-box"><ShieldCheck size={17} /><span>{message}</span></div>{developmentResetUrl && <div className="notice-box">Local development reset link: <a href={developmentResetUrl}>Reset your password</a></div>}</> : mode === "reset" && !token ? null : (
            <form className="auth-form" onSubmit={(event) => void onSubmit(event)}>
              {(mode === "setup" || mode === "register") && <label className="field-label">Full name<input autoComplete="name" required maxLength={200} placeholder="Your name" value={form.name} onChange={update("name")} /></label>}
              {(mode === "setup" || mode === "login" || mode === "forgot") && <label className="field-label">Work email<input type="email" autoComplete="email" required placeholder="you@yourbusiness.com" value={form.email} onChange={update("email")} /></label>}
              {mode === "setup" && <><label className="field-label">Business name<input required maxLength={200} placeholder="The name customers know you by" value={form.businessName} onChange={update("businessName")} /></label><label className="field-label">Business currency<select value={form.currency} onChange={update("currency")}><option value="PHP">PHP — Philippine peso</option><option value="USD">USD — US dollar</option><option value="SGD">SGD — Singapore dollar</option><option value="AUD">AUD — Australian dollar</option><option value="EUR">EUR — Euro</option><option value="GBP">GBP — British pound</option></select></label></>}
              {(mode === "login" || mode === "setup" || mode === "register" || mode === "reset") && <label className="field-label">{mode === "login" ? <span className="label-with-link">Password <Link to="/forgot-password">Forgot password?</Link></span> : "Password"}<span className="password-wrap"><input type={showPassword ? "text" : "password"} autoComplete={mode === "login" ? "current-password" : "new-password"} minLength={10} required placeholder="At least 10 characters" value={form.password} onChange={update("password")} /><button type="button" className="password-toggle" onClick={() => setShowPassword((value) => !value)}>{showPassword ? "Hide" : "Show"}</button></span></label>}
              {(mode === "setup" || mode === "register" || mode === "reset") && <label className="field-label">Confirm password<input type="password" autoComplete="new-password" minLength={10} required placeholder="Enter it one more time" value={form.confirmPassword} onChange={update("confirmPassword")} /></label>}
              {error && <div className="error-box" role="alert">{error}</div>}
              {mode === "register" && !token ? <button className="button button-primary auth-submit" type="button" disabled>Invitation required</button> : <button className="button button-primary auth-submit" type="submit" disabled={busy}>{busy ? "One moment…" : mode === "login" ? "Sign in to your workspace" : mode === "setup" ? "Create my workspace" : mode === "register" ? "Join workspace" : mode === "forgot" ? "Send reset instructions" : "Update password"}<ChevronRight size={17} /></button>}
            </form>
          )}
          <div className="auth-switch">{mode === "login" && <>New to SellerOne? <span>Your admin can invite you.</span></>}{mode === "setup" && <>One workspace. Everything in sync.</>}{mode === "register" && <Link to="/login"><ChevronLeft size={14} /> Back to sign in</Link>}{mode === "forgot" && <Link to="/login"><ChevronLeft size={14} /> Back to sign in</Link>}{mode === "reset" && <Link to="/login"><ChevronLeft size={14} /> Back to sign in</Link>}</div>
          {mode === "setup" && <p className="auth-security-note"><ShieldCheck size={14} /> Your account is protected with encrypted password storage.</p>}
        </div>
        <div className="auth-panel-footer"><span>Need a hand? <a href="mailto:hello@sellerone.app">Talk to us</a></span><span>Privacy <span>·</span> Terms</span></div>
      </div>
    </div>
  );
}

function PageHeading({ eyebrow, title, description, action }: { eyebrow: string; title: string; description?: string; action?: React.ReactNode }): React.JSX.Element {
  return <div className="page-heading"><div><div className="page-eyebrow">{eyebrow}</div><h1>{title}</h1>{description && <p>{description}</p>}</div>{action && <div className="heading-actions">{action}</div>}</div>;
}

function SectionHeading({ title, subtitle, action }: { title: string; subtitle?: string; action?: React.ReactNode }): React.JSX.Element {
  return <div className="section-heading"><div><h2>{title}</h2>{subtitle && <span>{subtitle}</span>}</div>{action}</div>;
}

function Button({ children, variant = "primary", ...props }: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "secondary" | "subtle" | "danger" }): React.JSX.Element {
  return <button className={`button button-${variant}`} {...props}>{children}</button>;
}

function IconButton({ label, children, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement> & { label: string }): React.JSX.Element {
  return <button className="icon-button" aria-label={label} title={label} {...props}>{children}</button>;
}

function SearchField({ value, onChange, placeholder = "Search anything…" }: { value: string; onChange: (value: string) => void; placeholder?: string }): React.JSX.Element {
  return <label className="search-field"><Search size={16} /><input value={value} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} /></label>;
}

function DataTable({ columns, rows, empty, rowKey }: { columns: { label: string; render: (row: Record<string, unknown>) => React.ReactNode; className?: string }[]; rows: Record<string, unknown>[]; empty: string; rowKey: string }): React.JSX.Element {
  if (!rows.length) return <EmptyState icon={<Package size={21} />} title="Nothing here just yet" description={empty} />;
  return <div className="table-scroll"><table className="data-table"><thead><tr>{columns.map((column) => <th key={column.label} className={column.className}>{column.label}</th>)}</tr></thead><tbody>{rows.map((row, index) => <tr key={String(row[rowKey] ?? index)}>{columns.map((column) => <td key={column.label} className={column.className}>{column.render(row)}</td>)}</tr>)}</tbody></table></div>;
}

function StatusPill({ status }: { status: string }): React.JSX.Element {
  const normalized = status.toLowerCase().replace(/\s+/g, "-");
  return <span className={`status-pill status-${normalized}`}><i />{status.replace(/-/g, " ")}</span>;
}

function EmptyState({ icon, title, description, action }: { icon: React.ReactNode; title: string; description: string; action?: React.ReactNode }): React.JSX.Element {
  return <div className="empty-state"><span className="empty-icon">{icon}</span><h3>{title}</h3><p>{description}</p>{action}</div>;
}

function useLoad<T>(path: string): { data: T | null; error: string; loading: boolean; reload: () => void } {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [version, setVersion] = useState(0);
  useEffect(() => {
    if (!path) {
      setLoading(false);
      setData(null);
      return;
    }
    let alive = true;
    setLoading(true);
    api<T>(path).then((result) => { if (alive) { setData(result); setError(""); } })
      .catch((caught: unknown) => { if (alive) setError(caught instanceof Error ? caught.message : "Could not load this page."); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [path, version]);
  return { data, error, loading, reload: () => setVersion((value) => value + 1) };
}

function PageError({ message }: { message: string }): React.JSX.Element {
  return <div className="page-error"><CircleHelp size={18} /><span>{message}</span></div>;
}

function StatCard({ label, value, change, icon, tone = "sage" }: { label: string; value: string; change?: string; icon: React.ReactNode; tone?: string }): React.JSX.Element {
  return <article className="stat-card"><div className="stat-top"><span>{label}</span><span className={`stat-icon stat-icon-${tone}`}>{icon}</span></div><strong>{value}</strong><span className="stat-foot">{change ?? "Based on your recorded activity"}</span></article>;
}

function DashboardPage(): React.JSX.Element {
  const { data, loading, error } = useLoad<{
    stats: Record<string, number>;
    recentOrders: Record<string, unknown>[];
    lowStock: Record<string, unknown>[];
  }>("/dashboard");
  const settings = useLoad<{ businessName: string }>("/settings");
  const navigate = useNavigate();
  const stats = data?.stats;
  return <>
    <PageHeading eyebrow="MONDAY, OCTOBER 10" title={`A good day to grow${settings.data?.businessName ? `, ${settings.data.businessName}` : ""}.`} description="Here’s your business at a glance. You’re right on track." action={<><Button variant="secondary" onClick={() => navigate("/inventory")}> <ArrowDownToLine size={16} /> Stock in</Button><Button onClick={() => navigate("/orders")}> <Plus size={17} /> New order</Button></>} />
    {error && <PageError message={error} />}
    {loading ? <LoadingGrid /> : <div className="stat-grid">
      <StatCard label="Sales this month" value={money(stats?.salesMinor)} change="Your recorded sales" icon={<TrendingUp size={17} />} />
      <StatCard label="Orders to fulfill" value={String(stats?.pendingOrders ?? 0)} change={`${stats?.orders ?? 0} orders on the books`} icon={<ShoppingBag size={17} />} tone="blue" />
      <StatCard label="Customers" value={String(stats?.customers ?? 0)} change="People in your corner" icon={<Users size={17} />} tone="lilac" />
      <StatCard label="Low stock items" value={String(stats?.lowStockItems ?? 0)} change="A little nudge to restock" icon={<Boxes size={17} />} tone="sand" />
    </div>}
    <div className="dashboard-grid">
      <section className="panel dashboard-orders"><SectionHeading title="Recent orders" subtitle="The latest from across your shop" action={<Link className="inline-link" to="/orders">All orders <ChevronRight size={14} /></Link>} />
        {loading ? <div className="table-skeleton" /> : <DataTable rowKey="id" rows={data?.recentOrders ?? []} empty="When you create your first order, you’ll see it here." columns={[
          { label: "ORDER", render: (row) => <Link className="table-primary" to={`/orders/${row.id}`}>{String(row.orderNumber)}</Link> },
          { label: "CUSTOMER", render: (row) => String(row.customerName) },
          { label: "STATUS", render: (row) => <StatusPill status={String(row.status)} /> },
          { label: "TOTAL", className: "align-right", render: (row) => <strong>{money(row.totalMinor, String(row.currency))}</strong> },
        ]} />}
      </section>
      <section className="panel low-stock-panel"><SectionHeading title="A little heads-up" subtitle="These items are running low" action={<span className="panel-count">{data?.lowStock.length ?? 0}</span>} />
        {loading ? <div className="list-skeleton" /> : data?.lowStock.length ? <div className="low-stock-list">{data.lowStock.map((item) => <div className="low-stock-row" key={String(item.variantId)}><span className="mini-product"><Package size={16} /></span><span className="low-stock-meta"><strong>{String(item.productName)} · {String(item.variantName)}</strong><small>SKU {String(item.sku)} <span>·</span> reorder at {String(item.reorderPoint)}</small></span><span className="stock-count">{String(item.quantityOnHand)}<small>left</small></span></div>)}<Link className="inline-link low-stock-link" to="/inventory">See all inventory <ChevronRight size={14} /></Link></div> : <EmptyState icon={<Boxes size={19} />} title="Stock looks healthy" description="We’ll give you a heads-up when something needs a restock." />}
      </section>
    </div>
    <section className="welcome-banner"><div className="welcome-art"><div className="welcome-sun" /><div className="welcome-hill hill-back" /><div className="welcome-hill hill-front" /><span className="welcome-spark spark-a">✳</span><span className="welcome-spark spark-b">✳</span><span className="welcome-plant plant-a" /><span className="welcome-plant plant-b" /></div><div className="welcome-copy"><span className="soft-tag"><Sparkles size={13} /> YOUR WORKSPACE, YOUR WAY</span><h2>Small steps add up to<br />something great.</h2><p>Add a product, welcome a customer, or simply take a breath. We’ll keep everything in sync.</p><Link to="/products/new" className="inline-link">Add your first product <ChevronRight size={14} /></Link></div></section>
  </>;
}

function LoadingGrid(): React.JSX.Element {
  return <div className="stat-grid">{[0, 1, 2, 3].map((item) => <div className="stat-card stat-loading" key={item}><i /><i /><i /></div>)}</div>;
}

function ProductsPage(): React.JSX.Element {
  const { data, loading, error, reload } = useLoad<{ items: Product[] }>("/products");
  const [search, setSearch] = useState("");
  const filtered = (data?.items ?? []).filter((product) => `${product.name} ${product.variants.map((variant) => variant.sku).join(" ")}`.toLowerCase().includes(search.toLowerCase()));
  const rows = filtered.map((product) => {
    const variants = product.variants;
    return {
      id: product.id, name: product.name, description: product.description ?? "",
      sku: variants.map((variant) => variant.sku).join(", "),
      price: variants[0]?.unitCostMinor ?? 0, currency: variants[0]?.currency ?? "PHP",
      stock: 0, variants: variants.length, active: Boolean(product.active),
    };
  });
  const stock = useLoad<{ items: Record<string, unknown>[] }>("/stock");
  for (const row of rows) row.stock = (stock.data?.items ?? []).filter((item) => item.productId === row.id).reduce((sum, item) => sum + Number(item.quantityOnHand ?? 0), 0);
  return <>
    <PageHeading eyebrow="YOUR CATALOG" title="Products" description="The things you make, source, and sell." action={<Link className="button button-primary" to="/products/new"><Plus size={17} /> Add product</Link>} />
    {error && <PageError message={error} />}
    <section className="panel list-panel"><div className="list-toolbar"><SearchField value={search} onChange={setSearch} placeholder="Search by name or SKU…" /><span className="result-count">{rows.length} {rows.length === 1 ? "product" : "products"}</span><IconButton label="Refresh products" onClick={reload}><Activity size={17} /></IconButton><IconButton label="Filter products"><SlidersHorizontal size={17} /></IconButton></div>
      {loading || stock.loading ? <div className="table-skeleton" /> : <DataTable rowKey="id" rows={rows} empty="Give your catalog a home. Add a product to get started." columns={[
        { label: "PRODUCT", render: (row) => <Link className="product-cell" to={`/products/${row.id}/edit`}><span className="product-thumb"><Package size={17} /></span><span><strong className="table-primary">{String(row.name)}</strong><small>{String(row.description) || "No description"}</small></span></Link> },
        { label: "SKU", render: (row) => <span className="mono">{String(row.sku)}</span> },
        { label: "UNIT COST", className: "align-right", render: (row) => money(row.price, String(row.currency)) },
        { label: "IN STOCK", render: (row) => <span className="table-number">{String(row.stock)} <small>units</small></span> },
        { label: "VARIANTS", render: (row) => String(row.variants) },
        { label: "STATUS", render: (row) => <StatusPill status={row.active ? "Active" : "Archived"} /> },
        { label: "", render: (row) => <Link className="row-action" to={`/products/${row.id}/edit`}>Edit <ChevronRight size={14} /></Link> },
      ]} />}
      <div className="table-foot"><span>Showing {rows.length} of {rows.length} products</span><span className="pagination"><button disabled aria-label="Previous page"><ChevronLeft size={16} /></button><span>1</span><button disabled aria-label="Next page"><ChevronRight size={16} /></button></span></div>
    </section>
  </>;
}

function ProductFormPage(): React.JSX.Element {
  const { id } = useParams();
  const editing = Boolean(id);
  const existing = useLoad<Product>(editing ? `/products/${id}` : "");
  const navigate = useNavigate();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const product = editing ? existing.data : null;
  const [form, setForm] = useState({ name: "", description: "", variantName: "Standard", variantDescription: "", sku: "", barcode: "", unitCost: "", currency: "PHP", reorderPoint: "0", attributes: "" });
  const [initialized, setInitialized] = useState(false);
  useEffect(() => {
    if (product && !initialized) {
      const variant = product.variants[0];
      setForm({
        name: product.name,
        description: product.description ?? "",
        variantName: variant?.name ?? "",
        variantDescription: variant?.description ?? "",
        sku: variant?.sku ?? "",
        barcode: variant?.barcode ?? "",
        unitCost: variant ? (variant.unitCostMinor / 100).toFixed(2) : "",
        currency: variant?.currency ?? "PHP",
        reorderPoint: String(variant?.reorderPoint ?? 0),
        attributes: Object.entries(variant?.attributes ?? {}).map(([key, value]) => `${key}=${value}`).join("\n"),
      });
      setInitialized(true);
    }
  }, [product, initialized]);
  const input = (key: keyof typeof form) => (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => setForm((value) => ({ ...value, [key]: event.target.value }));
  const submit = async (event: React.FormEvent) => {
    event.preventDefault(); setError(""); setNotice(""); setSaving(true);
    try {
      const attributes = Object.fromEntries(form.attributes.split("\n").filter(Boolean).map((line) => {
        const separator = line.indexOf("=");
        return separator < 1 ? ["", ""] : [line.slice(0, separator).trim(), line.slice(separator + 1).trim()];
      }).filter(([key]) => Boolean(key)));
      if (editing && product) {
        await api(`/products/${id}`, { method: "PATCH", body: JSON.stringify({ name: form.name, description: form.description || null }) });
        const variant = product.variants[0];
        if (variant) await api(`/variants/${variant.id}`, { method: "PATCH", body: JSON.stringify({
          name: form.variantName, description: form.variantDescription || null, sku: form.sku, barcode: form.barcode || null, attributes,
          unitCostMinor: Math.round(Number(form.unitCost) * 100), currency: form.currency,
          reorderPoint: Number(form.reorderPoint),
        }) });
        setNotice("Your product has been updated.");
        window.setTimeout(() => navigate("/products"), 650);
      } else {
        await api("/products", { method: "POST", body: JSON.stringify({
          name: form.name, description: form.description || undefined,
          variants: [{
            name: form.variantName, sku: form.sku, barcode: form.barcode || undefined,
            description: form.variantDescription || undefined,
            attributes, unitCostMinor: Math.round(Number(form.unitCost) * 100),
            currency: form.currency, reorderPoint: Number(form.reorderPoint),
          }],
        }) });
        navigate("/products");
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not save product.");
    } finally { setSaving(false); }
  };
  if (editing && existing.loading) return <LoadingGrid />;
  if (editing && existing.error) return <PageError message={existing.error} />;
  return <>
    <Link className="back-link" to="/products"><ChevronLeft size={15} /> Back to products</Link>
    <PageHeading eyebrow={editing ? "CATALOG / EDIT" : "CATALOG / NEW"} title={editing ? "Edit product" : "Add a product"} description={editing ? "Update your product details and variant." : "Give your product a name and the details you’ll need later."} />
    <form className="form-layout" onSubmit={(event) => void submit(event)}>
      <section className="panel form-panel"><SectionHeading title="The basics" subtitle="A clear name makes everything easier." /><div className="form-grid"><label className="field-label field-span">Product name<input required maxLength={200} placeholder="e.g. House blend coffee" value={form.name} onChange={input("name")} /></label><label className="field-label field-span">Description <span className="field-optional">OPTIONAL</span><textarea rows={3} maxLength={2000} placeholder="What makes this one special?" value={form.description} onChange={input("description")} /></label></div></section>
      <section className="panel form-panel"><SectionHeading title="First variant" subtitle="Add sizes, colours, or other options later." /><div className="form-grid"><label className="field-label">Variant name<input required maxLength={200} placeholder="Standard" value={form.variantName} onChange={input("variantName")} /></label><label className="field-label">Variant description <span className="field-optional">OPTIONAL</span><textarea rows={2} maxLength={2000} placeholder="Identify this variant for receiving and stock reports" value={form.variantDescription} onChange={input("variantDescription")} /></label><label className="field-label">SKU<input required maxLength={100} placeholder="e.g. COFFEE-250" value={form.sku} onChange={input("sku")} /></label><label className="field-label">Barcode <span className="field-optional">OPTIONAL</span><input maxLength={100} placeholder="Scan or type a barcode" value={form.barcode} onChange={input("barcode")} /></label><label className="field-label">Unit cost<input required type="number" min="0" step="0.01" placeholder="0.00" value={form.unitCost} onChange={input("unitCost")} /></label><label className="field-label">Currency<select value={form.currency} onChange={input("currency")}><option value="PHP">PHP — Philippine peso</option><option value="USD">USD — US dollar</option><option value="SGD">SGD — Singapore dollar</option><option value="AUD">AUD — Australian dollar</option><option value="EUR">EUR — Euro</option><option value="GBP">GBP — British pound</option></select></label><label className="field-label">Reorder point<input required type="number" min="0" step="1" value={form.reorderPoint} onChange={input("reorderPoint")} /><small>We’ll flag stock at or below this level.</small></label><label className="field-label field-span">Variant attributes <span className="field-optional">ONE PER LINE · KEY=VALUE</span><textarea rows={3} placeholder={"size=250 g\ncolour=Dark roast"} value={form.attributes} onChange={input("attributes")} /></label></div></section>
      {error && <PageError message={error} />}{notice && <div className="success-box"><ShieldCheck size={17} />{notice}</div>}
      <div className="form-actions"><Link className="button button-secondary" to="/products">Cancel</Link><Button type="submit" disabled={saving}>{saving ? "Saving…" : editing ? "Save changes" : "Save product"} <ChevronRight size={16} /></Button></div>
    </form>
  </>;
}

function InventoryPage(): React.JSX.Element {
  const stock = useLoad<{ items: Record<string, unknown>[] }>("/stock");
  const batches = useLoad<{ items: Record<string, unknown>[] }>("/batches");
  const locations = useLoad<{ items: Record<string, unknown>[] }>("/locations");
  const [tab, setTab] = useState<"stock" | "batches" | "history">("stock");
  const [modal, setModal] = useState<"in" | "out" | "adjust" | "transfer" | null>(null);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const refresh = () => { stock.reload(); batches.reload(); };
  const onSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault(); setMessage(""); setError("");
    const body = Object.fromEntries(new FormData(event.currentTarget).entries());
    const endpoint = modal === "in" ? "/stock/in" : modal === "out" ? "/stock/out" : modal === "adjust" ? "/adjustments" : "/transfers";
    const payload: Record<string, unknown> = { ...body };
    for (const field of ["quantity", "countedQuantity", "unitCostMinor"]) if (payload[field] !== undefined && payload[field] !== "") payload[field] = Number(payload[field]);
    if (payload.unitCostMinor !== undefined) payload.unitCostMinor = Math.round(Number(payload.unitCostMinor) * 100);
    if (modal === "transfer") payload.sourceLocationId = payload.locationId, delete payload.locationId;
    try {
      await api(endpoint, { method: "POST", body: JSON.stringify(payload) });
      setModal(null); setMessage("Inventory updated. Your stock counts are in sync."); refresh();
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Could not update stock."); }
  };
  const rows = stock.data?.items ?? [];
  const lowCount = rows.filter((row) => Number(row.quantityOnHand) <= Number(row.reorderPoint)).length;
  const products = useLoad<{ items: Product[] }>("/products");
  const variants = products.data?.items.flatMap((product) => product.variants.map((variant) => ({ ...variant, productName: product.name }))) ?? [];
  return <>
    <PageHeading eyebrow="STOCKROOM" title="Inventory" description="Know what you have, where it is, and when it’s time to restock." action={<div className="button-group"><Button variant="secondary" onClick={() => setModal("out")}><ArrowUpRight size={16} /> Stock out</Button><Button onClick={() => setModal("in")}><ArrowDownToLine size={16} /> Stock in</Button></div>} />
    {message && <div className="success-box"><ShieldCheck size={17} />{message}</div>}{error && <PageError message={error} />}
    <div className="stat-grid stat-grid-three"><StatCard label="Total units on hand" value={rows.reduce((sum, row) => sum + Number(row.quantityOnHand ?? 0), 0).toLocaleString()} change="Across all locations" icon={<Boxes size={17} />} /><StatCard label="Products tracked" value={String(new Set(rows.map((row) => row.productId)).size)} change="Active in your catalog" icon={<Package size={17} />} tone="blue" /><StatCard label="Needs a restock" value={String(lowCount)} change="At or below reorder point" icon={<Bell size={17} />} tone="sand" /></div>
    <section className="panel list-panel"><div className="tab-toolbar"><div className="tabs"><button className={tab === "stock" ? "tab active" : "tab"} onClick={() => setTab("stock")}>On hand <span>{rows.length}</span></button><button className={tab === "batches" ? "tab active" : "tab"} onClick={() => setTab("batches")}>Lots & batches <span>{batches.data?.items.length ?? 0}</span></button><button className={tab === "history" ? "tab active" : "tab"} onClick={() => setTab("history")}>Movement history</button></div><div className="toolbar-actions">{tab === "stock" && <Button variant="secondary" onClick={() => setModal("transfer")}><ArrowLeftRight size={15} /> Transfer</Button>}<Button variant="secondary" onClick={() => setModal("adjust")}><SlidersHorizontal size={15} /> Adjust stock</Button></div></div>
      {tab === "stock" ? <DataTable rowKey="variantId" rows={rows} empty="Add a product and receive stock to see your inventory here." columns={[
        { label: "PRODUCT / VARIANT", render: (row) => <span className="product-cell"><span className="product-thumb"><Package size={16} /></span><span><strong>{String(row.productName)} · {String(row.variantName)}</strong>{typeof row.variantDescription === "string" && row.variantDescription.length > 0 && <small>{row.variantDescription}</small>}<small className="mono">{String(row.sku)}</small></span></span> },
        { label: "LOCATION", render: (row) => String(row.locationName) },
        { label: "ON HAND", render: (row) => <strong>{String(row.quantityOnHand)} <small className="muted">units</small></strong> },
        { label: "REORDER AT", render: (row) => String(row.reorderPoint) },
        { label: "STATUS", render: (row) => Number(row.quantityOnHand) === 0 ? <StatusPill status="Out of stock" /> : Number(row.quantityOnHand) <= Number(row.reorderPoint) ? <StatusPill status="Low stock" /> : <StatusPill status="In stock" /> },
        { label: "VALUE", className: "align-right", render: (row) => money(Number(row.quantityOnHand) * Number(row.unitCostMinor), String(row.currency)) },
      ]} /> : tab === "batches" ? <DataTable rowKey="batchId" rows={batches.data?.items ?? []} empty="Each stock-in creates a traceable batch, complete with lot and receipt cost." columns={[
        { label: "PRODUCT / VARIANT", render: (row) => <span><strong>{String(row.productName)} · {String(row.variantName)}</strong>{typeof row.variantDescription === "string" && row.variantDescription.length > 0 && <small>{row.variantDescription}</small>}<small className="mono">{String(row.sku)}</small></span> },
        { label: "LOT / BATCH", render: (row) => <span className="mono">{String(row.lotNumber ?? "Unassigned")}</span> },
        { label: "LOCATION", render: (row) => String(row.locationName) },
        { label: "EXPIRES", render: (row) => dateLabel(row.expiresAt) },
        { label: "ON HAND", render: (row) => `${String(row.quantityOnHand)} units` },
        { label: "RECEIPT COST", className: "align-right", render: (row) => money(row.unitCostMinor, String(row.currency)) },
      ]} /> : <MovementList />}
    </section>
    {modal && <Modal title={modal === "in" ? "Receive stock" : modal === "out" ? "Issue stock" : modal === "adjust" ? "Adjust stock count" : "Transfer between locations"} onClose={() => setModal(null)}><form className="modal-form" onSubmit={(event) => void onSubmit(event)}><label className="field-label">Product & variant<select name="variantId" required><option value="">Choose a product</option>{variants.map((variant) => <option value={variant.id} key={variant.id}>{variant.productName} · {variant.name} ({variant.sku}){variant.description ? ` — ${variant.description}` : ""}</option>)}</select>{modal === "in" && <small>The variant description is saved with this receipt for stock history.</small>}</label>{modal === "transfer" ? <><label className="field-label">From<select name="locationId" required>{locations.data?.items.map((location) => <option key={String(location.id)} value={String(location.id)}>{String(location.name)}</option>)}</select></label><label className="field-label">To<select name="destinationLocationId" required><option value="">Choose destination</option>{locations.data?.items.map((location) => <option key={String(location.id)} value={String(location.id)}>{String(location.name)}</option>)}</select></label></> : <label className="field-label">Location<select name="locationId">{locations.data?.items.map((location) => <option key={String(location.id)} value={String(location.id)}>{String(location.name)}</option>)}</select></label>}{modal === "adjust" ? <label className="field-label">Counted quantity<input type="number" name="countedQuantity" min="0" step="1" required /></label> : <label className="field-label">Quantity<input type="number" name="quantity" min="1" step="1" required /></label>}{modal === "in" && <><label className="field-label">Unit cost<input type="number" name="unitCostMinor" min="0" step="0.01" placeholder="Leave blank to use catalog cost" /></label><label className="field-label">Lot number<input name="lotNumber" maxLength={100} /></label><label className="field-label">Expiry date<input type="date" name="expiresAt" /></label></>}<label className="field-label">Reference or note <span className="field-optional">OPTIONAL</span><input name="reference" maxLength={200} placeholder="Purchase order, reason, or note" /></label><div className="modal-actions"><Button type="button" variant="secondary" onClick={() => setModal(null)}>Cancel</Button><Button type="submit">Confirm movement <ChevronRight size={15} /></Button></div></form></Modal>}
  </>;
}

function MovementList(): React.JSX.Element {
  const { data, loading, error } = useLoad<{ items: Record<string, unknown>[] }>("/movements?limit=100");
  if (error) return <PageError message={error} />;
  if (loading) return <div className="table-skeleton" />;
  return <DataTable rowKey="id" rows={data?.items ?? []} empty="Every stock change will leave a clear trail right here." columns={[
    { label: "WHEN", render: (row) => dateLabel(row.createdAt) },
    { label: "PRODUCT / VARIANT", render: (row) => <span><strong>{String(row.productName)} · {String(row.variantName)}</strong>{typeof row.variantDescription === "string" && row.variantDescription.length > 0 && <small>{row.variantDescription}</small>}<small className="mono">{String(row.sku)}</small></span> },
    { label: "MOVEMENT", render: (row) => <StatusPill status={String(row.type).replace("_", " ")} /> },
    { label: "QUANTITY", render: (row) => { const quantity = Number(row.quantity); const delta = row.type === "stock_out" ? -quantity : quantity; return `${delta > 0 ? "+" : ""}${delta}`; } },
    { label: "REFERENCE", render: (row) => String(row.reference ?? row.note ?? "—") },
    { label: "VALUE", className: "align-right", render: (row) => money(row.totalCostMinor, String(row.currency)) },
  ]} />;
}

function Modal({ title, children, onClose }: { title: string; children: React.ReactNode; onClose: () => void }): React.JSX.Element {
  useEffect(() => {
    const handler = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    window.addEventListener("keydown", handler); return () => window.removeEventListener("keydown", handler);
  }, [onClose]);
  return <div className="modal-scrim" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}><div className="modal-card" role="dialog" aria-modal="true" aria-label={title}><div className="modal-heading"><div><span className="page-eyebrow">INVENTORY</span><h2>{title}</h2></div><IconButton label="Close" onClick={onClose}><X size={18} /></IconButton></div>{children}</div></div>;
}

function OrdersPage(): React.JSX.Element {
  const { data, loading, error, reload } = useLoad<{ items: Record<string, unknown>[] }>("/orders");
  const customers = useLoad<{ items: Customer[] }>("/customers");
  const products = useLoad<{ items: Product[] }>("/products");
  const [filter, setFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [modal, setModal] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const rows = (data?.items ?? []).filter((row) => (filter === "all" || row.status === filter) && `${row.orderNumber} ${row.customerName}`.toLowerCase().includes(search.toLowerCase()));
  const variants = products.data?.items.flatMap((product) => product.variants.map((variant) => ({ ...variant, productName: product.name }))) ?? [];
  const create = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault(); setErrorMessage("");
    const fields = new FormData(event.currentTarget);
    const customerId = String(fields.get("customerId") ?? "");
    const variant = variants.find((item) => item.id === fields.get("variantId"));
    if (!variant) { setErrorMessage("Choose a product before saving this order."); return; }
    const quantity = Number(fields.get("quantity"));
    try {
      await api("/orders", { method: "POST", body: JSON.stringify({
        customerId: customerId || undefined,
        customerName: customerId ? undefined : fields.get("customerName"),
        channel: fields.get("channel"),
        notes: fields.get("notes"),
        currency: variant.currency,
        items: [{ description: `${variant.productName} · ${variant.name}`, sku: variant.sku, quantity, unitPriceMinor: Math.round(Number(fields.get("unitPrice")) * 100) }],
      }) });
      setModal(false); reload();
    } catch (caught) { setErrorMessage(caught instanceof Error ? caught.message : "Could not create this order."); }
  };
  return <>
    <PageHeading eyebrow="FULFILLMENT" title="Orders" description="Every order, from first hello to out the door." action={<Button onClick={() => setModal(true)}><Plus size={17} /> New order</Button>} />
    {error && <PageError message={error} />}{errorMessage && <PageError message={errorMessage} />}
    <div className="stat-grid stat-grid-three"><StatCard label="All orders" value={String(data?.items.length ?? 0)} icon={<ShoppingBag size={17} />} /><StatCard label="To fulfill" value={String((data?.items ?? []).filter((row) => ["pending", "processing"].includes(String(row.status))).length)} icon={<ClipboardList size={17} />} tone="blue" /><StatCard label="On the way" value={String((data?.items ?? []).filter((row) => row.status === "shipped").length)} icon={<ArrowUpRight size={17} />} tone="sand" /></div>
    <section className="panel list-panel"><div className="list-toolbar"><div className="tabs compact-tabs">{["all", "pending", "processing", "shipped", "delivered", "cancelled"].map((item) => <button className={filter === item ? "tab active" : "tab"} onClick={() => setFilter(item)} key={item}>{item[0].toUpperCase() + item.slice(1)}</button>)}</div><SearchField value={search} onChange={setSearch} placeholder="Find an order…" /></div>{loading ? <div className="table-skeleton" /> : <DataTable rowKey="id" rows={rows} empty="Your next order is just around the corner." columns={[
      { label: "ORDER", render: (row) => <Link className="table-primary" to={`/orders/${row.id}`}>{String(row.orderNumber)}</Link> },
      { label: "CUSTOMER", render: (row) => String(row.customerName) },
      { label: "CHANNEL", render: (row) => <span className="channel-tag">{String(row.channel)}</span> },
      { label: "STATUS", render: (row) => <StatusPill status={String(row.status)} /> },
      { label: "DATE", render: (row) => dateLabel(row.createdAt) },
      { label: "TOTAL", className: "align-right", render: (row) => <strong>{money(row.totalMinor, String(row.currency))}</strong> },
      { label: "", render: (row) => <Link className="row-action" to={`/orders/${row.id}`}>Details <ChevronRight size={14} /></Link> },
    ]} />}</section>
    {modal && <Modal title="Create a new order" onClose={() => setModal(false)}><form className="modal-form" onSubmit={(event) => void create(event)}><label className="field-label">Customer<select name="customerId"><option value="">New customer / walk-in</option>{customers.data?.items.map((customer) => <option key={customer.id} value={customer.id}>{customer.name}</option>)}</select></label><label className="field-label">Customer name<input name="customerName" placeholder="Needed for a walk-in customer" /></label><label className="field-label">Product<select name="variantId" required><option value="">Choose a product</option>{variants.map((variant) => <option key={variant.id} value={variant.id}>{variant.productName} · {variant.name}</option>)}</select></label><div className="form-grid"><label className="field-label">Quantity<input type="number" name="quantity" min="1" value="1" required /></label><label className="field-label">Unit price<input type="number" name="unitPrice" min="0" step="0.01" required /></label></div><label className="field-label">Channel<select name="channel"><option>Manual</option><option>Facebook</option><option>Instagram</option><option>TikTok Shop</option><option>Messenger</option></select></label><label className="field-label">Notes<input name="notes" maxLength={500} /></label><p className="form-footnote">This creates an order record. Inventory is updated separately from the Inventory page.</p><div className="modal-actions"><Button type="button" variant="secondary" onClick={() => setModal(false)}>Cancel</Button><Button type="submit">Create order <ChevronRight size={15} /></Button></div></form></Modal>}
  </>;
}

function OrderDetailsPage(): React.JSX.Element {
  const { id } = useParams();
  const { data, error, loading, reload } = useLoad<Record<string, unknown>>(`/orders/${id}`);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const updateStatus = async (status: string) => {
    setBusy(true); setNotice("");
    try { await api(`/orders/${id}`, { method: "PATCH", body: JSON.stringify({ status }) }); setNotice("Order status updated."); reload(); }
    catch (caught) { setNotice(caught instanceof Error ? caught.message : "Could not update this order."); }
    finally { setBusy(false); }
  };
  if (loading) return <LoadingGrid />;
  if (error || !data) return <PageError message={error || "Order not found."} />;
  const items = data.items as Record<string, unknown>[];
  return <>
    <Link className="back-link" to="/orders"><ChevronLeft size={15} /> Back to orders</Link>
    <PageHeading eyebrow={`ORDER / ${String(data.orderNumber)}`} title="Order details" description={`Placed ${dateLabel(data.createdAt)} · ${String(data.channel)}`} action={<div className="button-group"><select className="status-select" value={String(data.status)} disabled={busy} onChange={(event) => void updateStatus(event.target.value)}><option value="pending">Pending</option><option value="processing">Processing</option><option value="shipped">Shipped</option><option value="delivered">Delivered</option><option value="cancelled">Cancelled</option></select><Button variant="secondary" onClick={() => window.print()}><FileText size={16} /> Print</Button></div>} />
    {notice && <div className="success-box">{notice}</div>}
    <div className="detail-grid"><section className="panel"><SectionHeading title="Items in this order" subtitle={`${items.length} line item${items.length === 1 ? "" : "s"}`} /><DataTable rowKey="id" rows={items} empty="No items in this order." columns={[
      { label: "ITEM", render: (row) => <span><strong>{String(row.description)}</strong><small className="mono">{String(row.sku ?? "")}</small></span> },
      { label: "QTY", render: (row) => String(row.quantity) },
      { label: "UNIT PRICE", className: "align-right", render: (row) => money(row.unitPriceMinor, String(data.currency)) },
      { label: "TOTAL", className: "align-right", render: (row) => <strong>{money(row.totalMinor, String(data.currency))}</strong> },
    ]} /><div className="order-total"><span>Order total</span><strong>{money(data.totalMinor, String(data.currency))}</strong></div></section>
    <div className="detail-side"><section className="panel"><SectionHeading title="Order status" /><StatusPill status={String(data.status)} /><div className="detail-meta"><span>Order number</span><strong className="mono">{String(data.orderNumber)}</strong><span>Channel</span><strong>{String(data.channel)}</strong><span>Created</span><strong>{dateLabel(data.createdAt)}</strong><span>Last updated</span><strong>{dateLabel(data.updatedAt)}</strong></div></section><section className="panel"><SectionHeading title="Customer" /><strong className="customer-detail-name">{String(data.customerName)}</strong>{data.customerId ? <Link className="inline-link" to={`/customers/${data.customerId}`}>View customer profile <ChevronRight size={14} /></Link> : <span className="muted small-copy">Walk-in customer</span>}</section>{Boolean(data.notes) && <section className="panel"><SectionHeading title="Order notes" /><p className="detail-notes">{String(data.notes)}</p></section>}</div></div>
  </>;
}

function CustomersPage(): React.JSX.Element {
  const { data, loading, error, reload } = useLoad<{ items: Customer[] }>("/customers");
  const [search, setSearch] = useState("");
  const [modal, setModal] = useState(false);
  const [message, setMessage] = useState("");
  const rows = (data?.items ?? []).filter((customer) => `${customer.name} ${customer.email ?? ""} ${customer.phone ?? ""}`.toLowerCase().includes(search.toLowerCase()));
  const create = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault(); const fields = new FormData(event.currentTarget);
    try {
      await api("/customers", { method: "POST", body: JSON.stringify(Object.fromEntries(fields.entries())) });
      setModal(false); setMessage("A new customer is in your book."); reload();
    } catch (caught) { setMessage(caught instanceof Error ? caught.message : "Could not add this customer."); }
  };
  return <>
    <PageHeading eyebrow="PEOPLE WHO MAKE IT HAPPEN" title="Customers" description="A little context goes a long way. Keep it all in one place." action={<Button onClick={() => setModal(true)}><Plus size={17} /> Add customer</Button>} />
    {error && <PageError message={error} />}{message && <div className="success-box">{message}</div>}
    <div className="stat-grid stat-grid-three"><StatCard label="Customers" value={String(data?.items.length ?? 0)} change="Everyone in your customer book" icon={<Users size={17} />} /><StatCard label="Returning customers" value={String((data?.items ?? []).filter((customer) => Number(customer.orderCount) > 1).length)} change="More than one order" icon={<UserRound size={17} />} tone="lilac" /><StatCard label="Customer lifetime sales" value={money((data?.items ?? []).reduce((total, customer) => total + Number(customer.spentMinor ?? 0), 0))} change="Across all recorded orders" icon={<Wallet size={17} />} tone="blue" /></div>
    <section className="panel list-panel"><div className="list-toolbar"><SearchField value={search} onChange={setSearch} placeholder="Search your customers…" /><span className="result-count">{rows.length} customers</span></div>{loading ? <div className="table-skeleton" /> : <DataTable rowKey="id" rows={rows as unknown as Record<string, unknown>[]} empty="Your customer list is a blank page. Let’s change that." columns={[
      { label: "CUSTOMER", render: (row) => <Link className="product-cell" to={`/customers/${row.id}`}><span className="avatar avatar-customer">{initials(String(row.name))}</span><span><strong className="table-primary">{String(row.name)}</strong><small>{String(row.email || row.phone || "No contact details")}</small></span></Link> },
      { label: "ORDERS", render: (row) => String(row.orderCount ?? 0) },
      { label: "LIFETIME SALES", className: "align-right", render: (row) => money(row.spentMinor) },
      { label: "CUSTOM SINCE", render: (row) => dateLabel(row.createdAt) },
      { label: "", render: (row) => <Link className="row-action" to={`/customers/${row.id}`}>Profile <ChevronRight size={14} /></Link> },
    ]} />}</section>
    {modal && <Modal title="Add a customer" onClose={() => setModal(false)}><form className="modal-form" onSubmit={(event) => void create(event)}><label className="field-label">Full name<input name="name" required maxLength={200} /></label><label className="field-label">Email<input name="email" type="email" /></label><label className="field-label">Phone<input name="phone" maxLength={50} /></label><label className="field-label">Address<input name="address" maxLength={500} /></label><label className="field-label">Notes<textarea name="notes" rows={3} maxLength={500} /></label><div className="modal-actions"><Button type="button" variant="secondary" onClick={() => setModal(false)}>Cancel</Button><Button type="submit">Save customer</Button></div></form></Modal>}
  </>;
}

function CustomerProfilePage(): React.JSX.Element {
  const { id } = useParams();
  const { data, error, loading } = useLoad<Record<string, unknown>>(`/customers/${id}`);
  if (loading) return <LoadingGrid />;
  if (error || !data) return <PageError message={error || "Customer not found."} />;
  return <>
    <Link className="back-link" to="/customers"><ChevronLeft size={15} /> Back to customers</Link>
    <PageHeading eyebrow="YOUR CUSTOMER BOOK" title={String(data.name)} description={`A customer since ${dateLabel(data.createdAt)}.`} action={<Button variant="secondary" onClick={() => window.print()}><FileText size={16} /> Print profile</Button>} />
    <div className="stat-grid stat-grid-three"><StatCard label="Lifetime sales" value={money(data.spentMinor)} icon={<Wallet size={17} />} /><StatCard label="Orders" value={String(data.orderCount ?? 0)} icon={<ShoppingBag size={17} />} tone="blue" /><StatCard label="Contact" value={String(data.email || data.phone || "Not added")} icon={<UserRound size={17} />} tone="lilac" /></div>
    <div className="detail-grid customer-detail-grid"><section className="panel"><SectionHeading title="Order history" subtitle="A little history, a lot of context." /><DataTable rowKey="id" rows={data.orders as Record<string, unknown>[]} empty="There are no orders for this customer yet." columns={[
      { label: "ORDER", render: (row) => <Link className="table-primary" to={`/orders/${row.id}`}>{String(row.orderNumber)}</Link> },
      { label: "DATE", render: (row) => dateLabel(row.createdAt) },
      { label: "STATUS", render: (row) => <StatusPill status={String(row.status)} /> },
      { label: "TOTAL", className: "align-right", render: (row) => money(row.totalMinor, String(row.currency)) },
    ]} /></section><section className="panel"><SectionHeading title="Customer details" /><div className="detail-meta"><span>Email</span><strong>{String(data.email || "—")}</strong><span>Phone</span><strong>{String(data.phone || "—")}</strong><span>Address</span><strong>{String(data.address || "—")}</strong></div>{Boolean(data.notes) && <><div className="soft-divider" /><span className="detail-label">NOTES</span><p className="detail-notes">{String(data.notes)}</p></>}</section></div>
  </>;
}

function TransactionsPage({ type }: { type: "sales" | "expenses" }): React.JSX.Element {
  const endpoint = `/${type}`;
  const { data, loading, error, reload } = useLoad<{ items: Record<string, unknown>[] }>(endpoint);
  const customers = useLoad<{ items: Customer[] }>("/customers");
  const settings = useLoad<{ currency: string }>("/settings");
  const [modal, setModal] = useState(false);
  const [message, setMessage] = useState("");
  const currency = settings.data?.currency ?? "PHP";
  const items = data?.items ?? [];
  const amount = (row: Record<string, unknown>) => row.amountMinor ?? row.amount_minor;
  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault(); const fields = Object.fromEntries(new FormData(event.currentTarget).entries());
    const payload: Record<string, unknown> = { ...fields, amountMinor: Math.round(Number(fields.amount) * 100), currency };
    delete payload.amount;
    if (type === "sales" && payload.customerId === "") { delete payload.customerId; }
    try { await api(endpoint, { method: "POST", body: JSON.stringify(payload) }); setModal(false); setMessage(`${type === "sales" ? "Sale" : "Expense"} saved.`); reload(); }
    catch (caught) { setMessage(caught instanceof Error ? caught.message : "Could not save this entry."); }
  };
  return <>
    <PageHeading eyebrow={type === "sales" ? "MONEY IN" : "MONEY OUT"} title={type === "sales" ? "Sales" : "Expenses"} description={type === "sales" ? "Keep a clear record of what your hard work brings in." : "The cost of doing business, all in one tidy place."} action={<Button onClick={() => setModal(true)}><Plus size={17} /> {type === "sales" ? "Record a sale" : "Add an expense"}</Button>} />
    {error && <PageError message={error} />}{message && <div className="success-box">{message}</div>}
    <div className="stat-grid stat-grid-three"><StatCard label={`Total ${type}`} value={money(items.reduce((sum, row) => sum + Number(amount(row) ?? 0), 0), currency)} change="All recorded transactions" icon={type === "sales" ? <TrendingUp size={17} /> : <TrendingDown size={17} />} /><StatCard label="This month" value={money(items.filter((row) => new Date(String(row.createdAt ?? row.created_at)).getMonth() === new Date().getMonth()).reduce((sum, row) => sum + Number(amount(row) ?? 0), 0), currency)} change="In the current calendar month" icon={<ChartNoAxesCombined size={17} />} tone="blue" /><StatCard label="Entries" value={String(items.length)} change="Your transaction history" icon={<FileText size={17} />} tone="sand" /></div>
    <section className="panel list-panel"><div className="list-toolbar"><div><h2 className="inline-panel-title">All {type}</h2><span className="result-count">{items.length} entries</span></div><span className="soft-tag"><Activity size={13} /> UPDATED JUST NOW</span></div>{loading ? <div className="table-skeleton" /> : <DataTable rowKey="id" rows={items} empty={`Your ${type} entries will appear here.`} columns={type === "sales" ? [
      { label: "DESCRIPTION", render: (row) => <span><strong>{String(row.description)}</strong><small>{String(row.customerName ?? row.customer_name ?? "Walk-in customer")}</small></span> },
      { label: "CHANNEL", render: (row) => <span className="channel-tag">{String(row.channel)}</span> },
      { label: "DATE", render: (row) => dateLabel(row.createdAt ?? row.created_at) },
      { label: "AMOUNT", className: "align-right", render: (row) => <strong>{money(amount(row), String(row.currency ?? currency))}</strong> },
    ] : [
      { label: "EXPENSE", render: (row) => <span><strong>{String(row.description)}</strong><small>{String(row.notes ?? "—")}</small></span> },
      { label: "CATEGORY", render: (row) => <span className="channel-tag">{String(row.category)}</span> },
      { label: "DATE", render: (row) => dateLabel(row.createdAt ?? row.created_at) },
      { label: "AMOUNT", className: "align-right", render: (row) => <strong>{money(amount(row), String(row.currency ?? currency))}</strong> },
    ]} />}</section>
    {modal && <Modal title={type === "sales" ? "Record a sale" : "Add an expense"} onClose={() => setModal(false)}><form className="modal-form" onSubmit={(event) => void submit(event)}><label className="field-label">{type === "sales" ? "What did you sell?" : "What was the expense?"}<input name="description" required maxLength={500} /></label>{type === "sales" ? <><label className="field-label">Customer<select name="customerId"><option value="">Walk-in customer</option>{customers.data?.items.map((customer) => <option key={customer.id} value={customer.id}>{customer.name}</option>)}</select></label><label className="field-label">Customer name <span className="field-optional">IF WALK-IN</span><input name="customerName" placeholder="Walk-in customer" /></label><label className="field-label">Channel<select name="channel"><option>Manual</option><option>Facebook</option><option>Instagram</option><option>TikTok Shop</option><option>Messenger</option></select></label></> : <label className="field-label">Category<select name="category"><option>Supplies</option><option>Shipping</option><option>Marketing</option><option>Utilities</option><option>Rent</option><option>Software</option><option>Other</option></select></label>}<label className="field-label">Amount ({currency})<input type="number" name="amount" min="0" step="0.01" required /></label>{type === "expenses" && <label className="field-label">Notes<input name="notes" maxLength={500} /></label>}<div className="modal-actions"><Button type="button" variant="secondary" onClick={() => setModal(false)}>Cancel</Button><Button type="submit">Save {type === "sales" ? "sale" : "expense"}</Button></div></form></Modal>}
  </>;
}

function SalesPage(): React.JSX.Element { return <TransactionsPage type="sales" />; }
function ExpensesPage(): React.JSX.Element { return <TransactionsPage type="expenses" />; }

function AccountingPage(): React.JSX.Element {
  const { data, loading, error } = useLoad<Record<string, unknown>>("/accounting/summary");
  const currency = String(data?.currency ?? "PHP");
  const monthly = (data?.monthly as Record<string, unknown>[] | undefined) ?? [];
  const maxSales = Math.max(...monthly.map((row) => Number(row.revenueMinor)), 1);
  return <>
    <PageHeading eyebrow="YOUR MONEY, MADE CLEAR" title="Accounting" description="A clear picture of what’s coming in and going out." action={<Link to="/reports" className="button button-secondary"><FileBarChart size={16} /> View reports</Link>} />
    {error && <PageError message={error} />}{loading && <LoadingGrid />}
    {!loading && <><div className="stat-grid"><StatCard label="Revenue this month" value={money(data?.monthSalesMinor, currency)} change="Recorded sales this month" icon={<TrendingUp size={17} />} /><StatCard label="Expenses this month" value={money(data?.monthExpensesMinor, currency)} change="Recorded expenses this month" icon={<TrendingDown size={17} />} tone="sand" /><StatCard label="Net income this month" value={money(data?.monthProfitMinor, currency)} change="Revenue less recorded expenses" icon={<Wallet size={17} />} tone="blue" /><StatCard label="Inventory value" value={money(data?.inventoryValueMinor, currency)} change="Current FIFO stock valuation" icon={<Boxes size={17} />} tone="lilac" /></div>
      <div className="accounting-grid"><section className="panel chart-panel"><SectionHeading title="Your sales at a glance" subtitle="Recorded revenue by month" /><div className="chart-legend"><span><i /> Revenue</span><span className="chart-caption">Last 6 months</span></div><div className="chart-area">{monthly.length ? monthly.slice().reverse().map((month) => <div className="chart-column" key={String(month.month)}><span className="chart-tooltip">{money(month.revenueMinor, currency)}</span><i style={{ height: `${Math.max(5, Number(month.revenueMinor) / maxSales * 100)}%` }} /><small>{new Intl.DateTimeFormat("en", { month: "short" }).format(new Date(`${month.month}-01T00:00:00`))}</small></div>) : <EmptyState icon={<ChartNoAxesCombined size={20} />} title="Your first sale starts the story" description="Once you record sales, your monthly picture will take shape." />}</div></section>
      <section className="panel accounting-summary"><SectionHeading title="At a glance" subtitle="Your business, in numbers" /><div className="summary-row"><span>Total revenue</span><strong>{money(data?.totalRevenueMinor, currency)}</strong></div><div className="summary-row"><span>Total expenses</span><strong>{money(data?.totalExpensesMinor, currency)}</strong></div><div className="soft-divider" /><div className="summary-row summary-highlight"><span>Net income to date</span><strong>{money(Number(data?.totalRevenueMinor) - Number(data?.totalExpensesMinor), currency)}</strong></div><Link className="inline-link summary-link" to="/sales">Review sales & expenses <ChevronRight size={14} /></Link></section></div></>}
  </>;
}

function ReportsPage(): React.JSX.Element {
  const { data, loading, error } = useLoad<Record<string, unknown>>("/reports");
  const currency = String(data?.currency ?? "PHP");
  const sales = (data?.sales as Record<string, unknown>[] | undefined) ?? [];
  const expenses = (data?.expenses as Record<string, unknown>[] | undefined) ?? [];
  const orders = (data?.orders as Record<string, unknown>[] | undefined) ?? [];
  const totalSales = sales.reduce((sum, item) => sum + Number(item.amountMinor), 0);
  const totalExpenses = expenses.reduce((sum, item) => sum + Number(item.amountMinor), 0);
  return <>
    <PageHeading eyebrow="THE BIGGER PICTURE" title="Reports" description="Take a breath, zoom out, and see how things are going." action={<Button variant="secondary" onClick={() => window.print()}><FileText size={16} /> Export report</Button>} />
    {error && <PageError message={error} />}{loading && <LoadingGrid />}
    {!loading && <><div className="report-filter"><span className="filter-icon"><SlidersHorizontal size={15} /></span><span>Reporting currency <strong>{currency}</strong></span><span className="report-date">Updated just now</span></div><div className="stat-grid stat-grid-three"><StatCard label="Gross sales" value={money(totalSales, currency)} change={`${sales.length} daily entries`} icon={<TrendingUp size={17} />} /><StatCard label="Expenses" value={money(totalExpenses, currency)} change={`${expenses.length} categories`} icon={<TrendingDown size={17} />} tone="sand" /><StatCard label="Net income" value={money(totalSales - totalExpenses, currency)} change="Recorded sales less expenses" icon={<ChartNoAxesCombined size={17} />} tone="blue" /></div>
      <div className="report-grid"><section className="panel"><SectionHeading title="Sales by day" subtitle="The last 90 days" /><DataTable rowKey="day" rows={sales} empty="Record a sale to start your sales report." columns={[
        { label: "DAY", render: (row) => dateLabel(row.day) },
        { label: "TRANSACTIONS", render: (row) => String(row.transactionCount) },
        { label: "SALES", className: "align-right", render: (row) => <strong>{money(row.amountMinor, currency)}</strong> },
      ]} /></section><section className="panel"><SectionHeading title="Expenses by category" subtitle="Where your costs go" /><DataTable rowKey="category" rows={expenses} empty="Add expenses to see where your costs go." columns={[
        { label: "CATEGORY", render: (row) => <span className="channel-tag">{String(row.category)}</span> },
        { label: "ENTRIES", render: (row) => String(row.transactionCount) },
        { label: "TOTAL", className: "align-right", render: (row) => <strong>{money(row.amountMinor, currency)}</strong> },
      ]} /></section><section className="panel report-orders"><SectionHeading title="Orders by status" subtitle="A quick pulse on fulfillment" /><DataTable rowKey="status" rows={orders} empty="Your order report will appear when you start tracking orders." columns={[
        { label: "STATUS", render: (row) => <StatusPill status={String(row.status)} /> },
        { label: "ORDERS", render: (row) => String(row.count) },
        { label: "ORDER TOTAL", className: "align-right", render: (row) => <strong>{money(row.amountMinor, currency)}</strong> },
      ]} /></section></div></>}
  </>;
}

function SettingsPage(): React.JSX.Element {
  const { data, loading, error } = useLoad<{ businessName: string; currency: string; timezone: string; lowStockEmailAlerts: boolean }>("/settings");
  const [form, setForm] = useState<{ businessName: string; currency: string; timezone: string; lowStockEmailAlerts: boolean } | null>(null);
  const [notice, setNotice] = useState("");
  const [problem, setProblem] = useState("");
  useEffect(() => { if (data && !form) setForm(data); }, [data, form]);
  const change = (key: keyof NonNullable<typeof form>, value: string | boolean) => setForm((current) => current ? { ...current, [key]: value } : current);
  const save = async (event: React.FormEvent) => {
    event.preventDefault(); if (!form) return; setNotice(""); setProblem("");
    try { await api("/settings", { method: "PATCH", body: JSON.stringify(form) }); setNotice("Your workspace settings are saved."); }
    catch (caught) { setProblem(caught instanceof Error ? caught.message : "Could not save settings."); }
  };
  return <>
    <PageHeading eyebrow="MAKE IT YOURS" title="Settings" description="The little details that make this workspace feel like yours." />
    {error && <PageError message={error} />}{notice && <div className="success-box"><ShieldCheck size={17} />{notice}</div>}{problem && <PageError message={problem} />}
    {loading || !form ? <LoadingGrid /> : <form onSubmit={(event) => void save(event)} className="settings-layout"><div className="settings-nav"><a className="settings-nav-item active" href="#business">Business details</a><a className="settings-nav-item" href="#preferences">Preferences</a><Link className="settings-nav-item" to="/users">Team & access <ChevronRight size={14} /></Link></div><div className="settings-sections"><section className="panel form-panel" id="business"><SectionHeading title="Business details" subtitle="The name and currency used across your workspace." /><div className="form-grid"><label className="field-label field-span">Business name<input required maxLength={200} value={form.businessName} onChange={(event) => change("businessName", event.target.value)} /></label><label className="field-label">Default currency<select value={form.currency} onChange={(event) => change("currency", event.target.value)}><option value="PHP">PHP — Philippine peso</option><option value="USD">USD — US dollar</option><option value="SGD">SGD — Singapore dollar</option><option value="AUD">AUD — Australian dollar</option><option value="EUR">EUR — Euro</option><option value="GBP">GBP — British pound</option></select><small>New sales and expenses use this currency by default.</small></label><label className="field-label">Time zone<input maxLength={100} value={form.timezone} onChange={(event) => change("timezone", event.target.value)} /><small>Use an IANA name, such as Asia/Manila.</small></label></div></section><section className="panel form-panel" id="preferences"><SectionHeading title="Preferences" subtitle="A few thoughtful nudges to help you stay ahead." /><label className="toggle-row"><span><strong>Low stock reminders</strong><small>Show inventory at or below its reorder point on your dashboard.</small></span><input type="checkbox" checked={form.lowStockEmailAlerts} onChange={(event) => change("lowStockEmailAlerts", event.target.checked)} /></label></section><div className="form-actions"><Button type="submit"><ShieldCheck size={16} /> Save settings</Button></div></div></form>}
  </>;
}

function UsersPage(): React.JSX.Element {
  const { data, loading, error, reload } = useLoad<{ items: Record<string, unknown>[]; invitations: Record<string, unknown>[] }>("/users");
  const [modal, setModal] = useState(false);
  const [notice, setNotice] = useState("");
  const [errorMessage, setErrorMessage] = useState("");
  const [inviteUrl, setInviteUrl] = useState("");
  const [copied, setCopied] = useState(false);
  const create = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault(); setNotice(""); setErrorMessage(""); setInviteUrl("");
    const body = Object.fromEntries(new FormData(event.currentTarget).entries());
    try {
      const result = await api<{ inviteUrl: string }>("/users", { method: "POST", body: JSON.stringify(body) });
      setInviteUrl(result.inviteUrl); setNotice("Invitation created. Copy this private link and send it to your teammate."); reload();
    } catch (caught) { setErrorMessage(caught instanceof Error ? caught.message : "Could not create invitation."); }
  };
  const toggle = async (row: Record<string, unknown>) => {
    setNotice(""); setErrorMessage("");
    try { await api(`/users/${row.id}`, { method: "PATCH", body: JSON.stringify({ active: !row.active }) }); reload(); }
    catch (caught) { setErrorMessage(caught instanceof Error ? caught.message : "Could not update this account."); }
  };
  const copy = async () => {
    try { await navigator.clipboard.writeText(inviteUrl); setCopied(true); }
    catch { setErrorMessage("Couldn’t copy automatically. Select and copy the invitation link."); }
  };
  return <>
    <PageHeading eyebrow="THE PEOPLE BEHIND IT" title="User management" description="Invite your people in, and keep the right things in the right hands." action={<Button onClick={() => { setModal(true); setInviteUrl(""); setNotice(""); }}><UserRoundPlus size={17} /> Invite a teammate</Button>} />
    {error && <PageError message={error} />}{errorMessage && <PageError message={errorMessage} />}{notice && <div className="success-box"><ShieldCheck size={17} />{notice}</div>}
    <div className="stat-grid stat-grid-three"><StatCard label="Team members" value={String(data?.items.length ?? 0)} change="People with workspace access" icon={<Users size={17} />} /><StatCard label="Workspace owners" value={String((data?.items ?? []).filter((row) => row.role === "owner" && row.active).length)} change="Full access and ownership" icon={<ShieldCheck size={17} />} tone="blue" /><StatCard label="Pending invitations" value={String(data?.invitations.length ?? 0)} change="Links expire after seven days" icon={<UserRoundPlus size={17} />} tone="lilac" /></div>
    <section className="panel list-panel"><SectionHeading title="Your team" subtitle="You can change a teammate’s access any time." />{loading ? <div className="table-skeleton" /> : <DataTable rowKey="id" rows={data?.items ?? []} empty="You’re the first member of your team." columns={[
      { label: "TEAMMATE", render: (row) => <span className="product-cell"><span className="avatar avatar-customer">{initials(String(row.name))}</span><span><strong>{String(row.name)}</strong><small>{String(row.email)}</small></span></span> },
      { label: "ROLE", render: (row) => <span className="channel-tag">{String(row.role)}</span> },
      { label: "JOINED", render: (row) => dateLabel(row.createdAt) },
      { label: "ACCESS", render: (row) => <StatusPill status={row.active ? "Active" : "Inactive"} /> },
      { label: "", render: (row) => row.role === "owner" ? <span className="muted">Owner</span> : <button className="row-action button-link" onClick={() => void toggle(row)}>{row.active ? "Deactivate" : "Reactivate"}</button> },
    ]} />}</section>
    {Boolean(data?.invitations.length) && <section className="panel invitation-panel"><SectionHeading title="Pending invitations" /><DataTable rowKey="email" rows={data?.invitations ?? []} empty="No pending invites." columns={[
      { label: "NAME", render: (row) => String(row.name) },
      { label: "EMAIL", render: (row) => String(row.email) },
      { label: "ROLE", render: (row) => <span className="channel-tag">{String(row.role)}</span> },
      { label: "EXPIRES", render: (row) => dateLabel(row.expiresAt) },
    ]} /></section>}
    {modal && <Modal title="Invite a teammate" onClose={() => setModal(false)}>{inviteUrl ? <div className="invite-created"><span className="success-icon"><UserRoundPlus size={20} /></span><h3>Your invite is ready to go.</h3><p>This private link gives one person access and expires in seven days.</p><div className="copy-link"><input readOnly value={inviteUrl} onFocus={(event) => event.target.select()} /><Button variant="secondary" onClick={() => void copy()}>{copied ? "Copied!" : "Copy link"}</Button></div><div className="modal-actions"><Button variant="secondary" onClick={() => { setModal(false); reload(); }}>Done</Button><Button onClick={() => { setInviteUrl(""); setNotice(""); setCopied(false); }}>Invite another</Button></div></div> : <form className="modal-form" onSubmit={(event) => void create(event)}><label className="field-label">Full name<input name="name" required maxLength={200} /></label><label className="field-label">Work email<input type="email" name="email" required /></label><label className="field-label">Workspace role<select name="role"><option value="staff">Staff — day-to-day access</option><option value="admin">Admin — manage workspace & team</option></select></label>{errorMessage && <PageError message={errorMessage} />}<div className="modal-actions"><Button type="button" variant="secondary" onClick={() => setModal(false)}>Cancel</Button><Button type="submit">Create invitation</Button></div></form>}</Modal>}
  </>;
}

function App(): React.JSX.Element {
  return <BrowserRouter><SessionProvider /></BrowserRouter>;
}

createRoot(document.getElementById("root")!).render(<React.StrictMode><App /></React.StrictMode>);
