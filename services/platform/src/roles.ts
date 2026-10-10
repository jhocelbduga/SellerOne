import { DatabaseSync } from "node:sqlite";

export const ROLES = ["owner", "admin", "staff", "inventory_controller", "order_processing_specialist", "customer_relations_representative"] as const;
export type Role = typeof ROLES[number];
export function isRole(value: unknown): value is Role {
  return typeof value === "string" && ROLES.some((role) => role === value);
}
export function isAdmin(role: Role): boolean {
  return role === "owner" || role === "admin";
}

export function canAccessApi(role: Role, resource: string, method: string): boolean {
  if (resource === "product-lifecycle") return method === "GET" ? canAccessApi(role, "products", "GET") : isAdmin(role);
  if (["products", "variants", "raw-material-bom"].includes(resource) && method !== "GET") return role === "owner";
  if (resource === "product-images") return canAccessApi(role, "products", "GET") && method === "GET";
  if (["me", "profile-pictures", "notifications"].includes(resource)) return true;
  if (isAdmin(role) || role === "staff") return true;
  const inventory = ["products", "variants", "stock", "batches", "locations", "adjustments", "transfers", "valuation", "movements", "alerts"];
  if (role === "inventory_controller") return inventory.includes(resource) || (resource === "raw-material-bom" && method === "GET") || resource === "notifications";
  if (role === "order_processing_specialist") return ["orders", "commerce", "notifications"].includes(resource)
    || (method === "GET" && ["products", "locations", "stock", "customers"].includes(resource));
  return resource === "customers";
}

export function migrateWorkspaceRoles(db: DatabaseSync): void {
  const legacy = ["users", "invitations"].filter((table) => {
    const row = db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ?").get(table);
    return row && !String(row.sql).includes("'inventory_controller'");
  });
  if (!legacy.length) return;
  db.exec("PRAGMA foreign_keys = OFF");
  db.exec("BEGIN IMMEDIATE");
  try {
    if (legacy.includes("users")) {
      db.exec(`CREATE TABLE users_roles_new (
        id TEXT PRIMARY KEY, name TEXT NOT NULL, email TEXT NOT NULL UNIQUE COLLATE NOCASE,
        password_hash TEXT NOT NULL,
        role TEXT NOT NULL CHECK (role IN ('owner', 'admin', 'staff', 'inventory_controller', 'order_processing_specialist', 'customer_relations_representative')),
        active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)), created_at TEXT NOT NULL
      );
      INSERT INTO users_roles_new SELECT id, name, email, password_hash, role, active, created_at FROM users;
      DROP TABLE users;
      ALTER TABLE users_roles_new RENAME TO users;`);
    }
    if (legacy.includes("invitations")) {
      db.exec(`CREATE TABLE invitations_roles_new (
        token_hash TEXT PRIMARY KEY, email TEXT NOT NULL COLLATE NOCASE, name TEXT NOT NULL,
        role TEXT NOT NULL CHECK (role IN ('admin', 'staff', 'inventory_controller', 'order_processing_specialist', 'customer_relations_representative')),
        expires_at TEXT NOT NULL, created_at TEXT NOT NULL
      );
      INSERT INTO invitations_roles_new SELECT token_hash, email, name, role, expires_at, created_at FROM invitations;
      DROP TABLE invitations;
      ALTER TABLE invitations_roles_new RENAME TO invitations;`);
    }
    if (db.prepare("PRAGMA foreign_key_check").all().length) throw new Error("Workspace role migration failed its foreign-key integrity check.");
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  } finally { db.exec("PRAGMA foreign_keys = ON"); }
}
