import { randomBytes, scrypt as scryptCallback, timingSafeEqual, createHash } from "node:crypto";
import { promisify } from "node:util";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { createReadStream, existsSync, mkdirSync, statSync } from "node:fs";
import { dirname, extname, resolve, sep } from "node:path";
import { TLSSocket } from "node:tls";
import { DatabaseSync } from "node:sqlite";
import nodemailer from "nodemailer";
import type { Transporter } from "nodemailer";
import { InventoryError, InventoryStore } from "@sellerone/inventory-service";
import { CHANNELS, CommerceStore } from "./commerce.js";
import { BomStore } from "./bom.js";
import { NotificationStore } from "./notifications.js";

const scrypt = promisify(scryptCallback);
const PORT = Number(process.env.PORT ?? 3100);
const PROJECT_ROOT = resolve(__dirname, "../../..");
const DB_PATH = process.env.DATABASE_PATH ?? resolve(PROJECT_ROOT, ".data/sellerone.sqlite");
const WEB_DIST = resolve(process.env.WEB_DIST_DIR ?? resolve(PROJECT_ROOT, "apps/web/dist"));
const SESSION_COOKIE = "sellerone_session";
const SESSION_LIFETIME_MS = 7 * 24 * 60 * 60 * 1000;
const TOKEN_LIFETIME_MS = 60 * 60 * 1000;
const DEFAULT_CURRENCY = "PHP";
const MIME_TYPES: Record<string, string> = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".ico": "image/x-icon",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".woff2": "font/woff2",
};

type Role = "owner" | "admin" | "staff";
interface User {
  id: string;
  name: string;
  email: string;
  role: Role;
}
interface AppErrorShape extends Error {
  statusCode?: number;
}

class AppError extends Error {
  constructor(message: string, readonly statusCode = 400) {
    super(message);
    this.name = "AppError";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function text(value: unknown, field: string, max = 200): string {
  if (typeof value !== "string" || value.trim().length === 0 || value.length > max) {
    throw new AppError(`${field} is required and must be no longer than ${max} characters.`);
  }
  return value.trim();
}

function emailAddress(value: unknown): string {
  const email = text(value, "Email", 254).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new AppError("Enter a valid email address.");
  }
  return email;
}

function passwordValue(value: unknown): string {
  if (typeof value !== "string" || value.length < 10 || value.length > 200) {
    throw new AppError("Password must be between 10 and 200 characters.");
  }
  return value;
}

function integer(value: unknown, field: string, min = 0): number {
  if (!Number.isSafeInteger(value) || Number(value) < min) {
    throw new AppError(`${field} must be a safe integer of at least ${min}.`);
  }
  return Number(value);
}

function optionalText(value: unknown, field: string, max = 500): string | null {
  if (value === undefined || value === null || value === "") {
    return null;
  }
  return text(value, field, max);
}

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function nowIso(): string {
  return new Date().toISOString();
}

function formatUser(row: Record<string, unknown>): User {
  return {
    id: String(row.id),
    name: String(row.name),
    email: String(row.email),
    role: String(row.role) as Role,
  };
}

function currencyCode(value: unknown): string {
  if (typeof value !== "string" || !/^[A-Za-z]{3}$/.test(value)) {
    throw new AppError("Currency must be a three-letter ISO code.");
  }
  const code = value.toUpperCase();
  if (!Intl.supportedValuesOf("currency").includes(code)) {
    throw new AppError("Enter a supported ISO currency code.");
  }
  return code;
}

if (DB_PATH !== ":memory:") {
  mkdirSync(dirname(resolve(DB_PATH)), { recursive: true });
}

const db = new DatabaseSync(DB_PATH);
db.exec(`
  PRAGMA foreign_keys = ON;
  PRAGMA busy_timeout = 5000;
  PRAGMA journal_mode = WAL;

  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    email TEXT NOT NULL UNIQUE COLLATE NOCASE,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL CHECK (role IN ('owner', 'admin', 'staff')),
    active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
    created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS sessions (
    id_hash TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at TEXT NOT NULL,
    created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS invitations (
    token_hash TEXT PRIMARY KEY,
    email TEXT NOT NULL COLLATE NOCASE,
    name TEXT NOT NULL,
    role TEXT NOT NULL CHECK (role IN ('admin', 'staff')),
    expires_at TEXT NOT NULL,
    created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS password_resets (
    token_hash TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at TEXT NOT NULL,
    created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS app_settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS customers (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    email TEXT,
    phone TEXT,
    address TEXT,
    notes TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS orders (
    id TEXT PRIMARY KEY,
    order_number TEXT NOT NULL UNIQUE,
    customer_id TEXT REFERENCES customers(id) ON DELETE SET NULL,
    customer_name TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('pending', 'processing', 'shipped', 'delivered', 'cancelled')),
    channel TEXT NOT NULL,
    total_minor INTEGER NOT NULL CHECK (total_minor >= 0),
    currency TEXT NOT NULL,
    notes TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS order_items (
    id TEXT PRIMARY KEY,
    order_id TEXT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
    description TEXT NOT NULL,
    sku TEXT,
    quantity INTEGER NOT NULL CHECK (quantity > 0),
    unit_price_minor INTEGER NOT NULL CHECK (unit_price_minor >= 0),
    total_minor INTEGER NOT NULL CHECK (total_minor >= 0)
  );
  CREATE TABLE IF NOT EXISTS sales (
    id TEXT PRIMARY KEY,
    customer_id TEXT REFERENCES customers(id) ON DELETE SET NULL,
    customer_name TEXT NOT NULL,
    description TEXT NOT NULL,
    amount_minor INTEGER NOT NULL CHECK (amount_minor >= 0),
    currency TEXT NOT NULL,
    channel TEXT NOT NULL,
    created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS expenses (
    id TEXT PRIMARY KEY,
    description TEXT NOT NULL,
    category TEXT NOT NULL,
    amount_minor INTEGER NOT NULL CHECK (amount_minor >= 0),
    currency TEXT NOT NULL,
    notes TEXT,
    created_at TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS sessions_expiry ON sessions (expires_at);
  CREATE INDEX IF NOT EXISTS customers_name ON customers (name);
  CREATE INDEX IF NOT EXISTS orders_created ON orders (created_at DESC);
  CREATE INDEX IF NOT EXISTS sales_created ON sales (created_at DESC);
  CREATE INDEX IF NOT EXISTS expenses_created ON expenses (created_at DESC);
`);

const inventory = new InventoryStore(db);
const materialBoms = new BomStore(db);
const notifications = new NotificationStore(db, inventory);
const customerSocialFields = {
  facebookUrl: { column: "facebook_url", label: "Facebook", hosts: ["facebook.com", "fb.com"] },
  instagramUrl: { column: "instagram_url", label: "Instagram", hosts: ["instagram.com"] },
  tiktokUrl: { column: "tiktok_url", label: "TikTok", hosts: ["tiktok.com"] },
  whatsappUrl: { column: "whatsapp_url", label: "WhatsApp", hosts: ["wa.me", "whatsapp.com"] },
  websiteUrl: { column: "website_url", label: "Website", hosts: [] },
};
const customerColumns = new Set(db.prepare("PRAGMA table_info(customers)").all().map((column) => String(column.name)));
for (const { column } of Object.values(customerSocialFields)) {
  if (!customerColumns.has(column)) db.exec(`ALTER TABLE customers ADD COLUMN ${column} TEXT`);
}
function customerSocialUrl(value: unknown, label: string, hosts: string[]): string | null {
  if (value === null || (typeof value === "string" && !value.trim())) return null;
  const input = text(value, `${label} URL`, 2000);
  let url: URL;
  try { url = new URL(input); }
  catch { throw new AppError(`${label} requires a full HTTPS URL.`); }
  if (url.protocol !== "https:" || url.username || url.password) throw new AppError(`${label} requires an HTTPS URL without embedded credentials.`);
  if (hosts.length && !hosts.some((host) => url.hostname === host || url.hostname.endsWith(`.${host}`))) {
    throw new AppError(`${label} URL must link to ${hosts.join(" or ")}.`);
  }
  return url.href;
}
function customerSocialResponse(row: Record<string, unknown>): Record<string, unknown> {
  return { ...row, ...Object.fromEntries(Object.entries(customerSocialFields).map(([field, { column }]) => [field, row[column] ?? null])) };
}
const commerce = new CommerceStore(db, inventory);
const publicRequests = new Map<string, { count: number; expiresAt: number }>();

function limitPublicRequests(request: IncomingMessage): void {
  const now = Date.now();
  for (const [key, value] of publicRequests) if (value.expiresAt <= now) publicRequests.delete(key);
  const key = `${request.socket.remoteAddress}:${request.method === "POST" ? "write" : "read"}`;
  const limit = request.method === "POST" ? 20 : 120;
  const entry = publicRequests.get(key) ?? { count: 0, expiresAt: now + 60000 };
  if (entry.count >= limit || (!publicRequests.has(key) && publicRequests.size >= 10000)) {
    throw new AppError("Too many public requests. Please try again in a minute.", 429);
  }
  entry.count += 1;
  publicRequests.set(key, entry);
}

function setting(key: string, fallback: string): string {
  return String(db.prepare("SELECT value FROM app_settings WHERE key = ?").get(key)?.value ?? fallback);
}

function sessionCookie(token: string, request: IncomingMessage, maxAge: number): string {
  const secure = process.env.NODE_ENV === "production" || request.socket instanceof TLSSocket ? "; Secure" : "";
  return `${SESSION_COOKIE}=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${maxAge}${secure}`;
}

function cookieToken(request: IncomingMessage): string | undefined {
  const cookie = request.headers.cookie?.split(";").map((part) => part.trim())
    .find((part) => part.startsWith(`${SESSION_COOKIE}=`));
  return cookie?.slice(SESSION_COOKIE.length + 1);
}

function parseUser(request: IncomingMessage): User | undefined {
  const token = cookieToken(request);
  if (!token) {
    return undefined;
  }
  const row = db.prepare(`
    SELECT u.id, u.name, u.email, u.role
    FROM sessions s JOIN users u ON u.id = s.user_id
    WHERE s.id_hash = ? AND s.expires_at > ? AND u.active = 1
  `).get(hashToken(token), nowIso());
  return row ? formatUser(row) : undefined;
}

async function readBody(request: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const value of request) {
    const chunk = Buffer.isBuffer(value) ? value : Buffer.from(value);
    size += chunk.length;
    if (size > 1024 * 1024) {
      throw new AppError("Request body is too large.", 413);
    }
    chunks.push(chunk);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new AppError("Request body must be valid JSON.");
  }
  if (!isRecord(parsed)) {
    throw new AppError("Request body must be a JSON object.");
  }
  return parsed;
}

