import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
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
import { api, money, dateLabel, useLoad } from "./api";
import { CommerceOrders, CommerceOrderDetails, CheckoutPage, TrackingPage } from "./commerce";
import { RawMaterialBomPage } from "./bom";
import { ProfileSocialLinks, profilePlatforms, type ProfileLinks } from "./profile-social";
import { ProfilePicture, UserAvatar, initials } from "./profile-picture";
import { canAccessPage, homePath, isAdmin, roleLabel, workspaceRoles, type Role } from "./roles";

interface User {
  id: string;
  name: string;
  email: string;
  role: Role;
  avatarUrl: string | null;
}
interface SessionState {
  user: User | null;
  needsSetup: boolean;
  rawMaterialBomEnabled: boolean;
  refresh: () => Promise<void>;
  updateAvatar: (url: string | null) => void;
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
  uom: string;
  uomLocked: boolean;
  description?: string | null;
  sku: string;
  barcode?: string | null;
  attributes: Record<string, string>;
  unitCostMinor: number;
  sellingPriceMinor: number | null;
  currency: string;
  reorderPoint: number;
  mediumStockLevel: number | null;
  maximumStockLevel: number | null;
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
  facebookUrl?: string | null;
  instagramUrl?: string | null;
  tiktokUrl?: string | null;
  whatsappUrl?: string | null;
  websiteUrl?: string | null;
}
const customerSocialPlatforms = [
  { field: "facebookUrl", label: "Facebook", placeholder: "https://www.facebook.com/username" },
  { field: "instagramUrl", label: "Instagram", placeholder: "https://www.instagram.com/username" },
  { field: "tiktokUrl", label: "TikTok", placeholder: "https://www.tiktok.com/@username" },
  { field: "whatsappUrl", label: "WhatsApp", placeholder: "https://wa.me/12025550101" },
  { field: "websiteUrl", label: "Website", placeholder: "https://example.com" },
] as const;

const SessionContext = createContext<SessionState>({
  user: null,
  needsSetup: false,
  rawMaterialBomEnabled: false,
  refresh: async () => undefined,
  updateAvatar: () => undefined,
});

function stockQuantitySummary(rows: Record<string, unknown>[]): string {
  const totals = new Map<string, number>();
  for (const row of rows) {
    const uom = String(row.uom);
    totals.set(uom, (totals.get(uom) ?? 0) + Number(row.quantityOnHand));
  }
  return [...totals].sort(([a], [b]) => a.localeCompare(b))
    .map(([uom, quantity]) => `${quantity.toLocaleString()} ${uom}`).join(" · ") || "0";
}

function UomField({ value, onChange, locked = false }: { value: string; onChange: (value: string) => void; locked?: boolean }): React.JSX.Element {
  const listId = React.useId();
  return <label className="field-label">Unit of measure (UOM)
    <input name="uom" required maxLength={30} value={value} onChange={(event) => onChange(event.target.value)} readOnly={locked} list={listId} placeholder="e.g. pcs, kg, liters, box" />
    <datalist id={listId}>{["pcs", "kg", "g", "liters", "ml", "box", "pack", "meter"].map((uom) => <option key={uom} value={uom} />)}</datalist>
    <small>{locked ? "Locked after the first stock movement. Use a new variant for a different UOM." : "One UOM per variant. Whole-number quantities only; no unit conversion. Unit cost is per UOM."}</small>
  </label>;
}

