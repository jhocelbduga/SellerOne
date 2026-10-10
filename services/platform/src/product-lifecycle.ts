import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { InventoryError } from "@sellerone/inventory-service";
import type { Role } from "./roles.js";

export const retirementReasons = [
  "End of Life (EOL)", "Product Phase-Out", "Product Discontinued",
  "Duplicate Product Record", "Incorrect Product Setup", "Supplier No Longer Available",
  "Regulatory or Compliance Requirements", "Other",
] as const;
const stakeholderRoles = ["owner", "admin", "inventory_controller"];
export class ProductLifecycle {
  constructor(private readonly db: DatabaseSync) {
    db.exec(`CREATE TABLE IF NOT EXISTS product_lifecycle (
      product_id TEXT PRIMARY KEY REFERENCES products(id),
      status TEXT NOT NULL CHECK(status IN ('active','phase_out','eol','discontinued','archived'))
    );
    CREATE TABLE IF NOT EXISTS product_lifecycle_events (
      id TEXT PRIMARY KEY, product_id TEXT NOT NULL REFERENCES products(id), product_name TEXT NOT NULL,
      action TEXT NOT NULL, reason TEXT NOT NULL, comments TEXT NOT NULL,
      actor_id TEXT NOT NULL, actor_name TEXT NOT NULL, actor_role TEXT NOT NULL,
      created_at TEXT NOT NULL, previous_status TEXT NOT NULL, new_status TEXT NOT NULL,
      request_key TEXT NOT NULL UNIQUE
    );
    CREATE TABLE IF NOT EXISTS product_lifecycle_notifications (
      event_id TEXT NOT NULL REFERENCES product_lifecycle_events(id),
      user_id TEXT NOT NULL REFERENCES users(id), read_at TEXT,
      PRIMARY KEY(event_id,user_id)
    );`);
  }
  status(id: string): string {
    const product = this.db.prepare("SELECT active FROM products WHERE id = ?").get(id);
    if (!product) throw new InventoryError("Product not found.", 404);
    return String(this.db.prepare("SELECT status FROM product_lifecycle WHERE product_id = ?").get(id)?.status ?? (product.active ? "active" : "archived"));
  }
  history(id: string): object {
    return { status: this.status(id), items: this.db.prepare(`SELECT id, product_id AS productId, product_name AS productName,
      action, reason, comments, actor_id AS actorId, actor_name AS actorName, actor_role AS actorRole,
      created_at AS createdAt, previous_status AS previousStatus, new_status AS newStatus
      FROM product_lifecycle_events WHERE product_id = ? ORDER BY created_at DESC, rowid DESC`).all(id) };
  }
  change(id: string, body: Record<string, unknown>, actor: { id: string; name: string; role: Role }): object {
    if (!["owner", "admin"].includes(actor.role)) throw new InventoryError("Only Workspace Owners and Admins may retire products.", 403);
    if (typeof body.reason !== "string" || !retirementReasons.some((reason) => reason === body.reason)) throw new InventoryError("Select a valid retirement reason.", 400);
    if (body.comments !== undefined && (typeof body.comments !== "string" || body.comments.length > 2000)) throw new InventoryError("Comments must be at most 2,000 characters.", 400);
    const comments = typeof body.comments === "string" ? body.comments.trim() : "";
    if (body.reason === "Other" && !comments) throw new InventoryError("Explain the reason when Other is selected.", 400);
    if (typeof body.action !== "string" || !["delete", "archive", "deactivate", "restore"].includes(body.action)) throw new InventoryError("Choose Delete Product, Archive Product, Deactivate Product or Restore Product.", 400);
    if (body.action === "restore" && !comments) throw new InventoryError("Explain why this product should be restored.", 400);
    if (body.confirmed !== true) throw new InventoryError("Confirm the product lifecycle change before proceeding.", 400);
    if (typeof body.requestKey !== "string" || !/^[A-Za-z0-9-]{16,100}$/.test(body.requestKey)) throw new InventoryError("A valid transaction key is required.", 400);
    const status = body.action === "restore" ? "active" : body.action === "archive" ? "archived" : body.action === "deactivate" ? "discontinued"
      : body.reason === "End of Life (EOL)" ? "eol" : body.reason === "Product Phase-Out" ? "phase_out" : body.reason === "Product Discontinued" ? "discontinued" : "archived";
    this.db.exec("SAVEPOINT product_retirement");
    try {
      const retry = this.db.prepare("SELECT * FROM product_lifecycle_events WHERE request_key = ?").get(body.requestKey);
      if (retry) {
        if (retry.product_id !== id || retry.actor_id !== actor.id || retry.action !== body.action || retry.reason !== body.reason || retry.comments !== comments) throw new InventoryError("Transaction key already belongs to a different retirement request.", 409);
        this.db.exec("RELEASE product_retirement"); return this.history(id);
      }
      const previous = this.status(id);
      if (body.expectedStatus !== previous) throw new InventoryError("Product lifecycle changed. Refresh the product and review its current status.", 409);
      if (status === previous) throw new InventoryError("This product already has the selected lifecycle status. Choose a different action.", 409);
      const product = this.db.prepare("SELECT name FROM products WHERE id = ?").get(id)!;
      const eventId = randomUUID(); const now = new Date().toISOString();
      this.db.prepare("INSERT INTO product_lifecycle VALUES (?, ?) ON CONFLICT(product_id) DO UPDATE SET status=excluded.status").run(id, status);
      this.db.prepare("UPDATE products SET active = ?, updated_at = ? WHERE id = ?").run(Number(["active", "phase_out"].includes(status)), now, id);
      this.db.prepare("INSERT INTO product_lifecycle_events VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").run(eventId, id, String(product.name), String(body.action), body.reason, comments, actor.id, actor.name, actor.role, now, previous, status, body.requestKey);
      for (const user of this.db.prepare("SELECT id, role FROM users WHERE active = 1").all()) {
        if (stakeholderRoles.includes(String(user.role))) this.db.prepare("INSERT INTO product_lifecycle_notifications VALUES (?, ?, NULL)").run(eventId, String(user.id));
      }
      this.db.exec("RELEASE product_retirement"); return this.history(id);
    } catch (error) { this.db.exec("ROLLBACK TO product_retirement; RELEASE product_retirement"); throw error; }
  }
  notifications(userId: string): Record<string, unknown>[] {
    return this.db.prepare(`SELECT e.id, e.product_id AS productId, e.product_name AS productName,
      e.reason, e.comments, e.action, e.actor_name AS actorName, e.actor_role AS actorRole,
      e.previous_status AS previousStatus, e.new_status AS newStatus, e.created_at AS createdAt, n.read_at AS readAt
      FROM product_lifecycle_notifications n JOIN product_lifecycle_events e ON e.id = n.event_id
      JOIN users u ON u.id = n.user_id WHERE n.user_id = ? AND u.active = 1
      AND u.role IN ('owner','admin','inventory_controller') AND n.read_at IS NULL
      ORDER BY e.created_at DESC, e.rowid DESC`).all(userId).map((row) => ({ ...row, kind: "product_lifecycle", status: "unread" }));
  }
  view(id: string, userId: string): Record<string, unknown> | null {
    const event = this.db.prepare(`SELECT e.id, e.product_id AS productId, e.product_name AS productName,
      e.reason, e.comments, e.action, e.actor_name AS actorName, e.actor_role AS actorRole,
      e.previous_status AS previousStatus, e.new_status AS newStatus, e.created_at AS createdAt
      FROM product_lifecycle_events e JOIN product_lifecycle_notifications n ON n.event_id = e.id
      JOIN users u ON u.id = n.user_id WHERE e.id = ? AND n.user_id = ? AND u.active = 1
      AND u.role IN ('owner','admin','inventory_controller')`).get(id, userId);
    if (!event) return null;
    const now = new Date().toISOString();
    this.db.prepare("UPDATE product_lifecycle_notifications SET read_at = COALESCE(read_at, ?) WHERE event_id = ? AND user_id = ?").run(now, id, userId);
    const readAt = this.db.prepare("SELECT read_at FROM product_lifecycle_notifications WHERE event_id = ? AND user_id = ?").get(id, userId)!.read_at;
    return { ...event, kind: "product_lifecycle", status: "read", readAt };
  }
}