function sendJson(response: ServerResponse, status: number, data: unknown): void {
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
  });
  response.end(JSON.stringify(data));
}

function safeReturnPath(value: string | null): string {
  return value?.startsWith("/") && !value.startsWith("//") ? value : "/";
}

async function setPassword(userId: string, password: string): Promise<void> {
  const salt = randomBytes(16);
  const key = await scrypt(passwordValue(password), salt, 64) as Buffer;
  db.prepare("UPDATE users SET password_hash = ? WHERE id = ?")
    .run(`${salt.toString("hex")}:${key.toString("hex")}`, userId);
}

async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [saltHex, keyHex] = stored.split(":");
  if (!saltHex || !keyHex) {
    return false;
  }
  const expected = Buffer.from(keyHex, "hex");
  const actual = await scrypt(password, Buffer.from(saltHex, "hex"), expected.length) as Buffer;
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

function createSession(userId: string, request: IncomingMessage, response: ServerResponse): void {
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + SESSION_LIFETIME_MS).toISOString();
  db.prepare("INSERT INTO sessions (id_hash, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)")
    .run(hashToken(token), userId, expiresAt, nowIso());
  response.setHeader("set-cookie", sessionCookie(token, request, SESSION_LIFETIME_MS / 1000));
}

function requireUser(user: User | undefined): User {
  if (!user) {
    throw new AppError("Sign in to continue.", 401);
  }
  return user;
}

function requireAdmin(user: User): void {
  if (user.role !== "owner" && user.role !== "admin") {
    throw new AppError("You do not have permission to manage this area.", 403);
  }
}

function ensureSameOrigin(request: IncomingMessage): void {
  const origin = request.headers.origin;
  if (!origin) {
    return;
  }
  const originUrl = new URL(origin);
  const host = request.headers.host;
  const devProxy = process.env.NODE_ENV !== "production"
    && ["localhost:5173", "127.0.0.1:5173"].includes(originUrl.host);
  if (!host || (originUrl.host !== host && !devProxy)) {
    throw new AppError("Request origin is not allowed.", 403);
  }
}

