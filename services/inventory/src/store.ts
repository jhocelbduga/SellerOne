import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";

export class InventoryError extends Error {
  constructor(
    message: string,
    readonly statusCode: number,
  ) {
    super(message);
    this.name = "InventoryError";
  }
}

export interface VariantInput {
  name: string;
  uom?: string;
  description?: string;
  sku?: string;
  barcode?: string;
  attributes?: Record<string, string>;
  unitCostMinor: number;
  sellingPriceMinor?: number | null;
  currency: string;
  reorderPoint?: number;
  mediumStockLevel?: number | null;
  maximumStockLevel?: number | null;
}

export interface ProductInput {
  name: string;
  description?: string;
  variants: VariantInput[];
}

export interface ProductPatch {
  name?: string;
  description?: string | null;
  active?: boolean;
}

export interface VariantPatch {
  name?: string;
  uom?: string;
  description?: string | null;
  sku?: string;
  barcode?: string | null;
  attributes?: Record<string, string>;
  unitCostMinor?: number;
  sellingPriceMinor?: number | null;
  currency?: string;
  reorderPoint?: number;
  mediumStockLevel?: number | null;
  maximumStockLevel?: number | null;
  active?: boolean;
}

export interface StockInput {
  variantId: string;
  uom?: string;
  variantDescription?: string;
  locationId?: string;
  quantity: number;
  lotNumber?: string;
  expiresAt?: string;
  unitCostMinor?: number;
  reference?: string;
  note?: string;
}

export interface StockOutInput extends StockInput {
  batchId?: string;
}

export interface AdjustmentInput {
  variantId: string;
  locationId?: string;
  countedQuantity: number;
  lotNumber?: string;
  expiresAt?: string;
  reference?: string;
  note?: string;
}

export interface TransferInput {
  variantId: string;
  sourceLocationId: string;
  destinationLocationId: string;
  quantity: number;
  reference?: string;
  note?: string;
}

interface BatchRow {
  id: string;
  sequence: number;
  variant_id: string;
  location_id: string;
  lot_number: string | null;
  expires_at: string | null;
  remaining_quantity: number;
  unit_cost_minor: number;
  created_at: string;
}

const DEFAULT_LOCATION_ID = "main";
const DEFAULT_LOCATION_NAME = "Main Warehouse";

function requiredText(value: unknown, field: string, maxLength = 200): string {
  if (typeof value !== "string" || value.trim().length === 0 || value.length > maxLength) {
    throw new InventoryError(`${field} must be a non-empty string of at most ${maxLength} characters.`, 400);
  }
  return value.trim();
}

