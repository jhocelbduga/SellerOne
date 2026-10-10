import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import {
  InventoryError,
  InventoryStore,
  type AdjustmentInput,
  type ProductInput,
  type ProductPatch,
  type StockInput,
  type StockOutInput,
  type TransferInput,
  type VariantInput,
  type VariantPatch,
} from "./store.js";

const MAX_BODY_SIZE = 1024 * 1024;
const SERVICE_NAME = "inventory";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isStringRecord(value: unknown): value is Record<string, string> {
  return isRecord(value) && Object.values(value).every((item) => typeof item === "string");
}

function requiredString(body: Record<string, unknown>, field: string): string {
  const value = body[field];
  if (typeof value !== "string") {
    throw new InventoryError(`${field} must be a string.`, 400);
  }
  return value;
}

function optionalString(
  body: Record<string, unknown>,
  field: string,
  allowNull = false,
): string | null | undefined {
  const value = body[field];
  if (value === undefined || (allowNull && value === null)) {
    return value;
  }
  if (typeof value !== "string") {
    throw new InventoryError(`${field} must be a string${allowNull ? " or null" : ""}.`, 400);
  }
  return value;
}

function requiredNumber(body: Record<string, unknown>, field: string): number {
  const value = body[field];
  if (typeof value !== "number") {
    throw new InventoryError(`${field} must be a number.`, 400);
  }
  return value;
}

function optionalNumber(body: Record<string, unknown>, field: string): number | undefined {
  const value = body[field];
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== "number") {
    throw new InventoryError(`${field} must be a number.`, 400);
  }
  return value;
}

function optionalBoolean(body: Record<string, unknown>, field: string): boolean | undefined {
  const value = body[field];
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== "boolean") {
    throw new InventoryError(`${field} must be a boolean.`, 400);
  }
  return value;
}

function optionalAttributes(body: Record<string, unknown>): Record<string, string> | undefined {
  const value = body.attributes;
  if (value === undefined) {
    return undefined;
  }
  if (!isStringRecord(value)) {
    throw new InventoryError("attributes must be an object containing string values.", 400);
  }
  return value;
}

function parseVariantInput(body: Record<string, unknown>): VariantInput {
  return {
    name: requiredString(body, "name"),
    sku: requiredString(body, "sku"),
    barcode: optionalString(body, "barcode", true) ?? undefined,
    attributes: optionalAttributes(body),
    unitCostMinor: requiredNumber(body, "unitCostMinor"),
    currency: requiredString(body, "currency"),
    reorderPoint: optionalNumber(body, "reorderPoint"),
  };
}

function parseProductInput(body: Record<string, unknown>): ProductInput {
  if (!Array.isArray(body.variants) || !body.variants.every(isRecord)) {
    throw new InventoryError("variants must be an array of variant objects.", 400);
  }
  return {
    name: requiredString(body, "name"),
    description: optionalString(body, "description") ?? undefined,
    variants: body.variants.map(parseVariantInput),
  };
}

function parseProductPatch(body: Record<string, unknown>): ProductPatch {
  return {
    name: optionalString(body, "name") ?? undefined,
    description: optionalString(body, "description", true),
    active: optionalBoolean(body, "active"),
  };
}

function parseVariantPatch(body: Record<string, unknown>): VariantPatch {
  return {
    name: optionalString(body, "name") ?? undefined,
    sku: optionalString(body, "sku") ?? undefined,
    barcode: optionalString(body, "barcode", true),
    attributes: optionalAttributes(body),
    unitCostMinor: optionalNumber(body, "unitCostMinor"),
    currency: optionalString(body, "currency") ?? undefined,
    reorderPoint: optionalNumber(body, "reorderPoint"),
    active: optionalBoolean(body, "active"),
  };
}

function parseStockInput(body: Record<string, unknown>): StockInput {
  return {
    variantId: requiredString(body, "variantId"),
    locationId: optionalString(body, "locationId") ?? undefined,
    quantity: requiredNumber(body, "quantity"),
    lotNumber: optionalString(body, "lotNumber") ?? undefined,
    expiresAt: optionalString(body, "expiresAt") ?? undefined,
    unitCostMinor: optionalNumber(body, "unitCostMinor"),
    reference: optionalString(body, "reference") ?? undefined,
    note: optionalString(body, "note") ?? undefined,
  };
}

