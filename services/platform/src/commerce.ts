import { createHash, randomBytes, randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { InventoryError, InventoryStore } from "@sellerone/inventory-service";

export const CHANNELS = ["Manual", "TikTok Shop", "Facebook Marketplace", "Facebook Page", "Facebook Messenger", "Instagram", "Shareable Order Link"] as const;
export const STAGES = ["received", "payment_verified", "packing", "shipped", "delivered", "completed", "cancelled"] as const;
type Stage = typeof STAGES[number];
type Actor = { id: string; name: string; role: string };
type Row = Record<string, unknown>;
interface Line {
  variantId: string;
  description: string;
  sku: string;
  uom: string;
  quantity: number;
  unitPriceMinor: number;
  totalMinor: number;
}

function fail(message: string, status = 400): never {
  throw new InventoryError(message, status);
}
function text(value: unknown, field: string, max = 200): string {
  if (typeof value !== "string" || !value.trim() || value.length > max) fail(`${field} is required (maximum ${max} characters).`);
  return value.trim();
}
function optional(value: unknown, field: string, max = 500): string | null {
  return value === undefined || value === null || value === "" ? null : text(value, field, max);
}
function integer(value: unknown, field: string, min = 0): number {
  if (!Number.isSafeInteger(value) || Number(value) < min) fail(`${field} must be a safe whole number of at least ${min}.`);
  return Number(value);
}
function record(value: unknown): Row {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail("Expected an object.");
  return value as Row;
}
function hash(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export class CommerceStore {
  constructor(private readonly db: DatabaseSync, private readonly inventory: InventoryStore) {
    const columns = {
      orders: {
        stage: "TEXT", external_id: "TEXT", location_id: "TEXT NOT NULL DEFAULT 'main'",
        customer_email: "TEXT", customer_phone: "TEXT", shipping_address: "TEXT",
        tracking_token: "TEXT", carrier: "TEXT", tracking_number: "TEXT", checkout_key: "TEXT",
      },
      order_items: { variant_id: "TEXT", uom: "TEXT NOT NULL DEFAULT 'pcs'" },
      sales: { order_id: "TEXT" },
    };
    for (const [table, additions] of Object.entries(columns)) {
      const existing = this.db.prepare(`PRAGMA table_info(${table})`).all().map((row) => String(row.name));
      for (const [column, definition] of Object.entries(additions)) {
        if (!existing.includes(column)) this.db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
      }
    }
    this.db.exec(`
      UPDATE orders SET stage = CASE status
        WHEN 'pending' THEN 'received' WHEN 'processing' THEN 'received'
        ELSE status END WHERE stage IS NULL;
      CREATE UNIQUE INDEX IF NOT EXISTS commerce_external_order ON orders(channel, external_id) WHERE external_id IS NOT NULL;
      CREATE UNIQUE INDEX IF NOT EXISTS commerce_checkout_order ON orders(checkout_key) WHERE checkout_key IS NOT NULL;
      CREATE UNIQUE INDEX IF NOT EXISTS commerce_tracking_token ON orders(tracking_token) WHERE tracking_token IS NOT NULL;
      CREATE UNIQUE INDEX IF NOT EXISTS commerce_sale ON sales(order_id) WHERE order_id IS NOT NULL;
      CREATE TABLE IF NOT EXISTS order_events (
        sequence INTEGER PRIMARY KEY AUTOINCREMENT, order_id TEXT NOT NULL REFERENCES orders(id),
        stage TEXT NOT NULL, message TEXT NOT NULL, actor TEXT NOT NULL, created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS order_payments (
        id TEXT PRIMARY KEY, order_id TEXT NOT NULL REFERENCES orders(id),
        method TEXT NOT NULL, reference TEXT NOT NULL, amount_minor INTEGER NOT NULL,
        currency TEXT NOT NULL, status TEXT NOT NULL CHECK(status IN ('submitted','verified','rejected','refunded')),
        review_note TEXT, reviewed_by TEXT, created_at TEXT NOT NULL, reviewed_at TEXT,
        UNIQUE(method, reference)
      );
      CREATE TABLE IF NOT EXISTS checkout_links (
        id TEXT PRIMARY KEY, token TEXT NOT NULL UNIQUE, title TEXT NOT NULL,
        channel TEXT NOT NULL, location_id TEXT NOT NULL, currency TEXT NOT NULL,
        items_json TEXT NOT NULL, active INTEGER NOT NULL DEFAULT 1,
        expires_at TEXT NOT NULL, created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS order_communications (
        id TEXT PRIMARY KEY, order_id TEXT NOT NULL REFERENCES orders(id),
        message TEXT NOT NULL, status TEXT NOT NULL CHECK(status IN ('prepared','sent')),
        actor TEXT NOT NULL, created_at TEXT NOT NULL
      );
    `);
  }

  private transaction<T>(operation: () => T): T {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const result = operation();
      this.db.exec("COMMIT");
      return result;
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  private raw(id: string): Row {
    return this.db.prepare("SELECT * FROM orders WHERE id = ?").get(id) ?? fail("Order not found.", 404);
  }
  private event(id: string, stage: string, message: string, actor: string): void {
    this.db.prepare(`INSERT INTO order_events (order_id, stage, message, actor, created_at)
      VALUES (?, ?, ?, ?, ?)`).run(id, stage, message, actor, new Date().toISOString());
  }
  private admin(actor: Actor): void {
    if (!["owner", "admin"].includes(actor.role)) fail("Only owners and admins can verify, reject, or refund payments.", 403);
  }
  private currency(value: unknown): string {
    const code = text(value, "Currency", 3).toUpperCase();
    if (!Intl.supportedValuesOf("currency").includes(code)) fail("Unsupported currency.");
    return code;
  }
  private channel(value: unknown): string {
    const aliases: Record<string, string> = { Facebook: "Facebook Page", Messenger: "Facebook Messenger" };
    const channel = text(value ?? "Manual", "Channel", 50);
    const normalized = aliases[channel] ?? channel;
    if (!CHANNELS.some((item) => item === normalized)) fail("Unsupported sales channel.");
    return normalized;
  }
  private location(value: unknown): string {
    const id = text(value ?? "main", "Location ID");
    if (!this.db.prepare("SELECT id FROM locations WHERE id = ?").get(id)) fail("Stock location not found.", 404);
    return id;
  }
  private lines(value: unknown, currency: string): Line[] {
    if (!Array.isArray(value) || !value.length || value.length > 50) fail("Provide between 1 and 50 order items.");
    const lines = value.map((value) => {
      const item = record(value);
      const variant = item.variantId !== undefined
        ? this.db.prepare(`SELECT v.*, p.name AS product_name, p.active AS product_active
          FROM variants v JOIN products p ON p.id = v.product_id WHERE v.id = ?`).get(text(item.variantId, "Variant ID"))
        : this.db.prepare(`SELECT v.*, p.name AS product_name, p.active AS product_active
          FROM variants v JOIN products p ON p.id = v.product_id WHERE v.sku = ?`).get(text(item.sku, "SKU", 100));
      if (!variant || !variant.active || !variant.product_active) fail("Choose an active catalog product variant.", 409);
      if (variant.currency !== currency) fail("All items must use the order currency.");
      const quantity = integer(item.quantity, "Quantity", 1);
      if (item.unitPriceMinor === undefined && variant.selling_price_minor === null) fail("Set a catalog selling price or provide an explicit selling price.");
      const unitPriceMinor = integer(item.unitPriceMinor === undefined ? variant.selling_price_minor : item.unitPriceMinor, "Selling price");
      const totalMinor = quantity * unitPriceMinor;
      if (!Number.isSafeInteger(totalMinor)) fail("Line total is outside the supported range.");
      return {
        variantId: String(variant.id), description: `${variant.product_name} · ${variant.name}`,
        sku: String(variant.sku), uom: String(variant.uom), quantity, unitPriceMinor, totalMinor,
      };
    });
    if (!Number.isSafeInteger(lines.reduce((sum, line) => sum + line.totalMinor, 0))) fail("Order total is outside the supported range.");
    return lines;
  }

  list(filters: { page?: number; search?: string; stage?: string; channel?: string; payment?: string } = {}): { items: Row[]; total: number; page: number; pageSize: number } {
    const page = integer(filters.page ?? 1, "Page", 1);
    const pageSize = 50;
    if (!Number.isSafeInteger((page - 1) * pageSize)) fail("Page is outside the supported range.");
    const clauses: string[] = [];
    const values: string[] = [];
    if (filters.stage) {
      if (!STAGES.some((stage) => stage === filters.stage)) fail("Invalid stage filter.");
      clauses.push("stage = ?"); values.push(filters.stage);
    }
    if (filters.channel) { clauses.push("channel = ?"); values.push(this.channel(filters.channel)); }
    if (filters.payment) {
      if (!["unpaid", "submitted", "verified", "rejected", "refund_due", "refunded"].includes(filters.payment)) fail("Invalid payment filter.");
      clauses.push("paymentStatus = ?"); values.push(filters.payment);
    }
    if (filters.search) {
      const query = text(filters.search, "Search", 200);
      clauses.push("(orderNumber LIKE ? OR customerName LIKE ? OR externalId LIKE ?)");
      values.push(`%${query}%`, `%${query}%`, `%${query}%`);
    }
    const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
    const inbox = `WITH inbox AS (SELECT id, order_number AS orderNumber, customer_id AS customerId,
      customer_name AS customerName, stage, status, channel, external_id AS externalId,
      total_minor AS totalMinor, currency, created_at AS createdAt,
      CASE WHEN stage = 'cancelled' AND EXISTS (SELECT 1 FROM order_payments p WHERE p.order_id = orders.id AND p.status = 'verified') THEN 'refund_due'
        ELSE COALESCE((SELECT status FROM order_payments p WHERE p.order_id = orders.id ORDER BY p.created_at DESC, p.rowid DESC LIMIT 1), 'unpaid') END AS paymentStatus
      FROM orders)`;
    return {
      items: this.db.prepare(`${inbox} SELECT * FROM inbox ${where} ORDER BY createdAt DESC, id LIMIT ? OFFSET ?`).all(...values, pageSize, (page - 1) * pageSize),
      total: Number(this.db.prepare(`${inbox} SELECT COUNT(*) AS count FROM inbox ${where}`).get(...values)?.count ?? 0),
      page, pageSize,
    };
  }

  get(id: string): Row {
    const raw = this.raw(id);
    const items = this.db.prepare(`SELECT id, variant_id AS variantId, description, sku, uom, quantity,
      unit_price_minor AS unitPriceMinor, total_minor AS totalMinor FROM order_items WHERE order_id = ? ORDER BY rowid`).all(id);
    const payments = this.db.prepare(`SELECT id, method, reference, amount_minor AS amountMinor, currency, status,
      review_note AS reviewNote, reviewed_by AS reviewedBy, created_at AS createdAt FROM order_payments WHERE order_id = ? ORDER BY created_at, rowid`).all(id);
    return {
      id, orderNumber: raw.order_number, customerId: raw.customer_id, customerName: raw.customer_name,
      businessName: this.db.prepare("SELECT value FROM app_settings WHERE key = 'businessName'").get()?.value ?? "SellerOne",
      customerEmail: raw.customer_email, customerPhone: raw.customer_phone, shippingAddress: raw.shipping_address,
      stage: raw.stage, status: raw.status, channel: raw.channel, externalId: raw.external_id,
      locationId: raw.location_id, totalMinor: raw.total_minor, currency: raw.currency, notes: raw.notes,
      carrier: raw.carrier, trackingNumber: raw.tracking_number,
      trackingPath: raw.tracking_token ? `/track/${raw.tracking_token}` : null,
      invoiceNumber: `INV-${raw.order_number}`, createdAt: raw.created_at, updatedAt: raw.updated_at, items, payments,
      refundDue: raw.stage === "cancelled" && payments.some((payment) => payment.status === "verified"),
      timeline: this.db.prepare(`SELECT sequence, stage, message, actor, created_at AS createdAt FROM order_events WHERE order_id = ? ORDER BY sequence`).all(id),
      communications: this.db.prepare(`SELECT id, message, status, actor, created_at AS createdAt FROM order_communications WHERE order_id = ? ORDER BY rowid`).all(id),
    };
  }

  create(body: Row, actor: string, imported = false, checkoutKey?: string): Row {
    const key = checkoutKey ?? (body.idempotencyKey === undefined ? undefined : hash(`capture:${text(body.idempotencyKey, "Submission key", 100)}`));
    return this.transaction(() => this.insert(body, actor, imported, key));
  }
  private insert(body: Row, actor: string, imported = false, checkoutKey?: string): Row {
    const channel = this.channel(body.channel);
    const externalId = optional(body.externalId, "External order ID", 150);
    if (imported && !externalId) fail("Imported orders require externalId.");
    if (body.status !== undefined && body.status !== "pending") fail("New orders must start at received.");
    if (body.stage !== undefined && body.stage !== "received") fail("New orders must start at received.");
    const existing = (checkoutKey ? this.db.prepare("SELECT id FROM orders WHERE checkout_key = ?").get(checkoutKey) : undefined)
      ?? (externalId ? this.db.prepare("SELECT id FROM orders WHERE channel = ? AND external_id = ?").get(channel, externalId) : undefined);
    if (existing) return { ...this.get(String(existing.id)), duplicate: true };
    const currency = this.currency(body.currency ?? "PHP");
    const items = this.lines(body.items, currency);
    const locationId = this.location(body.locationId);
    const customerId = optional(body.customerId, "Customer ID");
    const customer = customerId ? this.db.prepare("SELECT * FROM customers WHERE id = ?").get(customerId) : undefined;
    if (customerId && !customer) fail("Customer not found.", 404);
    const customerName = customer ? String(customer.name) : text(body.customerName, "Customer name");
    const customerEmail = optional(body.customerEmail ?? customer?.email, "Customer email", 254);
    if (customerEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(customerEmail)) fail("Enter a valid customer email.");
    const phone = optional(body.customerPhone ?? customer?.phone, "Phone", 50);
    const address = optional(body.shippingAddress ?? customer?.address, "Shipping address", 1000);
    const id = randomUUID();
    const now = new Date().toISOString();
    const resolvedCustomerId = customerId ?? randomUUID();
    if (!customerId) {
      this.db.prepare(`INSERT INTO customers (id, name, email, phone, address, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)`).run(resolvedCustomerId, customerName, customerEmail, phone, address, now, now);
    }
    const totalMinor = items.reduce((sum, item) => sum + item.totalMinor, 0);
    const orderNumber = `SO-${new Date().getFullYear()}-${id.replaceAll("-", "").toUpperCase()}`;
    this.db.prepare(`INSERT INTO orders (id, order_number, customer_id, customer_name, status, stage, channel,
      external_id, location_id, total_minor, currency, notes, customer_email, customer_phone, shipping_address,
      tracking_token, checkout_key, created_at, updated_at)
      VALUES (?, ?, ?, ?, 'pending', 'received', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(id, orderNumber, resolvedCustomerId, customerName, channel, externalId, locationId, totalMinor, currency,
        optional(body.notes, "Notes", 2000), customerEmail, phone, address, randomBytes(32).toString("base64url"), checkoutKey ?? null, now, now);
    for (const item of items) {
      this.db.prepare(`INSERT INTO order_items (id, order_id, variant_id, description, sku, uom, quantity, unit_price_minor, total_minor)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(randomUUID(), id, item.variantId, item.description, item.sku, item.uom, item.quantity, item.unitPriceMinor, item.totalMinor);
    }
    this.event(id, "received", imported ? "Imported order received." : "Order received. Awaiting payment verification.", actor);
    return this.get(id);
  }

  submitPayment(id: string, body: Row, actor: string): Row {
    return this.transaction(() => {
      const order = this.raw(id);
      if (order.stage !== "received") fail("Payments can only be submitted for orders awaiting verification.", 409);
      const amount = integer(body.amountMinor, "Payment amount");
      const currency = this.currency(body.currency);
      if (amount !== order.total_minor || currency !== order.currency) fail("Payment amount and currency must match the full order total.");
      if (this.db.prepare("SELECT 1 FROM order_payments WHERE order_id = ? AND status = 'submitted'").get(id)) fail("Review the existing payment submission first.", 409);
      const reference = body.reference === undefined || (typeof body.reference === "string" && !body.reference.trim())
        ? `PAY-${randomUUID().toUpperCase()}`
        : text(body.reference, "Payment reference", 150);
      this.db.prepare(`INSERT INTO order_payments (id, order_id, method, reference, amount_minor, currency, status, created_at)
        VALUES (?, ?, ?, ?, ?, ?, 'submitted', ?)`).run(randomUUID(), id, text(body.method, "Payment method", 50),
          reference, amount, currency, new Date().toISOString());
      this.event(id, String(order.stage), "Payment reference submitted; not yet verified.", actor);
      return this.get(id);
    });
  }

  reviewPayment(id: string, body: Row, actor: Actor, approve: boolean): Row {
    this.admin(actor);
    return this.transaction(() => {
      const order = this.raw(id);
      const paymentId = text(body.paymentId, "Payment ID");
      const payment = this.db.prepare("SELECT * FROM order_payments WHERE id = ? AND order_id = ?").get(paymentId, id);
      if (!payment || payment.status !== "submitted" || order.stage !== "received") fail("Payment is not awaiting review.", 409);
      const note = approve ? optional(body.note, "Verification note", 1000) : text(body.note, "Rejection reason", 1000);
      if (approve) {
        const items = this.db.prepare(`SELECT i.variant_id, i.sku, i.uom, i.quantity
          FROM order_items i WHERE i.order_id = ?`).all(id);
        if (!items.length) fail("An order must have inventory-linked items before verification.", 409);
        const reservations = items.map((item) => {
          const variant = item.variant_id
            ? this.db.prepare("SELECT id, uom FROM variants WHERE id = ?").get(String(item.variant_id))
            : this.db.prepare("SELECT id, uom FROM variants WHERE sku = ?").get(String(item.sku));
          if (!variant) fail("A legacy order item cannot be matched to inventory. Cancel and recreate the order with catalog items.", 409);
          if (item.variant_id && variant.uom !== item.uom) fail("The catalog UOM changed since this order was received. Cancel and recreate it.", 409);
          this.db.prepare("UPDATE order_items SET variant_id = ?, uom = ? WHERE order_id = ? AND sku = ?")
            .run(String(variant.id), String(variant.uom), id, String(item.sku));
          return { variantId: String(variant.id), locationId: String(order.location_id), quantity: Number(item.quantity) };
        });
        this.inventory.reserveStock(id, reservations, { allowInactiveProduct: true });
        this.setStage(id, "payment_verified");
      }
      this.db.prepare(`UPDATE order_payments SET status = ?, review_note = ?, reviewed_by = ?, reviewed_at = ? WHERE id = ?`)
        .run(approve ? "verified" : "rejected", note, actor.id, new Date().toISOString(), paymentId);
      this.event(id, approve ? "payment_verified" : "received",
        approve ? "Payment manually verified and inventory reserved." : "Payment rejected. Submit a new reference.", actor.name);
      return this.get(id);
    });
  }

  transition(id: string, body: Row, actor: Actor): Row {
    return this.transaction(() => {
      const order = this.raw(id);
      const stage = STAGES.find((stage) => stage === text(body.stage, "Order stage"));
      if (!stage) fail("Invalid order stage.");
      const current = String(order.stage);
      if (current === stage) return this.get(id);
      const next: Record<string, Stage> = { payment_verified: "packing", packing: "shipped", shipped: "delivered", delivered: "completed" };
      if (stage === "cancelled") {
        if (!["received", "payment_verified", "packing"].includes(current)) fail("Dispatched orders cannot be cancelled. Returns require a separate workflow.", 409);
        this.inventory.releaseReservation(id);
      } else if (next[current] !== stage) {
        fail("Invalid transition. Verify payment and follow the order workflow.", 409);
      }
      if (stage === "shipped") {
        const carrier = text(body.carrier, "Carrier", 100);
        const trackingNumber = body.trackingNumber === undefined || (typeof body.trackingNumber === "string" && !body.trackingNumber.trim())
          ? `SO-TRACK-${randomUUID().toUpperCase()}`
          : text(body.trackingNumber, "Tracking number", 150);
        if (!order.shipping_address || !order.customer_phone) fail("A shipping address and customer phone are required before dispatch.", 409);
        this.inventory.fulfillReservation(id);
        this.db.prepare("UPDATE orders SET carrier = ?, tracking_number = ? WHERE id = ?").run(carrier, trackingNumber, id);
      }
      if (stage === "completed") {
        this.db.prepare(`INSERT INTO sales (id, order_id, customer_id, customer_name, description,
          amount_minor, currency, channel, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
          .run(randomUUID(), id, order.customer_id ? String(order.customer_id) : null, String(order.customer_name), `Completed order ${order.order_number}`,
            Number(order.total_minor), String(order.currency), String(order.channel), new Date().toISOString());
      }
      this.setStage(id, stage);
      this.event(id, stage, stage === "cancelled" ? "Order cancelled. Reserved stock released; verified payments require a refund." : `Order ${stage}.`, actor.name);
      return this.get(id);
    });
  }

  private setStage(id: string, stage: Stage): void {
    const status = stage === "received" ? "pending" : ["payment_verified", "packing"].includes(stage) ? "processing" : stage === "completed" ? "delivered" : stage;
    this.db.prepare("UPDATE orders SET stage = ?, status = ?, updated_at = ? WHERE id = ?").run(stage, status, new Date().toISOString(), id);
  }

  updateShipping(id: string, body: Row, actor: Actor): Row {
    return this.transaction(() => {
      const order = this.raw(id);
      if (!["received", "payment_verified", "packing"].includes(String(order.stage))) fail("Shipping details are locked after dispatch or cancellation.", 409);
      this.db.prepare("UPDATE orders SET customer_phone = ?, shipping_address = ?, updated_at = ? WHERE id = ?")
        .run(text(body.customerPhone, "Customer phone", 50), text(body.shippingAddress, "Shipping address", 1000), new Date().toISOString(), id);
      this.event(id, String(order.stage), "Shipping details updated.", actor.name);
      return this.get(id);
    });
  }

  refund(id: string, body: Row, actor: Actor): Row {
    this.admin(actor);
    return this.transaction(() => {
      const order = this.raw(id);
      if (order.stage !== "cancelled") fail("Only cancelled, unshipped orders support this manual refund workflow.", 409);
      const note = text(body.note, "Refund reference / note", 1000);
      const result = this.db.prepare(`UPDATE order_payments SET status = 'refunded', review_note = ?, reviewed_by = ?, reviewed_at = ?
        WHERE order_id = ? AND status = 'verified'`).run(note, actor.id, new Date().toISOString(), id);
      if (!result.changes) fail("No verified payment is awaiting refund.", 409);
      this.event(id, "cancelled", "Seller recorded a manual refund.", actor.name);
      return this.get(id);
    });
  }

  communicate(id: string, body: Row, actor: Actor): Row {
    const order = this.raw(id);
    const status = text(body.status, "Communication status");
    if (!["prepared", "sent"].includes(status)) fail("Choose prepared or sent.");
    this.db.prepare(`INSERT INTO order_communications (id, order_id, message, status, actor, created_at)
      VALUES (?, ?, ?, ?, ?, ?)`).run(randomUUID(), id, text(body.message, "Customer message", 2000), status, actor.name, new Date().toISOString());
    return this.get(String(order.id));
  }

  links(): Row[] {
    return this.db.prepare(`SELECT id, title, channel, currency, active, expires_at AS expiresAt,
      '/checkout/' || token AS checkoutPath FROM checkout_links ORDER BY created_at DESC LIMIT 200`).all();
  }
  createLink(body: Row): Row {
    const currency = this.currency(body.currency ?? "PHP");
    const items = this.lines(body.items, currency);
    if (new Set(items.map((item) => item.variantId)).size !== items.length) fail("Each product variant can appear only once in a checkout link.");
    const days = integer(body.validDays ?? 7, "Validity days", 1);
    if (days > 90) fail("Checkout links can last at most 90 days.");
    const id = randomUUID();
    this.db.prepare(`INSERT INTO checkout_links (id, token, title, channel, location_id, currency, items_json, expires_at, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(id, randomBytes(32).toString("base64url"), text(body.title, "Link title"),
        this.channel(body.channel ?? "Shareable Order Link"), this.location(body.locationId), currency, JSON.stringify(items),
        new Date(Date.now() + days * 86400000).toISOString(), new Date().toISOString());
    return this.links().find((link) => link.id === id) ?? fail("Created link not found.", 500);
  }
  disableLink(id: string): void {
    if (!this.db.prepare("UPDATE checkout_links SET active = 0 WHERE id = ?").run(id).changes) fail("Checkout link not found.", 404);
  }
  private link(token: string): Row {
    return this.db.prepare("SELECT * FROM checkout_links WHERE token = ? AND active = 1 AND expires_at > ?")
      .get(token, new Date().toISOString()) ?? fail("Checkout link is unavailable or expired.", 404);
  }
  checkout(token: string): Row {
    const link = this.link(token);
    const items = JSON.parse(String(link.items_json)) as Line[];
    return {
      title: link.title, currency: link.currency, expiresAt: link.expires_at,
      items: items.map((item) => {
        const available = this.inventory.listStock({ variantId: item.variantId, locationId: String(link.location_id) }) as Row[];
        const variant = this.db.prepare(`SELECT v.uom, v.currency, v.active, p.active AS product_active
          FROM variants v JOIN products p ON p.id = v.product_id WHERE v.id = ?`).get(item.variantId);
        const active = variant && variant.active && variant.product_active && variant.currency === link.currency && variant.uom === item.uom;
        return { variantId: item.variantId, description: item.description, uom: item.uom, unitPriceMinor: item.unitPriceMinor,
          maxQuantity: active ? Number(available[0]?.quantityAvailable ?? 0) : 0 };
      }),
    };
  }
  submitCheckout(token: string, body: Row): Row {
    return this.transaction(() => {
      const key = text(body.idempotencyKey, "Submission key", 100);
      const checkoutKey = hash(`${token}:${key}`);
      const existing = this.db.prepare("SELECT tracking_token FROM orders WHERE checkout_key = ?").get(checkoutKey);
      if (existing) return this.track(String(existing.tracking_token));
      const link = this.link(token);
      const offered = JSON.parse(String(link.items_json)) as Line[];
      if (!Array.isArray(body.items) || !body.items.length || body.items.length > 50) fail("Choose at least one checkout item.");
      const available = this.checkout(token).items as Row[];
      const requested = new Map<string, number>();
      for (const value of body.items) {
        const item = record(value);
        const id = text(item.variantId, "Variant ID");
        if (!offered.some((line) => line.variantId === id)) fail("This product is not offered by the checkout link.");
        requested.set(id, (requested.get(id) ?? 0) + integer(item.quantity, "Quantity", 1));
      }
      for (const [id, quantity] of requested) {
        if (quantity > Number(available.find((item) => item.variantId === id)?.maxQuantity ?? 0)) fail("Requested quantity exceeds available stock.", 409);
      }
      const order = this.insert({
        customerName: body.customerName, customerEmail: body.customerEmail,
        customerPhone: text(body.customerPhone, "Phone", 50), shippingAddress: text(body.shippingAddress, "Shipping address", 1000),
        channel: link.channel, currency: link.currency, locationId: link.location_id,
        items: [...requested].map(([id, quantity]) => ({ variantId: id, quantity, unitPriceMinor: offered.find((line) => line.variantId === id)!.unitPriceMinor })),
      }, "Customer checkout", false, checkoutKey);
      return this.track(String(this.raw(String(order.id)).tracking_token));
    });
  }
  trackingOrder(token: string): string {
    const order = this.db.prepare("SELECT id FROM orders WHERE tracking_token = ?").get(token);
    return order ? String(order.id) : fail("Tracking link not found.", 404);
  }
  track(token: string): Row {
    const order = this.get(this.trackingOrder(token));
    const payments = order.payments as Row[];
    return {
      orderNumber: order.orderNumber, stage: order.stage, currency: order.currency, totalMinor: order.totalMinor,
      carrier: order.carrier, trackingNumber: order.trackingNumber, trackingPath: `/track/${token}`, refundDue: order.refundDue,
      paymentStatus: payments.length ? payments[payments.length - 1].status : "unpaid",
      items: (order.items as Row[]).map((item) => ({ description: item.description, quantity: item.quantity, uom: item.uom, unitPriceMinor: item.unitPriceMinor, totalMinor: item.totalMinor })),
      timeline: (order.timeline as Row[]).map((event) => ({ sequence: event.sequence, stage: event.stage, message: event.message, createdAt: event.createdAt })),
      messages: (order.communications as Row[]).filter((message) => message.status === "sent").map((message) => ({ id: message.id, message: message.message, createdAt: message.createdAt })),
    };
  }
}
