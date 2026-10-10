import { DatabaseSync } from "node:sqlite";
import { InventoryError } from "@sellerone/inventory-service";

function quantity(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0 || value > 1_000_000_000) {
    throw new InventoryError(`${label} must be a finite positive number no greater than 1,000,000,000.`, 400);
  }
  return value;
}

export class BomStore {
  constructor(private readonly db: DatabaseSync) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS raw_material_variants (
        variant_id TEXT PRIMARY KEY REFERENCES variants(id)
      );
      CREATE TABLE IF NOT EXISTS material_boms (
        variant_id TEXT PRIMARY KEY REFERENCES variants(id),
        output_quantity REAL NOT NULL CHECK (output_quantity > 0),
        output_uom TEXT NOT NULL,
        notes TEXT NOT NULL DEFAULT '',
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS material_bom_components (
        bom_variant_id TEXT NOT NULL REFERENCES material_boms(variant_id) ON DELETE CASCADE,
        material_variant_id TEXT NOT NULL REFERENCES raw_material_variants(variant_id),
        quantity REAL NOT NULL CHECK (quantity > 0),
        uom TEXT NOT NULL,
        PRIMARY KEY (bom_variant_id, material_variant_id),
        CHECK (bom_variant_id <> material_variant_id)
      );
    `);
  }

  list(): object {
    const variants = this.db.prepare(`
      SELECT v.id, v.name, v.sku, v.uom, v.active, p.name AS productName, p.active AS productActive,
        EXISTS (SELECT 1 FROM raw_material_variants r WHERE r.variant_id = v.id) AS isRawMaterial
      FROM variants v JOIN products p ON p.id = v.product_id ORDER BY p.name, v.name, v.id
    `).all().map((row) => ({ ...row, active: Boolean(row.active && row.productActive), isRawMaterial: Boolean(row.isRawMaterial) }));
    const boms = this.db.prepare(`
      SELECT variant_id AS variantId, output_quantity AS outputQuantity, output_uom AS outputUom,
        notes, updated_at AS updatedAt FROM material_boms ORDER BY variant_id
    `).all().map((bom) => ({
      ...bom,
      components: this.db.prepare(`
        SELECT material_variant_id AS variantId, quantity, uom
        FROM material_bom_components WHERE bom_variant_id = ? ORDER BY material_variant_id
      `).all(String(bom.variantId)),
    }));
    return { variants, boms };
  }

  private variant(id: string): Record<string, unknown> {
    const row = this.db.prepare(`
      SELECT v.id, v.uom, v.active, p.active AS productActive,
        EXISTS (SELECT 1 FROM raw_material_variants r WHERE r.variant_id = v.id) AS isRawMaterial
      FROM variants v JOIN products p ON p.id = v.product_id WHERE v.id = ?
    `).get(id);
    if (!row) throw new InventoryError("Catalog variant not found.", 404);
    return row;
  }

  classify(id: string, isRawMaterial: unknown): void {
    this.variant(id);
    if (typeof isRawMaterial !== "boolean") throw new InventoryError("isRawMaterial must be true or false.", 400);
    if (isRawMaterial) {
      if (this.db.prepare("SELECT 1 FROM material_boms WHERE variant_id = ?").get(id)) {
        throw new InventoryError("Remove this variant's finished-product BOM before classifying it as a raw material.", 409);
      }
      this.db.prepare("INSERT OR IGNORE INTO raw_material_variants (variant_id) VALUES (?)").run(id);
    } else {
      if (this.db.prepare("SELECT 1 FROM material_bom_components WHERE material_variant_id = ?").get(id)) {
        throw new InventoryError("Remove this raw material from its BOMs before clearing its classification.", 409);
      }
      this.db.prepare("DELETE FROM raw_material_variants WHERE variant_id = ?").run(id);
    }
  }

  save(id: string, body: Record<string, unknown>): void {
    const output = this.variant(id);
    if (!output.active || !output.productActive || output.isRawMaterial) {
      throw new InventoryError("BOM output must be an active, non-raw-material catalog variant.", 400);
    }
    const outputQuantity = quantity(body.outputQuantity, "Output quantity");
    if (body.outputUom !== output.uom) throw new InventoryError("Output UOM must match the current catalog UOM. No unit conversion is supported.", 400);
    if (typeof body.notes !== "string" || body.notes.length > 2000) throw new InventoryError("BOM notes must be text of at most 2,000 characters.", 400);
    if (!Array.isArray(body.components) || body.components.length === 0 || body.components.length > 100) {
      throw new InventoryError("A BOM requires between 1 and 100 raw-material components.", 400);
    }
    const seen = new Set<string>();
    const components = body.components.map((entry: unknown) => {
      if (!entry || typeof entry !== "object" || Array.isArray(entry)) throw new InventoryError("Each BOM component must be an object.", 400);
      const row = entry as Record<string, unknown>;
      if (typeof row.variantId !== "string" || !row.variantId) throw new InventoryError("Select a raw-material variant for every component.", 400);
      if (row.variantId === id || seen.has(row.variantId)) throw new InventoryError("BOM components cannot repeat or reference the output itself.", 400);
      seen.add(row.variantId);
      const material = this.variant(row.variantId);
      if (!material.active || !material.productActive || !material.isRawMaterial) throw new InventoryError("Every component must be an active classified raw material.", 400);
      if (row.uom !== material.uom) throw new InventoryError("Component UOM must match the current raw-material UOM. No unit conversion is supported.", 400);
      return { variantId: row.variantId, quantity: quantity(row.quantity, "Component quantity"), uom: String(material.uom) };
    });
    this.db.exec("SAVEPOINT save_material_bom");
    try {
      this.db.prepare(`
        INSERT INTO material_boms (variant_id, output_quantity, output_uom, notes, updated_at) VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(variant_id) DO UPDATE SET output_quantity = excluded.output_quantity,
          output_uom = excluded.output_uom, notes = excluded.notes, updated_at = excluded.updated_at
      `).run(id, outputQuantity, String(output.uom), body.notes, new Date().toISOString());
      this.db.prepare("DELETE FROM material_bom_components WHERE bom_variant_id = ?").run(id);
      const insert = this.db.prepare("INSERT INTO material_bom_components (bom_variant_id, material_variant_id, quantity, uom) VALUES (?, ?, ?, ?)");
      for (const component of components) insert.run(id, component.variantId, component.quantity, component.uom);
      this.db.exec("RELEASE save_material_bom");
    } catch (error) {
      this.db.exec("ROLLBACK TO save_material_bom; RELEASE save_material_bom");
      throw error;
    }
  }

  remove(id: string): void {
    this.variant(id);
    if (!this.db.prepare("SELECT 1 FROM material_boms WHERE variant_id = ?").get(id)) throw new InventoryError("BOM not found.", 404);
    this.db.prepare("DELETE FROM material_boms WHERE variant_id = ?").run(id);
  }
}