function parseStockOutInput(body: Record<string, unknown>): StockOutInput {
  return {
    ...parseStockInput(body),
    batchId: optionalString(body, "batchId") ?? undefined,
  };
}

function parseAdjustmentInput(body: Record<string, unknown>): AdjustmentInput {
  return {
    variantId: requiredString(body, "variantId"),
    locationId: optionalString(body, "locationId") ?? undefined,
    countedQuantity: requiredNumber(body, "countedQuantity"),
    lotNumber: optionalString(body, "lotNumber") ?? undefined,
    expiresAt: optionalString(body, "expiresAt") ?? undefined,
    reference: optionalString(body, "reference") ?? undefined,
    note: optionalString(body, "note") ?? undefined,
  };
}

function parseTransferInput(body: Record<string, unknown>): TransferInput {
  return {
    variantId: requiredString(body, "variantId"),
    sourceLocationId: requiredString(body, "sourceLocationId"),
    destinationLocationId: requiredString(body, "destinationLocationId"),
    quantity: requiredNumber(body, "quantity"),
    reference: optionalString(body, "reference") ?? undefined,
    note: optionalString(body, "note") ?? undefined,
  };
}

function sendJson(response: ServerResponse, statusCode: number, body: unknown): void {
  response.writeHead(statusCode, { "content-type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(body));
}

async function readJson(request: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > MAX_BODY_SIZE) {
      throw new InventoryError("Request body exceeds the 1 MB limit.", 413);
    }
    chunks.push(buffer);
  }
  if (size === 0) {
    throw new InventoryError("Request body must contain a JSON object.", 400);
  }
  let value: unknown;
  try {
    value = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new InventoryError("Request body must contain valid JSON.", 400);
  }
  if (!isRecord(value)) {
    throw new InventoryError("Request body must be a JSON object.", 400);
  }
  return value;
}

function stringQuery(value: string | null): string | undefined {
  return value === null || value.length === 0 ? undefined : value;
}

function integerQuery(value: string | null, fallback: number, max: number): number {
  if (value === null) {
    return fallback;
  }
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > max) {
    throw new InventoryError(`limit must be an integer between 1 and ${max}.`, 400);
  }
  return parsed;
}

function queryBoolean(value: string | null, field: string): boolean {
  if (value === null || value === "false") {
    return false;
  }
  if (value === "true") {
    return true;
  }
  throw new InventoryError(`${field} must be true or false.`, 400);
}

function routePath(path: string): string[] {
  try {
    return path.split("/").filter(Boolean).map((part) => decodeURIComponent(part));
  } catch {
    throw new InventoryError("Request path contains invalid encoding.", 400);
  }
}

