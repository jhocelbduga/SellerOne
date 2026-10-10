import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { InventoryError, InventoryStore } from "@sellerone/inventory-service";
import { decimalMaterialUom } from "./bom.js";
import type { Role } from "./roles.js";

type Row = Record<string, unknown>;
export class ProductionStore {
  constructor(private readonly db: DatabaseSync, private readonly inventory: InventoryStore) {
    db.exec(`CREATE TABLE IF NOT EXISTS production_transactions (
      id TEXT PRIMARY KEY, request_key TEXT NOT NULL UNIQUE, product_id TEXT NOT NULL REFERENCES products(id),
      variant_id TEXT NOT NULL REFERENCES variants(id), location_id TEXT NOT NULL REFERENCES locations(id),
      quantity INTEGER NOT NULL, actor_id TEXT NOT NULL, actor_name TEXT NOT NULL, actor_role TEXT NOT NULL,
      created_at TEXT NOT NULL, note TEXT NOT NULL, materials_json TEXT NOT NULL, cost_minor INTEGER NOT NULL, currency TEXT NOT NULL
    )`);
  }
  history(productId: string): Row[] {
    return this.db.prepare(`SELECT id, variant_id AS variantId, location_id AS locationId, quantity,
      actor_name AS actorName, actor_role AS actorRole, created_at AS createdAt, note, cost_minor AS costMinor, currency,
      materials_json AS materials FROM production_transactions WHERE product_id = ? ORDER BY rowid DESC`).all(productId)
      .map((row) => ({ ...row, materials: JSON.parse(String(row.materials)) }));
  }
  plan(productId: string, variantId: string, quantity: unknown, locationId: string): Row {
    if (typeof quantity !== "number" || !Number.isSafeInteger(quantity) || quantity <= 0 || quantity > 1_000_000) throw new InventoryError("Production quantity must be a whole number from 1 to 1,000,000.", 400);
    if (!this.db.prepare("SELECT 1 FROM locations WHERE id = ?").get(locationId)) throw new InventoryError("Location not found.", 404);
    const output = this.db.prepare(`SELECT v.id, v.uom, v.currency, v.active, p.active AS productActive,
      b.output_quantity, b.output_uom, b.updated_at, s.enabled FROM variants v JOIN products p ON p.id=v.product_id
      LEFT JOIN material_boms b ON b.variant_id=v.id LEFT JOIN product_bom_settings s ON s.product_id=p.id
      WHERE v.id=? AND p.id=?`).get(variantId, productId);
    if (!output || !output.enabled || !output.updated_at) throw new InventoryError("Enable and save this variant's BOM before production.", 409);
    if (!output.active || !output.productActive || output.uom !== output.output_uom) throw new InventoryError("Output is inactive or its BOM UOM changed. Review the product before production.", 409);
    const materials = this.db.prepare(`SELECT c.material_variant_id AS variantId, p.name AS productName,
      v.name, v.sku, v.uom, c.quantity, c.uom AS bomUom, c.description, c.remarks, v.currency, v.active,
      p.active AS productActive, EXISTS(SELECT 1 FROM raw_material_variants r WHERE r.variant_id=v.id) AS classified,
      COALESCE((SELECT SUM(remaining_quantity) FROM batches WHERE variant_id=v.id AND location_id=?),0)
      - COALESCE((SELECT SUM(quantity) FROM stock_reservations WHERE variant_id=v.id AND location_id=?),0) AS available
      FROM material_bom_components c JOIN variants v ON v.id=c.material_variant_id JOIN products p ON p.id=v.product_id
      WHERE c.bom_variant_id=? ORDER BY v.sku`).all(locationId, locationId, variantId).map((row) => {
        if (!row.active || !row.productActive || !row.classified || row.uom !== row.bomUom || row.currency !== output.currency) throw new InventoryError("Components must remain active classified materials with matching stock UOM and output currency.", 409);
        const raw = Number(row.quantity) / Number(output.output_quantity) * quantity;
        const required = Number(raw.toFixed(6));
        if (!Number.isFinite(raw) || raw <= 0 || raw > 1_000_000_000 || Math.abs(raw - required) > 1e-8 || (!decimalMaterialUom(String(row.uom)) && !Number.isSafeInteger(required))) throw new InventoryError(`Unsupported consumption quantity for ${row.sku}. Use whole count quantities or up to six weight/volume decimals.`, 400);
        const available = Number(Number(row.available).toFixed(6));
        return { variantId: row.variantId, productName: row.productName, name: row.name, sku: row.sku, uom: row.uom,
          description: row.description, remarks: row.remarks, usagePerUnit: Number(row.quantity) / Number(output.output_quantity),
          required, available, shortage: Number(Math.max(0, required - available).toFixed(6)) };
      });
    if (!materials.length) throw new InventoryError("Production requires at least one BOM component.", 409);
    return { productId, variantId, quantity, locationId, currency: output.currency, outputUom: output.uom,
      expectedUpdatedAt: output.updated_at, materials, canProduce: materials.every((row) => row.shortage === 0) };
  }
  produce(productId: string, body: Row, actor: { id: string; name: string; role: Role }): Row {
    if (!["owner", "admin", "staff", "inventory_controller"].includes(actor.role)) throw new InventoryError("Your role cannot record production.", 403);
    if (typeof body.requestKey !== "string" || !/^[A-Za-z0-9-]{16,100}$/.test(body.requestKey)) throw new InventoryError("A valid production transaction key is required.", 400);
    if (typeof body.variantId !== "string" || typeof body.locationId !== "string" || body.confirmed !== true) throw new InventoryError("Choose output and location and confirm production.", 400);
    if (body.note !== undefined && (typeof body.note !== "string" || body.note.length > 2000)) throw new InventoryError("Production notes must be at most 2,000 characters.", 400);
    const note = typeof body.note === "string" ? body.note.trim() : "";
    this.db.exec("SAVEPOINT record_production");
    try {
      const prior = this.db.prepare("SELECT * FROM production_transactions WHERE request_key=?").get(body.requestKey);
      if (prior) {
        if (prior.product_id !== productId || prior.variant_id !== body.variantId || prior.location_id !== body.locationId || prior.quantity !== body.quantity || prior.actor_id !== actor.id || prior.note !== note) throw new InventoryError("Transaction key belongs to a different production request.", 409);
        this.db.exec("RELEASE record_production"); return { id: prior.id, duplicate: true };
      }
      const plan = this.plan(productId, body.variantId, body.quantity, body.locationId);
      if (plan.expectedUpdatedAt !== body.expectedUpdatedAt) throw new InventoryError("BOM changed. Refresh the requirements before producing.", 409);
      const materials = plan.materials as Row[];
      if (!plan.canProduce) throw new InventoryError(`Insufficient raw materials: ${materials.filter((r) => Number(r.shortage) > 0).map((r) => `${r.sku}: ${r.shortage} ${r.uom} short`).join("; ")}. Receive stock before retrying.`, 409);
      const id = randomUUID(); let cost = 0;
      for (const material of materials) {
        this.inventory.stockOut({ variantId: String(material.variantId), locationId: body.locationId, quantity: Number(material.required), reference: id, note: `Production component: ${note}` });
        const movement = this.db.prepare("SELECT total_cost_minor FROM movements WHERE reference=? AND variant_id=? ORDER BY sequence DESC LIMIT 1").get(id, String(material.variantId))!;
        cost += Number(movement.total_cost_minor);
      }
      if (!Number.isSafeInteger(cost)) throw new InventoryError("Production cost exceeds the supported amount.", 400);
      const units = Number(body.quantity); const unitCost = Math.floor(cost / units); const remainder = cost % units;
      for (const [quantity, unitCostMinor] of [[units - remainder, unitCost], [remainder, unitCost + 1]]) {
        if (quantity) this.inventory.stockIn({ variantId: body.variantId, locationId: body.locationId, quantity,
          unitCostMinor, reference: id, note: `Production output: ${note}` });
      }
      this.db.prepare("INSERT INTO production_transactions VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").run(
        id, body.requestKey, productId, body.variantId, body.locationId, Number(body.quantity), actor.id, actor.name,
        actor.role, new Date().toISOString(), note, JSON.stringify(materials), cost, String(plan.currency));
      this.db.exec("RELEASE record_production"); return { id, costMinor: cost, materials };
    } catch (error) { this.db.exec("ROLLBACK TO record_production; RELEASE record_production"); throw error; }
  }
}
