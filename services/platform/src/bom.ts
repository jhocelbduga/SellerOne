import { DatabaseSync } from "node:sqlite";
import { createHash } from "node:crypto";
import { InventoryError } from "@sellerone/inventory-service";

export const materialUoms = ["kg", "g", "lb", "pc", "ea", "set", "pack", "box", "case", "bundle", "L", "ml", "scoop", "sachet", "bottle", "bag", "tube"] as const;
export function decimalMaterialUom(uom: string): boolean { return ["kg", "g", "lb", "L", "ml"].includes(uom); }

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
    for (const column of ["description", "remarks"]) {
      if (!db.prepare("PRAGMA table_info(material_bom_components)").all().some((row) => row.name === column)) {
        db.exec(`ALTER TABLE material_bom_components ADD COLUMN ${column} TEXT NOT NULL DEFAULT ''`);
      }
    }
    db.exec(`CREATE TABLE IF NOT EXISTS product_bom_settings (
      product_id TEXT PRIMARY KEY REFERENCES products(id), enabled INTEGER NOT NULL CHECK(enabled IN (0,1))
    )`);
  }

  list(): object {
    const variants = this.db.prepare(`
      SELECT v.id, v.name, v.sku, v.description, v.uom, v.active, p.id AS productId, p.name AS productName, p.active AS productActive,
        EXISTS (SELECT 1 FROM raw_material_variants r WHERE r.variant_id = v.id) AS isRawMaterial
      FROM variants v JOIN products p ON p.id = v.product_id ORDER BY p.name, v.name, v.id
    `).all().map((row) => ({ ...row, active: Boolean(row.active && row.productActive), isRawMaterial: Boolean(row.isRawMaterial) }));
    const boms = this.db.prepare(`
      SELECT variant_id AS variantId, output_quantity AS outputQuantity, output_uom AS outputUom,
        notes, updated_at AS updatedAt FROM material_boms ORDER BY variant_id
    `).all().map((bom) => ({
      ...bom,
      components: this.db.prepare(`
        SELECT material_variant_id AS variantId, quantity, uom, description, remarks
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
      if (this.db.prepare("SELECT 1 FROM batches WHERE variant_id = ? AND remaining_quantity <> CAST(remaining_quantity AS INTEGER)").get(id)) {
        throw new InventoryError("Reconcile fractional stock to whole units before removing its raw-material classification.", 409);
      }
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
      const amount = quantity(row.quantity, "Component quantity");
      const text = (value: unknown, field: string) => {
        if (value === undefined) return "";
        if (typeof value !== "string" || value.length > 2000) throw new InventoryError(`${field} must be text of at most 2,000 characters.`, 400);
        return value.trim();
      };
      if (body.standardUoms === true && !materialUoms.some((uom) => uom === material.uom)) throw new InventoryError("Choose a raw material with a supported stock UOM.", 400);
      const usage = amount / outputQuantity;
      if (body.standardUoms === true && (Number(usage.toFixed(6)) <= 0 || (!decimalMaterialUom(String(material.uom)) && !Number.isSafeInteger(usage))
        || Math.abs(usage - Number(usage.toFixed(6))) > 1e-10)) throw new InventoryError("Per-unit usage must use whole quantities for count UOMs and at most six decimals for weight/volume.", 400);
      return { variantId: row.variantId, quantity: amount, uom: String(material.uom), description: text(row.description, "Component description"), remarks: text(row.remarks, "Remarks") };
    });
    this.db.exec("SAVEPOINT save_material_bom");
    try {
      this.db.prepare(`
        INSERT INTO material_boms (variant_id, output_quantity, output_uom, notes, updated_at) VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(variant_id) DO UPDATE SET output_quantity = excluded.output_quantity,
          output_uom = excluded.output_uom, notes = excluded.notes, updated_at = excluded.updated_at
      `).run(id, outputQuantity, String(output.uom), body.notes, new Date().toISOString());
      this.db.prepare("DELETE FROM material_bom_components WHERE bom_variant_id = ?").run(id);
      const insert = this.db.prepare("INSERT INTO material_bom_components (bom_variant_id, material_variant_id, quantity, uom, description, remarks) VALUES (?, ?, ?, ?, ?, ?)");
      for (const component of components) insert.run(id, component.variantId, component.quantity, component.uom, component.description, component.remarks);
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

  product(id: string): object {
    if (!this.db.prepare("SELECT 1 FROM products WHERE id = ?").get(id)) throw new InventoryError("Product not found.", 404);
    const data = this.list() as { variants: Record<string, unknown>[]; boms: Record<string, unknown>[] };
    const outputs = data.variants.filter((v) => v.productId === id);
    const enabled = Boolean(this.db.prepare("SELECT enabled FROM product_bom_settings WHERE product_id = ?").get(id)?.enabled);
    const boms = data.boms.filter((b) => outputs.some((v) => v.id === b.variantId));
    return { enabled, version: createHash("sha256").update(JSON.stringify({ enabled, outputs, boms })).digest("hex"),
      variants: outputs, materials: data.variants.filter((v) => v.isRawMaterial),
      boms, uoms: materialUoms };
  }

  saveProduct(id: string, body: Record<string, unknown>): object {
    const current = this.product(id) as { version: string };
    if (body.expectedVersion !== current.version) throw new InventoryError("Product BOM changed. Reload and review before saving.", 409);
    if (typeof body.enabled !== "boolean") throw new InventoryError("Uses Raw Material BOM must be true or false.", 400);
    if (!Array.isArray(body.boms)) throw new InventoryError("Supply the variant BOM list.", 400);
    const outputs = this.db.prepare("SELECT id FROM variants WHERE product_id = ? AND active = 1").all(id).map((r) => String(r.id));
    const seen = new Set<string>();
    this.db.exec("SAVEPOINT product_bom_save");
    try {
      for (const value of body.boms) {
        if (!value || typeof value !== "object" || Array.isArray(value)) throw new InventoryError("Invalid variant BOM.", 400);
        const bom = value as Record<string, unknown>;
        if (typeof bom.variantId !== "string" || !outputs.includes(bom.variantId) || seen.has(bom.variantId)) throw new InventoryError("BOM variants must be unique and belong to this product.", 400);
        seen.add(bom.variantId);
        this.save(bom.variantId, { ...bom, outputQuantity: 1, standardUoms: true });
      }
      if (body.enabled && outputs.some((variantId) => !seen.has(variantId))) throw new InventoryError("Define a BOM for every active finished-product variant.", 400);
      this.db.prepare("INSERT INTO product_bom_settings VALUES (?, ?) ON CONFLICT(product_id) DO UPDATE SET enabled=excluded.enabled").run(id, Number(body.enabled));
      this.db.exec("RELEASE product_bom_save");
      return this.product(id);
    } catch (error) { this.db.exec("ROLLBACK TO product_bom_save; RELEASE product_bom_save"); throw error; }
  }
}
