import assert from "node:assert/strict";
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

async function createProduct(reorderPoint = 0): Promise<{ productId: string; variantId: string }> {
  const response = await request("/products", "POST", {
    name: "Coffee Beans",
    description: "Roasted coffee",
    variants: [{
      name: "250 g",
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
  it("serves health status and creates searchable products with SKU lookup", async () => {
    const health = await request("/health");
    assert.equal(health.status, 200);
    assert.equal(health.body.status, "ok");

    const created = await request("/products", "POST", {
      name: "Coffee Beans",
      variants: [{
        name: "250 g",
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
    const { variantId } = await createProduct();
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
      const stock = reopenedStore.listStock({ variantId }) as JsonObject[];
      assert.equal(stock[0].quantityOnHand, 4);
      const movements = reopenedStore.listMovements({ variantId, limit: 10 }) as JsonObject[];
      assert.equal(movements[0].currency, "PHP");
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