async function handleRequest(
  request: IncomingMessage,
  response: ServerResponse,
  store: InventoryStore,
): Promise<void> {
  const url = new URL(request.url ?? "/", "http://localhost");
  const path = routePath(url.pathname);
  const method = request.method ?? "GET";

  if (method === "GET" && path.length === 1 && path[0] === "health") {
    sendJson(response, 200, { status: "ok", service: SERVICE_NAME });
    return;
  }
  if (method === "GET" && path.length === 0) {
    sendJson(response, 200, {
      service: SERVICE_NAME,
      status: "running",
      endpoints: [
        "GET/POST /products",
        "GET/PATCH /products/:id",
        "GET /products/lookup?code=",
        "POST /products/:id/variants",
        "PATCH /variants/:id",
        "GET/POST /locations",
        "GET /stock",
        "GET /batches",
        "POST /stock/in",
        "POST /stock/out",
        "POST /adjustments",
        "POST /transfers",
        "GET /alerts/low-stock",
        "GET /valuation",
        "GET /movements",
      ],
    });
    return;
  }

  if (path[0] === "products" && path[1] === "lookup" && path.length === 2 && method === "GET") {
    const code = stringQuery(url.searchParams.get("code"));
    if (!code) {
      throw new InventoryError("The code query parameter is required.", 400);
    }
    sendJson(response, 200, store.lookupProduct(code));
    return;
  }
  if (path[0] === "products" && path.length === 1 && method === "GET") {
    sendJson(response, 200, { items: store.listProducts(stringQuery(url.searchParams.get("search"))) });
    return;
  }
  if (path[0] === "products" && path.length === 1 && method === "POST") {
    sendJson(response, 201, store.createProduct(parseProductInput(await readJson(request))));
    return;
  }
  if (path[0] === "products" && path.length === 2 && method === "GET") {
    sendJson(response, 200, store.getProduct(path[1]));
    return;
  }
  if (path[0] === "products" && path.length === 2 && method === "PATCH") {
    sendJson(response, 200, store.updateProduct(path[1], parseProductPatch(await readJson(request))));
    return;
  }
  if (path[0] === "products" && path[2] === "variants" && path.length === 3 && method === "POST") {
    sendJson(response, 201, store.createVariant(path[1], parseVariantInput(await readJson(request))));
    return;
  }
  if (path[0] === "variants" && path.length === 2 && method === "PATCH") {
    sendJson(response, 200, store.updateVariant(path[1], parseVariantPatch(await readJson(request))));
    return;
  }
  if (path[0] === "locations" && path.length === 1 && method === "GET") {
    sendJson(response, 200, { items: store.listLocations() });
    return;
  }
  if (path[0] === "locations" && path.length === 1 && method === "POST") {
    const body = await readJson(request);
    sendJson(response, 201, store.createLocation(requiredString(body, "name")));
    return;
  }
  if (path[0] === "stock" && path.length === 1 && method === "GET") {
    sendJson(response, 200, {
      items: store.listStock({
        locationId: stringQuery(url.searchParams.get("locationId")),
        variantId: stringQuery(url.searchParams.get("variantId")),
        lowStockOnly: queryBoolean(url.searchParams.get("lowStock"), "lowStock"),
      }),
    });
    return;
  }
  if (path[0] === "batches" && path.length === 1 && method === "GET") {
    sendJson(response, 200, {
      items: store.listBatches({
        variantId: stringQuery(url.searchParams.get("variantId")),
        locationId: stringQuery(url.searchParams.get("locationId")),
        lotNumber: stringQuery(url.searchParams.get("lotNumber")),
        includeDepleted: queryBoolean(url.searchParams.get("includeDepleted"), "includeDepleted"),
        limit: integerQuery(url.searchParams.get("limit"), 100, 500),
      }),
    });
    return;
  }
  if (path[0] === "stock" && path[1] === "in" && path.length === 2 && method === "POST") {
    sendJson(response, 201, store.stockIn(parseStockInput(await readJson(request))));
    return;
  }
  if (path[0] === "stock" && path[1] === "out" && path.length === 2 && method === "POST") {
    sendJson(response, 200, store.stockOut(parseStockOutInput(await readJson(request))));
    return;
  }
  if (path[0] === "adjustments" && path.length === 1 && method === "POST") {
    sendJson(response, 200, store.adjustStock(parseAdjustmentInput(await readJson(request))));
    return;
  }
  if (path[0] === "transfers" && path.length === 1 && method === "POST") {
    sendJson(response, 200, store.transferStock(parseTransferInput(await readJson(request))));
    return;
  }
  if (path[0] === "alerts" && path[1] === "low-stock" && path.length === 2 && method === "GET") {
    sendJson(response, 200, { items: store.listStock({ lowStockOnly: true }) });
    return;
  }
  if (path[0] === "valuation" && path.length === 1 && method === "GET") {
    sendJson(response, 200, {
      items: store.getValuation(stringQuery(url.searchParams.get("locationId"))),
      method: "FIFO",
    });
    return;
  }
  if (path[0] === "movements" && path.length === 1 && method === "GET") {
    sendJson(response, 200, {
      items: store.listMovements({
        variantId: stringQuery(url.searchParams.get("variantId")),
        locationId: stringQuery(url.searchParams.get("locationId")),
        limit: integerQuery(url.searchParams.get("limit"), 100, 500),
      }),
    });
    return;
  }
  sendJson(response, 404, { error: "Endpoint not found." });
}

export function createInventoryServer(store: InventoryStore): Server {
  return createServer((request, response) => {
    void handleRequest(request, response, store).catch((error: unknown) => {
      if (response.headersSent) {
        response.destroy(error instanceof Error ? error : undefined);
        return;
      }
      if (error instanceof InventoryError) {
        sendJson(response, error.statusCode, { error: error.message });
        return;
      }
      if (error instanceof Error && error.message.includes("UNIQUE constraint failed")) {
        sendJson(response, 409, { error: "A product SKU, barcode, or location name already exists." });
        return;
      }
      console.error("Inventory request failed:", error);
      sendJson(response, 500, { error: "An internal inventory service error occurred." });
    });
  });
}
