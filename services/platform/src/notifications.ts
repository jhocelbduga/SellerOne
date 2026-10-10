import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { InventoryError, InventoryStore } from "@sellerone/inventory-service";

export class NotificationStore {
  constructor(private readonly db: DatabaseSync, private readonly inventory: InventoryStore) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS stock_notifications (
        id TEXT PRIMARY KEY,
        variant_id TEXT NOT NULL REFERENCES variants(id),
        location_id TEXT NOT NULL REFERENCES locations(id),
        details_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        resolved_at TEXT
      );
      CREATE UNIQUE INDEX IF NOT EXISTS stock_notification_active
        ON stock_notifications (variant_id, location_id) WHERE resolved_at IS NULL;
      CREATE TABLE IF NOT EXISTS notification_reads (
        notification_id TEXT NOT NULL REFERENCES stock_notifications(id),
        user_id TEXT NOT NULL REFERENCES users(id),
        read_at TEXT NOT NULL,
        PRIMARY KEY (notification_id, user_id)
      );
    `);
  }

  sync(): void {
    const low = this.inventory.listStock({ lowStockOnly: true }) as Record<string, unknown>[];
    const active = this.db.prepare("SELECT id, variant_id, location_id FROM stock_notifications WHERE resolved_at IS NULL").all();
    const keys = new Set(low.map((row) => JSON.stringify([row.variantId, row.locationId])));
    const now = new Date().toISOString();
    this.db.exec("SAVEPOINT sync_notifications");
    try {
      for (const entry of active) {
        if (!keys.has(JSON.stringify([entry.variant_id, entry.location_id]))) {
          this.db.prepare("UPDATE stock_notifications SET resolved_at = ? WHERE id = ?").run(now, String(entry.id));
        }
      }
      for (const row of low) {
        const details = JSON.stringify({
          variantId: row.variantId, locationId: row.locationId, productName: row.productName,
          variantName: row.variantName, sku: row.sku, locationName: row.locationName,
          quantityOnHand: row.quantityOnHand, reorderPoint: row.reorderPoint, uom: row.uom,
        });
        const existing = active.find((entry) => entry.variant_id === row.variantId && entry.location_id === row.locationId);
        if (existing) this.db.prepare("UPDATE stock_notifications SET details_json = ? WHERE id = ?").run(details, String(existing.id));
        else this.db.prepare("INSERT INTO stock_notifications (id, variant_id, location_id, details_json, created_at) VALUES (?, ?, ?, ?, ?)").run(randomUUID(), String(row.variantId), String(row.locationId), details, now);
      }
      this.db.exec("RELEASE sync_notifications");
    } catch (error) {
      this.db.exec("ROLLBACK TO sync_notifications; RELEASE sync_notifications");
      throw error;
    }
  }

  list(userId: string): { items: Record<string, unknown>[]; unreadCount: number } {
    this.sync();
    const items = this.db.prepare(`
      SELECT n.id, n.details_json, n.created_at AS createdAt, r.read_at AS readAt
      FROM stock_notifications n LEFT JOIN notification_reads r ON r.notification_id = n.id AND r.user_id = ?
      WHERE n.resolved_at IS NULL ORDER BY n.created_at DESC, n.id
    `).all(userId).map(({ details_json, ...row }) => ({
      ...row, ...JSON.parse(String(details_json)) as Record<string, unknown>, status: row.readAt ? "read" : "unread",
    }));
    return { items, unreadCount: items.filter((row) => row.status === "unread").length };
  }

  view(id: string, userId: string): { items: Record<string, unknown>[]; unreadCount: number; notification: Record<string, unknown> } {
    this.sync();
    const entry = this.db.prepare("SELECT id FROM stock_notifications WHERE id = ? AND resolved_at IS NULL").get(id);
    if (!entry) throw new InventoryError("Notification is no longer active. Refresh the notification list.", 404);
    this.db.prepare("INSERT OR IGNORE INTO notification_reads (notification_id, user_id, read_at) VALUES (?, ?, ?)").run(id, userId, new Date().toISOString());
    const result = this.list(userId);
    return { ...result, notification: result.items.find((row) => row.id === id)! };
  }
}