function createMailer(): Transporter | undefined {
  const host = process.env.SMTP_HOST;
  if (!host) {
    return undefined;
  }
  return nodemailer.createTransport({
    host,
    port: Number(process.env.SMTP_PORT ?? 587),
    secure: process.env.SMTP_SECURE === "true",
    auth: process.env.SMTP_USER ? {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASSWORD,
    } : undefined,
  });
}

const mailer = createMailer();

function insertSessionRevocation(userId: string): void {
  db.prepare("DELETE FROM sessions WHERE user_id = ?").run(userId);
}

function domainSummary(): object {
  const month = new Date();
  month.setDate(1);
  month.setHours(0, 0, 0, 0);
  const monthStart = month.toISOString();
  const stats = db.prepare(`
    SELECT
      (SELECT COUNT(*) FROM orders WHERE status != 'cancelled') AS orders,
      (SELECT COUNT(*) FROM orders WHERE status IN ('pending', 'processing')) AS pendingOrders,
      (SELECT COUNT(*) FROM products) AS unusedProductPlaceholder,
      (SELECT COUNT(*) FROM customers) AS customers,
      (SELECT COALESCE(SUM(amount_minor), 0) FROM sales WHERE created_at >= ?) AS salesMinor,
      (SELECT COALESCE(SUM(amount_minor), 0) FROM expenses WHERE created_at >= ?) AS expensesMinor
  `).get(monthStart, monthStart);
  const recentOrders = db.prepare(`
    SELECT id, order_number AS orderNumber, customer_name AS customerName,
      stage AS status, total_minor AS totalMinor, currency, created_at AS createdAt
    FROM orders ORDER BY created_at DESC LIMIT 6
  `).all();
  const lowStock = inventory.listStock({ lowStockOnly: true });
  return {
    stats: {
      orders: Number(stats?.orders ?? 0),
      pendingOrders: Number(stats?.pendingOrders ?? 0),
      customers: Number(stats?.customers ?? 0),
      salesMinor: Number(stats?.salesMinor ?? 0),
      expensesMinor: Number(stats?.expensesMinor ?? 0),
      lowStockItems: lowStock.length,
    },
    recentOrders,
    lowStock: lowStock.slice(0, 5),
  };
}