function optionalText(value: unknown, field: string, maxLength = 500): string | null {
  if (value === undefined || value === null || value === "") {
    return null;
  }
  if (typeof value !== "string" || value.length > maxLength) {
    throw new InventoryError(`${field} must be a string of at most ${maxLength} characters.`, 400);
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function nonNegativeInteger(value: unknown, field: string): number {
  if (!Number.isSafeInteger(value) || Number(value) < 0) {
    throw new InventoryError(`${field} must be a non-negative safe integer.`, 400);
  }
  return Number(value);
}

function positiveInteger(value: unknown, field: string): number {
  if (!Number.isSafeInteger(value) || Number(value) <= 0) {
    throw new InventoryError(`${field} must be a positive safe integer.`, 400);
  }
  return Number(value);
}

function currencyCode(value: unknown): string {
  if (typeof value !== "string" || !/^[A-Za-z]{3}$/.test(value)) {
    throw new InventoryError("currency must be a three-letter ISO currency code.", 400);
  }
  const code = value.toUpperCase();
  if (!Intl.supportedValuesOf("currency").includes(code)) {
    throw new InventoryError(`${code} is not a supported ISO currency code.`, 400);
  }
  return code;
}

function dateOnly(value: unknown, field: string): string | null {
  const date = optionalText(value, field, 10);
  if (date === null) {
    return null;
  }
  const parsed = new Date(`${date}T00:00:00.000Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date) {
    throw new InventoryError(`${field} must be a valid date in YYYY-MM-DD format.`, 400);
  }
  return date;
}

function stringAttributes(value: unknown): Record<string, string> {
  if (value === undefined) {
    return {};
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new InventoryError("attributes must be an object containing string values.", 400);
  }
  const attributes: Record<string, string> = {};
  for (const [key, attributeValue] of Object.entries(value)) {
    if (key.trim().length === 0 || key.length > 50 || typeof attributeValue !== "string" || attributeValue.length > 100) {
      throw new InventoryError("Each attribute must have a key of at most 50 characters and a string value of at most 100 characters.", 400);
    }
    attributes[key.trim()] = attributeValue.trim();
  }
  return attributes;
}

function unitOfMeasure(value: unknown): string {
  return requiredText(value, "UOM", 30).toLowerCase();
}

function validateVariant(input: VariantInput): VariantInput & { sku: string; uom: string } {
  return {
    name: requiredText(input.name, "variant name"),
    uom: input.uom === undefined ? "pcs" : unitOfMeasure(input.uom),
    description: optionalText(input.description, "variant description", 2000) ?? undefined,
    sku: input.sku === undefined ? `SKU-${randomUUID().toUpperCase()}` : requiredText(input.sku, "SKU", 100),
    barcode: optionalText(input.barcode, "barcode", 100) ?? undefined,
    attributes: stringAttributes(input.attributes),
    unitCostMinor: nonNegativeInteger(input.unitCostMinor, "unitCostMinor"),
    sellingPriceMinor: input.sellingPriceMinor == null ? null : nonNegativeInteger(input.sellingPriceMinor, "sellingPriceMinor"),
    currency: currencyCode(input.currency),
    ...validateStockLevels(input.reorderPoint ?? 0, input.mediumStockLevel ?? null, input.maximumStockLevel ?? null),
  };
}

function validateStockLevels(minimum: unknown, medium: unknown, maximum: unknown): { reorderPoint: number; mediumStockLevel: number | null; maximumStockLevel: number | null } {
  const reorderPoint = nonNegativeInteger(minimum, "reorderPoint");
  const mediumStockLevel = medium === null ? null : nonNegativeInteger(medium, "mediumStockLevel");
  const maximumStockLevel = maximum === null ? null : nonNegativeInteger(maximum, "maximumStockLevel");
  if ((mediumStockLevel !== null && mediumStockLevel < reorderPoint)
    || (maximumStockLevel !== null && maximumStockLevel < (mediumStockLevel ?? reorderPoint))) {
    throw new InventoryError("Stock levels must satisfy minimum <= medium <= maximum in the variant's UOM.", 400);
  }
  return { reorderPoint, mediumStockLevel, maximumStockLevel };
}

export class InventoryStore {
  private readonly database: DatabaseSync;
  private readonly ownsDatabase: boolean;

  constructor(databasePath: string | DatabaseSync) {
    if (typeof databasePath === "string" && databasePath !== ":memory:") {
      mkdirSync(dirname(databasePath), { recursive: true });
    }
    this.ownsDatabase = typeof databasePath === "string";
    this.database = typeof databasePath === "string" ? new DatabaseSync(databasePath) : databasePath;
    this.database.exec(`
      PRAGMA foreign_keys = ON;
      PRAGMA journal_mode = WAL;

      CREATE TABLE IF NOT EXISTS locations (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL UNIQUE,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS products (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        description TEXT,
        active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS variants (
        id TEXT PRIMARY KEY,
        product_id TEXT NOT NULL REFERENCES products(id),
        name TEXT NOT NULL,
        description TEXT,
        sku TEXT NOT NULL UNIQUE,
        uom TEXT NOT NULL DEFAULT 'pcs',
        barcode TEXT UNIQUE,
        attributes_json TEXT NOT NULL,
        unit_cost_minor INTEGER NOT NULL CHECK (unit_cost_minor >= 0),
        currency TEXT NOT NULL CHECK (length(currency) = 3),
        reorder_point INTEGER NOT NULL DEFAULT 0 CHECK (reorder_point >= 0),
        active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS batches (
        sequence INTEGER PRIMARY KEY AUTOINCREMENT,
        id TEXT NOT NULL UNIQUE,
        variant_id TEXT NOT NULL REFERENCES variants(id),
        location_id TEXT NOT NULL REFERENCES locations(id),
        variant_description TEXT,
        lot_number TEXT,
        expires_at TEXT,
        remaining_quantity INTEGER NOT NULL CHECK (remaining_quantity >= 0),
        unit_cost_minor INTEGER NOT NULL CHECK (unit_cost_minor >= 0),
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS movements (
        sequence INTEGER PRIMARY KEY AUTOINCREMENT,
        id TEXT NOT NULL UNIQUE,
        variant_id TEXT NOT NULL REFERENCES variants(id),
        movement_type TEXT NOT NULL CHECK (movement_type IN ('stock_in', 'stock_out', 'adjustment', 'transfer')),
        quantity INTEGER NOT NULL CHECK (quantity > 0),
        source_location_id TEXT REFERENCES locations(id),
        destination_location_id TEXT REFERENCES locations(id),
        batch_id TEXT REFERENCES batches(id),
        unit_cost_minor INTEGER NOT NULL CHECK (unit_cost_minor >= 0),
        total_cost_minor INTEGER NOT NULL CHECK (total_cost_minor >= 0),
        batch_allocations_json TEXT NOT NULL,
        currency TEXT NOT NULL CHECK (length(currency) = 3),
        reference TEXT,
        note TEXT,
        created_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS batches_stock_lookup
        ON batches (variant_id, location_id, sequence);
      CREATE INDEX IF NOT EXISTS movements_history
        ON movements (sequence DESC);
      CREATE INDEX IF NOT EXISTS movements_variant_history
        ON movements (variant_id, sequence DESC);
      CREATE TABLE IF NOT EXISTS stock_reservations (
        order_id TEXT NOT NULL,
        variant_id TEXT NOT NULL REFERENCES variants(id),
        location_id TEXT NOT NULL REFERENCES locations(id),
        quantity INTEGER NOT NULL CHECK (quantity > 0),
        PRIMARY KEY (order_id, variant_id, location_id)
      );
    `);
    this.ensureColumn("variants", "description", "TEXT");
    this.ensureColumn("variants", "uom", "TEXT NOT NULL DEFAULT 'pcs'");
    this.ensureColumn("variants", "selling_price_minor", "INTEGER CHECK (selling_price_minor >= 0)");
    this.ensureColumn("variants", "medium_stock_level", "INTEGER CHECK (medium_stock_level >= 0)");
    this.ensureColumn("variants", "maximum_stock_level", "INTEGER CHECK (maximum_stock_level >= 0)");
    this.ensureColumn("batches", "variant_description", "TEXT");
    this.database.prepare(`
      INSERT OR IGNORE INTO locations (id, name, created_at)
      VALUES (?, ?, ?)
    `).run(DEFAULT_LOCATION_ID, DEFAULT_LOCATION_NAME, new Date().toISOString());
  }

  close(): void {
    if (this.ownsDatabase) this.database.close();
  }

  reserveStock(orderId: string, items: { variantId: string; locationId: string; quantity: number }[]): void {
    this.transaction(() => {
      if (this.database.prepare("SELECT 1 FROM stock_reservations WHERE order_id = ?").get(orderId)) {
        throw new InventoryError("This order already has reserved stock.", 409);
      }
      for (const item of items) {
        const variant = this.inventoryVariant(item.variantId);
        if (Number(variant.active) !== 1 || Number(variant.product_active) !== 1) {
          throw new InventoryError("Inactive variants cannot be reserved.", 409);
        }
        const locationId = this.locationId(item.locationId);
        const quantity = positiveInteger(item.quantity, "quantity");
        this.assertAvailable(item.variantId, locationId, quantity);
        this.database.prepare(`INSERT INTO stock_reservations (order_id, variant_id, location_id, quantity)
          VALUES (?, ?, ?, ?) ON CONFLICT (order_id, variant_id, location_id)
          DO UPDATE SET quantity = quantity + excluded.quantity`).run(orderId, item.variantId, locationId, quantity);
      }
    });
  }

  releaseReservation(orderId: string): void {
    this.database.prepare("DELETE FROM stock_reservations WHERE order_id = ?").run(orderId);
  }

  fulfillReservation(orderId: string): void {
    this.transaction(() => {
      const items = this.database.prepare(`SELECT variant_id, location_id, quantity
        FROM stock_reservations WHERE order_id = ?`).all(orderId);
      if (!items.length) throw new InventoryError("No stock reservation exists for this order.", 409);
      this.releaseReservation(orderId);
      for (const item of items) {
        this.stockOut({
          variantId: String(item.variant_id), locationId: String(item.location_id),
          quantity: Number(item.quantity), reference: `Order ${orderId}`,
        });
      }
    });
  }

  listProducts(search?: string): object[] {
    const query = search?.trim();
    const products = query
      ? this.database.prepare(`
        SELECT id, name, description, active, created_at AS createdAt, updated_at AS updatedAt
        FROM products
        WHERE name LIKE ? OR description LIKE ? OR EXISTS (
          SELECT 1 FROM variants v
          WHERE v.product_id = products.id AND v.description LIKE ?
        )
        ORDER BY name, id
      `).all(`%${query}%`, `%${query}%`, `%${query}%`)
      : this.database.prepare(`
        SELECT id, name, description, active, created_at AS createdAt, updated_at AS updatedAt
        FROM products
        ORDER BY name, id
      `).all();
    return products.map((product) => this.productWithVariants(String(product.id)));
  }

  getProduct(id: string): object {
    const product = this.database.prepare("SELECT id FROM products WHERE id = ?").get(id);
    if (!product) {
      throw new InventoryError("Product not found.", 404);
    }
    return this.productWithVariants(id);
  }

  createProduct(input: ProductInput): object {
    const name = requiredText(input.name, "name");
    const description = optionalText(input.description, "description", 2000);
    if (!Array.isArray(input.variants) || input.variants.length === 0) {
      throw new InventoryError("A product must include at least one variant.", 400);
    }
    const variants = input.variants.map(validateVariant);
    const productId = randomUUID();
    const now = new Date().toISOString();

    this.transaction(() => {
      this.database.prepare(`
        INSERT INTO products (id, name, description, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?)
      `).run(productId, name, description, now, now);
      for (const variant of variants) {
        this.insertVariant(productId, variant, now);
      }
    });
    return this.getProduct(productId);
  }

  updateProduct(id: string, patch: ProductPatch): object {
    this.getProduct(id);
    const fields: string[] = [];
    const values: (string | number | null)[] = [];
    if (patch.name !== undefined) {
      fields.push("name = ?");
      values.push(requiredText(patch.name, "name"));
    }
    if (patch.description !== undefined) {
      fields.push("description = ?");
      values.push(optionalText(patch.description, "description", 2000));
    }
    if (patch.active !== undefined) {
      if (typeof patch.active !== "boolean") {
        throw new InventoryError("active must be a boolean.", 400);
      }
      fields.push("active = ?");
      values.push(Number(patch.active));
    }
    if (fields.length === 0) {
      throw new InventoryError("Provide at least one product field to update.", 400);
    }
    fields.push("updated_at = ?");
    values.push(new Date().toISOString(), id);
    this.database.prepare(`UPDATE products SET ${fields.join(", ")} WHERE id = ?`).run(...values);
    return this.getProduct(id);
  }

  createVariant(productId: string, input: VariantInput): object {
    this.getProduct(productId);
    this.insertVariant(productId, validateVariant(input), new Date().toISOString());
    return this.getProduct(productId);
  }

  updateVariant(id: string, patch: VariantPatch): object {
    const existing = this.database.prepare(`
      SELECT id, product_id AS productId, currency, uom
      FROM variants WHERE id = ?
    `).get(id);
    if (!existing) {
      throw new InventoryError("Variant not found.", 404);
    }

    const fields: string[] = [];
    const values: (string | number | null)[] = [];
    if (patch.uom !== undefined) {
      const uom = unitOfMeasure(patch.uom);
      this.assertUomChangeAllowed(id, String(existing.uom), uom);
      fields.push("uom = ?");
      values.push(uom);
    }
    if (patch.name !== undefined) {
      fields.push("name = ?");
      values.push(requiredText(patch.name, "name"));
    }
    if (patch.description !== undefined) {
      fields.push("description = ?");
      values.push(optionalText(patch.description, "variant description", 2000));
    }
    if (patch.sku !== undefined) {
      fields.push("sku = ?");
      values.push(requiredText(patch.sku, "sku", 100));
    }
    if (patch.barcode !== undefined) {
      fields.push("barcode = ?");
      values.push(optionalText(patch.barcode, "barcode", 100));
    }
    if (patch.attributes !== undefined) {
      fields.push("attributes_json = ?");
      values.push(JSON.stringify(stringAttributes(patch.attributes)));
    }
    if (patch.unitCostMinor !== undefined) {
      fields.push("unit_cost_minor = ?");
      values.push(nonNegativeInteger(patch.unitCostMinor, "unitCostMinor"));
    }
    if (patch.sellingPriceMinor !== undefined) {
      fields.push("selling_price_minor = ?");
      values.push(patch.sellingPriceMinor === null ? null : nonNegativeInteger(patch.sellingPriceMinor, "sellingPriceMinor"));
    }
    if (patch.currency !== undefined) {
      const currency = currencyCode(patch.currency);
      if (currency !== String(existing.currency)) {
        const balance = this.database.prepare(`
          SELECT COALESCE(SUM(remaining_quantity), 0) AS quantity
          FROM batches WHERE variant_id = ?
        `).get(id);
        if (Number(balance?.quantity ?? 0) > 0) {
          throw new InventoryError("Currency cannot be changed while this variant has stock on hand.", 409);
        }
      }
      fields.push("currency = ?");
      values.push(currency);
    }
    if (patch.reorderPoint !== undefined || patch.mediumStockLevel !== undefined || patch.maximumStockLevel !== undefined) {
      const levels = this.database.prepare("SELECT reorder_point, medium_stock_level, maximum_stock_level FROM variants WHERE id = ?").get(id)!;
      const validated = validateStockLevels(
        patch.reorderPoint === undefined ? levels.reorder_point : patch.reorderPoint,
        patch.mediumStockLevel === undefined ? levels.medium_stock_level : patch.mediumStockLevel,
        patch.maximumStockLevel === undefined ? levels.maximum_stock_level : patch.maximumStockLevel,
      );
      fields.push("reorder_point = ?", "medium_stock_level = ?", "maximum_stock_level = ?");
      values.push(validated.reorderPoint, validated.mediumStockLevel, validated.maximumStockLevel);
    }
    if (patch.active !== undefined) {
      if (typeof patch.active !== "boolean") {
        throw new InventoryError("active must be a boolean.", 400);
      }
      fields.push("active = ?");
      values.push(Number(patch.active));
    }
    if (fields.length === 0) {
      throw new InventoryError("Provide at least one variant field to update.", 400);
    }
    fields.push("updated_at = ?");
    values.push(new Date().toISOString(), id);
    this.database.prepare(`UPDATE variants SET ${fields.join(", ")} WHERE id = ?`).run(...values);
    return this.getProduct(String(existing.productId));
  }

  listLocations(): object[] {
    return this.database.prepare(`
      SELECT id, name, created_at AS createdAt
      FROM locations ORDER BY name, id
    `).all();
  }

  createLocation(name: string): object {
    const id = randomUUID();
    this.database.prepare(`
      INSERT INTO locations (id, name, created_at) VALUES (?, ?, ?)
    `).run(id, requiredText(name, "name"), new Date().toISOString());
    const location = this.database.prepare(`
      SELECT id, name, created_at AS createdAt FROM locations WHERE id = ?
    `).get(id);
    if (!location) {
      throw new Error("Created inventory location could not be read.");
    }
    return location;
  }

  lookupProduct(code: string): object {
    const value = requiredText(code, "code", 100);
    const variant = this.database.prepare(`
      SELECT product_id AS productId FROM variants
      WHERE sku = ? OR barcode = ?
    `).get(value, value);
    if (!variant) {
      throw new InventoryError("No product variant matches that SKU or barcode.", 404);
    }
    return this.getProduct(String(variant.productId));
  }

  stockIn(input: StockInput): object {
    const quantity = positiveInteger(input.quantity, "quantity");
    const variant = this.inventoryVariant(input.variantId);
    if (Number(variant.active) !== 1 || Number(variant.product_active) !== 1) {
      throw new InventoryError("Stock cannot be received for an inactive product or variant.", 409);
    }
    const locationId = this.locationId(input.locationId);
    const unitCostMinor = input.unitCostMinor === undefined
      ? Number(variant.unit_cost_minor)
      : nonNegativeInteger(input.unitCostMinor, "unitCostMinor");
    const variantDescription = input.variantDescription === undefined
      ? (typeof variant.description === "string" ? variant.description : null)
      : optionalText(input.variantDescription, "variantDescription", 2000);
    const lotNumber = optionalText(input.lotNumber, "lotNumber", 100);
    const expiresAt = dateOnly(input.expiresAt, "expiresAt");
    const reference = optionalText(input.reference, "reference", 200);
    const note = optionalText(input.note, "note");
    const now = new Date().toISOString();
    const batchId = randomUUID();
    const totalCostMinor = quantity * unitCostMinor;
    if (!Number.isSafeInteger(totalCostMinor)) {
      throw new InventoryError("The inventory value exceeds the supported amount.", 400);
    }

    this.transaction(() => {
      if (input.uom !== undefined) {
        const uom = unitOfMeasure(input.uom);
        this.assertUomChangeAllowed(input.variantId, String(variant.uom), uom);
        this.database.prepare("UPDATE variants SET uom = ?, updated_at = ? WHERE id = ?")
          .run(uom, now, input.variantId);
      }
      this.database.prepare(`
        INSERT INTO batches (
          id, variant_id, location_id, variant_description, lot_number, expires_at,
          remaining_quantity, unit_cost_minor, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(batchId, input.variantId, locationId, variantDescription ?? "", lotNumber, expiresAt, quantity, unitCostMinor, now);
      this.insertMovement({
        variantId: input.variantId,
        type: "stock_in",
        quantity,
        destinationLocationId: locationId,
        batchId,
        batchAllocations: [{ batchId, lotNumber, quantity, unitCostMinor }],
        unitCostMinor,
        totalCostMinor,
        currency: String(variant.currency),
        reference,
        note,
        now,
      });
    });
    return { batchId, ...this.getStockItem(input.variantId, locationId) };
  }

  stockOut(input: StockOutInput): object {
    const quantity = positiveInteger(input.quantity, "quantity");
    const variant = this.inventoryVariant(input.variantId);
    const locationId = this.locationId(input.locationId);
    const now = new Date().toISOString();
    let totalCostMinor = 0;
    let batchAllocations: { batchId: string; lotNumber: string | null; quantity: number; unitCostMinor: number }[] = [];
    this.transaction(() => {
      this.assertAvailable(input.variantId, locationId, quantity);
      const batches = this.availableBatches(input.variantId, locationId, input.batchId, input.lotNumber);
      const plan = this.planDeduction(batches, quantity);
      this.applyDeduction(plan.allocations);
      totalCostMinor = plan.totalCostMinor;
      batchAllocations = plan.allocations.map(({ batch, quantity: allocated }) => ({
        batchId: batch.id,
        lotNumber: batch.lot_number,
        quantity: allocated,
        unitCostMinor: Number(batch.unit_cost_minor),
      }));
      this.insertMovement({
        variantId: input.variantId,
        type: "stock_out",
        quantity,
        sourceLocationId: locationId,
        batchId: input.batchId ?? null,
        batchAllocations,
        unitCostMinor: Math.floor(totalCostMinor / quantity),
        totalCostMinor,
        currency: String(variant.currency),
        reference: optionalText(input.reference, "reference", 200),
        note: optionalText(input.note, "note"),
        now,
      });
    });
    return this.getStockItem(input.variantId, locationId);
  }

  adjustStock(input: AdjustmentInput): object {
    const countedQuantity = nonNegativeInteger(input.countedQuantity, "countedQuantity");
    const variant = this.inventoryVariant(input.variantId);
    const locationId = this.locationId(input.locationId);
    const now = new Date().toISOString();
    const reference = optionalText(input.reference, "reference", 200);
    const note = optionalText(input.note, "note");
    let difference = 0;
    let totalCostMinor = 0;
    let batchAllocations: { batchId: string; lotNumber: string | null; quantity: number; unitCostMinor: number }[] = [];
    this.transaction(() => {
      const currentQuantity = this.quantityOnHand(input.variantId, locationId);
      if (countedQuantity < this.reservedQuantity(input.variantId, locationId)) {
        throw new InventoryError("Counted stock cannot be less than reserved stock. Resolve the affected orders first.", 409);
      }
      difference = countedQuantity - currentQuantity;
      if (difference === 0) {
        throw new InventoryError("countedQuantity matches current stock; no adjustment is needed.", 400);
      }
      if (difference > 0) {
        const lotNumber = optionalText(input.lotNumber, "lotNumber", 100);
        const batchId = this.addBatch({
          variantId: input.variantId,
          locationId,
          quantity: difference,
          lotNumber,
          expiresAt: dateOnly(input.expiresAt, "expiresAt"),
          unitCostMinor: Number(variant.unit_cost_minor),
          now,
        });
        totalCostMinor = difference * Number(variant.unit_cost_minor);
        if (!Number.isSafeInteger(totalCostMinor)) {
          throw new InventoryError("The inventory value exceeds the supported amount.", 400);
        }
        batchAllocations = [{
          batchId,
          lotNumber,
          quantity: difference,
          unitCostMinor: Number(variant.unit_cost_minor),
        }];
      } else {
        const batches = this.availableBatches(input.variantId, locationId);
        const plan = this.planDeduction(batches, -difference);
        this.applyDeduction(plan.allocations);
        totalCostMinor = plan.totalCostMinor;
        batchAllocations = plan.allocations.map(({ batch, quantity }) => ({
          batchId: batch.id,
          lotNumber: batch.lot_number,
          quantity,
          unitCostMinor: Number(batch.unit_cost_minor),
        }));
      }
      this.insertMovement({
        variantId: input.variantId,
        type: "adjustment",
        quantity: Math.abs(difference),
        sourceLocationId: difference < 0 ? locationId : null,
        destinationLocationId: difference > 0 ? locationId : null,
        batchAllocations,
        unitCostMinor: Math.floor(totalCostMinor / Math.abs(difference)),
        totalCostMinor,
        currency: String(variant.currency),
        reference,
        note,
        now,
      });
    });
    return { adjustment: difference, ...this.getStockItem(input.variantId, locationId) };
  }

  transferStock(input: TransferInput): object {
    const quantity = positiveInteger(input.quantity, "quantity");
    const variant = this.inventoryVariant(input.variantId);
    if (input.sourceLocationId === input.destinationLocationId) {
      throw new InventoryError("Source and destination locations must be different.", 400);
    }
    const sourceLocationId = this.locationId(input.sourceLocationId);
    const destinationLocationId = this.locationId(input.destinationLocationId);
    const now = new Date().toISOString();
    const reference = optionalText(input.reference, "reference", 200);
    const note = optionalText(input.note, "note");
    let allocationCostMinor = 0;
    let batchAllocations: { batchId: string; lotNumber: string | null; quantity: number; unitCostMinor: number }[] = [];

    this.transaction(() => {
      this.assertAvailable(input.variantId, sourceLocationId, quantity);
      const batches = this.availableBatches(input.variantId, sourceLocationId);
      const plan = this.planDeduction(batches, quantity);
      this.applyDeduction(plan.allocations);
      allocationCostMinor = plan.totalCostMinor;
      batchAllocations = plan.allocations.map(({ batch, quantity: allocated }) => ({
        batchId: batch.id,
        lotNumber: batch.lot_number,
        quantity: allocated,
        unitCostMinor: Number(batch.unit_cost_minor),
      }));
      for (const allocation of plan.allocations) {
        const sourceBatch = allocation.batch;
        this.addBatch({
          variantId: input.variantId,
          locationId: destinationLocationId,
          quantity: allocation.quantity,
          lotNumber: sourceBatch.lot_number,
          expiresAt: sourceBatch.expires_at,
          unitCostMinor: Number(sourceBatch.unit_cost_minor),
          now,
        });
      }
      this.insertMovement({
        variantId: input.variantId,
        type: "transfer",
        quantity,
        sourceLocationId,
        destinationLocationId,
        batchAllocations,
        unitCostMinor: Math.floor(allocationCostMinor / quantity),
        totalCostMinor: allocationCostMinor,
        currency: String(variant.currency),
        reference,
        note,
        now,
      });
    });
    return {
      source: this.getStockItem(input.variantId, sourceLocationId),
      destination: this.getStockItem(input.variantId, destinationLocationId),
    };
  }

  listStock(filters: { locationId?: string; variantId?: string; lowStockOnly?: boolean }): object[] {
    const conditions: string[] = [];
    const parameters: (string | number)[] = [];
    if (filters.locationId) {
      this.locationId(filters.locationId);
      conditions.push("l.id = ?");
      parameters.push(filters.locationId);
    }
    if (filters.variantId) {
      conditions.push("v.id = ?");
      parameters.push(filters.variantId);
    }
    if (filters.lowStockOnly) {
      conditions.push("p.active = 1", "v.active = 1");
    }
    const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

    return this.database.prepare(`
      SELECT
        v.id AS variantId,
        p.id AS productId,
        p.name AS productName,
        v.name AS variantName,
        v.description AS variantDescription,
        v.uom,
        v.sku,
        v.barcode,
        l.id AS locationId,
        l.name AS locationName,
        v.reorder_point AS reorderPoint,
        v.medium_stock_level AS mediumStockLevel,
        v.maximum_stock_level AS maximumStockLevel,
        v.unit_cost_minor AS unitCostMinor,
        v.currency,
        COALESCE(SUM(b.remaining_quantity), 0) AS quantityOnHand,
        COALESCE((SELECT SUM(r.quantity) FROM stock_reservations r WHERE r.variant_id = v.id AND r.location_id = l.id), 0) AS quantityReserved,
        COALESCE(SUM(b.remaining_quantity), 0) - COALESCE((SELECT SUM(r.quantity) FROM stock_reservations r WHERE r.variant_id = v.id AND r.location_id = l.id), 0) AS quantityAvailable
      FROM variants v
      JOIN products p ON p.id = v.product_id
      CROSS JOIN locations l
      LEFT JOIN batches b ON b.variant_id = v.id AND b.location_id = l.id
      ${where}
      GROUP BY v.id, p.id, l.id
      ${filters.lowStockOnly ? "HAVING COALESCE(SUM(b.remaining_quantity), 0) <= v.reorder_point" : ""}
      ORDER BY p.name, v.name, l.name
    `).all(...parameters);
  }

  listMovements(filters: { variantId?: string; locationId?: string; limit: number }): object[] {
    const conditions: string[] = [];
    const parameters: (string | number)[] = [];
    if (filters.variantId) {
      conditions.push("m.variant_id = ?");
      parameters.push(filters.variantId);
    }
    if (filters.locationId) {
      this.locationId(filters.locationId);
      conditions.push("(m.source_location_id = ? OR m.destination_location_id = ?)");
      parameters.push(filters.locationId, filters.locationId);
    }
    const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
    const movements = this.database.prepare(`
      SELECT
        m.id,
        m.variant_id AS variantId,
        p.name AS productName,
        v.name AS variantName,
        COALESCE(b.variant_description, v.description) AS variantDescription,
        v.uom,
        v.sku,
        m.movement_type AS type,
        m.quantity,
        m.source_location_id AS sourceLocationId,
        source.name AS sourceLocationName,
        m.destination_location_id AS destinationLocationId,
        destination.name AS destinationLocationName,
        m.batch_id AS batchId,
        b.lot_number AS lotNumber,
        m.unit_cost_minor AS unitCostMinor,
        m.total_cost_minor AS totalCostMinor,
        m.batch_allocations_json AS batchAllocationsJson,
        m.currency,
        m.reference,
        m.note,
        m.created_at AS createdAt
      FROM movements m
      JOIN variants v ON v.id = m.variant_id
      JOIN products p ON p.id = v.product_id
      LEFT JOIN locations source ON source.id = m.source_location_id
      LEFT JOIN locations destination ON destination.id = m.destination_location_id
      LEFT JOIN batches b ON b.id = m.batch_id
      ${where}
      ORDER BY m.sequence DESC
      LIMIT ?
    `).all(...parameters, filters.limit);
    return movements.map(({ batchAllocationsJson, ...movement }) => ({
      ...movement,
      batchAllocations: JSON.parse(String(batchAllocationsJson)) as {
        batchId: string;
        lotNumber: string | null;
        quantity: number;
        unitCostMinor: number;
      }[],
    }));
  }

  listBatches(filters: {
    variantId?: string;
    locationId?: string;
    lotNumber?: string;
    includeDepleted: boolean;
    limit: number;
  }): object[] {
    const conditions: string[] = [];
    const parameters: (string | number)[] = [];
    if (!filters.includeDepleted) {
      conditions.push("b.remaining_quantity > 0");
    }
    if (filters.variantId) {
      conditions.push("b.variant_id = ?");
      parameters.push(filters.variantId);
    }
    if (filters.locationId) {
      this.locationId(filters.locationId);
      conditions.push("b.location_id = ?");
      parameters.push(filters.locationId);
    }
    if (filters.lotNumber) {
      conditions.push("b.lot_number = ?");
      parameters.push(requiredText(filters.lotNumber, "lotNumber", 100));
    }
    const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
    return this.database.prepare(`
      SELECT
        b.id AS batchId,
        b.variant_id AS variantId,
        p.name AS productName,
        v.name AS variantName,
        COALESCE(b.variant_description, v.description) AS variantDescription,
        v.uom,
        v.sku,
        b.location_id AS locationId,
        l.name AS locationName,
        b.lot_number AS lotNumber,
        b.expires_at AS expiresAt,
        b.remaining_quantity AS quantityOnHand,
        b.unit_cost_minor AS unitCostMinor,
        b.remaining_quantity * b.unit_cost_minor AS valueMinor,
        v.currency,
        b.created_at AS receivedAt
      FROM batches b
      JOIN variants v ON v.id = b.variant_id
      JOIN products p ON p.id = v.product_id
      JOIN locations l ON l.id = b.location_id
      ${where}
      ORDER BY b.sequence DESC
      LIMIT ?
    `).all(...parameters, filters.limit);
  }

  getValuation(locationId?: string): object[] {
    if (locationId) {
      this.locationId(locationId);
    }
    const locationCondition = locationId ? "AND b.location_id = ?" : "";
    const parameters = locationId ? [locationId] : [];
    return this.database.prepare(`
      SELECT
        v.currency,
        SUM(b.remaining_quantity * b.unit_cost_minor) AS totalValueMinor,
        SUM(b.remaining_quantity) AS totalUnits,
        COUNT(DISTINCT v.id) AS variantCount
      FROM batches b
      JOIN variants v ON v.id = b.variant_id
      JOIN products p ON p.id = v.product_id
      WHERE b.remaining_quantity > 0 ${locationCondition}
      GROUP BY v.currency
      ORDER BY v.currency
    `).all(...parameters);
  }

  private productWithVariants(productId: string): object {
    const product = this.database.prepare(`
      SELECT id, name, description, active, created_at AS createdAt, updated_at AS updatedAt
      FROM products WHERE id = ?
    `).get(productId);
    if (!product) {
      throw new InventoryError("Product not found.", 404);
    }
    const variants = this.database.prepare(`
      SELECT
        id, name, description, sku, barcode, uom,
        EXISTS (SELECT 1 FROM movements m WHERE m.variant_id = variants.id) AS uomLocked,
        attributes_json AS attributesJson,
        unit_cost_minor AS unitCostMinor,
        selling_price_minor AS sellingPriceMinor,
        currency,
        reorder_point AS reorderPoint,
        medium_stock_level AS mediumStockLevel,
        maximum_stock_level AS maximumStockLevel,
        active,
        created_at AS createdAt,
        updated_at AS updatedAt
      FROM variants WHERE product_id = ?
      ORDER BY name, id
    `).all(productId);
    return {
      ...product,
      active: Number(product.active) === 1,
      variants: variants.map(({ attributesJson, ...variant }) => ({
        ...variant,
        attributes: JSON.parse(String(attributesJson)) as Record<string, string>,
        active: Number(variant.active) === 1,
        uomLocked: Number(variant.uomLocked) === 1,
      })),
    };
  }

  private insertVariant(productId: string, variant: VariantInput & { sku: string; uom: string }, now: string): void {
    this.database.prepare(`
      INSERT INTO variants (
        id, product_id, name, description, sku, barcode, attributes_json, uom,
        unit_cost_minor, selling_price_minor, currency, reorder_point, medium_stock_level, maximum_stock_level, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      randomUUID(),
      productId,
      variant.name,
      variant.description ?? null,
      variant.sku,
      variant.barcode ?? null,
      JSON.stringify(variant.attributes ?? {}),
      variant.uom,
      variant.unitCostMinor,
      variant.sellingPriceMinor ?? null,
      variant.currency,
      variant.reorderPoint ?? 0,
      variant.mediumStockLevel ?? null,
      variant.maximumStockLevel ?? null,
      now,
      now,
    );
  }

  private inventoryVariant(id: string): Record<string, unknown> {
    const variant = this.database.prepare(`
      SELECT v.id, v.description, v.uom, v.unit_cost_minor, v.currency, v.active, p.active AS product_active
      FROM variants v
      JOIN products p ON p.id = v.product_id
      WHERE v.id = ?
    `).get(id);
    if (!variant) {
      throw new InventoryError("Active product variant not found.", 404);
    }
    return variant;
  }

  private locationId(id?: string): string {
    const locationId = id ?? DEFAULT_LOCATION_ID;
    const location = this.database.prepare("SELECT id FROM locations WHERE id = ?").get(locationId);
    if (!location) {
      throw new InventoryError("Location not found.", 404);
    }
    return locationId;
  }

  private ensureColumn(table: "variants" | "batches", column: string, definition: string): void {
    const columns = this.database.prepare(`PRAGMA table_info(${table})`).all();
    if (!columns.some((entry) => entry.name === column)) {
      this.database.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
    }
  }

  private assertUomChangeAllowed(variantId: string, currentUom: string, uom: string): void {
    if (currentUom !== uom && this.database.prepare("SELECT 1 FROM movements WHERE variant_id = ? LIMIT 1").get(variantId)) {
      throw new InventoryError("UOM cannot be changed after a stock movement. Create a new variant for a different unit of measure.", 409);
    }
  }

  private getStockItem(variantId: string, locationId: string): Record<string, unknown> {
    const row = this.database.prepare(`
      SELECT
        v.id AS variantId,
        p.id AS productId,
        p.name AS productName,
        v.name AS variantName,
        v.description AS variantDescription,
        v.uom,
        v.sku,
        v.barcode,
        l.id AS locationId,
        l.name AS locationName,
        v.reorder_point AS reorderPoint,
        v.medium_stock_level AS mediumStockLevel,
        v.maximum_stock_level AS maximumStockLevel,
        v.unit_cost_minor AS unitCostMinor,
        v.currency,
        COALESCE(SUM(b.remaining_quantity), 0) AS quantityOnHand,
        COALESCE((SELECT SUM(r.quantity) FROM stock_reservations r WHERE r.variant_id = v.id AND r.location_id = l.id), 0) AS quantityReserved,
        COALESCE(SUM(b.remaining_quantity), 0) - COALESCE((SELECT SUM(r.quantity) FROM stock_reservations r WHERE r.variant_id = v.id AND r.location_id = l.id), 0) AS quantityAvailable
      FROM variants v
      JOIN products p ON p.id = v.product_id
      JOIN locations l ON l.id = ?
      LEFT JOIN batches b ON b.variant_id = v.id AND b.location_id = l.id
      WHERE v.id = ?
      GROUP BY v.id, p.id, l.id
    `).get(locationId, variantId);
    if (!row) {
      throw new InventoryError("Product variant not found.", 404);
    }
    return row;
  }

  private quantityOnHand(variantId: string, locationId: string): number {
    const row = this.database.prepare(`
      SELECT COALESCE(SUM(remaining_quantity), 0) AS quantity
      FROM batches WHERE variant_id = ? AND location_id = ?
    `).get(variantId, locationId);
    return Number(row?.quantity ?? 0);
  }

  private reservedQuantity(variantId: string, locationId: string): number {
    return Number(this.database.prepare(`SELECT COALESCE(SUM(quantity), 0) AS quantity
      FROM stock_reservations WHERE variant_id = ? AND location_id = ?`).get(variantId, locationId)?.quantity ?? 0);
  }

  private assertAvailable(variantId: string, locationId: string, quantity: number): void {
    if (quantity > this.quantityOnHand(variantId, locationId) - this.reservedQuantity(variantId, locationId)) {
      const stock = this.getStockItem(variantId, locationId);
      throw new InventoryError(`Insufficient available stock for ${stock.productName} · ${stock.variantName} (${stock.sku}) at ${stock.locationName}. Required: ${quantity} ${stock.uom}; available: ${stock.quantityAvailable} ${stock.uom}; reserved: ${stock.quantityReserved} ${stock.uom}. Receive stock before retrying.`, 409);
    }
  }

  private availableBatches(
    variantId: string,
    locationId: string,
    batchId?: string,
    lotNumber?: string,
  ): BatchRow[] {
    if (batchId !== undefined && lotNumber !== undefined) {
      throw new InventoryError("Use either batchId or lotNumber, not both.", 400);
    }
    const filters = ["variant_id = ?", "location_id = ?", "remaining_quantity > 0"];
    const parameters: string[] = [variantId, locationId];
    if (batchId !== undefined) {
      filters.push("id = ?");
      parameters.push(requiredText(batchId, "batchId", 100));
    }
    if (lotNumber !== undefined) {
      filters.push("lot_number = ?");
      parameters.push(requiredText(lotNumber, "lotNumber", 100));
    }
    return this.database.prepare(`
      SELECT id, sequence, variant_id, location_id, lot_number, expires_at,
        remaining_quantity, unit_cost_minor, created_at
      FROM batches
      WHERE ${filters.join(" AND ")}
      ORDER BY sequence
    `).all(...parameters) as unknown as BatchRow[];
  }

  private planDeduction(
    batches: BatchRow[],
    quantity: number,
  ): { allocations: { batch: BatchRow; quantity: number }[]; totalCostMinor: number } {
    let remaining = quantity;
    let totalCostMinor = 0;
    const allocations: { batch: BatchRow; quantity: number }[] = [];
    for (const batch of batches) {
      if (remaining === 0) {
        break;
      }
      const allocated = Math.min(Number(batch.remaining_quantity), remaining);
      if (allocated > 0) {
        allocations.push({ batch, quantity: allocated });
        totalCostMinor += allocated * Number(batch.unit_cost_minor);
        remaining -= allocated;
      }
    }
    if (!Number.isSafeInteger(totalCostMinor)) {
      throw new InventoryError("The inventory value exceeds the supported amount.", 400);
    }
    if (remaining > 0) {
      throw new InventoryError("Insufficient stock for this operation.", 409);
    }
    return { allocations, totalCostMinor };
  }

  private applyDeduction(allocations: { batch: BatchRow; quantity: number }[]): void {
    for (const allocation of allocations) {
      const result = this.database.prepare(`
        UPDATE batches SET remaining_quantity = remaining_quantity - ?
        WHERE id = ? AND remaining_quantity >= ?
      `).run(allocation.quantity, allocation.batch.id, allocation.quantity);
      if (Number(result.changes) !== 1) {
        throw new InventoryError("Stock changed while processing the request; retry the operation.", 409);
      }
    }
  }

  private addBatch(input: {
    variantId: string;
    locationId: string;
    quantity: number;
    lotNumber: string | null;
    expiresAt: string | null;
    unitCostMinor: number;
    now: string;
  }): string {
    const id = randomUUID();
    this.database.prepare(`
      INSERT INTO batches (
        id, variant_id, location_id, lot_number, expires_at,
        remaining_quantity, unit_cost_minor, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      input.variantId,
      input.locationId,
      input.lotNumber,
      input.expiresAt,
      input.quantity,
      input.unitCostMinor,
      input.now,
    );
    return id;
  }

  private insertMovement(input: {
    variantId: string;
    type: "stock_in" | "stock_out" | "adjustment" | "transfer";
    quantity: number;
    sourceLocationId?: string | null;
    destinationLocationId?: string | null;
    batchId?: string | null;
    batchAllocations?: { batchId: string; lotNumber: string | null; quantity: number; unitCostMinor: number }[];
    unitCostMinor: number;
    totalCostMinor: number;
    currency: string;
    reference: string | null;
    note: string | null;
    now: string;
  }): void {
    this.database.prepare(`
      INSERT INTO movements (
        id, variant_id, movement_type, quantity,
        source_location_id, destination_location_id, batch_id,
        unit_cost_minor, total_cost_minor, batch_allocations_json,
        currency, reference, note, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      randomUUID(),
      input.variantId,
      input.type,
      input.quantity,
      input.sourceLocationId ?? null,
      input.destinationLocationId ?? null,
      input.batchId ?? null,
      input.unitCostMinor,
      input.totalCostMinor,
      JSON.stringify(input.batchAllocations ?? []),
      input.currency,
      input.reference,
      input.note,
      input.now,
    );
  }

  private transaction<T>(operation: () => T): T {
    const nested = this.database.isTransaction;
    const savepoint = `inventory_${randomUUID().replaceAll("-", "")}`;
    this.database.exec(nested ? `SAVEPOINT ${savepoint}` : "BEGIN IMMEDIATE");
    try {
      const result = operation();
      this.database.exec(nested ? `RELEASE ${savepoint}` : "COMMIT");
      return result;
    } catch (error) {
      this.database.exec(nested ? `ROLLBACK TO ${savepoint}; RELEASE ${savepoint}` : "ROLLBACK");
      throw error;
    }
  }
}
