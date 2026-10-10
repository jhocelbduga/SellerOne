import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { InventoryError, InventoryStore } from "@sellerone/inventory-service";
import { InventoryAlertSettings } from "./inventory-alerts.js";
import { ProductLifecycle } from "./product-lifecycle.js";

export class NotificationStore {
  readonly settings: InventoryAlertSettings;
  readonly lifecycle: ProductLifecycle;
  constructor(private readonly db: DatabaseSync, private readonly inventory: InventoryStore) {
    this.settings = new InventoryAlertSettings(db);
    this.lifecycle = new ProductLifecycle(db);
    db.exec(`
      CREATE TABLE IF NOT EXISTS stock_notifications (
        id TEXT PRIMARY KEY,
        variant_id TEXT NOT NULL REFERENCES variants(id),
        location_id TEXT NOT NULL REFERENCES locations(id),
        details_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        resolved_at TEXT
      );
      CREATE TABLE IF NOT EXISTS notification_reads (
        notification_id TEXT NOT NULL REFERENCES stock_notifications(id),
        user_id TEXT NOT NULL REFERENCES users(id),
        read_at TEXT NOT NULL,
        PRIMARY KEY (notification_id, user_id)
      );
    `);
    if (!db.prepare("PRAGMA table_info(stock_notifications)").all().some((row) => row.name === "kind")) {
      db.exec("ALTER TABLE stock_notifications ADD COLUMN kind TEXT NOT NULL DEFAULT 'low_stock'");
    }
    db.exec(`DROP INDEX IF EXISTS stock_notification_active;
      CREATE UNIQUE INDEX IF NOT EXISTS stock_notification_active_kind
      ON stock_notifications (variant_id, location_id, kind) WHERE resolved_at IS NULL;`);
  }

  sync(): void {
    const rules = new Map(this.settings.rules().map((rule) => [rule.variantId, rule]));
    const enabled = new Set(this.db.prepare("SELECT v.id FROM variants v JOIN products p ON p.id = v.product_id WHERE v.active = 1 AND p.active = 1").all().map((row) => String(row.id)));
    const low = (this.inventory.listStock({}) as Record<string, unknown>[]).filter((row) => enabled.has(String(row.variantId))).flatMap((row) => {
      const rule = rules.get(String(row.variantId));
      const quantity = Number(row.quantityAvailable);
      const minimum = rule?.lowThreshold ?? Number(row.reorderPoint);
      const events: Record<string, unknown>[] = [];
      if (quantity === 0 && (rule?.outEnabled ?? true)) events.push({ ...row, kind: "out_of_stock", threshold: 0 });
      else if ((rule?.lowEnabled ?? true) && quantity <= minimum) events.push({ ...row, kind: "low_stock", threshold: minimum });
      if (rule?.reorderThreshold !== null && rule?.reorderThreshold !== undefined && quantity <= rule.reorderThreshold) events.push({ ...row, kind: "replenishment", threshold: rule.reorderThreshold });
      return events;
    });
    const active = this.db.prepare("SELECT id, variant_id, location_id, kind FROM stock_notifications WHERE resolved_at IS NULL").all();
    const keys = new Set(low.map((row) => JSON.stringify([row.variantId, row.locationId, row.kind])));
    const now = new Date().toISOString();
    this.db.exec("SAVEPOINT sync_notifications");
    try {
      for (const entry of active) {
        if (!keys.has(JSON.stringify([entry.variant_id, entry.location_id, entry.kind]))) {
          this.db.prepare("UPDATE stock_notifications SET resolved_at = ? WHERE id = ?").run(now, String(entry.id));
        }
      }
      for (const row of low) {
        const details = JSON.stringify({
          variantId: row.variantId, locationId: row.locationId, productName: row.productName,
          variantName: row.variantName, sku: row.sku, locationName: row.locationName,
          quantityOnHand: row.quantityOnHand, reorderPoint: row.reorderPoint, uom: row.uom,
          quantityAvailable: row.quantityAvailable, quantityReserved: row.quantityReserved, kind: row.kind, threshold: row.threshold,
        });
        const existing = active.find((entry) => entry.variant_id === row.variantId && entry.location_id === row.locationId && entry.kind === row.kind);
        if (existing) this.db.prepare("UPDATE stock_notifications SET details_json = ? WHERE id = ?").run(details, String(existing.id));
        else this.db.prepare("INSERT INTO stock_notifications (id, variant_id, location_id, details_json, created_at, kind) VALUES (?, ?, ?, ?, ?, ?)").run(randomUUID(), String(row.variantId), String(row.locationId), details, now, String(row.kind));
      }
      this.db.exec("RELEASE sync_notifications");
    } catch (error) {
      this.db.exec("ROLLBACK TO sync_notifications; RELEASE sync_notifications");
      throw error;
    }
  }

  list(userId: string): { items: Record<string, unknown>[]; unreadCount: number } {
    this.sync();
    const items: Record<string, unknown>[] = this.settings.receives(userId) ? this.db.prepare(`
      SELECT n.id, n.details_json, n.created_at AS createdAt, r.read_at AS readAt
      FROM stock_notifications n LEFT JOIN notification_reads r ON r.notification_id = n.id AND r.user_id = ?
      WHERE n.resolved_at IS NULL AND r.read_at IS NULL ORDER BY n.created_at DESC, n.id
    `).all(userId).map(({ details_json, ...row }) => ({
      ...row, ...JSON.parse(String(details_json)) as Record<string, unknown>, status: row.readAt ? "read" : "unread",
    })) : [];
    items.push(...this.lifecycle.notifications(userId));
    items.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)) || String(b.id).localeCompare(String(a.id)));
    return { items, unreadCount: items.length };
  }

  view(id: string, userId: string): { items: Record<string, unknown>[]; unreadCount: number; notification: Record<string, unknown> } {
    this.sync();
    const lifecycle = this.lifecycle.view(id, userId);
    if (lifecycle) return { ...this.list(userId), notification: lifecycle };
    if (!this.settings.receives(userId)) throw new InventoryError("This stock notification is not assigned to you.", 403);
    const entry = this.db.prepare("SELECT id FROM stock_notifications WHERE id = ? AND resolved_at IS NULL").get(id);
    if (!entry) throw new InventoryError("Notification is no longer active. Refresh the notification list.", 404);
    this.db.prepare("INSERT OR IGNORE INTO notification_reads (notification_id, user_id, read_at) VALUES (?, ?, ?)").run(id, userId, new Date().toISOString());
    const result = this.list(userId);
    const viewed = this.db.prepare(`
      SELECT n.id, n.details_json, n.created_at AS createdAt, r.read_at AS readAt
      FROM stock_notifications n JOIN notification_reads r ON r.notification_id = n.id AND r.user_id = ?
      WHERE n.id = ?
    `).get(userId, id)!;
    const { details_json, ...row } = viewed;
    return { ...result, notification: { ...row, ...JSON.parse(String(details_json)) as Record<string, unknown>, status: "read" } };
  }
}