async function api(
  request: IncomingMessage,
  response: ServerResponse,
  url: URL,
): Promise<void> {
  const path = url.pathname.slice("/api".length).split("/").filter(Boolean)
    .map((segment) => decodeURIComponent(segment));
  const method = request.method ?? "GET";
  if (["POST", "PUT", "PATCH", "DELETE"].includes(method)) {
    ensureSameOrigin(request);
  }

  if (path[0] === "auth" && method === "GET" && path[1] === "status") {
    sendJson(response, 200, {
      needsSetup: Number(db.prepare("SELECT COUNT(*) AS count FROM users").get()?.count ?? 0) === 0,
      user: parseUser(request) ?? null,
      rawMaterialBomEnabled: parseUser(request) ? setting("rawMaterialBomEnabled", "false") === "true" : false,
    });
    return;
  }

  if (path[0] === "auth" && path[1] === "setup" && method === "POST") {
    const body = await readBody(request);
    const count = Number(db.prepare("SELECT COUNT(*) AS count FROM users").get()?.count ?? 0);
    if (count !== 0) {
      throw new AppError("Initial setup is already complete.", 409);
    }
    const id = randomBytes(16).toString("hex");
    const name = text(body.name, "Name");
    const email = emailAddress(body.email);
    const businessName = text(body.businessName, "Business name");
    const currency = currencyCode(body.currency ?? DEFAULT_CURRENCY);
    const password = passwordValue(body.password);
    const salt = randomBytes(16);
    const key = await scrypt(password, salt, 64) as Buffer;
    db.exec("BEGIN IMMEDIATE");
    try {
      if (Number(db.prepare("SELECT COUNT(*) AS count FROM users").get()?.count ?? 0) !== 0) {
        throw new AppError("Initial setup is already complete.", 409);
      }
      db.prepare(`
        INSERT INTO users (id, name, email, password_hash, role, created_at)
        VALUES (?, ?, ?, ?, 'owner', ?)
      `).run(id, name, email, `${salt.toString("hex")}:${key.toString("hex")}`, nowIso());
      db.prepare("INSERT OR REPLACE INTO app_settings (key, value) VALUES ('businessName', ?)")
        .run(businessName);
      db.prepare("INSERT OR REPLACE INTO app_settings (key, value) VALUES ('currency', ?)")
        .run(currency);
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
    createSession(id, request, response);
    sendJson(response, 201, { user: { id, name, email, role: "owner" } });
    return;
  }

  if (path[0] === "auth" && path[1] === "login" && method === "POST") {
    const body = await readBody(request);
    const email = emailAddress(body.email);
    const row = db.prepare(`
      SELECT id, name, email, password_hash, role
      FROM users WHERE email = ? COLLATE NOCASE AND active = 1
    `).get(email);
    if (!row || !await verifyPassword(passwordValue(body.password), String(row.password_hash))) {
      throw new AppError("Email or password is incorrect.", 401);
    }
    createSession(String(row.id), request, response);
    sendJson(response, 200, { user: formatUser(row) });
    return;
  }

  if (path[0] === "auth" && path[1] === "logout" && method === "POST") {
    const token = cookieToken(request);
    if (token) {
      db.prepare("DELETE FROM sessions WHERE id_hash = ?").run(hashToken(token));
    }
    response.setHeader("set-cookie", sessionCookie("", request, 0));
    sendJson(response, 200, { ok: true });
    return;
  }

  if (path[0] === "auth" && path[1] === "register" && method === "POST") {
    const body = await readBody(request);
    const token = text(body.token, "Invitation token", 200);
    const invitation = db.prepare(`
      SELECT token_hash, email, name, role FROM invitations
      WHERE token_hash = ? AND expires_at > ?
    `).get(hashToken(token), nowIso());
    if (!invitation) {
      throw new AppError("This invitation is invalid or has expired.", 410);
    }
    const id = randomBytes(16).toString("hex");
    const salt = randomBytes(16);
    const key = await scrypt(passwordValue(body.password), salt, 64) as Buffer;
    db.exec("BEGIN IMMEDIATE");
    try {
      const consumed = db.prepare("DELETE FROM invitations WHERE token_hash = ? AND expires_at > ?")
        .run(hashToken(token), nowIso());
      if (Number(consumed.changes) !== 1) {
        throw new AppError("This invitation is invalid or has expired.", 410);
      }
      db.prepare(`
        INSERT INTO users (id, name, email, password_hash, role, created_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(id, String(invitation.name), String(invitation.email), `${salt.toString("hex")}:${key.toString("hex")}`,
        String(invitation.role), nowIso());
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
    createSession(id, request, response);
    sendJson(response, 201, {
      user: { id, name: invitation.name, email: invitation.email, role: invitation.role },
    });
    return;
  }

  if (path[0] === "auth" && path[1] === "forgot-password" && method === "POST") {
    if (!mailer && process.env.NODE_ENV === "production") {
      throw new AppError("Password reset email is not configured. Contact your workspace administrator.", 503);
    }
    const body = await readBody(request);
    const email = emailAddress(body.email);
    const user = db.prepare("SELECT id FROM users WHERE email = ? COLLATE NOCASE AND active = 1").get(email);
    const token = randomBytes(32).toString("base64url");
    const baseUrl = process.env.APP_URL?.replace(/\/+$/, "")
      || new URL(request.headers.origin ?? `http://${request.headers.host ?? "localhost"}`).origin;
    const resetUrl = `${baseUrl}/reset-password?token=${encodeURIComponent(token)}`;
    if (user) {
      const expiresAt = new Date(Date.now() + TOKEN_LIFETIME_MS).toISOString();
      db.prepare("INSERT INTO password_resets (token_hash, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)")
        .run(hashToken(token), String(user.id), expiresAt, nowIso());
      if (mailer) {
        try {
          await mailer.sendMail({
            from: process.env.SMTP_FROM ?? "SellerOne <no-reply@sellerone.local>",
            to: email,
            subject: "Reset your SellerOne password",
            text: `Use this link within one hour to reset your password:\n\n${resetUrl}`,
          });
        } catch (error) {
          db.prepare("DELETE FROM password_resets WHERE token_hash = ?").run(hashToken(token));
          console.error("Could not send password reset email:", error);
          throw new AppError("Unable to send reset instructions right now. Please try again later.", 503);
        }
      }
    }
    sendJson(response, 200, {
      message: process.env.NODE_ENV !== "production" && !mailer
        ? "Email delivery is not configured in local development. Use the reset link below; it works only for an active account matching the email you entered."
        : "If an active account matches that email, password reset instructions will be sent.",
      ...(process.env.NODE_ENV !== "production" && !mailer ? { developmentResetUrl: resetUrl } : {}),
    });
    return;
  }

  if (path[0] === "auth" && path[1] === "reset-password" && method === "POST") {
    const body = await readBody(request);
    const token = text(body.token, "Reset token", 200);
    const reset = db.prepare(`
      SELECT token_hash, user_id AS userId FROM password_resets
      WHERE token_hash = ? AND expires_at > ?
    `).get(hashToken(token), nowIso());
    if (!reset) {
      throw new AppError("This reset link is invalid or has expired.", 410);
    }
    const salt = randomBytes(16);
    const key = await scrypt(passwordValue(body.password), salt, 64) as Buffer;
    db.exec("BEGIN IMMEDIATE");
    try {
      const consumed = db.prepare("DELETE FROM password_resets WHERE token_hash = ? AND expires_at > ?")
        .run(hashToken(token), nowIso());
      if (Number(consumed.changes) !== 1) {
        throw new AppError("This reset link is invalid or has expired.", 410);
      }
      db.prepare("UPDATE users SET password_hash = ? WHERE id = ? AND active = 1")
        .run(`${salt.toString("hex")}:${key.toString("hex")}`, String(reset.userId));
      insertSessionRevocation(String(reset.userId));
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
    sendJson(response, 200, { ok: true });
    return;
  }

  if (path[0] === "public") {
    response.setHeader("cache-control", "no-store");
    response.setHeader("referrer-policy", "no-referrer");
    limitPublicRequests(request);
    if (path[1] === "checkout" && path.length === 3 && method === "GET") {
      sendJson(response, 200, commerce.checkout(path[2]));
      return;
    }
    if (path[1] === "checkout" && path.length === 3 && method === "POST") {
      sendJson(response, 201, commerce.submitCheckout(path[2], await readBody(request)));
      return;
    }
    if (path[1] === "tracking" && path.length === 3 && method === "GET") {
      sendJson(response, 200, commerce.track(path[2]));
      return;
    }
    if (path[1] === "tracking" && path[3] === "payments" && path.length === 4 && method === "POST") {
      commerce.submitPayment(commerce.trackingOrder(path[2]), await readBody(request), "Customer payment submission");
      sendJson(response, 201, commerce.track(path[2]));
      return;
    }
    throw new AppError("Public commerce endpoint not found.", 404);
  }

  const user = requireUser(parseUser(request));
  if (path[0] === "notifications") {
    if (path.length === 1 && method === "GET") {
      sendJson(response, 200, notifications.list(user.id));
      return;
    }
    if (path.length === 3 && path[2] === "view" && method === "POST") {
      sendJson(response, 200, notifications.view(path[1], user.id));
      return;
    }
    throw new AppError("Notification endpoint not found.", 404);
  }
  if (path[0] === "me" && method === "GET") {
    sendJson(response, 200, { user });
    return;
  }

  if (path[0] === "users") {
    requireAdmin(user);
    if (path.length === 1 && method === "GET") {
      const users = db.prepare(`
        SELECT id, name, email, role, active, created_at AS createdAt
        FROM users ORDER BY created_at
      `).all();
      const invitations = db.prepare(`
        SELECT email, name, role, expires_at AS expiresAt, created_at AS createdAt
        FROM invitations ORDER BY created_at DESC
      `).all();
      sendJson(response, 200, { items: users, invitations });
      return;
    }
    if (path.length === 1 && method === "POST") {
      const body = await readBody(request);
      const email = emailAddress(body.email);
      const name = text(body.name, "Name");
      const role = body.role ?? "staff";
      if (role !== "staff" && role !== "admin") {
        throw new AppError("Invited users can have the admin or staff role.");
      }
      if (db.prepare("SELECT id FROM users WHERE email = ? COLLATE NOCASE").get(email)) {
        throw new AppError("An account already exists for this email.", 409);
      }
      const token = randomBytes(32).toString("base64url");
      const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
      db.prepare(`
        INSERT OR REPLACE INTO invitations (token_hash, email, name, role, expires_at, created_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(hashToken(token), email, name, role, expiresAt, nowIso());
      sendJson(response, 201, {
        email,
        role,
        expiresAt,
        inviteUrl: `${process.env.APP_URL ?? `http://localhost:${PORT}`}/register?token=${encodeURIComponent(token)}`,
      });
      return;
    }
    if (path.length === 2 && method === "PATCH") {
      const body = await readBody(request);
      const targetId = path[1];
      const existing = db.prepare("SELECT id, role, active FROM users WHERE id = ?").get(targetId);
      if (!existing) {
        throw new AppError("User not found.", 404);
      }
      const active = body.active;
      if (active !== undefined && typeof active !== "boolean") {
        throw new AppError("active must be true or false.");
      }
      const role = body.role;
      if (role !== undefined && !["owner", "admin", "staff"].includes(String(role))) {
        throw new AppError("Invalid user role.");
      }
      if (targetId === user.id && (active === false || role === "staff")) {
        throw new AppError("You cannot deactivate or demote your own account.", 409);
      }
      if (String(existing.role) === "owner" && (active === false || (role !== undefined && role !== "owner"))) {
        const activeOwners = Number(db.prepare("SELECT COUNT(*) AS count FROM users WHERE role = 'owner' AND active = 1").get()?.count ?? 0);
        if (activeOwners <= 1) {
          throw new AppError("The last active owner cannot be deactivated or demoted.", 409);
        }
      }
      db.prepare(`
        UPDATE users SET active = COALESCE(?, active), role = COALESCE(?, role)
        WHERE id = ?
      `).run(active === undefined ? null : Number(active), role === undefined ? null : String(role), targetId);
      if (active === false) {
        insertSessionRevocation(targetId);
      }
      sendJson(response, 200, { ok: true });
      return;
    }
  }

  if (path[0] === "settings") {
    requireAdmin(user);
    if (method === "GET") {
      sendJson(response, 200, {
        businessName: setting("businessName", "My Business"),
        currency: setting("currency", DEFAULT_CURRENCY),
        timezone: setting("timezone", "Asia/Manila"),
        lowStockEmailAlerts: setting("lowStockEmailAlerts", "false") === "true",
        rawMaterialBomEnabled: setting("rawMaterialBomEnabled", "false") === "true",
      });
      return;
    }
    if (method === "PATCH") {
      const body = await readBody(request);
      const updates: [string, string][] = [];
      if (body.businessName !== undefined) {
        updates.push(["businessName", text(body.businessName, "Business name")]);
      }
      if (body.currency !== undefined) {
        updates.push(["currency", currencyCode(body.currency)]);
      }
      if (body.timezone !== undefined) {
        const timezone = text(body.timezone, "Timezone", 100);
        try {
          new Intl.DateTimeFormat("en", { timeZone: timezone });
        } catch {
          throw new AppError("Enter a supported time zone.");
        }
        updates.push(["timezone", timezone]);
      }
      if (body.lowStockEmailAlerts !== undefined) {
        if (typeof body.lowStockEmailAlerts !== "boolean") {
          throw new AppError("lowStockEmailAlerts must be true or false.");
        }
        updates.push(["lowStockEmailAlerts", String(body.lowStockEmailAlerts)]);
      }
      if (body.rawMaterialBomEnabled !== undefined) {
        if (typeof body.rawMaterialBomEnabled !== "boolean") throw new AppError("rawMaterialBomEnabled must be true or false.");
        updates.push(["rawMaterialBomEnabled", String(body.rawMaterialBomEnabled)]);
      }
      db.exec("BEGIN IMMEDIATE");
      try {
        const upsert = db.prepare("INSERT OR REPLACE INTO app_settings (key, value) VALUES (?, ?)");
        for (const update of updates) {
          upsert.run(...update);
        }
        db.exec("COMMIT");
      } catch (error) {
        db.exec("ROLLBACK");
        throw error;
      }
      sendJson(response, 200, {
        businessName: setting("businessName", "My Business"),
        currency: setting("currency", DEFAULT_CURRENCY),
        timezone: setting("timezone", "Asia/Manila"),
        lowStockEmailAlerts: setting("lowStockEmailAlerts", "false") === "true",
        rawMaterialBomEnabled: setting("rawMaterialBomEnabled", "false") === "true",
      });
      return;
    }
  }

  if (path[0] === "raw-material-bom") {
    if (setting("rawMaterialBomEnabled", "false") !== "true") throw new AppError("Enable Raw Material BOM in Settings preferences first.", 409);
    if (path.length === 1 && method === "GET") {
      sendJson(response, 200, materialBoms.list());
      return;
    }
    requireAdmin(user);
    if (path.length === 3 && path[1] === "materials" && method === "PATCH") {
      materialBoms.classify(path[2], (await readBody(request)).isRawMaterial);
    } else if (path.length === 2 && method === "PUT") {
      materialBoms.save(path[1], await readBody(request));
    } else if (path.length === 2 && method === "DELETE") {
      materialBoms.remove(path[1]);
    } else throw new AppError("BOM endpoint not found.", 404);
    sendJson(response, 200, materialBoms.list());
    return;
  }

  if (path[0] === "dashboard" && method === "GET") {
    sendJson(response, 200, domainSummary());
    return;
  }

  if (path[0] === "products" || path[0] === "variants" || path[0] === "stock"
    || path[0] === "batches" || path[0] === "locations" || path[0] === "adjustments"
    || path[0] === "transfers" || path[0] === "valuation" || path[0] === "movements"
    || path[0] === "alerts") {
    await inventoryApi(request, response, url, path, method);
    return;
  }

  if (path[0] === "customers") {
    if (path.length === 1 && method === "GET") {
      sendJson(response, 200, {
        items: db.prepare(`
          SELECT c.id, c.name, c.email, c.phone, c.address, c.notes,
            c.facebook_url AS facebookUrl, c.instagram_url AS instagramUrl, c.tiktok_url AS tiktokUrl,
            c.whatsapp_url AS whatsappUrl, c.website_url AS websiteUrl,
            c.created_at AS createdAt, COUNT(o.id) AS orderCount,
            COALESCE(SUM(CASE WHEN o.stage IN ('delivered', 'completed') THEN o.total_minor ELSE 0 END), 0) AS spentMinor
          FROM customers c LEFT JOIN orders o ON o.customer_id = c.id
          GROUP BY c.id ORDER BY c.created_at DESC
        `).all(),
      });
      return;
    }
    if (path.length === 1 && method === "POST") {
      const body = await readBody(request);
      const id = randomBytes(16).toString("hex");
      const now = nowIso();
      const socialValues = Object.entries(customerSocialFields).map(([field, { label, hosts }]) =>
        body[field] === undefined ? null : customerSocialUrl(body[field], label, hosts));
      db.prepare(`
        INSERT INTO customers (id, name, email, phone, address, notes, created_at, updated_at,
          facebook_url, instagram_url, tiktok_url, whatsapp_url, website_url)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(id, text(body.name, "Name"), optionalText(body.email, "Email", 254)?.toLowerCase() ?? null,
        optionalText(body.phone, "Phone", 50), optionalText(body.address, "Address"),
        optionalText(body.notes, "Notes"), now, now, ...socialValues);
      sendJson(response, 201, customerSocialResponse(db.prepare("SELECT * FROM customers WHERE id = ?").get(id)!));
      return;
    }
    if (path.length === 2 && method === "GET") {
      const customer = db.prepare(`
        SELECT c.id, c.name, c.email, c.phone, c.address, c.notes, c.created_at AS createdAt,
          c.facebook_url AS facebookUrl, c.instagram_url AS instagramUrl, c.tiktok_url AS tiktokUrl,
          c.whatsapp_url AS whatsappUrl, c.website_url AS websiteUrl,
          COUNT(o.id) AS orderCount,
          COALESCE(SUM(CASE WHEN o.stage IN ('delivered', 'completed') THEN o.total_minor ELSE 0 END), 0) AS spentMinor
        FROM customers c LEFT JOIN orders o ON o.customer_id = c.id
        WHERE c.id = ? GROUP BY c.id
      `).get(path[1]);
      if (!customer) {
        throw new AppError("Customer not found.", 404);
      }
      const orders = db.prepare(`
        SELECT id, order_number AS orderNumber, stage AS status,
          total_minor AS totalMinor, currency, created_at AS createdAt
        FROM orders WHERE customer_id = ? ORDER BY created_at DESC
      `).all(path[1]);
      sendJson(response, 200, { ...customer, orders });
      return;
    }
    if (path.length === 2 && method === "PATCH") {
      const body = await readBody(request);
      const existing = db.prepare("SELECT id FROM customers WHERE id = ?").get(path[1]);
      if (!existing) {
        throw new AppError("Customer not found.", 404);
      }
      const allowed: Record<string, string> = {
        name: "name", email: "email", phone: "phone", address: "address", notes: "notes",
      };
      const fields: string[] = [];
      const values: (string | null)[] = [];
      for (const [field, column] of Object.entries(allowed)) {
        if (body[field] !== undefined) {
          fields.push(`${column} = ?`);
          values.push(field === "name"
            ? text(body[field], "Name")
            : optionalText(body[field], field === "email" ? "Email" : field)?.toLowerCase() ?? null);
        }
        for (const [field, { column, label, hosts }] of Object.entries(customerSocialFields)) {
          if (body[field] !== undefined) {
            fields.push(`${column} = ?`);
            values.push(customerSocialUrl(body[field], label, hosts));
          }
        }
      }
      if (fields.length === 0) {
        throw new AppError("Provide at least one customer field to update.");
      }
      fields.push("updated_at = ?");
      values.push(nowIso(), path[1]);
      db.prepare(`UPDATE customers SET ${fields.join(", ")} WHERE id = ?`).run(...values);
      sendJson(response, 200, customerSocialResponse(db.prepare("SELECT * FROM customers WHERE id = ?").get(path[1])!));
      return;
    }
  }

  if (path[0] === "commerce" && path[1] === "channels" && path.length === 2 && method === "GET") {
    sendJson(response, 200, { items: CHANNELS.map((name) => ({ name, connection: name === "Manual" || name === "Shareable Order Link" ? "local" : "manual / import; live API not connected" })) });
    return;
  }
  if (path[0] === "checkout-links") {
    requireAdmin(user);
    if (path.length === 1 && method === "GET") { sendJson(response, 200, { items: commerce.links() }); return; }
    if (path.length === 1 && method === "POST") { sendJson(response, 201, commerce.createLink(await readBody(request))); return; }
    if (path.length === 2 && method === "DELETE") { commerce.disableLink(path[1]); sendJson(response, 200, { ok: true }); return; }
  }
  if (path[0] === "orders") {
    if (path.length === 1 && method === "GET") {
      sendJson(response, 200, commerce.list({
        page: Number(url.searchParams.get("page") ?? 1), search: url.searchParams.get("search")?.trim() || undefined,
        stage: url.searchParams.get("stage") || undefined, channel: url.searchParams.get("channel") || undefined,
        payment: url.searchParams.get("payment") || undefined,
      }));
      return;
    }
    if (path.length === 1 && method === "POST") {
      sendJson(response, 201, commerce.create(await readBody(request), user.name));
      return;
    }
    if (path[1] === "import" && path.length === 2 && method === "POST") {
      requireAdmin(user);
      sendJson(response, 200, commerce.create(await readBody(request), user.name, true));
      return;
    }
    if (path.length === 2 && method === "GET") {
      sendJson(response, 200, commerce.get(path[1]));
      return;
    }
    if (path.length === 2 && method === "PATCH") {
      const result = commerce.transition(path[1], await readBody(request), user);
      notifications.sync();
      sendJson(response, 200, result);
      return;
    }
    if (path.length === 3 && method === "POST") {
      const body = await readBody(request);
      const result = path[2] === "payments" ? commerce.submitPayment(path[1], body, user.name)
        : path[2] === "verify-payment" ? commerce.reviewPayment(path[1], body, user, true)
        : path[2] === "reject-payment" ? commerce.reviewPayment(path[1], body, user, false)
        : path[2] === "shipping" ? commerce.updateShipping(path[1], body, user)
        : path[2] === "refund" ? commerce.refund(path[1], body, user)
        : path[2] === "communications" ? commerce.communicate(path[1], body, user)
        : undefined;
      if (!result) throw new AppError("Order action not found.", 404);
      sendJson(response, 200, result);
      return;
    }
  }

  if (path[0] === "sales") {
    if (path.length === 1 && method === "GET") {
      sendJson(response, 200, {
        items: db.prepare(`
          SELECT id, order_id AS orderId, customer_id AS customerId, customer_name AS customerName,
            description, amount_minor AS amountMinor, currency, channel, created_at AS createdAt
          FROM sales ORDER BY created_at DESC LIMIT 500
        `).all(),
      });
      return;
    }
    if (path.length === 1 && method === "POST") {
      const body = await readBody(request);
      const id = randomBytes(16).toString("hex");
      const customerId = optionalText(body.customerId, "Customer ID");
      const customer = customerId ? db.prepare("SELECT name FROM customers WHERE id = ?").get(customerId) : undefined;
      if (customerId && !customer) {
        throw new AppError("Customer not found.", 404);
      }
      const description = text(body.description, "Description", 500);
      const amountMinor = integer(body.amountMinor, "Amount");
      const currency = currencyCode(body.currency ?? setting("currency", DEFAULT_CURRENCY));
      const channel = text(body.channel ?? "Manual", "Channel", 50);
      db.prepare(`
        INSERT INTO sales (id, customer_id, customer_name, description, amount_minor, currency, channel, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(id, customerId, customer ? String(customer.name) : text(body.customerName, "Customer name"),
        description, amountMinor, currency, channel, nowIso());
      sendJson(response, 201, db.prepare("SELECT * FROM sales WHERE id = ?").get(id));
      return;
    }
  }

  if (path[0] === "expenses") {
    if (path.length === 1 && method === "GET") {
      sendJson(response, 200, {
        items: db.prepare(`
          SELECT id, description, category, amount_minor AS amountMinor,
            currency, notes, created_at AS createdAt
          FROM expenses ORDER BY created_at DESC LIMIT 500
        `).all(),
      });
      return;
    }
    if (path.length === 1 && method === "POST") {
      const body = await readBody(request);
      const id = randomBytes(16).toString("hex");
      db.prepare(`
        INSERT INTO expenses (id, description, category, amount_minor, currency, notes, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(id, text(body.description, "Description", 500), text(body.category, "Category", 100),
        integer(body.amountMinor, "Amount"), currencyCode(body.currency ?? setting("currency", DEFAULT_CURRENCY)),
        optionalText(body.notes, "Notes"), nowIso());
      sendJson(response, 201, db.prepare("SELECT * FROM expenses WHERE id = ?").get(id));
      return;
    }
  }

  if (path[0] === "accounting" && path[1] === "summary" && method === "GET") {
    const currency = setting("currency", DEFAULT_CURRENCY);
    const monthStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString();
    const sales = db.prepare("SELECT COALESCE(SUM(amount_minor), 0) AS total FROM sales WHERE currency = ? AND created_at >= ?")
      .get(currency, monthStart);
    const expenses = db.prepare("SELECT COALESCE(SUM(amount_minor), 0) AS total FROM expenses WHERE currency = ? AND created_at >= ?")
      .get(currency, monthStart);
    const allSales = db.prepare("SELECT COALESCE(SUM(amount_minor), 0) AS total FROM sales WHERE currency = ?")
      .get(currency);
    const allExpenses = db.prepare("SELECT COALESCE(SUM(amount_minor), 0) AS total FROM expenses WHERE currency = ?")
      .get(currency);
    const valuation = inventory.getValuation().find((entry) => isRecord(entry) && String(entry.currency) === currency);
    const monthly = db.prepare(`
      SELECT substr(created_at, 1, 7) AS month, currency, SUM(amount_minor) AS revenueMinor
      FROM sales WHERE currency = ? GROUP BY month ORDER BY month DESC LIMIT 6
    `).all(currency);
    sendJson(response, 200, {
      currency,
      monthSalesMinor: Number(sales?.total ?? 0),
      monthExpensesMinor: Number(expenses?.total ?? 0),
      monthProfitMinor: Number(sales?.total ?? 0) - Number(expenses?.total ?? 0),
      totalRevenueMinor: Number(allSales?.total ?? 0),
      totalExpensesMinor: Number(allExpenses?.total ?? 0),
      inventoryValueMinor: Number((valuation as Record<string, unknown> | undefined)?.totalValueMinor ?? 0),
      monthly,
    });
    return;
  }

  if (path[0] === "reports" && method === "GET") {
    const currency = setting("currency", DEFAULT_CURRENCY);
    const timezone = setting("timezone", "Asia/Manila");
    const formatter = new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" });
    const calendarDay = (timestamp: string): string => {
      const parts = formatter.formatToParts(new Date(timestamp));
      return ["year", "month", "day"].map((type) => parts.find((part) => part.type === type)!.value).join("-");
    };
    const endDay = calendarDay(nowIso());
    const startDate = new Date(`${endDay}T00:00:00.000Z`);
    startDate.setUTCDate(startDate.getUTCDate() - 89);
    const startDay = startDate.toISOString().slice(0, 10);
    const lowerBound = new Date(startDate.getTime() - 86400000).toISOString();
    const upperBound = new Date(new Date(`${endDay}T00:00:00.000Z`).getTime() + 2 * 86400000).toISOString();
    const groupTransactions = (table: "sales" | "expenses") => {
      const groups = new Map<string, { day?: string; category?: string; currency: string; amountMinor: number; transactionCount: number }>();
      const rows = db.prepare(`SELECT created_at, amount_minor${table === "expenses" ? ", category" : ""}
        FROM ${table} WHERE currency = ? AND created_at >= ? AND created_at < ?`).all(currency, lowerBound, upperBound);
      for (const row of rows) {
        const day = calendarDay(String(row.created_at));
        if (day < startDay || day > endDay) continue;
        const key = table === "sales" ? day : String(row.category);
        const group = groups.get(key) ?? { ...(table === "sales" ? { day } : { category: key }), currency, amountMinor: 0, transactionCount: 0 };
        group.amountMinor += Number(row.amount_minor);
        group.transactionCount++;
        groups.set(key, group);
      }
      return [...groups.values()];
    };
    const sales = groupTransactions("sales").sort((a, b) => String(b.day).localeCompare(String(a.day)));
    const expenses = groupTransactions("expenses").sort((a, b) => b.amountMinor - a.amountMinor);
    const orders = db.prepare(`
      SELECT stage AS status, currency, COUNT(*) AS count, SUM(total_minor) AS amountMinor
      FROM orders WHERE currency = ? GROUP BY stage ORDER BY stage
    `).all(currency);
    sendJson(response, 200, { currency, timezone, startDay, endDay, sales, expenses, orders });
    return;
  }

  throw new AppError("API endpoint not found.", 404);
}

async function inventoryApi(
  request: IncomingMessage,
  response: ServerResponse,
  url: URL,
  path: string[],
  method: string,
): Promise<void> {
  const search = (name: string) => url.searchParams.get(name) || undefined;
  const body = async () => readBody(request);
  let result: object;
  let status = 200;
  if (path[0] === "products" && path[1] === "lookup" && method === "GET") {
    result = inventory.lookupProduct(text(search("code"), "Product code"));
  } else if (path[0] === "products" && path.length === 1 && method === "GET") {
    result = { items: inventory.listProducts(search("search")) };
  } else if (path[0] === "products" && path.length === 1 && method === "POST") {
    const data = await body();
    result = inventory.createProduct(data as never);
    status = 201;
  } else if (path[0] === "products" && path.length === 2 && method === "GET") {
    result = inventory.getProduct(path[1]);
  } else if (path[0] === "products" && path.length === 2 && method === "PATCH") {
    result = inventory.updateProduct(path[1], await body());
  } else if (path[0] === "products" && path[2] === "variants" && path.length === 3 && method === "POST") {
    result = inventory.createVariant(path[1], await body() as never);
    status = 201;
  } else if (path[0] === "variants" && path.length === 2 && method === "PATCH") {
    result = inventory.updateVariant(path[1], await body());
  } else if (path[0] === "locations" && path.length === 1 && method === "GET") {
    result = { items: inventory.listLocations() };
  } else if (path[0] === "locations" && path.length === 1 && method === "POST") {
    const data = await body();
    result = inventory.createLocation(data.name as string);
    status = 201;
  } else if (path[0] === "stock" && path.length === 1 && method === "GET") {
    result = { items: inventory.listStock({
      locationId: search("locationId"),
      variantId: search("variantId"),
      lowStockOnly: search("lowStock") === "true",
    }) };
  } else if (path[0] === "stock" && path[1] === "in" && path.length === 2 && method === "POST") {
    result = inventory.stockIn(await body() as never);
    status = 201;
  } else if (path[0] === "stock" && path[1] === "out" && path.length === 2 && method === "POST") {
    result = inventory.stockOut(await body() as never);
  } else if (path[0] === "batches" && path.length === 1 && method === "GET") {
    result = { items: inventory.listBatches({
      variantId: search("variantId"),
      locationId: search("locationId"),
      lotNumber: search("lotNumber"),
      includeDepleted: search("includeDepleted") === "true",
      limit: Math.min(500, Math.max(1, Number(search("limit") ?? 100))),
    }) };
  } else if (path[0] === "adjustments" && method === "POST") {
    result = inventory.adjustStock(await body() as never);
  } else if (path[0] === "transfers" && method === "POST") {
    result = inventory.transferStock(await body() as never);
  } else if (path[0] === "alerts" && path[1] === "low-stock" && method === "GET") {
    result = { items: inventory.listStock({ lowStockOnly: true }) };
  } else if (path[0] === "valuation" && method === "GET") {
    result = { items: inventory.getValuation(search("locationId")), method: "FIFO" };
  } else if (path[0] === "movements" && method === "GET") {
    result = { items: inventory.listMovements({
      variantId: search("variantId"),
      locationId: search("locationId"),
      limit: Math.min(500, Math.max(1, Number(search("limit") ?? 100))),
    }) };
  } else {
    throw new AppError("Inventory endpoint not found.", 404);
  }
  if (method !== "GET") notifications.sync();
  sendJson(response, status, result);
}

function serveFile(request: IncomingMessage, response: ServerResponse, pathname: string): void {
  const relative = pathname === "/" ? "index.html" : decodeURIComponent(pathname.slice(1));
  const filePath = resolve(WEB_DIST, relative);
  if (!filePath.startsWith(`${WEB_DIST}${sep}`) && filePath !== WEB_DIST) {
    throw new AppError("File not found.", 404);
  }
  const target = existsSync(filePath) && statSync(filePath).isFile()
    ? filePath
    : resolve(WEB_DIST, "index.html");
  if (!existsSync(target)) {
    throw new AppError("Web application is not built. Run npm run build --workspace @sellerone/web.", 503);
  }
  response.writeHead(200, {
    "content-type": MIME_TYPES[extname(target)] ?? "application/octet-stream",
    "cache-control": target.endsWith("index.html") ? "no-cache" : "public, max-age=31536000, immutable",
    "referrer-policy": "no-referrer",
  });
  createReadStream(target).pipe(response);
}

if (!Number.isInteger(PORT) || PORT < 1 || PORT > 65535) {
  throw new Error(`PORT must be an integer between 1 and 65535.`);
}

const server = createServer((request, response) => {
  const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`);
  const handler = url.pathname.startsWith("/api/")
    ? api(request, response, url)
    : Promise.resolve().then(() => serveFile(request, response, url.pathname));
  void handler.catch((error: unknown) => {
    if (response.headersSent) {
      response.destroy(error instanceof Error ? error : undefined);
      return;
    }
    const typed = error as AppErrorShape;
    if (error instanceof AppError || error instanceof InventoryError) {
      sendJson(response, typed.statusCode ?? 400, { error: error.message });
      return;
    }
    if (error instanceof Error && /UNIQUE constraint failed/.test(error.message)) {
      sendJson(response, 409, { error: "A record with this value already exists." });
      return;
    }
    console.error("Platform request failed:", error);
    sendJson(response, 500, { error: "An unexpected server error occurred." });
  });
});

server.on("error", (error) => {
  console.error("Platform server failed:", error);
  process.exitCode = 1;
});
server.listen(PORT, "0.0.0.0", () => {
  console.log(`SellerOne platform listening on port ${PORT}`);
});
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    server.close((error) => {
      if (error) {
        console.error("Platform server did not shut down cleanly:", error);
        process.exitCode = 1;
      }
      inventory.close();
      db.close();
    });
  });
}
