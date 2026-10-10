import { DatabaseSync } from "node:sqlite";
import { InventoryError } from "@sellerone/inventory-service";
import { isRole, type Role } from "./roles.js";

export interface AlertRule {
  variantId: string;
  lowEnabled: boolean;
  lowThreshold: number | null;
  outEnabled: boolean;
  reorderThreshold: number | null;
}
interface Recipients { roles: Role[]; userIds: string[] }
const defaults: Recipients = { roles: ["owner", "admin", "staff", "inventory_controller", "order_processing_specialist"], userIds: [] };
function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new InventoryError("Provide an inventory alert configuration object.", 400);
  return value as Record<string, unknown>;
}
function threshold(value: unknown, label: string): number | null {
  if (value === null) return null;
  if (!Number.isSafeInteger(value) || Number(value) < 0) throw new InventoryError(`${label} must be a non-negative whole number or null.`, 400);
  return Number(value);
}

export class InventoryAlertSettings {
  constructor(private readonly db: DatabaseSync) {
    db.exec(`CREATE TABLE IF NOT EXISTS inventory_alert_rules (
      variant_id TEXT PRIMARY KEY REFERENCES variants(id),
      low_enabled INTEGER NOT NULL CHECK(low_enabled IN (0,1)),
      low_threshold INTEGER,
      out_enabled INTEGER NOT NULL CHECK(out_enabled IN (0,1)),
      reorder_threshold INTEGER
    );
    CREATE TABLE IF NOT EXISTS inventory_alert_recipients (
      id INTEGER PRIMARY KEY CHECK(id = 1), config_json TEXT NOT NULL
    );`);
  }
  rules(): AlertRule[] {
    return this.db.prepare("SELECT * FROM inventory_alert_rules").all().map((row) => ({
      variantId: String(row.variant_id), lowEnabled: Boolean(row.low_enabled),
      lowThreshold: row.low_threshold === null ? null : Number(row.low_threshold),
      outEnabled: Boolean(row.out_enabled), reorderThreshold: row.reorder_threshold === null ? null : Number(row.reorder_threshold),
    }));
  }
  recipients(): Recipients {
    const row = this.db.prepare("SELECT config_json FROM inventory_alert_recipients WHERE id = 1").get();
    return row ? JSON.parse(String(row.config_json)) as Recipients : defaults;
  }
  receives(userId: string): boolean {
    const user = this.db.prepare("SELECT role FROM users WHERE id = ? AND active = 1").get(userId);
    const recipients = this.recipients();
    return !!user && (recipients.userIds.includes(userId) || recipients.roles.some((role) => role === user.role));
  }
  read(): object {
    return {
      rules: this.rules(), recipients: this.recipients(),
      variants: this.db.prepare(`SELECT v.id, v.name, v.sku, v.uom, v.reorder_point AS minimum,
        p.name AS productName FROM variants v JOIN products p ON p.id = v.product_id
        WHERE v.active = 1 AND p.active = 1 ORDER BY p.name, v.name`).all(),
      users: this.db.prepare("SELECT id, name, role, active FROM users ORDER BY name").all(),
    };
  }
  save(value: unknown): void {
    const body = record(value);
    if (!Array.isArray(body.rules) || body.rules.length > 1000) throw new InventoryError("Provide at most 1000 SKU alert rules.", 400);
    const rules: AlertRule[] = body.rules.map((value) => {
      const row = record(value);
      if (typeof row.variantId !== "string" || !this.db.prepare("SELECT id FROM variants WHERE id = ?").get(row.variantId)) throw new InventoryError("Choose an existing variant/SKU.", 400);
      if (typeof row.lowEnabled !== "boolean" || typeof row.outEnabled !== "boolean") throw new InventoryError("Alert switches must be true or false.", 400);
      return { variantId: row.variantId, lowEnabled: row.lowEnabled, outEnabled: row.outEnabled,
        lowThreshold: threshold(row.lowThreshold, "Low-stock threshold"), reorderThreshold: threshold(row.reorderThreshold, "Reorder threshold") };
    });
    if (new Set(rules.map((rule) => rule.variantId)).size !== rules.length) throw new InventoryError("Each SKU can have only one alert rule.", 400);
    const recipients = record(body.recipients);
    if (!Array.isArray(recipients.roles) || !Array.isArray(recipients.userIds) || recipients.roles.length > 6 || recipients.userIds.length > 1000) throw new InventoryError("Provide recipient roles and users.", 400);
    const roles = recipients.roles.map((role) => {
      if (!isRole(role)) throw new InventoryError("Invalid recipient role.", 400);
      return role;
    });
    const userIds = recipients.userIds.map((id) => {
      if (typeof id !== "string" || !this.db.prepare("SELECT id FROM users WHERE id = ? AND active = 1").get(id)) throw new InventoryError("Choose active users as recipients.", 400);
      return id;
    });
    if (new Set(roles).size !== roles.length || new Set(userIds).size !== userIds.length) throw new InventoryError("Duplicate alert recipients are not allowed.", 400);
    this.db.exec("SAVEPOINT save_inventory_alerts");
    try {
      this.db.prepare("DELETE FROM inventory_alert_rules").run();
      const insert = this.db.prepare("INSERT INTO inventory_alert_rules VALUES (?, ?, ?, ?, ?)");
      for (const rule of rules) insert.run(rule.variantId, Number(rule.lowEnabled), rule.lowThreshold, Number(rule.outEnabled), rule.reorderThreshold);
      this.db.prepare("INSERT INTO inventory_alert_recipients VALUES (1, ?) ON CONFLICT(id) DO UPDATE SET config_json = excluded.config_json")
        .run(JSON.stringify({ roles, userIds }));
      this.db.exec("RELEASE save_inventory_alerts");
    } catch (error) { this.db.exec("ROLLBACK TO save_inventory_alerts; RELEASE save_inventory_alerts"); throw error; }
  }
}