function SessionProvider(): React.JSX.Element {
  const [user, setUser] = useState<User | null>(null);
  const [needsSetup, setNeedsSetup] = useState(false);
  const [rawMaterialBomEnabled, setRawMaterialBomEnabled] = useState(false);
  const [ready, setReady] = useState(false);
  const [syncError, setSyncError] = useState("");
  const refresh = useCallback(async () => {
    try {
      const status = await api<{ user: User | null; needsSetup: boolean; rawMaterialBomEnabled: boolean }>("/auth/status");
      setUser(status.user);
      setNeedsSetup(status.needsSetup);
      setRawMaterialBomEnabled(status.rawMaterialBomEnabled);
      setSyncError("");
    } finally {
      setReady(true);
    }
  }, []);
  useEffect(() => { void refresh().catch(() => setReady(true)); }, []);
  useEffect(() => {
    if (!user || !("BroadcastChannel" in window)) return;
    const channel = new BroadcastChannel("sellerone-profile-picture");
    channel.onmessage = (event: MessageEvent<unknown>) => {
      if (event.data === user.id) void refresh().catch(() => setSyncError("Could not refresh your profile picture. Reload this page to retry."));
    };
    return () => channel.close();
  }, [user?.id, refresh]);
  const updateAvatar = (avatarUrl: string | null) => {
    setUser((current) => current ? { ...current, avatarUrl } : current);
    if (user && "BroadcastChannel" in window) {
      const channel = new BroadcastChannel("sellerone-profile-picture");
      channel.postMessage(user.id); channel.close();
    }
  };
  if (!ready) return <div className="boot-screen"><span className="brand-glyph">S</span><span>Opening your workspace…</span></div>;
  return (
    <SessionContext.Provider value={{ user, needsSetup, rawMaterialBomEnabled, refresh, updateAvatar }}>
      {syncError && <div className="error-box" role="alert">{syncError}</div>}
      <Routes>
        <Route path="/login" element={<AuthPage mode="login" />} />
        <Route path="/setup" element={<AuthPage mode="setup" />} />
        <Route path="/register" element={<AuthPage mode="register" />} />
        <Route path="/forgot-password" element={<AuthPage mode="forgot" />} />
        <Route path="/reset-password" element={<AuthPage mode="reset" />} />
        <Route path="/checkout/:token" element={<CheckoutPage />} />
        <Route path="/track/:token" element={<TrackingPage />} />
        <Route element={<ProtectedLayout />}>
          <Route index element={<DashboardPage />} />
          <Route path="dashboard" element={<DashboardPage />} />
          <Route path="products" element={<ProductsPage />} />
          <Route path="products/new" element={<ProductFormPage />} />
          <Route path="products/:id/edit" element={<ProductFormPage />} />
          <Route path="inventory" element={<InventoryPage />} />
          <Route path="raw-material-bom" element={<RawMaterialBomPage enabled={rawMaterialBomEnabled} role={user?.role ?? "staff"} />} />
          <Route path="orders" element={<CommerceOrders role={user?.role ?? "staff"} />} />
          <Route path="orders/:id" element={<CommerceOrderDetails role={user?.role ?? "staff"} />} />
          <Route path="customers" element={<CustomersPage />} />
          <Route path="customers/:id" element={<CustomerProfilePage />} />
          <Route path="sales" element={<SalesPage />} />
          <Route path="expenses" element={<ExpensesPage />} />
          <Route path="accounting" element={<AccountingPage />} />
          <Route path="reports" element={<ReportsPage />} />
          <Route path="settings" element={<SettingsPage />} />
          <Route path="profile" element={<ProfileSettingsPage />} />
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

function AccountOptions({ user, onNavigate, avatar = false }: { user: User; onNavigate: () => void; avatar?: boolean }): React.JSX.Element {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const container = React.useRef<HTMLDivElement>(null);
  const trigger = React.useRef<HTMLButtonElement>(null);
  const panelId = React.useId();
  const location = useLocation();
  useEffect(() => { setOpen(false); }, [location.key]);
  const social = useLoad<{ links: ProfileLinks }>(open ? "/me/social-links" : "");
  useEffect(() => {
    if (!open) return;
    const dismiss = (event: PointerEvent | FocusEvent) => {
      if (event.target instanceof Node && !container.current?.contains(event.target)) setOpen(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
        trigger.current?.focus();
      }
    };
    document.addEventListener("pointerdown", dismiss);
    document.addEventListener("focusin", dismiss);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("pointerdown", dismiss);
      document.removeEventListener("focusin", dismiss);
      document.removeEventListener("keydown", escape);
    };
  }, [open]);
  const signOut = async () => {
    setBusy(true); setError("");
    try {
      await api("/auth/logout", { method: "POST" });
      window.location.assign("/login");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not sign out. Please try again.");
      setBusy(false);
    }
  };
  return <div className={`account-options${avatar ? " account-options-top" : ""}`} ref={container}>
    <button ref={trigger} className={avatar ? "icon-button profile-avatar-trigger" : "icon-button profile-more"} type="button" aria-label={avatar ? "Profile Settings" : "Account options"} aria-expanded={open} aria-controls={panelId} onClick={() => setOpen((value) => !value)}>{avatar ? <UserAvatar name={user.name} avatarUrl={user.avatarUrl} className="avatar-top" /> : <MoreHorizontal size={19} />}</button>
    {open && <div className="account-panel" id={panelId} role="region" aria-label={avatar ? "Profile Settings menu" : "Account options"}>
      <strong>{user.name}</strong><small>{user.email}</small>
      <Link className="account-action" to="/profile" onClick={() => { setOpen(false); onNavigate(); }}><UserRound size={16} /> Account details</Link>
      <Link className="account-action" to="/profile#security" onClick={() => { setOpen(false); onNavigate(); }}><ShieldCheck size={16} /> Security / password</Link>
      <Link className="account-action" to="/profile#preferences" onClick={() => { setOpen(false); onNavigate(); }}><SlidersHorizontal size={16} /> Preferences</Link>
      {isAdmin(user.role) && <Link className="account-action" to="/settings" onClick={() => { setOpen(false); onNavigate(); }}><Settings size={16} /> Workspace settings</Link>}
      {social.loading && <small role="status">Loading social links...</small>}
      {social.error && <div className="error-box" role="alert">{social.error}<button type="button" className="text-button" onClick={social.reload}>Retry social links</button></div>}
      {social.data && profilePlatforms.map(({ field, label, icon: Icon }) => social.data?.links[field].visible && social.data.links[field].url && <a key={field} className="account-action" href={social.data.links[field].url ?? undefined} target="_blank" rel="noopener noreferrer"><Icon size={16} aria-hidden="true" /> {label} profile</a>)}
      <button className="account-action" type="button" disabled={busy} onClick={() => void signOut()}><LogOut size={16} /> {busy ? "Signing out..." : "Sign out"}</button>
      {error && <div className="error-box" role="alert">{error}</div>}
    </div>}
  </div>;
}

function StockNotifications({ canManageInventory }: { canManageInventory: boolean }): React.JSX.Element {
  const location = useLocation();
  const [open, setOpen] = useState(false);
  const container = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  type Notification = {
    id: string; status: "read" | "unread"; readAt: string | null; createdAt: string;
    variantId: string; locationId: string; productName: string; variantName: string;
    sku: string; locationName: string; quantityOnHand: number; reorderPoint: number; uom: string;
  };
  const { data, loading, error, reload, setData } = useLoad<{ items: Notification[]; unreadCount: number }>("/notifications");
  const [selected, setSelected] = useState<Notification | null>(null);
  const [viewing, setViewing] = useState(false);
  const [viewError, setViewError] = useState("");
  const channel = useRef<BroadcastChannel | null>(null);
  const detail = useRef<HTMLHeadingElement>(null);
  const view = async (id: string) => {
    if (viewing) return;
    setViewing(true); setViewError("");
    try {
      const result = await api<{ items: Notification[]; unreadCount: number; notification: Notification }>(`/notifications/${id}/view`, { method: "POST" });
      setData(result); setSelected(result.notification); reload();
      channel.current?.postMessage("read-status-changed");
    } catch (caught) { setViewError(caught instanceof Error ? caught.message : "Could not view notification."); }
    finally { setViewing(false); }
  };
  useEffect(() => { if (selected) detail.current?.focus(); }, [selected]);
  useEffect(() => {
    reload();
    setOpen(false);
    setSelected(null); setViewError("");
  }, [location.key, reload]);
  useEffect(() => {
    const interval = window.setInterval(reload, 15000);
    window.addEventListener("focus", reload);
    window.addEventListener("sellerone-data-changed", reload);
    if (typeof BroadcastChannel !== "undefined") {
      const broadcast = new BroadcastChannel("sellerone-notifications");
      broadcast.onmessage = reload;
      channel.current = broadcast;
    }
    return () => {
      window.clearInterval(interval); window.removeEventListener("focus", reload);
      window.removeEventListener("sellerone-data-changed", reload);
      channel.current?.close(); channel.current = null;
    };
  }, [reload]);
  useEffect(() => {
    if (!open) return;
    closeButton.current?.focus();
    const outside = (event: PointerEvent) => {
      if (event.target instanceof Node && !container.current?.contains(event.target)) setOpen(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") { setOpen(false); trigger.current?.focus(); }
    };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", escape);
    return () => { document.removeEventListener("pointerdown", outside); document.removeEventListener("keydown", escape); };
  }, [open]);
  const count = !error ? data?.unreadCount ?? 0 : 0;
  return <div className="stock-notifications" ref={container} onBlur={(event) => {
    if (event.relatedTarget instanceof Node && !event.currentTarget.contains(event.relatedTarget)) setOpen(false);
  }}>
    <button ref={trigger} className="icon-button notification-button" type="button"
      aria-label={error ? "Notifications: unavailable" : count ? `Notifications: ${count} unread` : "Notifications"}
      aria-expanded={open} aria-controls="stock-notifications-panel" onClick={() => { if (!open) { setSelected(null); setViewError(""); reload(); } setOpen((current) => !current); }}>
      <Bell size={18} />{count > 0 && <span className="notification-count" aria-hidden="true">{count > 99 ? "99+" : count}</span>}
    </button>
    {open && <section id="stock-notifications-panel" className="notification-panel" aria-labelledby="stock-notifications-title" aria-busy={loading}>
      <div className="notification-heading"><h2 id="stock-notifications-title">Notification management</h2><button ref={closeButton} className="icon-button" type="button" aria-label="Close notifications" onClick={() => { setOpen(false); trigger.current?.focus(); }}><X size={18} /></button></div>
      <p role="status">{count} unread notifications</p>
      <p>Select a stock notification to view its details and mark it read for your account.</p>
      {viewError && <div className="error-box" role="alert">{viewError}</div>}
      {selected && <section className="notification-detail" aria-labelledby="notification-detail-title">
        <h3 ref={detail} tabIndex={-1} id="notification-detail-title">{selected.productName} · {selected.variantName}</h3>
        <p>{selected.sku} · {selected.locationName}</p>
        <p>{selected.quantityOnHand === 0 ? "Out of stock" : "Low stock"}: {selected.quantityOnHand} {selected.uom} on hand · Minimum: {selected.reorderPoint} {selected.uom}</p>
        <p>Created: {new Date(selected.createdAt).toLocaleString()}</p>
        <p>Status: Read{selected.readAt ? ` · ${new Date(selected.readAt).toLocaleString()}` : ""}</p>
        <p>Reading acknowledges this notification; it does not resolve the stock shortage.</p>
        <button className="button button-secondary" type="button" onClick={() => { setSelected(null); closeButton.current?.focus(); }}>Back to notification list</button>
      </section>}
      {loading ? <p role="status">Checking stock alerts...</p> : error ? <div className="error-box" role="alert">{error}</div>
        : data?.items.length ? <><ul className="notification-list" aria-label="Selectable notifications">
          {data.items.filter((item) => item.status === "unread").map((item) => <li key={item.id}>
            <button type="button" className={`notification-item ${item.status}`} disabled={viewing} aria-pressed={selected?.id === item.id} onClick={() => void view(item.id)}>
              <strong>{item.productName} · {item.variantName}</strong>
              <small>{item.sku} · {item.locationName}</small>
              <span>{item.status === "unread" ? "Unread" : "Read"} · View details</span>
            </button>
          </li>)}
        </ul></> : <p role="status">No pending unread alerts. Viewed alerts have been cleared from this list; stock shortages may still require attention.</p>}
      {viewing && <p role="status">Opening notification...</p>}
      <div className="notification-actions"><button className="button button-secondary" type="button" disabled={loading || viewing} onClick={() => { setSelected(null); setViewError(""); reload(); }}>Refresh alerts</button>{canManageInventory && <Link className="button" to="/inventory" onClick={() => setOpen(false)}>View inventory</Link>}</div>
      <small>Only pending unread alerts are listed. Read status is saved per user; refreshing does not acknowledge unread items. A new unread notification is created only after stock recovers above minimum and later becomes low again.</small>
    </section>}
  </div>;
}

function ProtectedLayout(): React.JSX.Element {
  const { user, needsSetup, rawMaterialBomEnabled } = useContext(SessionContext);
  const location = useLocation();
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  if (needsSetup) return <Navigate to="/setup" replace />;
  if (!user) return <Navigate to="/login" state={{ from: location.pathname }} replace />;
  if (location.pathname === "/" && homePath(user.role) !== "/") return <Navigate to={homePath(user.role)} replace />;
  const current = [...primaryNav.flatMap((section) => section.items), { to: "/profile", label: "Profile Settings", icon: UserRound }, { to: "/raw-material-bom", label: "Raw Material BOM", icon: Boxes }, ...(isAdmin(user.role) ? [{ to: "/settings", label: "Settings", icon: Settings }, { to: "/users", label: "User management", icon: Users }] : [])]
    .find((item) => item.to === location.pathname);
  return (
    <div className="app-shell">
      <aside className={`sidebar ${mobileNavOpen ? "sidebar-open" : ""}`}>
        <Link className="brand" to={homePath(user.role)}>
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
          {primaryNav.filter((section) => section.items.some((item) => canAccessPage(user.role, item.to))).map((section) => (
            <div className="nav-section" key={section.label}>
              <span className="nav-heading">{section.label}</span>
              {section.items.filter((item) => canAccessPage(user.role, item.to)).map(({ to, label, icon: Icon }) => (
                <Link key={to} className={`nav-link ${location.pathname === to || (to !== "/" && location.pathname.startsWith(to)) ? "active" : ""}`} to={to} onClick={() => setMobileNavOpen(false)}>
                  <Icon size={17} strokeWidth={1.8} /><span>{label}</span>
                  {label === "Inventory" && <span className="nav-dot" />}
                </Link>
              ))}
            </div>
          ))}
          {(isAdmin(user.role) || (rawMaterialBomEnabled && canAccessPage(user.role, "/raw-material-bom"))) && <div className="nav-section">
            <span className="nav-heading">Workspace</span>
            {rawMaterialBomEnabled && canAccessPage(user.role, "/raw-material-bom") && <Link className={`nav-link ${location.pathname === "/raw-material-bom" ? "active" : ""}`} to="/raw-material-bom" onClick={() => setMobileNavOpen(false)}><Boxes size={17} strokeWidth={1.8} /><span>Raw Material BOM</span></Link>}
            {isAdmin(user.role) && <Link className={`nav-link ${location.pathname === "/users" ? "active" : ""}`} to="/users"><UserRoundPlus size={17} strokeWidth={1.8} /><span>User management</span></Link>}
            {isAdmin(user.role) && <Link className={`nav-link ${location.pathname === "/settings" ? "active" : ""}`} to="/settings"><Settings size={17} strokeWidth={1.8} /><span>Settings</span></Link>}
          </div>}
        </nav>
        <div className="sidebar-bottom">
          <div className="help-card"><span className="help-icon"><LifeBuoy size={17} /></span><strong>Need a hand?</strong><p>We’re here to help you get the most out of SellerOne.</p><button className="text-button" type="button">Visit help center <ChevronRight size={14} /></button></div>
          <div className="profile-mini">
            <UserAvatar name={user.name} avatarUrl={user.avatarUrl} className="avatar-sage" />
            <span className="profile-meta"><strong>{user.name}</strong><small>{user.role === "owner" ? "Workspace owner" : roleLabel(user.role)}</small></span>
            <AccountOptions user={user} onNavigate={() => setMobileNavOpen(false)} />
          </div>
        </div>
      </aside>
      {mobileNavOpen && <button className="mobile-scrim" aria-label="Close menu" onClick={() => setMobileNavOpen(false)} />}
      <section className="main-column">
        <header className="topbar">
          <button className="icon-button mobile-menu" aria-label="Open menu" onClick={() => setMobileNavOpen(true)}><Menu size={20} /></button>
          <div className="breadcrumbs"><span>Workspace</span><ChevronRight size={14} /><strong>{!canAccessPage(user.role, location.pathname) ? "Access restricted" : current?.label ?? (location.pathname.startsWith("/orders/") ? "Order details" : location.pathname.startsWith("/customers/") ? "Customer profile" : "Edit product")}</strong></div>
          <div className="topbar-actions">
            <span className="today-label">{new Intl.DateTimeFormat("en-PH", { weekday: "short", month: "short", day: "numeric" }).format(new Date())}</span>
            <button className="icon-button search-trigger" type="button"><Search size={18} /><span>Search</span><kbd>⌘ K</kbd></button>
            {user.role !== "customer_relations_representative" && <StockNotifications canManageInventory={canAccessPage(user.role, "/inventory")} />}
            <AccountOptions user={user} avatar onNavigate={() => setMobileNavOpen(false)} />
          </div>
        </header>
        <main className="page-content">{canAccessPage(user.role, location.pathname) ? <Outlet /> : <section className="panel form-panel"><h1>Access restricted</h1><p role="alert">Your workspace role does not have access to this screen.</p><Link className="button" to={homePath(user.role)}>Go to my workspace</Link></section>}</main>
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
  const onSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const submittedFields = new FormData(event.currentTarget);
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
        await api("/auth/login", { method: "POST", body: JSON.stringify({
          email: String(submittedFields.get("email") ?? form.email),
          password: String(submittedFields.get("password") ?? form.password),
        }) });
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
            <form className="auth-form" autoComplete="on" onSubmit={(event) => void onSubmit(event)}>
              {(mode === "setup" || mode === "register") && <label className="field-label">Full name<input autoComplete="name" required maxLength={200} placeholder="Your name" value={form.name} onChange={update("name")} /></label>}
              {(mode === "setup" || mode === "login" || mode === "forgot") && <label className="field-label">Work email<input id="auth-email" name="email" type="email" autoComplete={mode === "login" ? "username" : "email"} autoCapitalize="none" spellCheck={false} required placeholder="you@yourbusiness.com" value={form.email} onChange={update("email")} /></label>}
              {mode === "setup" && <><label className="field-label">Business name<input required maxLength={200} placeholder="The name customers know you by" value={form.businessName} onChange={update("businessName")} /></label><label className="field-label">Business currency<select value={form.currency} onChange={update("currency")}><option value="PHP">PHP — Philippine peso</option><option value="USD">USD — US dollar</option><option value="SGD">SGD — Singapore dollar</option><option value="AUD">AUD — Australian dollar</option><option value="EUR">EUR — Euro</option><option value="GBP">GBP — British pound</option></select></label></>}
              {(mode === "login" || mode === "setup" || mode === "register" || mode === "reset") && <label className="field-label">{mode === "login" ? <span className="label-with-link">Password <Link to="/forgot-password">Forgot password?</Link></span> : "Password"}<span className="password-wrap"><input id="auth-password" name="password" type={showPassword ? "text" : "password"} autoComplete={mode === "login" ? "current-password" : "new-password"} minLength={10} required placeholder="At least 10 characters" value={form.password} onChange={update("password")} /><button type="button" className="password-toggle" onClick={() => setShowPassword((value) => !value)}>{showPassword ? "Hide" : "Show"}</button></span></label>}
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
  const normalized = status.toLowerCase().replace(/[_\s]+/g, "-");
  return <span className={`status-pill status-${normalized}`}><i />{status.replace(/[-_]/g, " ")}</span>;
}

function EmptyState({ icon, title, description, action }: { icon: React.ReactNode; title: string; description: string; action?: React.ReactNode }): React.JSX.Element {
  return <div className="empty-state"><span className="empty-icon">{icon}</span><h3>{title}</h3><p>{description}</p>{action}</div>;
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
        {loading ? <div className="list-skeleton" /> : data?.lowStock.length ? <div className="low-stock-list">{data.lowStock.map((item) => <div className="low-stock-row" key={String(item.variantId)}><span className="mini-product"><Package size={16} /></span><span className="low-stock-meta"><strong>{String(item.productName)} · {String(item.variantName)}</strong><small>SKU {String(item.sku)} <span>·</span> reorder at {String(item.reorderPoint)} {String(item.uom)}</small></span><span className="stock-count">{String(item.quantityOnHand)}<small>{String(item.uom)} left</small></span></div>)}<Link className="inline-link low-stock-link" to="/inventory">See all inventory <ChevronRight size={14} /></Link></div> : <EmptyState icon={<Boxes size={19} />} title="Stock looks healthy" description="We’ll give you a heads-up when something needs a restock." />}
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
      stock: "", variants: variants.length, active: Boolean(product.active),
    };
  });
  const stock = useLoad<{ items: Record<string, unknown>[] }>("/stock");
  for (const row of rows) row.stock = stockQuantitySummary((stock.data?.items ?? []).filter((item) => item.productId === row.id));
  return <>
    <PageHeading eyebrow="YOUR CATALOG" title="Products" description="The things you make, source, and sell." action={<Link className="button button-primary" to="/products/new"><Plus size={17} /> Add product</Link>} />
    {error && <PageError message={error} />}
    <section className="panel list-panel"><div className="list-toolbar"><SearchField value={search} onChange={setSearch} placeholder="Search by name or SKU…" /><span className="result-count">{rows.length} {rows.length === 1 ? "product" : "products"}</span><IconButton label="Refresh products" onClick={reload}><Activity size={17} /></IconButton><IconButton label="Filter products"><SlidersHorizontal size={17} /></IconButton></div>
      {loading || stock.loading ? <div className="table-skeleton" /> : <DataTable rowKey="id" rows={rows} empty="Give your catalog a home. Add a product to get started." columns={[
        { label: "PRODUCT", render: (row) => <Link className="product-cell" to={`/products/${row.id}/edit`}><span className="product-thumb"><Package size={17} /></span><span><strong className="table-primary">{String(row.name)}</strong><small>{String(row.description) || "No description"}</small></span></Link> },
        { label: "SKU", render: (row) => <span className="mono">{String(row.sku)}</span> },
        { label: "UNIT COST", className: "align-right", render: (row) => money(row.price, String(row.currency)) },
        { label: "IN STOCK", render: (row) => <span className="table-number">{String(row.stock)}</span> },
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
  const [form, setForm] = useState({ name: "", description: "", variantName: "Standard", variantDescription: "", uom: "pcs", sku: "", barcode: "", unitCost: "", currency: "PHP", reorderPoint: "0", attributes: "" });
  const [initialized, setInitialized] = useState(false);
  const [sellingPrices, setSellingPrices] = useState<Record<string, string>>({ new: "" });
  const [stockLevels, setStockLevels] = useState<Record<string, { minimum: string; medium: string; maximum: string }>>({ new: { minimum: "0", medium: "", maximum: "" } });
  useEffect(() => {
    if (product && !initialized) {
      const variant = product.variants[0];
      setForm({
        name: product.name,
        description: product.description ?? "",
        variantName: variant?.name ?? "",
        variantDescription: variant?.description ?? "",
        uom: variant?.uom ?? "pcs",
        sku: variant?.sku ?? "",
        barcode: variant?.barcode ?? "",
        unitCost: variant ? (variant.unitCostMinor / 100).toFixed(2) : "",
        currency: variant?.currency ?? "PHP",
        reorderPoint: String(variant?.reorderPoint ?? 0),
        attributes: Object.entries(variant?.attributes ?? {}).map(([key, value]) => `${key}=${value}`).join("\n"),
      });
      setInitialized(true);
      setSellingPrices(Object.fromEntries(product.variants.map((variant) => [variant.id, variant.sellingPriceMinor == null ? "" : (variant.sellingPriceMinor / 100).toFixed(2)])));
      setStockLevels(Object.fromEntries(product.variants.map((variant) => [variant.id, { minimum: String(variant.reorderPoint), medium: variant.mediumStockLevel == null ? "" : String(variant.mediumStockLevel), maximum: variant.maximumStockLevel == null ? "" : String(variant.maximumStockLevel) }])));
    }
  }, [product, initialized]);
  const input = (key: keyof typeof form) => (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => setForm((value) => ({ ...value, [key]: event.target.value }));
  const submit = async (event: React.FormEvent) => {
    event.preventDefault(); setError(""); setNotice(""); setSaving(true);
    try {
      const prices = Object.fromEntries(Object.entries(sellingPrices).map(([key, value]) => {
        const minor = value.trim() === "" ? null : Math.round(Number(value) * 100);
        if (minor !== null && (!Number.isSafeInteger(minor) || minor < 0)) throw new Error("Enter valid non-negative selling prices.");
        return [key, minor];
      }));
      const levels = Object.fromEntries(Object.entries(stockLevels).map(([key, value]) => {
        const minimum = key === (product?.variants[0]?.id ?? "new") ? Number(form.reorderPoint) : Number(value.minimum);
        const medium = value.medium.trim() === "" ? null : Number(value.medium);
        const maximum = value.maximum.trim() === "" ? null : Number(value.maximum);
        if ([minimum, medium, maximum].some((level) => level !== null && (!Number.isSafeInteger(level) || level < 0))
          || (medium !== null && medium < minimum) || (maximum !== null && maximum < (medium ?? minimum))) {
          throw new Error("Enter whole-number stock levels with minimum <= medium <= maximum.");
        }
        return [key, { reorderPoint: minimum, mediumStockLevel: medium, maximumStockLevel: maximum }];
      }));
      const attributes = Object.fromEntries(form.attributes.split("\n").filter(Boolean).map((line) => {
        const separator = line.indexOf("=");
        return separator < 1 ? ["", ""] : [line.slice(0, separator).trim(), line.slice(separator + 1).trim()];
      }).filter(([key]) => Boolean(key)));
      if (editing && product) {
        await api(`/products/${id}`, { method: "PATCH", body: JSON.stringify({ name: form.name, description: form.description || null }) });
        const variant = product.variants[0];
        if (variant) await api(`/variants/${variant.id}`, { method: "PATCH", body: JSON.stringify({
          name: form.variantName, description: form.variantDescription || null, uom: form.uom, sku: form.sku, barcode: form.barcode || null, attributes,
          unitCostMinor: Math.round(Number(form.unitCost) * 100), currency: form.currency,
          sellingPriceMinor: prices[variant.id],
          ...levels[variant.id],
        }) });
        for (const additional of product.variants.slice(1)) {
          const targets = levels[additional.id];
          if (prices[additional.id] !== additional.sellingPriceMinor || targets.reorderPoint !== additional.reorderPoint || targets.mediumStockLevel !== additional.mediumStockLevel || targets.maximumStockLevel !== additional.maximumStockLevel) {
            await api(`/variants/${additional.id}`, { method: "PATCH", body: JSON.stringify({ sellingPriceMinor: prices[additional.id], ...targets }) });
          }
        }
        setNotice("Your product has been updated.");
        window.setTimeout(() => navigate("/products"), 650);
      } else {
        await api("/products", { method: "POST", body: JSON.stringify({
          name: form.name, description: form.description || undefined,
          variants: [{
            name: form.variantName, uom: form.uom, sku: form.sku, barcode: form.barcode || undefined,
            description: form.variantDescription || undefined,
            attributes, unitCostMinor: Math.round(Number(form.unitCost) * 100),
            sellingPriceMinor: prices.new,
            currency: form.currency, ...levels.new,
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
      <section className="panel form-panel"><SectionHeading title="First variant" subtitle="Add sizes, colours, or other options later." /><div className="form-grid">
        <label className="field-label">Variant name<input required maxLength={200} placeholder="Standard" value={form.variantName} onChange={input("variantName")} /></label>
        <label className="field-label">Variant description <span className="field-optional">OPTIONAL</span><textarea rows={2} maxLength={2000} placeholder="Identify this variant for receiving and stock reports" value={form.variantDescription} onChange={input("variantDescription")} /></label>
        <label className="field-label">SKU<input required maxLength={100} placeholder="e.g. COFFEE-250" value={form.sku} onChange={input("sku")} /></label>
        <label className="field-label">Barcode <span className="field-optional">OPTIONAL</span><input maxLength={100} placeholder="Scan or type a barcode" value={form.barcode} onChange={input("barcode")} /></label>
        <label className="field-label">Unit cost<input required type="number" min="0" step="0.01" placeholder="0.00" value={form.unitCost} onChange={input("unitCost")} /></label>
        <label className="field-label">Currency<select value={form.currency} onChange={input("currency")}><option value="PHP">PHP — Philippine peso</option><option value="USD">USD — US dollar</option><option value="SGD">SGD — Singapore dollar</option><option value="AUD">AUD — Australian dollar</option><option value="EUR">EUR — Euro</option><option value="GBP">GBP — British pound</option></select></label>
        <label className="field-label field-span">Variant attributes <span className="field-optional">ONE PER LINE · KEY=VALUE</span><textarea rows={3} placeholder={"size=250 g\ncolour=Dark roast"} value={form.attributes} onChange={input("attributes")} /></label>
      </div></section>
      <section className="panel form-panel"><UomField value={form.uom} onChange={(uom) => setForm((current) => ({ ...current, uom }))} locked={product?.variants[0]?.uomLocked} /></section>
      <section className="panel form-panel"><SectionHeading title="Selling prices per UOM" subtitle="Saved defaults for orders and checkout offers. Leave blank for manual pricing; zero is an explicit free price." /><div className="form-grid">
        {(product ? product.variants : [{ id: "new", name: form.variantName, uom: form.uom, currency: form.currency }]).map((variant, index) => <label key={variant.id} className="field-label">{variant.name} selling price ({index === 0 ? form.currency : variant.currency} / {index === 0 ? form.uom : variant.uom})<input type="number" min="0" step="0.01" value={sellingPrices[variant.id] ?? ""} onChange={(event) => setSellingPrices((current) => ({ ...current, [variant.id]: event.target.value }))} /></label>)}
      </div></section>
      <section className="panel form-panel"><SectionHeading title="Stock levels per UOM" subtitle="Minimum is the reorder point. Medium and maximum are planning targets, not automatic receipts or hard stock limits. Leave optional targets blank if unset." /><div className="form-grid">
        {(product ? product.variants : [{ id: "new", name: form.variantName, uom: form.uom }]).map((variant, index) => <div key={variant.id} className="field-span">
          <h3>{variant.name} ({index === 0 ? form.uom : variant.uom})</h3>
          <div className="form-grid">
            <label className="field-label">Minimum stock ({index === 0 ? form.uom : variant.uom})<input required type="number" min="0" step="1" value={index === 0 ? form.reorderPoint : stockLevels[variant.id]?.minimum ?? "0"} onChange={(event) => index === 0 ? setForm((current) => ({ ...current, reorderPoint: event.target.value })) : setStockLevels((current) => ({ ...current, [variant.id]: { ...current[variant.id], minimum: event.target.value } }))} /></label>
            <label className="field-label">Medium stock ({index === 0 ? form.uom : variant.uom})<input type="number" min="0" step="1" value={stockLevels[variant.id]?.medium ?? ""} onChange={(event) => setStockLevels((current) => ({ ...current, [variant.id]: { ...current[variant.id], medium: event.target.value } }))} /></label>
            <label className="field-label">Maximum stock ({index === 0 ? form.uom : variant.uom})<input type="number" min="0" step="1" value={stockLevels[variant.id]?.maximum ?? ""} onChange={(event) => setStockLevels((current) => ({ ...current, [variant.id]: { ...current[variant.id], maximum: event.target.value } }))} /></label>
          </div>
        </div>)}
      </div></section>
      {error && <PageError message={error} />}{notice && <div className="success-box"><ShieldCheck size={17} />{notice}</div>}
      <div className="form-actions"><Link className="button button-secondary" to="/products">Cancel</Link><Button type="submit" disabled={saving}>{saving ? "Saving…" : editing ? "Save changes" : "Save product"} <ChevronRight size={16} /></Button></div>
    </form>
  </>;
}

function InventoryPage(): React.JSX.Element {
  const location = useLocation();
  const products = useLoad<{ items: Product[] }>("/products");
  const receiptQuery = new URLSearchParams(location.search);
  const receiveVariantId = receiptQuery.get("receive");
  const returnOrderId = receiptQuery.get("orderId");
  const [openedReceiptQuery, setOpenedReceiptQuery] = useState("");
  const stock = useLoad<{ items: Record<string, unknown>[] }>("/stock");
  const batches = useLoad<{ items: Record<string, unknown>[] }>("/batches");
  const locations = useLoad<{ items: Record<string, unknown>[] }>("/locations");
  const [tab, setTab] = useState<"stock" | "batches" | "history">("stock");
  const [modal, setModal] = useState<"in" | "out" | "adjust" | "transfer" | null>(null);
  const [variantDescription, setVariantDescription] = useState("");
  const [uom, setUom] = useState("pcs");
  const [selectedVariantId, setSelectedVariantId] = useState("");
  const [createdProduct, setCreatedProduct] = useState<Product | null>(null);
  const [savingProduct, setSavingProduct] = useState(false);
  const [newProduct, setNewProduct] = useState({ name: "", variantName: "Standard", uom: "pcs", sku: "", unitCost: "", sellingPrice: "", currency: "PHP", description: "" });
  useEffect(() => {
    const variant = modal === "in" && receiveVariantId ? products.data?.items.flatMap((product) => product.variants).find((variant) => variant.id === receiveVariantId) : undefined;
    setVariantDescription(variant?.description ?? "");
    setSelectedVariantId(variant?.id ?? "");
    setUom(variant?.uom ?? "pcs");
    setNewProduct({ name: "", variantName: "Standard", uom: "pcs", sku: "", unitCost: "", sellingPrice: "", currency: "PHP", description: "" });
  }, [modal, location.search]);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  useEffect(() => {
    if (!receiveVariantId || products.loading || locations.loading || location.search === openedReceiptQuery) return;
    setOpenedReceiptQuery(location.search);
    if (products.error || locations.error) { setError(products.error || locations.error); return; }
    const variant = products.data?.items.flatMap((product) => product.variants).find((variant) => variant.id === receiveVariantId);
    const locationId = receiptQuery.get("locationId") ?? "main";
    if (!variant || !locations.data?.items.some((entry) => entry.id === locationId)) {
      setError("The requested stock receipt variant or location was not found."); return;
    }
    setModal("in");
  }, [receiveVariantId, products.loading, products.data, products.error, locations.loading, locations.data, locations.error, location.search, openedReceiptQuery]);
  const refresh = () => { stock.reload(); batches.reload(); };
  const onSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault(); setMessage(""); setError("");
    if (selectedVariantId === "new") {
      setError("Save the new product before confirming its stock receipt.");
      return;
    }
    const body = Object.fromEntries(new FormData(event.currentTarget).entries());
    const endpoint = modal === "in" ? "/stock/in" : modal === "out" ? "/stock/out" : modal === "adjust" ? "/adjustments" : "/transfers";
    const payload: Record<string, unknown> = { ...body };
    for (const field of ["quantity", "countedQuantity", "unitCostMinor"]) if (payload[field] !== undefined && payload[field] !== "") payload[field] = Number(payload[field]);
    if (payload.unitCostMinor !== undefined) payload.unitCostMinor = Math.round(Number(payload.unitCostMinor) * 100);
    if (modal === "in") {
      payload.variantDescription = variantDescription;
      if (body.unitCostMinor === "") delete payload.unitCostMinor;
    }
    if (modal === "transfer") payload.sourceLocationId = payload.locationId, delete payload.locationId;
    try {
      await api(endpoint, { method: "POST", body: JSON.stringify(payload) });
      setModal(null); setMessage("Inventory updated. Your stock counts are in sync."); refresh(); products.reload(); setCreatedProduct(null);
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Could not update stock."); }
  };
  const rows = stock.data?.items ?? [];
  const lowCount = rows.filter((row) => Number(row.quantityOnHand) <= Number(row.reorderPoint)).length;
  const catalog = products.data?.items ?? [];
  const availableProducts = createdProduct && !catalog.some((product) => product.id === createdProduct.id) ? [...catalog, createdProduct] : catalog;
  const variants = availableProducts.flatMap((product) => product.variants.map((variant) => ({ ...variant, productName: product.name })));
  const saveNewProduct = async () => {
    setError(""); setSavingProduct(true);
    try {
      if (!newProduct.name.trim() || !newProduct.variantName.trim() || newProduct.unitCost === "") {
        throw new Error("Enter a product name, variant name, and unit cost.");
      }
      const unitCostMinor = Math.round(Number(newProduct.unitCost) * 100);
      if (!Number.isSafeInteger(unitCostMinor) || unitCostMinor < 0) throw new Error("Enter a valid non-negative unit cost.");
      const sellingPriceMinor = newProduct.sellingPrice.trim() === "" ? null : Math.round(Number(newProduct.sellingPrice) * 100);
      if (sellingPriceMinor !== null && (!Number.isSafeInteger(sellingPriceMinor) || sellingPriceMinor < 0)) throw new Error("Enter a valid non-negative selling price.");
      const product = await api<Product>("/products", { method: "POST", body: JSON.stringify({
        name: newProduct.name,
        variants: [{
          name: newProduct.variantName, uom: newProduct.uom, sku: newProduct.sku.trim() || undefined, description: newProduct.description || undefined,
          unitCostMinor, currency: newProduct.currency,
          sellingPriceMinor,
        }],
      }) });
      setCreatedProduct(product);
      setSelectedVariantId(product.variants[0].id);
      setVariantDescription(product.variants[0].description ?? "");
      setUom(product.variants[0].uom);
      products.reload();
      refresh();
      setMessage(`Product saved with SKU ${product.variants[0].sku}. Confirm the movement below to receive its stock.`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not create product.");
    } finally { setSavingProduct(false); }
  };
  const updateNewProduct = (field: keyof typeof newProduct) => (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
    setNewProduct((current) => ({ ...current, [field]: event.target.value }));
  };
  return <>
    <PageHeading eyebrow="STOCKROOM" title="Inventory" description="Know what you have, where it is, and when it’s time to restock." action={<div className="button-group"><Button variant="secondary" onClick={() => setModal("out")}><ArrowUpRight size={16} /> Stock out</Button><Button onClick={() => setModal("in")}><ArrowDownToLine size={16} /> Stock in</Button></div>} />
    {message && <div className="success-box"><ShieldCheck size={17} />{message}</div>}{error && <PageError message={error} />}
    <div className="stat-grid stat-grid-three"><StatCard label="Stock on hand by UOM" value={stockQuantitySummary(rows)} change="Across all locations; units are not converted" icon={<Boxes size={17} />} /><StatCard label="Products tracked" value={String(new Set(rows.map((row) => row.productId)).size)} change="Active in your catalog" icon={<Package size={17} />} tone="blue" /><StatCard label="Needs a restock" value={String(lowCount)} change="At or below reorder point" icon={<Bell size={17} />} tone="sand" /></div>
    <section className="panel list-panel"><div className="tab-toolbar"><div className="tabs"><button className={tab === "stock" ? "tab active" : "tab"} onClick={() => setTab("stock")}>On hand <span>{rows.length}</span></button><button className={tab === "batches" ? "tab active" : "tab"} onClick={() => setTab("batches")}>Lots & batches <span>{batches.data?.items.length ?? 0}</span></button><button className={tab === "history" ? "tab active" : "tab"} onClick={() => setTab("history")}>Movement history</button></div><div className="toolbar-actions">{tab === "stock" && <Button variant="secondary" onClick={() => setModal("transfer")}><ArrowLeftRight size={15} /> Transfer</Button>}<Button variant="secondary" onClick={() => setModal("adjust")}><SlidersHorizontal size={15} /> Adjust stock</Button></div></div>
      {tab === "stock" ? <DataTable rowKey="variantId" rows={rows} empty="Add a product and receive stock to see your inventory here." columns={[
        { label: "PRODUCT / VARIANT", render: (row) => <span className="product-cell"><span className="product-thumb"><Package size={16} /></span><span><strong>{String(row.productName)} · {String(row.variantName)}</strong>{typeof row.variantDescription === "string" && row.variantDescription.length > 0 && <small>{row.variantDescription}</small>}<small className="mono">{String(row.sku)}</small></span></span> },
        { label: "LOCATION", render: (row) => String(row.locationName) },
        { label: "ON HAND", render: (row) => <strong>{String(row.quantityOnHand)} <small className="muted">{String(row.uom)}</small></strong> },
        { label: "RESERVED / AVAILABLE", render: (row) => `${row.quantityReserved} / ${row.quantityAvailable} ${row.uom}` },
        { label: "MINIMUM / MEDIUM / MAXIMUM", render: (row) => `${row.reorderPoint} / ${row.mediumStockLevel ?? "Not set"} / ${row.maximumStockLevel ?? "Not set"} ${row.uom}` },
        { label: "STATUS", render: (row) => Number(row.quantityOnHand) === 0 ? <StatusPill status="Out of stock" /> : Number(row.quantityOnHand) <= Number(row.reorderPoint) ? <StatusPill status="Low stock" /> : <StatusPill status="In stock" /> },
        { label: "VALUE", className: "align-right", render: (row) => money(Number(row.quantityOnHand) * Number(row.unitCostMinor), String(row.currency)) },
      ]} /> : tab === "batches" ? <DataTable rowKey="batchId" rows={batches.data?.items ?? []} empty="Each stock-in creates a traceable batch, complete with lot and receipt cost." columns={[
        { label: "PRODUCT / VARIANT", render: (row) => <span><strong>{String(row.productName)} · {String(row.variantName)}</strong>{typeof row.variantDescription === "string" && row.variantDescription.length > 0 && <small>{row.variantDescription}</small>}<small className="mono">{String(row.sku)}</small></span> },
        { label: "LOT / BATCH", render: (row) => <span className="mono">{String(row.lotNumber ?? "Unassigned")}</span> },
        { label: "LOCATION", render: (row) => String(row.locationName) },
        { label: "EXPIRES", render: (row) => dateLabel(row.expiresAt) },
        { label: "ON HAND", render: (row) => `${row.quantityOnHand} ${row.uom}` },
        { label: "RECEIPT COST", className: "align-right", render: (row) => money(row.unitCostMinor, String(row.currency)) },
      ]} /> : <MovementList />}
    </section>
    {modal && <Modal title={modal === "in" ? "Receive stock" : modal === "out" ? "Issue stock" : modal === "adjust" ? "Adjust stock count" : "Transfer between locations"} onClose={() => { if (!savingProduct) setModal(null); }}>
      <form className="modal-form" onSubmit={(event) => void onSubmit(event)}>
        <label className="field-label">Product & variant
          <select name="variantId" required value={selectedVariantId} disabled={savingProduct} onChange={(event) => {
            setSelectedVariantId(event.target.value);
            setVariantDescription(variants.find((variant) => variant.id === event.target.value)?.description ?? "");
            setUom(variants.find((variant) => variant.id === event.target.value)?.uom ?? "pcs");
            setError(""); setMessage("");
          }}>
            <option value="">Choose a product</option>
            {modal === "in" && <option value="new">+ Add new product</option>}
            {variants.map((variant) => <option value={variant.id} key={variant.id}>{variant.productName} · {variant.name} ({variant.sku}){variant.description ? ` — ${variant.description}` : ""}</option>)}
          </select>
        </label>
        {products.error && <div className="error-box" role="alert">{products.error}</div>}
        {modal === "in" && selectedVariantId === "new" && <section className="form-grid">
          <label className="field-label">Product name<input maxLength={200} value={newProduct.name} onChange={updateNewProduct("name")} disabled={savingProduct} /></label>
          <label className="field-label">Variant name<input maxLength={200} value={newProduct.variantName} onChange={updateNewProduct("variantName")} disabled={savingProduct} /></label>
          <UomField value={newProduct.uom} onChange={(uom) => setNewProduct((current) => ({ ...current, uom }))} locked={savingProduct} />
          <label className="field-label">SKU <span className="field-optional">AUTOMATIC IF BLANK</span><input maxLength={100} placeholder="Generated when you save the product" value={newProduct.sku} onChange={updateNewProduct("sku")} disabled={savingProduct} /></label>
          <label className="field-label">Catalog unit cost<input type="number" min="0" step="0.01" value={newProduct.unitCost} onChange={updateNewProduct("unitCost")} disabled={savingProduct} /></label>
          <label className="field-label">Selling price per UOM <span className="field-optional">OPTIONAL</span><input type="number" min="0" step="0.01" value={newProduct.sellingPrice} onChange={updateNewProduct("sellingPrice")} disabled={savingProduct} /><small>Default price for orders and checkout offers.</small></label>
          <label className="field-label">Currency<select value={newProduct.currency} onChange={updateNewProduct("currency")} disabled={savingProduct}>{["PHP", "USD", "SGD", "AUD", "EUR", "GBP"].map((currency) => <option key={currency}>{currency}</option>)}</select></label>
          <label className="field-label field-span">Catalog variant description <span className="field-optional">OPTIONAL</span><textarea rows={2} maxLength={2000} value={newProduct.description} onChange={updateNewProduct("description")} disabled={savingProduct} /></label>
          <small className="field-span">Saving creates a catalog product with its first variant. It does not add stock yet.</small>
          <Button type="button" disabled={savingProduct} onClick={() => void saveNewProduct()}>{savingProduct ? "Saving product..." : "Save product & select"}</Button>
        </section>}
        {modal === "in" && selectedVariantId !== "new" && <UomField value={uom} onChange={setUom} locked={variants.find((variant) => variant.id === selectedVariantId)?.uomLocked} />}
        {modal !== "in" && selectedVariantId && <p>Unit of measure: <strong>{uom}</strong>. Quantities use this UOM; no unit conversion.</p>}
        {modal === "in" && <label className="field-label">Receipt product / variant description <span className="field-optional">OPTIONAL</span>
          <textarea rows={3} maxLength={2000} value={variantDescription} onChange={(event) => setVariantDescription(event.target.value)} placeholder="Enter a description for the stock being received" />
          <small>Prefilled from the selected variant. Changes apply only to this receipt, not the catalog.</small>
        </label>}
        {modal === "transfer" ? <>
          <label className="field-label">From<select name="locationId" required>{locations.data?.items.map((location) => <option key={String(location.id)} value={String(location.id)}>{String(location.name)}</option>)}</select></label>
          <label className="field-label">To<select name="destinationLocationId" required><option value="">Choose destination</option>{locations.data?.items.map((location) => <option key={String(location.id)} value={String(location.id)}>{String(location.name)}</option>)}</select></label>
        </> : <label className="field-label">Location<select name="locationId" defaultValue={modal === "in" && receiveVariantId ? receiptQuery.get("locationId") ?? "main" : undefined}>{locations.data?.items.map((location) => <option key={String(location.id)} value={String(location.id)}>{String(location.name)}</option>)}</select></label>}
        {modal === "adjust" ? <label className="field-label">Counted quantity<input type="number" name="countedQuantity" min="0" step="1" required /></label> : <label className="field-label">Quantity<input type="number" name="quantity" min="1" step="1" required defaultValue={modal === "in" && receiveVariantId && Number.isSafeInteger(Number(receiptQuery.get("quantity"))) && Number(receiptQuery.get("quantity")) > 0 ? receiptQuery.get("quantity") ?? undefined : undefined} /></label>}
        {modal === "in" && <>
          <label className="field-label">Unit cost<input type="number" name="unitCostMinor" min="0" step="0.01" placeholder="Leave blank to use catalog cost" /></label>
          <label className="field-label">Lot number<input name="lotNumber" maxLength={100} /></label>
          <label className="field-label">Expiry date<input type="date" name="expiresAt" /></label>
        </>}
        <label className="field-label">Reference or note <span className="field-optional">OPTIONAL</span><input name="reference" maxLength={200} placeholder="Purchase order, reason, or note" /></label>
        {error && <div className="error-box" role="alert">{error}</div>}
        {message && <div className="success-box" role="status">{message}</div>}
        <div className="modal-actions"><Button type="button" variant="secondary" disabled={savingProduct} onClick={() => setModal(null)}>Cancel</Button><Button type="submit" disabled={savingProduct || selectedVariantId === "new"}>Confirm movement <ChevronRight size={15} /></Button></div>
      </form>
    </Modal>}
    {returnOrderId && <Link className="back-link" to={`/orders/${encodeURIComponent(returnOrderId)}`}>Return to order and retry payment verification</Link>}
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
    { label: "QUANTITY", render: (row) => { const quantity = Number(row.quantity); const delta = row.type === "stock_out" ? -quantity : quantity; return `${delta > 0 ? "+" : ""}${delta} ${row.uom}`; } },
    { label: "REFERENCE", render: (row) => String(row.reference ?? row.note ?? "—") },
    { label: "VALUE", className: "align-right", render: (row) => money(row.totalCostMinor, String(row.currency)) },
  ]} />;
}

function Modal({ title, children, onClose, eyebrow = "INVENTORY" }: { title: string; children: React.ReactNode; onClose: () => void; eyebrow?: string }): React.JSX.Element {
  useEffect(() => {
    const handler = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    window.addEventListener("keydown", handler); return () => window.removeEventListener("keydown", handler);
  }, [onClose]);
  return <div className="modal-scrim" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}><div className="modal-card" role="dialog" aria-modal="true" aria-label={title}><div className="modal-heading"><div><span className="page-eyebrow">{eyebrow}</span><h2>{title}</h2></div><IconButton label="Close" onClick={onClose}><X size={18} /></IconButton></div>{children}</div></div>;
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

function CustomerSocialCard({ customer, saved }: { customer: Customer; saved: () => void }): React.JSX.Element {
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const links = customerSocialPlatforms.filter(({ field }) => customer[field]);
  const save = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault(); if (busy) return;
    const fields = Object.fromEntries(new FormData(event.currentTarget));
    setBusy(true); setError("");
    try { await api(`/customers/${customer.id}`, { method: "PATCH", body: JSON.stringify(fields) }); setEditing(false); saved(); }
    catch (caught) { setError(caught instanceof Error ? caught.message : "Could not save social media links."); }
    finally { setBusy(false); }
  };
  return <article className="stat-card customer-social-card">
    <div className="stat-top"><span>Social media links</span><span className="stat-icon icon-blue"><Users size={17} /></span></div>
    {links.length ? <ul>{links.map(({ field, label }) => <li key={field}><a className="inline-link" href={customer[field] ?? undefined} target="_blank" rel="noopener noreferrer">{label}<ArrowUpRight size={13} /></a></li>)}</ul> : <p>No social media links added.</p>}
    <button type="button" className="text-button commerce-no-print" onClick={() => { setError(""); setEditing(true); }}>{links.length ? "Edit links" : "Add links"}</button>
    {editing && <Modal title="Customer social media links" eyebrow="CUSTOMER BOOK" onClose={() => setEditing(false)}>
      <form className="modal-form" onSubmit={(event) => void save(event)}>
        <p>Add full HTTPS links for this customer. Leave a field blank to remove its link. These links do not connect or verify social accounts.</p>
        {error && <PageError message={error} />}
        {customerSocialPlatforms.map(({ field, label, placeholder }) => <label key={field} className="field-label">{label}<input type="url" name={field} defaultValue={customer[field] ?? ""} maxLength={2000} placeholder={placeholder} /></label>)}
        <div className="modal-actions"><Button type="button" variant="secondary" onClick={() => setEditing(false)}>Cancel</Button><Button type="submit" disabled={busy}>{busy ? "Saving..." : "Save links"}</Button></div>
      </form>
    </Modal>}
  </article>;
}

function CustomerProfilePage(): React.JSX.Element {
  const { user } = useContext(SessionContext);
  const { id } = useParams();
  const { data, error, loading, reload } = useLoad<Customer & { orders: Record<string, unknown>[] }>(`/customers/${id}`);
  if (loading) return <LoadingGrid />;
  if (error || !data) return <PageError message={error || "Customer not found."} />;
  return <>
    <Link className="back-link" to="/customers"><ChevronLeft size={15} /> Back to customers</Link>
    <PageHeading eyebrow="YOUR CUSTOMER BOOK" title={String(data.name)} description={`A customer since ${dateLabel(data.createdAt)}.`} action={<Button variant="secondary" onClick={() => window.print()}><FileText size={16} /> Print profile</Button>} />
    <div className="stat-grid customer-summary-grid"><StatCard label="Lifetime sales" value={money(data.spentMinor)} icon={<Wallet size={17} />} /><StatCard label="Orders" value={String(data.orderCount ?? 0)} icon={<ShoppingBag size={17} />} tone="blue" /><StatCard label="Contact" value={String(data.email || data.phone || "Not added")} icon={<UserRound size={17} />} tone="lilac" /><CustomerSocialCard customer={data} saved={reload} /></div>
    <div className="detail-grid customer-detail-grid"><section className="panel"><SectionHeading title="Order history" subtitle="A little history, a lot of context." /><DataTable rowKey="id" rows={data.orders as Record<string, unknown>[]} empty="There are no orders for this customer yet." columns={[
      { label: "ORDER", render: (row) => user && canAccessPage(user.role, "/orders") ? <Link className="table-primary" to={`/orders/${row.id}`}>{String(row.orderNumber)}</Link> : String(row.orderNumber) },
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
  const [selectedExpense, setSelectedExpense] = useState<Record<string, unknown> | null>(null);
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
    {type === "sales" && <p>Completed orders appear here automatically. Open their order to view or print the invoice. Delivered orders are not recorded as sales until marked completed.</p>}
    {error && <PageError message={error} />}{message && <div className="success-box">{message}</div>}
    <div className="stat-grid stat-grid-three"><StatCard label={`Total ${type}`} value={money(items.reduce((sum, row) => sum + Number(amount(row) ?? 0), 0), currency)} change="All recorded transactions" icon={type === "sales" ? <TrendingUp size={17} /> : <TrendingDown size={17} />} /><StatCard label="This month" value={money(items.filter((row) => new Date(String(row.createdAt ?? row.created_at)).getMonth() === new Date().getMonth()).reduce((sum, row) => sum + Number(amount(row) ?? 0), 0), currency)} change="In the current calendar month" icon={<ChartNoAxesCombined size={17} />} tone="blue" /><StatCard label="Entries" value={String(items.length)} change="Your transaction history" icon={<FileText size={17} />} tone="sand" /></div>
    <section className="panel list-panel"><div className="list-toolbar"><div><h2 className="inline-panel-title">All {type}</h2><span className="result-count">{items.length} entries</span></div><span className="soft-tag"><Activity size={13} /> UPDATED JUST NOW</span></div>{loading ? <div className="table-skeleton" /> : <DataTable rowKey="id" rows={items} empty={`Your ${type} entries will appear here.`} columns={type === "sales" ? [
      { label: "DESCRIPTION", render: (row) => <span><strong>{String(row.description)}</strong><small>{String(row.customerName ?? row.customer_name ?? "Walk-in customer")}</small></span> },
      { label: "CHANNEL", render: (row) => <span className="channel-tag">{String(row.channel)}</span> },
      { label: "DATE", render: (row) => dateLabel(row.createdAt ?? row.created_at) },
      { label: "AMOUNT", className: "align-right", render: (row) => <strong>{money(amount(row), String(row.currency ?? currency))}</strong> },
      { label: "DETAILS", render: (row) => typeof row.orderId === "string" && row.orderId ? <Link className="inline-link" to={`/orders/${encodeURIComponent(row.orderId)}`}>View order / invoice</Link> : <span className="muted">Manual sale</span> },
    ] : [
      { label: "EXPENSE", render: (row) => <span><strong>{String(row.description)}</strong><small>{String(row.notes ?? "—")}</small></span> },
      { label: "CATEGORY", render: (row) => <span className="channel-tag">{String(row.category)}</span> },
      { label: "DATE", render: (row) => dateLabel(row.createdAt ?? row.created_at) },
      { label: "AMOUNT", className: "align-right", render: (row) => <strong>{money(amount(row), String(row.currency ?? currency))}</strong> },
      { label: "DETAILS", render: (row) => <button type="button" className="text-button" aria-label={`View details for ${String(row.description)}`} onClick={() => setSelectedExpense(row)}>View details <ChevronRight size={14} /></button> },
    ]} />}</section>
    {type === "expenses" && selectedExpense && <Modal title="Expense details" eyebrow="MONEY OUT" onClose={() => setSelectedExpense(null)}>
      <dl className="expense-detail">
        <dt>Description</dt><dd>{String(selectedExpense.description)}</dd>
        <dt>Category</dt><dd>{String(selectedExpense.category)}</dd>
        <dt>Recorded date</dt><dd>{dateLabel(selectedExpense.createdAt ?? selectedExpense.created_at)}</dd>
        <dt>Amount</dt><dd>{money(amount(selectedExpense), String(selectedExpense.currency ?? currency))}</dd>
        <dt>Notes</dt><dd>{String(selectedExpense.notes || "No notes added.")}</dd>
        <dt>Entry ID</dt><dd className="mono">{String(selectedExpense.id)}</dd>
      </dl>
      <div className="modal-actions"><Button type="button" variant="secondary" onClick={() => setSelectedExpense(null)}>Close details</Button></div>
    </Modal>}
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
      <p>Sales and expenses cover the last 90 calendar days, including today, in {String(data?.timezone ?? "Asia/Manila")}. Sales include completed orders and manually recorded sales only.</p>
      <div className="report-grid"><section className="panel"><SectionHeading title="Sales by day" subtitle="The last 90 calendar days" /><DataTable rowKey="day" rows={sales} empty="No sales in this period. Mark a delivered order completed or record a manual sale to include it here." columns={[
        { label: "DAY", render: (row) => dateLabel(`${String(row.day)}T12:00:00`) },
        { label: "TRANSACTIONS", render: (row) => String(row.transactionCount) },
        { label: "SALES", className: "align-right", render: (row) => <strong>{money(row.amountMinor, currency)}</strong> },
      ]} /></section><section className="panel"><SectionHeading title="Expenses by category" subtitle="The last 90 calendar days" /><DataTable rowKey="category" rows={expenses} empty="No expenses recorded in this period." columns={[
        { label: "CATEGORY", render: (row) => <span className="channel-tag">{String(row.category)}</span> },
        { label: "ENTRIES", render: (row) => String(row.transactionCount) },
        { label: "TOTAL", className: "align-right", render: (row) => <strong>{money(row.amountMinor, currency)}</strong> },
      ]} /></section><section className="panel report-orders"><SectionHeading title="Orders by status" subtitle="All-time fulfillment status" /><DataTable rowKey="status" rows={orders} empty="Your order report will appear when you start tracking orders." columns={[
        { label: "STATUS", render: (row) => <StatusPill status={String(row.status)} /> },
        { label: "ORDERS", render: (row) => String(row.count) },
        { label: "ORDER TOTAL", className: "align-right", render: (row) => <strong>{money(row.amountMinor, currency)}</strong> },
      ]} /></section></div></>}
  </>;
}

function ProfileSettingsPage(): React.JSX.Element {
  const { user, refresh, updateAvatar } = useContext(SessionContext);
  const location = useLocation();
  const [name, setName] = useState(user?.name ?? "");
  const [email, setEmail] = useState(user?.email ?? "");
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const tab = location.hash === "#security" ? "security" : location.hash === "#preferences" ? "preferences" : "account";
  const [editing, setEditing] = useState(false);
  const nameInput = React.useRef<HTMLInputElement>(null);
  useEffect(() => {
    setEditing(false); setName(user?.name ?? ""); setEmail(user?.email ?? "");
    setCurrentPassword(""); setNewPassword(""); setConfirmation(""); setError(""); setNotice("");
  }, [tab, user?.name, user?.email]);
  const cancelEdit = () => {
    setEditing(false); setName(user?.name ?? ""); setEmail(user?.email ?? "");
    setCurrentPassword(""); setError(""); setNotice("");
  };
  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    if (busy || (tab === "account" && !editing)) return;
    setError(""); setNotice("");
    if (tab === "account" && !name.trim()) { setError("Full name is required."); nameInput.current?.focus(); return; }
    if (tab === "security" && newPassword !== confirmation) { setError("New passwords do not match."); return; }
    setBusy(true);
    try {
      const result = await api<{ user: User }>(tab === "security" ? "/me/password" : "/me", {
        method: tab === "security" ? "POST" : "PATCH",
        body: JSON.stringify(tab === "security" ? { currentPassword, newPassword } : { name, email, ...(email.trim().toLowerCase() !== user?.email ? { currentPassword } : {}) }),
      });
      setName(result.user.name); setEmail(result.user.email);
      setCurrentPassword(""); setNewPassword(""); setConfirmation("");
      await refresh();
      setEditing(false);
      setNotice(tab === "security" ? "Password changed. Other sessions were signed out." : "Account details saved successfully.");
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Could not save profile settings."); }
    finally { setBusy(false); }
  };
  return <>
    <PageHeading eyebrow="YOUR ACCOUNT" title="Profile Settings" description="Manage your personal account details and security." />
    <nav className="form-actions" aria-label="Profile settings sections">
      <Link className="button button-secondary" aria-current={tab === "account" ? "page" : undefined} to="/profile">Account details</Link>
      <Link className="button button-secondary" aria-current={tab === "security" ? "page" : undefined} to="/profile#security">Security</Link>
      <Link className="button button-secondary" aria-current={tab === "preferences" ? "page" : undefined} to="/profile#preferences">Preferences</Link>
    </nav>
    {error && <div className="error-box" role="alert">{error}</div>}
    {notice && <div className="success-box" role="status">{notice}</div>}
    {tab === "account" && user && <ProfilePicture name={user.name} avatarUrl={user.avatarUrl} onSaved={updateAvatar} />}
    <section className="panel form-panel">
      {tab === "preferences" ? <><h2>Preferences</h2><p>Workspace preferences apply to everyone in your business; they are not personal settings.</p>{user && isAdmin(user.role) ? <Link className="button" to="/settings#preferences">Manage workspace preferences</Link> : <p>Contact an owner or admin to change workspace preferences.</p>}<p>Notification read status is personal and saved automatically when you view an alert.</p></>
        : <form onSubmit={(event) => void save(event)} className="modal-form">
          <h2>{tab === "security" ? "Change password" : "Account details"}</h2>
          {tab === "account" ? <>
            <label className="field-label">Full name<input ref={nameInput} required maxLength={200} autoComplete="name" value={name} readOnly={!editing} disabled={busy} onChange={(event) => setName(event.target.value)} /></label>
            <label className="field-label">Email<input required type="email" maxLength={254} autoComplete="email" value={email} readOnly={!editing} disabled={busy} onChange={(event) => setEmail(event.target.value)} /></label>
            <p>Role: {roleLabel(user?.role)}. Email changes require your current password and sign out other sessions. Use the new email for future sign-ins.</p>
          </> : <p>Use 10-200 characters. Changing your password signs out other sessions and invalidates pending password reset links.</p>}
          {(tab === "security" || (editing && email.trim().toLowerCase() !== user?.email)) && <label className="field-label">Current password<input required type="password" minLength={10} maxLength={200} autoComplete="current-password" value={currentPassword} disabled={busy} onChange={(event) => setCurrentPassword(event.target.value)} /></label>}
          {tab === "security" && <>
            <label className="field-label">New password<input required type="password" minLength={10} maxLength={200} autoComplete="new-password" value={newPassword} disabled={busy} onChange={(event) => setNewPassword(event.target.value)} /></label>
            <label className="field-label">Confirm new password<input required type="password" minLength={10} maxLength={200} autoComplete="new-password" value={confirmation} disabled={busy} onChange={(event) => setConfirmation(event.target.value)} /></label>
          </>}
          <div className="form-actions">
            {tab === "account" && !editing ? <Button type="button" onClick={(event) => { event.preventDefault(); setEditing(true); setError(""); setNotice(""); nameInput.current?.focus(); }}>Edit Account Details</Button> : <>
              <Button type="submit" disabled={busy}>{busy ? "Saving..." : tab === "security" ? "Change password" : "Save Changes"}</Button>
              {tab === "account" && <Button type="button" variant="secondary" disabled={busy} onClick={cancelEdit}>Cancel</Button>}
            </>}
          </div>
        </form>}
    </section>
    {tab === "account" && <ProfileSocialLinks />}
  </>;
}

function SettingsPage(): React.JSX.Element {
  const { refresh } = useContext(SessionContext);
  const location = useLocation();
  const navigate = useNavigate();
  const tab = location.hash === "#preferences" ? "preferences" : "business";
  const { data, loading, error } = useLoad<{ businessName: string; currency: string; timezone: string; lowStockEmailAlerts: boolean; rawMaterialBomEnabled: boolean }>("/settings");
  const [form, setForm] = useState<{ businessName: string; currency: string; timezone: string; lowStockEmailAlerts: boolean; rawMaterialBomEnabled: boolean } | null>(null);
  const [notice, setNotice] = useState("");
  const [problem, setProblem] = useState("");
  const [saving, setSaving] = useState(false);
  useEffect(() => { if (data && !form) setForm(data); }, [data, form]);
  const change = (key: keyof NonNullable<typeof form>, value: string | boolean) => setForm((current) => current ? { ...current, [key]: value } : current);
  const save = async (event: React.FormEvent) => {
    event.preventDefault(); if (!form || saving) return; setNotice(""); setProblem(""); setSaving(true);
    const payload = tab === "preferences" ? { lowStockEmailAlerts: form.lowStockEmailAlerts, rawMaterialBomEnabled: form.rawMaterialBomEnabled }
      : { businessName: form.businessName, currency: form.currency, timezone: form.timezone };
    try { await api("/settings", { method: "PATCH", body: JSON.stringify(payload) }); await refresh(); navigate("/"); }
    catch (caught) { setProblem(caught instanceof Error ? caught.message : "Could not save settings."); }
    finally { setSaving(false); }
  };
  const selectTab = (selected: "business" | "preferences") => {
    navigate(`#${selected}`);
    setNotice(""); setProblem("");
  };
  const tabKeys = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (!["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const selected = event.key === "Home" ? "business" : event.key === "End" ? "preferences" : tab === "business" ? "preferences" : "business";
    selectTab(selected);
    document.getElementById(`settings-tab-${selected}`)?.focus();
  };
  return <>
    <PageHeading eyebrow="MAKE IT YOURS" title="Settings" description="The little details that make this workspace feel like yours." />
    {error && <PageError message={error} />}{notice && <div className="success-box"><ShieldCheck size={17} />{notice}</div>}{problem && <PageError message={problem} />}
    {loading || !form ? <LoadingGrid /> : <form onSubmit={(event) => void save(event)} className="settings-layout">
      <div className="settings-nav">
        <div className="settings-tabs" role="tablist" aria-label="Workspace settings" onKeyDown={tabKeys}>
          {(["business", "preferences"] as const).map((name) => <button key={name} type="button" role="tab" id={`settings-tab-${name}`} aria-controls={`settings-panel-${name}`} aria-selected={tab === name} tabIndex={tab === name ? 0 : -1} className={`settings-nav-item${tab === name ? " active" : ""}`} onClick={() => selectTab(name)}>{name === "business" ? "Business details" : "Preferences"}</button>)}
        </div>
        <Link className="settings-nav-item" to="/users">Team & access <ChevronRight size={14} /></Link>
      </div>
      <div className="settings-sections">
        <section className="panel form-panel" role="tabpanel" id={`settings-panel-${tab}`} aria-labelledby={`settings-tab-${tab}`}>
          {tab === "business" ? <><SectionHeading title="Business details" subtitle="The name and currency used across your workspace." /><div className="form-grid">
            <label className="field-label field-span">Business name<input required maxLength={200} value={form.businessName} onChange={(event) => change("businessName", event.target.value)} /></label>
            <label className="field-label">Default currency<select value={form.currency} onChange={(event) => change("currency", event.target.value)}><option value="PHP">PHP — Philippine peso</option><option value="USD">USD — US dollar</option><option value="SGD">SGD — Singapore dollar</option><option value="AUD">AUD — Australian dollar</option><option value="EUR">EUR — Euro</option><option value="GBP">GBP — British pound</option></select><small>New sales and expenses use this currency by default.</small></label>
            <label className="field-label">Time zone<input required maxLength={100} value={form.timezone} onChange={(event) => change("timezone", event.target.value)} /><small>Use an IANA name, such as Asia/Manila.</small></label>
          </div></> : <><SectionHeading title="Preferences" subtitle="A few thoughtful nudges to help you stay ahead." /><label className="toggle-row"><span><strong>Low stock reminders</strong><small>Show inventory at or below its reorder point on your dashboard.</small></span><input type="checkbox" checked={form.lowStockEmailAlerts} onChange={(event) => change("lowStockEmailAlerts", event.target.checked)} /></label><label className="toggle-row"><span><strong>Raw Material BOM view</strong><small>Show a separate material classification and BOM planning page. Does not change the Product catalogue or deduct stock. Disabling keeps saved BOMs.</small></span><input type="checkbox" checked={form.rawMaterialBomEnabled} onChange={(event) => change("rawMaterialBomEnabled", event.target.checked)} /></label></>}
        </section>
        <div className="form-actions"><Button type="submit" disabled={saving}><ShieldCheck size={16} />{saving ? "Saving..." : "Save settings"}</Button></div>
      </div>
    </form>}
  </>;
}

function WorkspaceRoleSelect({ name, label, value, onChange, disabled }: { name?: string; label: string; value: string; onChange: (value: string) => void; disabled?: boolean }): React.JSX.Element {
  return <label className="field-label">{label}<select aria-label={label} name={name} value={value} disabled={disabled} onChange={(event) => onChange(event.target.value)}>
    {workspaceRoles.map((role) => <option key={role.value} value={role.value}>{role.label}</option>)}
  </select><small>{workspaceRoles.find((role) => role.value === value)?.description}</small></label>;
}

function WorkspaceRoleEditor({ current, name, endpoint, onSaved, onError }: { current: string; name: string; endpoint: string; onSaved: () => void; onError: (message: string) => void }): React.JSX.Element {
  const [role, setRole] = useState(current);
  const [busy, setBusy] = useState(false);
  useEffect(() => { setRole(current); }, [current]);
  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    if (busy || role === current) return;
    setBusy(true); onError("");
    try { await api(endpoint, { method: "PATCH", body: JSON.stringify({ role }) }); onSaved(); }
    catch (caught) { onError(caught instanceof Error ? caught.message : "Could not update the workspace role."); }
    finally { setBusy(false); }
  };
  return <form className="workspace-role-editor" onSubmit={(event) => void save(event)}>
    <WorkspaceRoleSelect label={`Workspace role for ${name}`} value={role} disabled={busy} onChange={setRole} />
    <Button type="submit" variant="secondary" disabled={busy || role === current}>{busy ? "Saving..." : "Save role"}</Button>
  </form>;
}

function UsersPage(): React.JSX.Element {
  const { user } = useContext(SessionContext);
  const { data, loading, error, reload } = useLoad<{ items: Record<string, unknown>[]; invitations: Record<string, unknown>[] }>("/users");
  const [modal, setModal] = useState(false);
  const [notice, setNotice] = useState("");
  const [errorMessage, setErrorMessage] = useState("");
  const [inviteUrl, setInviteUrl] = useState("");
  const [copied, setCopied] = useState(false);
  const [inviteRole, setInviteRole] = useState("staff");
  const [inviting, setInviting] = useState(false);
  const owner = user?.role === "owner";
  const create = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault(); if (inviting) return;
    setNotice(""); setErrorMessage(""); setInviteUrl(""); setInviting(true);
    const body = Object.fromEntries(new FormData(event.currentTarget).entries());
    try {
      const result = await api<{ inviteUrl: string }>("/users", { method: "POST", body: JSON.stringify(body) });
      setInviteUrl(result.inviteUrl); setNotice("Invitation created. Copy this private link and send it to your teammate."); reload();
    } catch (caught) { setErrorMessage(caught instanceof Error ? caught.message : "Could not create invitation."); }
    finally { setInviting(false); }
  };
  const roleSaved = () => { setNotice("Workspace role updated. Changed team members must sign in again."); reload(); };
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
    <PageHeading eyebrow="THE PEOPLE BEHIND IT" title="User management" description="Invite your people in, and keep the right things in the right hands." action={<Button onClick={() => { setModal(true); setInviteUrl(""); setNotice(""); setErrorMessage(""); setInviteRole("staff"); }}><UserRoundPlus size={17} /> Invite a teammate</Button>} />
    {error && <PageError message={error} />}{errorMessage && <PageError message={errorMessage} />}{notice && <div className="success-box"><ShieldCheck size={17} />{notice}</div>}
    <div className="stat-grid stat-grid-three"><StatCard label="Team members" value={String(data?.items.length ?? 0)} change="People with workspace access" icon={<Users size={17} />} /><StatCard label="Workspace owners" value={String((data?.items ?? []).filter((row) => row.role === "owner" && row.active).length)} change="Full access and ownership" icon={<ShieldCheck size={17} />} tone="blue" /><StatCard label="Pending invitations" value={String(data?.invitations.length ?? 0)} change="Links expire after seven days" icon={<UserRoundPlus size={17} />} tone="lilac" /></div>
    <section className="panel list-panel"><SectionHeading title="Your team" subtitle="You can change a teammate’s access any time." />{loading ? <div className="table-skeleton" /> : <DataTable rowKey="id" rows={data?.items ?? []} empty="You’re the first member of your team." columns={[
      { label: "TEAMMATE", render: (row) => <span className="product-cell"><UserAvatar name={String(row.name)} avatarUrl={user && row.id === user.id ? user.avatarUrl : typeof row.avatarUrl === "string" ? row.avatarUrl : null} className="avatar-customer" /><span><strong>{String(row.name)}</strong><small>{String(row.email)}</small></span></span> },
      { label: "ROLE", render: (row) => owner && row.role !== "owner" ? <WorkspaceRoleEditor current={String(row.role)} name={String(row.name)} endpoint={`/users/${row.id}`} onSaved={roleSaved} onError={setErrorMessage} /> : <span className="channel-tag">{roleLabel(row.role)}</span> },
      { label: "JOINED", render: (row) => dateLabel(row.createdAt) },
      { label: "ACCESS", render: (row) => <StatusPill status={row.active ? "Active" : "Inactive"} /> },
      { label: "", render: (row) => row.role === "owner" || (!owner && row.role === "admin") ? <span className="muted">{roleLabel(row.role)}</span> : <button className="row-action button-link" onClick={() => void toggle(row)}>{row.active ? "Deactivate" : "Reactivate"}</button> },
    ]} />}</section>
    {Boolean(data?.invitations.length) && <section className="panel invitation-panel"><SectionHeading title="Pending invitations" /><DataTable rowKey="email" rows={data?.invitations ?? []} empty="No pending invites." columns={[
      { label: "NAME", render: (row) => String(row.name) },
      { label: "EMAIL", render: (row) => String(row.email) },
      { label: "ROLE", render: (row) => owner && new Date(String(row.expiresAt)).getTime() > Date.now() ? <WorkspaceRoleEditor current={String(row.role)} name={`${row.name} (invitation)`} endpoint={`/invitations/${encodeURIComponent(String(row.email))}`} onSaved={() => { setNotice("Invitation role updated. The existing invitation link is unchanged."); reload(); }} onError={setErrorMessage} /> : <span className="channel-tag">{roleLabel(row.role)}</span> },
      { label: "EXPIRES", render: (row) => dateLabel(row.expiresAt) },
    ]} /></section>}
    {modal && <Modal title="Invite a teammate" onClose={() => { if (!inviting) setModal(false); }}>{inviteUrl ? <div className="invite-created"><span className="success-icon"><UserRoundPlus size={20} /></span><h3>Your invite is ready to go.</h3><p>This private link gives one person access and expires in seven days.</p><div className="copy-link"><input readOnly value={inviteUrl} onFocus={(event) => event.target.select()} /><Button variant="secondary" onClick={() => void copy()}>{copied ? "Copied!" : "Copy link"}</Button></div><div className="modal-actions"><Button variant="secondary" onClick={() => { setModal(false); reload(); }}>Done</Button><Button onClick={() => { setInviteUrl(""); setNotice(""); setCopied(false); setInviteRole("staff"); }}>Invite another</Button></div></div> : <form className="modal-form" onSubmit={(event) => void create(event)}><label className="field-label">Full name<input name="name" required maxLength={200} disabled={inviting} /></label><label className="field-label">Work email<input type="email" name="email" required disabled={inviting} /></label>{owner ? <WorkspaceRoleSelect name="role" label="Workspace role" value={inviteRole} onChange={setInviteRole} disabled={inviting} /> : <p>New teammates receive Staff access. Only an Owner can assign or change workspace roles.</p>}{errorMessage && <PageError message={errorMessage} />}<div className="modal-actions"><Button type="button" variant="secondary" disabled={inviting} onClick={() => setModal(false)}>Cancel</Button><Button type="submit" disabled={inviting}>{inviting ? "Creating..." : "Create invitation"}</Button></div></form>}</Modal>}
  </>;
}

function App(): React.JSX.Element {
  return <BrowserRouter><SessionProvider /></BrowserRouter>;
}

createRoot(document.getElementById("root")!).render(<React.StrictMode><App /></React.StrictMode>);
