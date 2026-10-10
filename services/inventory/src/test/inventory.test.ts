import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, it } from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createInventoryServer } from "../server.js";
import { InventoryStore } from "../store.js";

type JsonObject = Record<string, unknown>;

let store: InventoryStore;
let server: ReturnType<typeof createInventoryServer>;
let baseUrl: string;

beforeEach(async () => {
  store = new InventoryStore(":memory:");
  server = createInventoryServer(store);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${address.port}`;
});

afterEach(async () => {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  });
  store.close();
});

async function request(
  path: string,
  method = "GET",
  body?: JsonObject,
): Promise<{ status: number; body: JsonObject }> {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: body === undefined ? undefined : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return {
    status: response.status,
    body: await response.json() as JsonObject,
  };
}

it("stores optional selling prices independently from cost and validates updates", async () => {
  const created = await request("/products", "POST", { name: "Priced coffee", variants: [
    { name: "Small", sku: "PRICE-S", uom: "cup", unitCostMinor: 100, sellingPriceMinor: 12550, currency: "PHP" },
    { name: "Large", sku: "PRICE-L", uom: "cup", unitCostMinor: 200, currency: "PHP" },
  ] });
  assert.equal(created.status, 201);
  const variants = created.body.variants as JsonObject[];
  const small = variants.find((v) => v.sku === "PRICE-S")!;
  const large = variants.find((v) => v.sku === "PRICE-L")!;
  assert.equal(small.sellingPriceMinor, 12550);
  assert.equal(large.sellingPriceMinor, null);
  for (const invalid of [-1, 1.5, "100", Number.MAX_SAFE_INTEGER + 1]) {
    assert.equal((await request(`/variants/${small.id}`, "PATCH", { sellingPriceMinor: invalid })).status, 400);
  }
  assert.equal((await request(`/variants/${small.id}`, "PATCH", { sellingPriceMinor: 0 })).status, 200);
  let reread = (await request(`/products/${created.body.id}`)).body.variants as JsonObject[];
  assert.equal(reread.find((v) => v.id === small.id)?.sellingPriceMinor, 0);
  assert.equal(reread.find((v) => v.id === small.id)?.unitCostMinor, 100);
  assert.equal((await request(`/variants/${small.id}`, "PATCH", { sellingPriceMinor: null })).status, 200);
  reread = (await request(`/products/${created.body.id}`)).body.variants as JsonObject[];
  assert.equal(reread.find((v) => v.id === small.id)?.sellingPriceMinor, null);
  assert.equal((await request(`/variants/${large.id}`, "PATCH", { sellingPriceMinor: 19900 })).status, 200);
});

it("validates stock planning levels across create and partial updates without changing stock or UOM", async () => {
  const created = await request("/products", "POST", { name: "Stock targets", variants: [
    { name: "Cup", sku: "LEVEL-CUP", uom: "cup", unitCostMinor: 100, currency: "PHP", reorderPoint: 10, mediumStockLevel: 50, maximumStockLevel: 100 },
    { name: "Milk", sku: "LEVEL-MILK", uom: "litre", unitCostMinor: 200, currency: "PHP" },
  ] });
  assert.equal(created.status, 201);
  const variants = created.body.variants as JsonObject[];
  const cup = variants.find((v) => v.sku === "LEVEL-CUP")!;
  const milk = variants.find((v) => v.sku === "LEVEL-MILK")!;
  assert.equal(cup.mediumStockLevel, 50);
  assert.equal(cup.maximumStockLevel, 100);
  assert.equal(milk.mediumStockLevel, null);
  assert.equal(milk.maximumStockLevel, null);
  for (const patch of [
    { reorderPoint: 51 }, { mediumStockLevel: 9 }, { mediumStockLevel: 101 }, { maximumStockLevel: 49 },
    { mediumStockLevel: -1 }, { maximumStockLevel: 1.5 }, { mediumStockLevel: "50" },
    { maximumStockLevel: Number.MAX_SAFE_INTEGER + 1 },
  ]) assert.equal((await request(`/variants/${cup.id}`, "PATCH", patch)).status, 400);
  let reread = (await request(`/products/${created.body.id}`)).body.variants as JsonObject[];
  assert.equal(reread.find((v) => v.id === cup.id)?.reorderPoint, 10);
  assert.equal(reread.find((v) => v.id === cup.id)?.mediumStockLevel, 50);
  assert.equal((await request(`/variants/${cup.id}`, "PATCH", { mediumStockLevel: null, maximumStockLevel: null })).status, 200);
  assert.equal((await request(`/variants/${cup.id}`, "PATCH", { reorderPoint: 20, mediumStockLevel: 30, maximumStockLevel: 40 })).status, 200);
  assert.equal((await request(`/variants/${cup.id}`, "PATCH", { name: "Updated cup" })).status, 200);
  reread = (await request(`/products/${created.body.id}`)).body.variants as JsonObject[];
  assert.equal(reread.find((v) => v.id === cup.id)?.maximumStockLevel, 40);
  const stock = ((await request("/stock")).body.items as JsonObject[]).find((v) => v.variantId === cup.id)!;
  assert.equal(stock.reorderPoint, 20);
  assert.equal(stock.mediumStockLevel, 30);
  assert.equal(stock.maximumStockLevel, 40);
  assert.equal(stock.quantityOnHand, 0);
  assert.equal(stock.uom, "cup");
  assert.equal((await request("/products", "POST", { name: "Invalid targets", variants: [
    { name: "Bad", sku: "LEVEL-BAD", unitCostMinor: 0, currency: "PHP", reorderPoint: 10, maximumStockLevel: 9 },
  ] })).status, 400);
});

async function createProduct(reorderPoint = 0, description?: string): Promise<{ productId: string; variantId: string }> {
  const response = await request("/products", "POST", {
    name: "Coffee Beans",
    description: "Roasted coffee",
    variants: [{
      name: "250 g",
      description,
      sku: "TEST-COFFEE",
      barcode: null,
      attributes: { size: "250 g" },
      unitCostMinor: 100,
      currency: "PHP",
      reorderPoint,
    }],
  });
  assert.equal(response.status, 201);
  const variants = response.body.variants as JsonObject[];
  return {
    productId: String(response.body.id),
    variantId: String(variants[0].id),
  };
}

describe("inventory service", () => {
  it("defines UOM on variants and the first receipt, then protects historical quantities", async () => {
    const created = await request("/products", "POST", {
      name: "Measured goods",
      variants: [
        { name: "Bulk", uom: " KG ", unitCostMinor: 100, currency: "PHP" },
        { name: "Packed", unitCostMinor: 200, currency: "PHP" },
      ],
    });
    assert.equal(created.status, 201);
    const variants = created.body.variants as JsonObject[];
    const bulk = variants.find((variant) => variant.name === "Bulk")!;
    const packed = variants.find((variant) => variant.name === "Packed")!;
    assert.equal(bulk.uom, "kg");
    assert.equal(packed.uom, "pcs");
    assert.equal(packed.uomLocked, false);

    const edited = await request(`/variants/${packed.id}`, "PATCH", { uom: " Pack " });
    assert.equal(edited.status, 200);
    const receipt = await request("/stock/in", "POST", { variantId: packed.id, quantity: 4, uom: " BOX " });
    assert.equal(receipt.status, 201);
    assert.equal(receipt.body.uom, "box");
    assert.equal(receipt.body.quantityOnHand, 4);
    assert.equal((await request("/stock/in", "POST", { variantId: packed.id, quantity: 2, uom: "box" })).status, 201);
    const conflict = await request("/stock/in", "POST", { variantId: packed.id, quantity: 1, uom: "pcs" });
    assert.equal(conflict.status, 409);
    assert.match(String(conflict.body.error), /UOM cannot be changed/);
    assert.equal((await request(`/variants/${packed.id}`, "PATCH", { uom: "pcs" })).status, 409);
    assert.equal((await request(`/variants/${packed.id}`, "PATCH", { uom: " BOX " })).status, 200);

    const stock = await request(`/stock?variantId=${packed.id}`);
    assert.equal((stock.body.items as JsonObject[])[0].quantityOnHand, 6);
    assert.equal((stock.body.items as JsonObject[])[0].uom, "box");
    const batches = await request(`/batches?variantId=${packed.id}`);
    assert.ok((batches.body.items as JsonObject[]).every((batch) => batch.uom === "box"));
    const lowStock = await request("/alerts/low-stock");
    assert.equal((lowStock.body.items as JsonObject[]).find((item) => item.variantId === bulk.id)?.uom, "kg");
    const reread = await request(`/products/${created.body.id}`);
    assert.equal((reread.body.variants as JsonObject[]).find((variant) => variant.id === packed.id)?.uomLocked, true);

    const location = await request("/locations", "POST", { name: "UOM destination" });
    const transfer = await request("/transfers", "POST", {
      variantId: packed.id, sourceLocationId: "main", destinationLocationId: location.body.id, quantity: 2,
    });
    assert.equal((transfer.body.destination as JsonObject).uom, "box");
    const adjusted = await request("/adjustments", "POST", { variantId: packed.id, countedQuantity: 3 });
    assert.equal(adjusted.body.uom, "box");
    assert.equal((await request("/stock/out", "POST", { variantId: packed.id, quantity: 3 })).body.uom, "box");
    await request("/stock/out", "POST", { variantId: packed.id, locationId: location.body.id, quantity: 2 });
    assert.equal((await request(`/variants/${packed.id}`, "PATCH", { uom: "pcs" })).status, 409);
    const movements = await request(`/movements?variantId=${packed.id}`);
    assert.ok((movements.body.items as JsonObject[]).every((movement) => movement.uom === "box"));
  });

  it("validates UOM and rolls back failed receipts without changing the catalog", async () => {
    const { productId, variantId } = await createProduct();
    for (const uom of ["", "   ", "x".repeat(31), null, 42]) {
      assert.equal((await request(`/variants/${variantId}`, "PATCH", { uom })).status, 400);
      assert.equal((await request("/stock/in", "POST", { variantId, quantity: 1, uom })).status, 400);
      assert.equal((await request("/products", "POST", {
        name: "Invalid UOM", variants: [{ name: "Standard", uom, unitCostMinor: 100, currency: "PHP" }],
      })).status, 400);
    }
    assert.equal((await request("/stock/in", "POST", { variantId, quantity: 1.5, uom: "kg" })).status, 400);
    assert.equal((await request("/stock/in", "POST", { variantId, quantity: 1, uom: "kg", expiresAt: "2027-02-30" })).status, 400);
    const product = await request(`/products/${productId}`);
    assert.equal((product.body.variants as JsonObject[])[0].uom, "pcs");
    assert.equal((product.body.variants as JsonObject[])[0].uomLocked, false);
    assert.equal(((await request("/movements")).body.items as JsonObject[]).length, 0);
  });

  it("generates distinct persistent SKUs when omitted and preserves supplied SKUs", async () => {
    const created = await request("/products", "POST", {
      name: "Auto SKU product",
      variants: [
        { name: "Small", unitCostMinor: 100, currency: "PHP" },
        { name: "Large", unitCostMinor: 200, currency: "PHP" },
        { name: "Manual", sku: "MY-SKU", unitCostMinor: 100, currency: "PHP" },
      ],
    });
    assert.equal(created.status, 201);
    const variants = created.body.variants as JsonObject[];
    const generated = variants.filter((variant) => variant.name !== "Manual");
    for (const variant of generated) {
      assert.match(String(variant.sku), /^SKU-[0-9A-F-]{36}$/);
      const lookup = await request(`/products/lookup?code=${variant.sku}`);
      assert.equal(lookup.body.id, created.body.id);
    }
    assert.notEqual(generated[0].sku, generated[1].sku);
    assert.equal(variants.find((variant) => variant.name === "Manual")?.sku, "MY-SKU");
    const reread = await request(`/products/${created.body.id}`);
    assert.deepEqual((reread.body.variants as JsonObject[]).map((variant) => variant.sku), variants.map((variant) => variant.sku));
    const receipt = await request("/stock/in", "POST", { variantId: generated[0].id, quantity: 3 });
    assert.equal(receipt.status, 201);
    assert.equal(receipt.body.sku, generated[0].sku);
  });

  it("serves health status and creates searchable products with SKU lookup", async () => {
    const health = await request("/health");
    assert.equal(health.status, 200);
    assert.equal(health.body.status, "ok");

    const created = await request("/products", "POST", {
      name: "Coffee Beans",
      variants: [{
        name: "250 g",
        description: "Resealable coffee pouch",
        sku: "COFFEE-250",
        barcode: "1000000000250",
        attributes: { size: "250 g", colour: "Dark roast" },
        unitCostMinor: 850,
        currency: "php",
        reorderPoint: 10,
      }],
    });
    assert.equal(created.status, 201);
    assert.equal(created.body.name, "Coffee Beans");
    const variant = (created.body.variants as JsonObject[])[0];
    assert.equal(variant.currency, "PHP");
    assert.deepEqual(variant.attributes, { size: "250 g", colour: "Dark roast" });

    const search = await request("/products?search=Coffee");
    assert.equal((search.body.items as JsonObject[]).length, 1);
    const variantDescriptionSearch = await request("/products?search=Resealable");
    assert.equal((variantDescriptionSearch.body.items as JsonObject[]).length, 1);
    const lookup = await request("/products/lookup?code=1000000000250");
    assert.equal(lookup.body.id, created.body.id);

    const duplicate = await request("/products", "POST", {
      name: "Other Beans",
      variants: [{
        name: "250 g",
        sku: "COFFEE-250",
        unitCostMinor: 1,
        currency: "PHP",
      }],
    });
    assert.equal(duplicate.status, 409);
  });

  it("tracks stock receipts, FIFO costs, batch allocations, and movement history", async () => {
    const { productId, variantId } = await createProduct(0, "Resealable 250 g pouch");
    const firstReceipt = await request("/stock/in", "POST", {
      variantId,
      quantity: 5,
      lotNumber: "LOT-A",
      unitCostMinor: 100,
      reference: "PO-1",
    });
    const secondReceipt = await request("/stock/in", "POST", {
      variantId,
      quantity: 5,
      lotNumber: "LOT-B",
      unitCostMinor: 150,
    });
    assert.equal(firstReceipt.status, 201);
    assert.equal(secondReceipt.status, 201);
    const descriptionUpdate = await request(`/variants/${variantId}`, "PATCH", {
      description: "Updated packaging details",
    });
    assert.equal(descriptionUpdate.status, 200);
    assert.equal((descriptionUpdate.body.variants as JsonObject[])[0].description, "Updated packaging details");

    const issue = await request("/stock/out", "POST", { variantId, quantity: 7 });
    assert.equal(issue.status, 200);
    assert.equal(issue.body.quantityOnHand, 3);

    const valuation = await request("/valuation");
    const totals = valuation.body.items as JsonObject[];
    assert.deepEqual(totals[0], {
      currency: "PHP",
      totalValueMinor: 450,
      totalUnits: 3,
      variantCount: 1,
    });

    const batches = await request(`/batches?variantId=${variantId}`);
    assert.equal((batches.body.items as JsonObject[])[0].variantDescription, "Resealable 250 g pouch");
    assert.deepEqual((batches.body.items as JsonObject[]).map(({ lotNumber, quantityOnHand, valueMinor }) => ({
      lotNumber,
      quantityOnHand,
      valueMinor,
    })), [
      { lotNumber: "LOT-B", quantityOnHand: 3, valueMinor: 450 },
    ]);

    const movements = await request(`/movements?variantId=${variantId}`);
    const items = movements.body.items as JsonObject[];
    assert.equal(items.length, 3);
    assert.equal(items[0].type, "stock_out");
    assert.equal(items[0].variantDescription, "Updated packaging details");
    assert.equal(items[1].variantDescription, "Resealable 250 g pouch");
    assert.equal(items[0].totalCostMinor, 800);
    const allocations = items[0].batchAllocations as JsonObject[];
    assert.deepEqual(allocations.map(({ lotNumber, quantity, unitCostMinor }) => ({
      lotNumber,
      quantity,
      unitCostMinor,
    })), [
      { lotNumber: "LOT-A", quantity: 5, unitCostMinor: 100 },
      { lotNumber: "LOT-B", quantity: 2, unitCostMinor: 150 },
    ]);
    assert.ok(allocations.every(({ batchId }) => typeof batchId === "string"));
    const product = await request(`/products/${productId}`);
    assert.equal((product.body.variants as JsonObject[])[0].description, "Updated packaging details");
  });

  it("stores receipt-specific descriptions without changing the catalog", async () => {
    const { productId, variantId } = await createProduct(0, "Catalog description");
    for (const [description, expected] of [
      [undefined, "Catalog description"],
      ["  New receipt packaging  ", "New receipt packaging"],
      ["", ""],
    ] as const) {
      const receipt = await request("/stock/in", "POST", {
        variantId, quantity: 2, variantDescription: description,
      });
      assert.equal(receipt.status, 201);
      const batches = await request(`/batches?variantId=${variantId}`);
      const batch = (batches.body.items as JsonObject[]).find((item) => item.batchId === receipt.body.batchId);
      assert.equal(batch?.variantDescription, expected);
      assert.equal(batch?.unitCostMinor, 100);
      const movements = await request(`/movements?variantId=${variantId}`);
      assert.equal((movements.body.items as JsonObject[])[0].variantDescription, expected);
    }
    for (const invalid of [123, "x".repeat(2001)]) {
      const rejected = await request("/stock/in", "POST", { variantId, quantity: 2, variantDescription: invalid });
      assert.equal(rejected.status, 400);
    }
    const product = await request(`/products/${productId}`);
    assert.equal((product.body.variants as JsonObject[])[0].description, "Catalog description");
    const stock = await request(`/stock?variantId=${variantId}`);
    assert.equal((stock.body.items as JsonObject[])[0].quantityOnHand, 6);
  });

  it("migrates existing databases to add descriptions and default UOM without altering stock", async () => {
    const directory = mkdtempSync(join(tmpdir(), "sellerone-inventory-migration-"));
    const databasePath = join(directory, "inventory.sqlite");
    const initialStore = new InventoryStore(databasePath);
    const existing = initialStore.createProduct({
      name: "Existing catalog",
      variants: [{ name: "Standard", sku: "EXISTING-1", unitCostMinor: 100, currency: "PHP" }],
    }) as JsonObject;
    const variantId = String((existing.variants as JsonObject[])[0].id);
    initialStore.stockIn({ variantId, quantity: 2 });
    initialStore.close();
    const legacyDatabase = new DatabaseSync(databasePath);
    legacyDatabase.exec("ALTER TABLE variants DROP COLUMN description; ALTER TABLE variants DROP COLUMN uom; ALTER TABLE batches DROP COLUMN variant_description;");
    legacyDatabase.close();

    const migratedStore = new InventoryStore(databasePath);
    try {
      const migrated = migratedStore.getProduct(String(existing.id)) as JsonObject;
      const variant = (migrated.variants as JsonObject[])[0];
      assert.equal(variant.uom, "pcs");
      assert.equal(variant.uomLocked, true);
      const balance = (migratedStore.listStock({ variantId }) as JsonObject[])[0];
      assert.equal(balance.quantityOnHand, 2);
      assert.equal(balance.uom, "pcs");
      assert.throws(() => migratedStore.updateVariant(variantId, { uom: "kg" }), /UOM cannot be changed/);
      const product = migratedStore.createProduct({
        name: "Legacy catalog",
        variants: [{ name: "Standard", sku: "LEGACY-1", unitCostMinor: 100, currency: "PHP" }],
      }) as { variants: JsonObject[] };
      assert.equal(product.variants[0].description, null);
      assert.equal(product.variants[0].uom, "pcs");
    } finally {
      migratedStore.close();
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("rejects overselling and keeps concurrent stock-outs atomic", async () => {
    const { variantId } = await createProduct();
    await request("/stock/in", "POST", { variantId, quantity: 5 });

    const results = await Promise.all([
      request("/stock/out", "POST", { variantId, quantity: 4 }),
      request("/stock/out", "POST", { variantId, quantity: 4 }),
    ]);
    assert.deepEqual(results.map((result) => result.status).sort(), [200, 409]);
    const stock = await request(`/stock?variantId=${variantId}`);
    const items = stock.body.items as JsonObject[];
    assert.equal(items[0].quantityOnHand, 1);
  });

  it("isolates lot-specific stock and rejects invalid dates and quantities", async () => {
    const { variantId } = await createProduct();
    const receipt = await request("/stock/in", "POST", {
      variantId,
      quantity: 4,
      lotNumber: "LOT-A",
      expiresAt: "2027-01-31",
    });
    assert.equal(receipt.status, 201);

    const wrongLot = await request("/stock/out", "POST", {
      variantId,
      quantity: 1,
      lotNumber: "LOT-MISSING",
    });
    assert.equal(wrongLot.status, 409);
    const invalidDate = await request("/stock/in", "POST", {
      variantId,
      quantity: 1,
      expiresAt: "2027-02-30",
    });
    assert.equal(invalidDate.status, 400);
    const invalidQuantity = await request("/stock/in", "POST", { variantId, quantity: 0 });
    assert.equal(invalidQuantity.status, 400);
    const stock = await request(`/stock?variantId=${variantId}`);
    assert.equal((stock.body.items as JsonObject[])[0].quantityOnHand, 4);
  });

  it("adjusts counted stock and transfers batches without losing lot cost", async () => {
    const { variantId } = await createProduct();
    await request("/stock/in", "POST", {
      variantId,
      quantity: 8,
      lotNumber: "LOT-A",
      unitCostMinor: 125,
    });
    const location = await request("/locations", "POST", { name: "Storefront" });
    assert.equal(location.status, 201);

    const adjustment = await request("/adjustments", "POST", {
      variantId,
      countedQuantity: 6,
      reference: "COUNT-1",
    });
    assert.equal(adjustment.status, 200);
    assert.equal(adjustment.body.adjustment, -2);

    const transfer = await request("/transfers", "POST", {
      variantId,
      sourceLocationId: "main",
      destinationLocationId: String(location.body.id),
      quantity: 3,
    });
    assert.equal(transfer.status, 200);
    const destination = transfer.body.destination as JsonObject;
    assert.equal(destination.quantityOnHand, 3);

    const destinationValuation = await request(`/valuation?locationId=${location.body.id}`);
    assert.equal((destinationValuation.body.items as JsonObject[])[0].totalValueMinor, 375);

    const tooMuch = await request("/transfers", "POST", {
      variantId,
      sourceLocationId: "main",
      destinationLocationId: String(location.body.id),
      quantity: 99,
    });
    assert.equal(tooMuch.status, 409);
  });

  it("reports out-of-stock and low-stock variants", async () => {
    const { variantId } = await createProduct(3);
    const lowStock = await request("/alerts/low-stock");
    assert.equal((lowStock.body.items as JsonObject[]).length, 1);

    await request("/stock/in", "POST", { variantId, quantity: 3 });
    const stock = await request(`/stock?variantId=${variantId}&lowStock=true`);
    assert.equal((stock.body.items as JsonObject[]).length, 1);
    await request("/stock/out", "POST", { variantId, quantity: 3 });
    const outOfStock = await request("/alerts/low-stock");
    assert.equal((outOfStock.body.items as JsonObject[])[0].quantityOnHand, 0);
  });

  it("validates API bodies and returns a useful not-found response", async () => {
    const malformed = await fetch(`${baseUrl}/products`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{",
    });
    assert.equal(malformed.status, 400);

    const missingVariantFields = await request("/products", "POST", {
      name: "Incomplete",
      variants: [{}],
    });
    assert.equal(missingVariantFields.status, 400);
    const invalidCurrency = await request("/products", "POST", {
      name: "Invalid Currency",
      variants: [{
        name: "Standard",
        sku: "BAD-CURRENCY",
        unitCostMinor: 1,
        currency: "ZZZ",
      }],
    });
    assert.equal(invalidCurrency.status, 400);
    const notFound = await request("/products/missing");
    assert.equal(notFound.status, 404);
  });

  it("persists products, batch balances, and movement history across restarts", () => {
    const directory = mkdtempSync(join(tmpdir(), "sellerone-inventory-"));
    const databasePath = join(directory, "inventory.sqlite");
    const firstStore = new InventoryStore(databasePath);
    let reopenedStore: InventoryStore | undefined;
    let firstStoreOpen = true;
    try {
      const product = firstStore.createProduct({
        name: "Persistent Product",
        variants: [{
          name: "Standard",
          sku: "PERSIST-1",
          uom: "liters",
          unitCostMinor: 325,
          currency: "PHP",
        }],
      });
      const productId = String((product as JsonObject).id);
      const variants = (product as JsonObject).variants as JsonObject[];
      const variantId = String(variants[0].id);
      firstStore.stockIn({ variantId, quantity: 4, lotNumber: "PERSIST-LOT" });
      firstStore.close();
      firstStoreOpen = false;

      reopenedStore = new InventoryStore(databasePath);
      const reopenedProduct = reopenedStore.getProduct(productId) as JsonObject;
      assert.equal(reopenedProduct.name, "Persistent Product");
      assert.equal((reopenedProduct.variants as JsonObject[])[0].uom, "liters");
      assert.equal((reopenedProduct.variants as JsonObject[])[0].uomLocked, true);
      const stock = reopenedStore.listStock({ variantId }) as JsonObject[];
      assert.equal(stock[0].quantityOnHand, 4);
      assert.equal(stock[0].uom, "liters");
      const movements = reopenedStore.listMovements({ variantId, limit: 10 }) as JsonObject[];
      assert.equal(movements[0].currency, "PHP");
      assert.equal(movements[0].uom, "liters");
      assert.equal(movements[0].totalCostMinor, 1300);
    } finally {
      if (reopenedStore) {
        reopenedStore.close();
      }
      if (firstStoreOpen) {
        firstStore.close();
      }
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("preserves currency on historical movement records", async () => {
    const { productId, variantId } = await createProduct();
    await request("/stock/in", "POST", { variantId, quantity: 2 });
    await request("/stock/out", "POST", { variantId, quantity: 2 });

    const product = await request(`/products/${productId}`);
    const updated = await request(`/variants/${variantId}`, "PATCH", { currency: "USD" });
    assert.equal(updated.status, 200);
    assert.equal((updated.body.variants as JsonObject[])[0].currency, "USD");

    const movements = await request(`/movements?variantId=${variantId}`);
    assert.ok((movements.body.items as JsonObject[]).every((movement) => movement.currency === "PHP"));
  });

  it("keeps inactive stock visible and movable while excluding it from reorder alerts", async () => {
    const { productId, variantId } = await createProduct(5);
    await request("/stock/in", "POST", { variantId, quantity: 3 });
    const archived = await request(`/products/${productId}`, "PATCH", { active: false });
    assert.equal(archived.status, 200);

    const stock = await request(`/stock?variantId=${variantId}`);
    assert.equal((stock.body.items as JsonObject[])[0].quantityOnHand, 3);
    const alerts = await request("/alerts/low-stock");
    assert.equal((alerts.body.items as JsonObject[]).length, 0);
    const issue = await request("/stock/out", "POST", { variantId, quantity: 1 });
    assert.equal(issue.status, 200);

    const receipt = await request("/stock/in", "POST", { variantId, quantity: 1 });
    assert.equal(receipt.status, 409);
  });
});
