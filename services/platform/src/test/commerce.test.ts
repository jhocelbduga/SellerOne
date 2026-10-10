import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import { mkdtempSync, rmSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { after, before, describe, it } from "node:test";

type Row = Record<string, unknown>;
let child: ChildProcess;
let base: string;
let port: number;
let ownerCookie: string;
let staffCookie: string;
let logs = "";
const directory = mkdtempSync(join(tmpdir(), "sellerone-commerce-test-"));
const databasePath = join(directory, "commerce.sqlite");

async function start(): Promise<void> {
  logs = "";
  child = spawn(process.execPath, [resolve(__dirname, "../index.js")], {
    env: { ...process.env, PORT: String(port), DATABASE_PATH: databasePath, SMTP_HOST: "", NODE_ENV: "test" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout?.on("data", (data) => { logs += String(data); });
  child.stderr?.on("data", (data) => { logs += String(data); });
  const deadline = Date.now() + 10000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`Platform exited: ${logs}`);
    try {
      const response = await fetch(`${base}/api/auth/status`);
      if (response.ok) return;
    } catch (error) {
      if (!(error instanceof TypeError)) throw error;
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`Platform startup timed out: ${logs}`);
}
async function stop(): Promise<void> {
  if (child && child.exitCode === null) {
    const exited = once(child, "exit");
    child.kill();
    await exited;
  }
}
async function request(path: string, method = "GET", body?: Row, cookie = ownerCookie): Promise<{ status: number; body: Row; cookie: string; headers: Headers }> {
  const response = await fetch(`${base}/api${path}`, {
    method, headers: { ...(cookie ? { cookie } : {}), ...(body ? { "content-type": "application/json" } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: response.status, body: await response.json() as Row, cookie: response.headers.get("set-cookie")?.split(";")[0] ?? "", headers: response.headers };
}
async function product(stock = 10): Promise<string> {
  const result = await request("/products", "POST", { name: "Commerce test product", variants: [{ name: "Standard", uom: "box", unitCostMinor: 100, currency: "PHP" }] });
  assert.equal(result.status, 201);
  const id = String((result.body.variants as Row[])[0].id);
  if (stock) assert.equal((await request("/stock/in", "POST", { variantId: id, quantity: stock })).status, 201);
  return id;
}
async function order(variantId: string, quantity = 2, extra: Row = {}): Promise<Row> {
  const result = await request("/orders", "POST", {
    customerName: "Commerce Customer", customerEmail: "buyer@example.test", customerPhone: "09123456789",
    shippingAddress: "Test address", currency: "PHP", channel: "Instagram",
    items: [{ variantId, quantity, unitPriceMinor: 500 }], ...extra,
  });
  assert.equal(result.status, 201, JSON.stringify(result.body));
  return result.body;
}
async function payment(order: Row): Promise<string> {
  const result = await request(`/orders/${order.id}/payments`, "POST", {
    method: "Bank transfer", reference: `TEST-${order.id}`, amountMinor: order.totalMinor, currency: "PHP",
  });
  assert.equal(result.status, 200);
  return String((result.body.payments as Row[]).at(-1)?.id);
}
async function balance(variantId: string): Promise<Row> {
  return ((await request(`/stock?variantId=${variantId}&locationId=main`)).body.items as Row[])[0];
}

before(async () => {
  const socket = createServer();
  await new Promise<void>((resolve) => socket.listen(0, "127.0.0.1", resolve));
  const address = socket.address();
  assert.ok(address && typeof address === "object");
  port = address.port;
  await new Promise<void>((resolve) => socket.close(() => resolve()));
  base = `http://127.0.0.1:${port}`;
  await start();
  const setup = await request("/auth/setup", "POST", {
    name: "Commerce Owner", email: "owner@example.test", password: "Commerce-Test-2026!",
    businessName: "Test commerce", currency: "PHP",
  }, "");
  assert.equal(setup.status, 201);
  ownerCookie = setup.cookie;
  const invite = await request("/users", "POST", { name: "Staff", email: "staff@example.test", role: "staff" });
  const token = new URL(String(invite.body.inviteUrl)).searchParams.get("token");
  const register = await request("/auth/register", "POST", { token, password: "Commerce-Staff-2026!" }, "");
  assert.equal(register.status, 201);
  staffCookie = register.cookie;
});
after(async () => { await stop(); rmSync(directory, { recursive: true, force: true }); });

describe("social commerce platform", () => {
  it("processes received through completed with one FIFO deduction and one sale", async () => {
    const variantId = await product();
    const created = await order(variantId);
    assert.equal(created.stage, "received");
    assert.equal(created.totalMinor, 1000);
    assert.equal(created.businessName, "Test commerce");
    assert.equal((created.items as Row[])[0].uom, "box");
    assert.equal((await balance(variantId)).quantityReserved, 0);
    assert.equal((await request(`/customers/${created.customerId}`)).body.spentMinor, 0);
    assert.equal((await request(`/orders/${created.id}`, "PATCH", { stage: "shipped" })).status, 409);
    assert.equal((await request(`/orders/${created.id}`, "PATCH", { status: "shipped" })).status, 400);
    const paymentId = await payment(created);
    const verified = await request(`/orders/${created.id}/verify-payment`, "POST", { paymentId });
    assert.equal(verified.status, 200);
    assert.equal(verified.body.stage, "payment_verified");
    const reserved = await balance(variantId);
    assert.equal(reserved.quantityOnHand, 10);
    assert.equal(reserved.quantityReserved, 2);
    assert.equal(reserved.quantityAvailable, 8);
    assert.equal((await request(`/orders/${created.id}/verify-payment`, "POST", { paymentId })).status, 409);
    assert.equal((await request(`/orders/${created.id}`, "PATCH", { stage: "packing" })).status, 200);
    const dispatch = { stage: "shipped", carrier: "Test courier", trackingNumber: "TRACK-1" };
    assert.equal((await request(`/orders/${created.id}`, "PATCH", dispatch)).status, 200);
    assert.equal((await request(`/orders/${created.id}`, "PATCH", dispatch)).status, 200);
    const deducted = await balance(variantId);
    assert.equal(deducted.quantityOnHand, 8);
    assert.equal(deducted.quantityReserved, 0);
    assert.equal((await request(`/orders/${created.id}`, "PATCH", { stage: "cancelled" })).status, 409);
    assert.equal((await request(`/orders/${created.id}`, "PATCH", { stage: "delivered" })).status, 200);
    assert.equal((await request(`/orders/${created.id}`, "PATCH", { stage: "completed" })).status, 200);
    assert.equal((await request(`/orders/${created.id}`, "PATCH", { stage: "completed" })).status, 200);
    const sales = ((await request("/sales")).body.items as Row[]).filter((sale) => String(sale.description).includes(String(created.orderNumber)));
    assert.equal(sales.length, 1);
    assert.equal(sales[0].amountMinor, 1000);
    assert.equal((await request(`/customers/${created.customerId}`)).body.spentMinor, 1000);
    assert.ok(((await request("/reports")).body.orders as Row[]).some((row) => row.status === "completed"));
    const movements = ((await request(`/movements?variantId=${variantId}`)).body.items as Row[]).filter((item) => item.type === "stock_out");
    assert.equal(movements.length, 1);
    assert.equal(movements[0].totalCostMinor, 200);
    const completed = (await request(`/orders/${created.id}`)).body;
    assert.deepEqual((completed.timeline as Row[]).map((event) => event.stage), ["received", "received", "payment_verified", "packing", "shipped", "delivered", "completed"]);
  });

  it("rejects invalid payments and enforces owner/admin verification", async () => {
    const created = await order(await product());
    assert.equal((await request(`/orders/${created.id}/payments`, "POST", { method: "GCash", reference: "WRONG", amountMinor: 1, currency: "PHP" })).status, 400);
    const paymentId = await payment(created);
    assert.equal((await request(`/orders/${created.id}/verify-payment`, "POST", { paymentId }, staffCookie)).status, 403);
    assert.equal((await request(`/orders/${created.id}/reject-payment`, "POST", { paymentId, note: "" })).status, 400);
    assert.equal((await request(`/orders/${created.id}/reject-payment`, "POST", { paymentId, note: "Funds not received" })).status, 200);
    assert.equal((await request(`/orders/${created.id}/verify-payment`, "POST", { paymentId })).status, 409);
    const resubmit = await request(`/orders/${created.id}/payments`, "POST", { method: "GCash", reference: `SECOND-${created.id}`, amountMinor: 1000, currency: "PHP" });
    assert.equal(resubmit.status, 200);
    assert.equal((resubmit.body.payments as Row[]).length, 2);
    assert.equal((await request("/orders/import", "POST", {}, staffCookie)).status, 403);
    assert.equal((await request("/checkout-links", "GET", undefined, staffCookie)).status, 403);
  });

  it("reserves atomically across competing orders and blocks manual reserved-stock consumption", async () => {
    const variantId = await product(3);
    const first = await order(variantId, 2);
    const second = await order(variantId, 2);
    const firstPayment = await payment(first);
    const secondPayment = await payment(second);
    const results = await Promise.all([
      request(`/orders/${first.id}/verify-payment`, "POST", { paymentId: firstPayment }),
      request(`/orders/${second.id}/verify-payment`, "POST", { paymentId: secondPayment }),
    ]);
    assert.deepEqual(results.map((result) => result.status).sort(), [200, 409]);
    const stock = await balance(variantId);
    assert.equal(stock.quantityReserved, 2);
    assert.equal(stock.quantityAvailable, 1);
    const failed = results.find((result) => result.status === 409)!;
    assert.match(String(failed.body.error), /available stock/);
    assert.equal((await request("/stock/out", "POST", { variantId, quantity: 2 })).status, 409);
    assert.equal((await request("/adjustments", "POST", { variantId, countedQuantity: 1 })).status, 409);
    const location = (await request("/locations", "POST", { name: "Reserved test destination" })).body;
    assert.equal((await request("/transfers", "POST", { variantId, sourceLocationId: "main", destinationLocationId: location.id, quantity: 2 })).status, 409);
    const loser = results[0].status === 409 ? first : second;
    const unchanged = (await request(`/orders/${loser.id}`)).body;
    assert.equal(unchanged.stage, "received");
    assert.equal((unchanged.payments as Row[])[0].status, "submitted");
  });

  it("rolls back partial reservations for multi-item orders and protects order UOM snapshots", async () => {
    const firstId = await product(5);
    const secondId = await product(1);
    const created = await order(firstId, 1, { items: [{ variantId: firstId, quantity: 2, unitPriceMinor: 500 }, { variantId: secondId, quantity: 2, unitPriceMinor: 500 }] });
    const paymentId = await payment(created);
    assert.equal((await request(`/orders/${created.id}/verify-payment`, "POST", { paymentId })).status, 409);
    assert.equal((await balance(firstId)).quantityReserved, 0);
    assert.equal((await balance(secondId)).quantityReserved, 0);
    const emptyId = await product(0);
    const unstocked = await order(emptyId);
    await request(`/variants/${emptyId}`, "PATCH", { uom: "kg" });
    await request("/stock/in", "POST", { variantId: emptyId, quantity: 4 });
    const secondPayment = await payment(unstocked);
    const conflict = await request(`/orders/${unstocked.id}/verify-payment`, "POST", { paymentId: secondPayment });
    assert.equal(conflict.status, 409);
    assert.match(String(conflict.body.error), /UOM changed/);
  });

  it("releases cancelled reservations and records explicit manual refunds", async () => {
    const variantId = await product(4);
    const created = await order(variantId);
    const paymentId = await payment(created);
    await request(`/orders/${created.id}/verify-payment`, "POST", { paymentId });
    const cancelled = await request(`/orders/${created.id}`, "PATCH", { stage: "cancelled" });
    assert.equal(cancelled.body.refundDue, true);
    const stock = await balance(variantId);
    assert.equal(stock.quantityOnHand, 4);
    assert.equal(stock.quantityReserved, 0);
    assert.equal((await request(`/orders/${created.id}/refund`, "POST", { note: "REFUND-1" }, staffCookie)).status, 403);
    const refund = await request(`/orders/${created.id}/refund`, "POST", { note: "REFUND-1" });
    assert.equal(refund.status, 200);
    assert.equal(refund.body.refundDue, false);
    assert.equal((refund.body.payments as Row[])[0].status, "refunded");
    assert.equal((await request(`/orders/${created.id}`, "PATCH", { stage: "packing" })).status, 409);
  });

  it("imports idempotently by channel/external ID without duplicate customers or items", async () => {
    const variantId = await product();
    const payload = { channel: "TikTok Shop", externalId: "CHANNEL-TEST-001", customerName: "Imported Customer", currency: "PHP", items: [{ variantId, quantity: 3, unitPriceMinor: 1000 }] };
    const results = await Promise.all([request("/orders/import", "POST", payload), request("/orders/import", "POST", payload)]);
    assert.deepEqual(results.map((result) => result.status), [200, 200]);
    assert.equal(results[0].body.id, results[1].body.id);
    assert.equal((results[1].body.items as Row[]).length, 1);
    assert.equal((results[1].body.timeline as Row[]).length, 1);
    const customers = ((await request("/customers")).body.items as Row[]).filter((customer) => customer.name === "Imported Customer");
    assert.equal(customers.length, 1);
    assert.equal((await request("/orders/import", "POST", { ...payload, externalId: undefined })).status, 400);
    assert.equal((await request("/orders", "POST", { ...payload, channel: "Unsupported" })).status, 400);
    assert.equal((await request("/orders", "POST", { ...payload, externalId: undefined, status: "shipped" })).status, 400);
    const manual = { ...payload, externalId: undefined, idempotencyKey: "MANUAL-RETRY" };
    const first = await request("/orders", "POST", manual);
    const retry = await request("/orders", "POST", manual);
    assert.equal(first.status, 201);
    assert.equal(first.body.id, retry.body.id);
  });

  it("validates checkout offers and prevents duplicate payment references and invalid items", async () => {
    const variantId = await product(3);
    const item = { variantId, quantity: 1, unitPriceMinor: 500 };
    const offer = { title: "Offer", currency: "PHP", items: [item] };
    assert.equal((await request("/checkout-links", "POST", { ...offer, items: [item, item] })).status, 400);
    assert.equal((await request("/checkout-links", "POST", { ...offer, validDays: 91 })).status, 400);
    assert.equal((await request("/checkout-links", "POST", { ...offer, validDays: 0 })).status, 400);
    const link = (await request("/checkout-links", "POST", offer)).body;
    const token = String(link.checkoutPath).split("/").at(-1);
    const other = await product();
    const payload = { idempotencyKey: "INVALID-CART", customerName: "Invalid", customerPhone: "09123456789", shippingAddress: "Test address", items: [{ variantId: other, quantity: 1 }] };
    assert.equal((await request(`/public/checkout/${token}`, "POST", payload, "")).status, 400);
    assert.equal((await request(`/public/checkout/${token}`, "POST", { ...payload, items: [{ variantId, quantity: 1.5 }] }, "")).status, 400);
    assert.equal((await request(`/public/checkout/${token}`, "POST", { ...payload, items: [{ variantId, quantity: 2 }, { variantId, quantity: 2 }] }, "")).status, 409);
    const first = await order(variantId, 1);
    const second = await order(variantId, 1);
    const paymentBody = { method: "GCash", reference: "UNIQUE-REFERENCE-TEST", amountMinor: 500, currency: "PHP" };
    assert.equal((await request(`/orders/${first.id}/payments`, "POST", paymentBody)).status, 200);
    assert.equal((await request(`/orders/${second.id}/payments`, "POST", paymentBody)).status, 409);
    assert.equal((await request("/orders", "POST", { customerName: "Wrong currency", currency: "USD", items: [item] })).status, 400);
    assert.equal((await request("/orders", "POST", { customerName: "Bad item", items: [{ variantId: "missing", quantity: 1, unitPriceMinor: 1 }] })).status, 409);
  });

  it("provides price-authoritative checkout, private tracking and duplicate-safe retries", async () => {
    const variantId = await product(5);
    const link = await request("/checkout-links", "POST", { title: "Social checkout", currency: "PHP", items: [{ variantId, quantity: 1, unitPriceMinor: 750 }] });
    assert.equal(link.status, 201);
    const token = String(link.body.checkoutPath).split("/").at(-1);
    const offered = await request(`/public/checkout/${token}`, "GET", undefined, "");
    assert.equal(offered.status, 200);
    assert.equal(offered.headers.get("cache-control"), "no-store");
    assert.equal((offered.body.items as Row[])[0].unitPriceMinor, 750);
    assert.equal((offered.body.items as Row[])[0].maxQuantity, 5);
    assert.ok(!JSON.stringify(offered.body).includes("unitCost"));
    const payload = { idempotencyKey: "CHECKOUT-TEST-001", customerName: "Private Buyer", customerEmail: "private@example.test", customerPhone: "09123456789", shippingAddress: "Private delivery address", items: [{ variantId, quantity: 2, unitPriceMinor: 1 }] };
    const received = await request(`/public/checkout/${token}`, "POST", payload, "");
    assert.equal(received.status, 201);
    assert.equal(received.body.totalMinor, 1500);
    const retry = await request(`/public/checkout/${token}`, "POST", payload, "");
    assert.equal(retry.body.orderNumber, received.body.orderNumber);
    const publicJson = JSON.stringify(received.body);
    for (const hidden of ["private@example.test", "Private delivery address", "Private Buyer", "09123456789", "actor", "customerId", "reviewNote"]) assert.ok(!publicJson.includes(hidden));
    const trackingToken = String(received.body.trackingPath).split("/").at(-1);
    const tracked = await request(`/public/tracking/${trackingToken}`, "GET", undefined, "");
    assert.equal(tracked.body.stage, "received");
    assert.equal((await request("/orders", "GET", undefined, "")).status, 401);
    const internal = ((await request("/orders")).body.items as Row[]).find((item) => item.orderNumber === received.body.orderNumber)!;
    const submitted = await request(`/public/tracking/${trackingToken}/payments`, "POST", { method: "GCash", reference: "PUBLIC-PAYMENT-1", amountMinor: 1500, currency: "PHP" }, "");
    assert.equal(submitted.status, 201);
    assert.equal(submitted.body.paymentStatus, "submitted");
    const internalDetails = (await request(`/orders/${internal.id}`)).body;
    const paymentId = (internalDetails.payments as Row[])[0].id;
    assert.equal((await request(`/orders/${internal.id}/verify-payment`, "POST", { paymentId }, "")).status, 401);
    await request(`/orders/${internal.id}/communications`, "POST", { message: "Private draft", status: "prepared" });
    await request(`/orders/${internal.id}/communications`, "POST", { message: "Hello buyer", status: "sent" });
    const messages = (await request(`/public/tracking/${trackingToken}`, "GET", undefined, "")).body.messages as Row[];
    assert.equal(messages.length, 1);
    assert.equal(messages[0].message, "Hello buyer");
    assert.equal((await request(`/public/checkout/${token}`, "POST", { ...payload, idempotencyKey: "TOO-MANY", items: [{ variantId, quantity: 6 }] }, "")).status, 409);
    await request(`/checkout-links/${link.body.id}`, "DELETE");
    assert.equal((await request(`/public/checkout/${token}`, "GET", undefined, "")).status, 404);
    assert.equal((await request("/public/tracking/not-a-token", "GET", undefined, "")).status, 404);
    assert.equal((await request(`/public/tracking/${trackingToken}`, "GET", undefined, "")).status, 200);
  });

  it("requires shipping data before dispatch and preserves reservations on validation failure", async () => {
    const variantId = await product();
    const created = await order(variantId, 2, { shippingAddress: "", customerPhone: "" });
    const paymentId = await payment(created);
    await request(`/orders/${created.id}/verify-payment`, "POST", { paymentId });
    await request(`/orders/${created.id}`, "PATCH", { stage: "packing" });
    assert.equal((await request(`/orders/${created.id}`, "PATCH", { stage: "shipped", carrier: "Courier", trackingNumber: "SHIP-1" })).status, 409);
    assert.equal((await balance(variantId)).quantityReserved, 2);
    assert.equal((await balance(variantId)).quantityOnHand, 10);
    assert.equal((await request(`/orders/${created.id}/shipping`, "POST", { customerPhone: "09123456789", shippingAddress: "Updated address" })).status, 200);
    assert.equal((await request(`/orders/${created.id}`, "PATCH", { stage: "shipped", carrier: "Courier", trackingNumber: "SHIP-1" })).status, 200);
    assert.equal((await request(`/orders/${created.id}/shipping`, "POST", { customerPhone: "09123456789", shippingAddress: "Changed address" })).status, 409);
  });

  it("filters across all orders with stable pagination rather than truncating the inbox", async () => {
    const variantId = await product();
    for (let index = 0; index < 51; index++) {
      await order(variantId, 1, { customerName: `Pagination Buyer ${index}`, channel: "Facebook Marketplace" });
    }
    const first = await request("/orders?search=Pagination%20Buyer&channel=Facebook%20Marketplace&stage=received&payment=unpaid&page=1");
    const second = await request("/orders?search=Pagination%20Buyer&channel=Facebook%20Marketplace&stage=received&payment=unpaid&page=2");
    assert.equal(first.status, 200);
    assert.equal(first.body.total, 51);
    assert.equal((first.body.items as Row[]).length, 50);
    assert.equal((second.body.items as Row[]).length, 1);
    const ids = [...first.body.items as Row[], ...second.body.items as Row[]].map((item) => item.id);
    assert.equal(new Set(ids).size, 51);
    assert.equal((await request("/orders?page=0")).status, 400);
    assert.equal((await request("/orders?stage=invalid")).status, 400);
  });

  it("persists workflow and reservations across restart and migrates legacy statuses", async () => {
    const variantId = await product();
    const created = await order(variantId);
    const paymentId = await payment(created);
    await request(`/orders/${created.id}/verify-payment`, "POST", { paymentId });
    await stop();
    const db = new DatabaseSync(databasePath);
    try {
      db.prepare(`INSERT INTO orders (id, order_number, customer_name, status, channel, total_minor, currency, created_at, updated_at)
        VALUES ('legacy-order', 'LEGACY-ORDER', 'Legacy Customer', 'processing', 'Manual', 100, 'PHP', ?, ?)`)
        .run(new Date().toISOString(), new Date().toISOString());
    } finally { db.close(); }
    await start();
    const restored = (await request(`/orders/${created.id}`)).body;
    assert.equal(restored.stage, "payment_verified");
    assert.equal((restored.payments as Row[])[0].status, "verified");
    assert.equal((await balance(variantId)).quantityReserved, 2);
    const legacy = (await request("/orders/legacy-order")).body;
    assert.equal(legacy.stage, "received");
    assert.equal(legacy.trackingPath, null);
    assert.equal((await request(`/public/tracking/${String(restored.trackingPath).split("/").at(-1)}`, "GET", undefined, "")).status, 200);
  });
});
