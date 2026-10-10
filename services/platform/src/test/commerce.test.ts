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
  it("keeps shortages unverified then resumes the full workflow after receiving stock", async () => {
    const variantId = await product(0);
    const created = await order(variantId, 5, { items: [{ variantId, quantity: 2, unitPriceMinor: 500 }, { variantId, quantity: 3, unitPriceMinor: 500 }] });
    const paymentId = await payment(created);
    const blocked = await request(`/orders/${created.id}/verify-payment`, "POST", { paymentId });
    assert.equal(blocked.status, 409);
    assert.match(String(blocked.body.error), /Commerce test product.*Standard/);
    assert.match(String(blocked.body.error), /available: 0 box/);
    assert.match(String(blocked.body.error), /Main Warehouse/);
    const unchanged = (await request(`/orders/${created.id}`)).body;
    assert.equal(unchanged.stage, "received");
    assert.equal((unchanged.payments as Row[])[0].status, "submitted");
    assert.equal((await balance(variantId)).quantityReserved, 0);
    assert.equal((await request("/stock/in", "POST", { variantId, quantity: 5, locationId: "main" })).status, 201);
    assert.equal((await request(`/orders/${created.id}/verify-payment`, "POST", { paymentId })).status, 200);
    assert.equal((await balance(variantId)).quantityReserved, 5);
    assert.equal((await request(`/orders/${created.id}`, "PATCH", { stage: "packing" })).status, 200);
    assert.equal((await request(`/orders/${created.id}`, "PATCH", { stage: "shipped", carrier: "Test courier" })).status, 200);
    assert.equal((await balance(variantId)).quantityOnHand, 0);
    assert.equal((await balance(variantId)).quantityReserved, 0);
    assert.equal((await request(`/orders/${created.id}`, "PATCH", { stage: "delivered" })).status, 200);
    assert.equal((await request(`/orders/${created.id}`, "PATCH", { stage: "completed" })).status, 200);
    assert.equal((await request(`/orders/${created.id}`, "PATCH", { stage: "completed" })).status, 200);
    const sales = ((await request("/sales")).body.items as Row[]).filter((row) => row.orderId === created.id);
    assert.equal(sales.length, 1);
    assert.equal(sales[0].amountMinor, 2500);
  });

  it("defaults order, import and offer prices from catalog while preserving overrides and snapshots", async () => {
    const variantId = await product();
    assert.equal((await request(`/variants/${variantId}`, "PATCH", { sellingPriceMinor: 12550 })).status, 200);
    const created = await order(variantId, 2, { items: [{ variantId, quantity: 2 }] });
    assert.equal(created.totalMinor, 25100);
    const overridden = await order(variantId, 1, { items: [{ variantId, quantity: 1, unitPriceMinor: 9900 }] });
    assert.equal(overridden.totalMinor, 9900);
    const free = await order(variantId, 1, { items: [{ variantId, quantity: 1, unitPriceMinor: 0 }] });
    assert.equal(free.totalMinor, 0);
    const offer = await request("/checkout-links", "POST", { title: "Catalog price offer", currency: "PHP", items: [{ variantId, quantity: 1 }], validDays: 7 });
    assert.equal(offer.status, 201);
    const imported = await request("/orders/import", "POST", { channel: "Instagram", externalId: "catalog-price-import", customerName: "Price test", currency: "PHP", items: [{ variantId, quantity: 1 }] });
    assert.equal(imported.status, 200);
    assert.equal(imported.body.totalMinor, 12550);
    assert.equal((await request(`/variants/${variantId}`, "PATCH", { sellingPriceMinor: 18000 })).status, 200);
    assert.equal((await request(`/orders/${created.id}`)).body.totalMinor, 25100);
    const publicOffer = await request(`/public/checkout/${String(offer.body.checkoutPath).split("/").at(-1)}`, "GET", undefined, "");
    assert.equal((publicOffer.body.items as Row[])[0].unitPriceMinor, 12550);
    assert.equal(JSON.stringify(publicOffer.body).includes("unitCostMinor"), false);
    await stop(); await start();
    const products = (await request("/products")).body.items as Row[];
    const saved = products.flatMap((p) => p.variants as Row[]).find((v) => v.id === variantId);
    assert.equal(saved?.sellingPriceMinor, 18000);
    for (const invalid of [null, "500", -1]) {
      assert.equal((await request("/orders", "POST", { customerName: "Price test", currency: "PHP", items: [{ variantId, quantity: 1, unitPriceMinor: invalid }] })).status, 400);
    }
    assert.equal((await request(`/variants/${variantId}`, "PATCH", { sellingPriceMinor: null })).status, 200);
    assert.equal((await request("/orders", "POST", { customerName: "Unpriced test", currency: "PHP", items: [{ variantId, quantity: 1 }] })).status, 400);
  });

  it("saves customer-specific social links with domain validation, removal and restart persistence", async () => {
    const links = {
      facebookUrl: "https://www.facebook.com/fictional.customer",
      instagramUrl: "https://www.instagram.com/fictional.customer",
      tiktokUrl: "https://www.tiktok.com/@fictional.customer",
      whatsappUrl: "https://wa.me/12025550101",
      websiteUrl: "https://example.test/profile",
    };
    const created = await request("/customers", "POST", { name: "Social test customer", email: "social@example.test", ...links });
    assert.equal(created.status, 201);
    const customerPath = `/customers/${created.body.id}`;
    for (const [key, value] of Object.entries(links)) assert.equal(created.body[key], value);
    const second = await request("/customers", "POST", { name: "Unlinked customer" });
    assert.equal(second.status, 201);
    assert.equal(second.body.facebookUrl, null);
    assert.equal((await request(customerPath, "PATCH", { facebookUrl: "https://facebook.com/changed" }, "")).status, 401);
    for (const facebookUrl of ["javascript:alert(1)", "http://facebook.com/test", "https://facebook.com.example.test/test", "https://user:password@facebook.com/test", 123, "x".repeat(2001)]) {
      assert.equal((await request(customerPath, "PATCH", { facebookUrl, name: "Invalid change" })).status, 400);
    }
    assert.equal((await request(customerPath)).body.name, "Social test customer");
    assert.equal((await request(customerPath)).body.facebookUrl, links.facebookUrl);
    assert.equal((await request("/customers", "POST", { name: "Invalid new customer", instagramUrl: "https://tiktok.com/wrong" })).status, 400);
    const updated = await request(customerPath, "PATCH", { facebookUrl: "  https://facebook.com/changed  ", instagramUrl: "", tiktokUrl: null, whatsappUrl: "   " });
    assert.equal(updated.status, 200);
    assert.equal(updated.body.facebookUrl, "https://facebook.com/changed");
    assert.equal(updated.body.instagramUrl, null);
    assert.equal(updated.body.tiktokUrl, null);
    assert.equal(updated.body.whatsappUrl, null);
    assert.equal(updated.body.websiteUrl, links.websiteUrl);
    assert.equal((await request(`/customers/${second.body.id}`)).body.facebookUrl, null);
    const listed = ((await request("/customers")).body.items as Row[]).find((row) => row.id === created.body.id);
    assert.equal(listed?.facebookUrl, "https://facebook.com/changed");
    await stop();
    await start();
    const restored = (await request(customerPath)).body;
    assert.equal(restored.facebookUrl, "https://facebook.com/changed");
    assert.equal(restored.websiteUrl, links.websiteUrl);
    const captured = await order(await product(), 1, { customerId: created.body.id });
    const publicTracking = await request(`/public/tracking/${String(captured.trackingPath).split("/").at(-1)}`, "GET", undefined, "");
    assert.equal(publicTracking.status, 200);
    assert.equal(JSON.stringify(publicTracking.body).includes("facebook.com/changed"), false);
    assert.equal(JSON.stringify(publicTracking.body).includes("example.test/profile"), false);
  });

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
    const dispatch = { stage: "shipped", carrier: "Test courier", trackingNumber: "  TRACK-1  " };
    const dispatched = await request(`/orders/${created.id}`, "PATCH", dispatch);
    assert.equal(dispatched.status, 200);
    assert.equal(dispatched.body.trackingNumber, "TRACK-1");
    assert.equal((await request(`/orders/${created.id}`, "PATCH", dispatch)).status, 200);
    const deducted = await balance(variantId);
    assert.equal(deducted.quantityOnHand, 8);
    assert.equal(deducted.quantityReserved, 0);
    assert.equal((await request(`/orders/${created.id}`, "PATCH", { stage: "cancelled" })).status, 409);
    assert.equal((await request(`/orders/${created.id}`, "PATCH", { stage: "delivered" })).status, 200);
    assert.equal(((await request("/sales")).body.items as Row[]).filter((sale) => sale.orderId === created.id).length, 0);
    assert.equal((await request(`/orders/${created.id}`, "PATCH", { stage: "completed" })).status, 200);
    assert.equal((await request(`/orders/${created.id}`, "PATCH", { stage: "completed" })).status, 200);
    const sales = ((await request("/sales")).body.items as Row[]).filter((sale) => String(sale.description).includes(String(created.orderNumber)));
    assert.equal(sales.length, 1);
    assert.equal(sales[0].orderId, created.id);
    assert.equal(sales[0].amountMinor, 1000);
    assert.equal((await request(`/customers/${created.customerId}`)).body.spentMinor, 1000);
    assert.ok(((await request("/reports")).body.orders as Row[]).some((row) => row.status === "completed"));
    const movements = ((await request(`/movements?variantId=${variantId}`)).body.items as Row[]).filter((item) => item.type === "stock_out");
    assert.equal(movements.length, 1);
    assert.equal(movements[0].totalCostMinor, 200);
    const completed = (await request(`/orders/${created.id}`)).body;
    assert.deepEqual((completed.timeline as Row[]).map((event) => event.stage), ["received", "received", "payment_verified", "packing", "shipped", "delivered", "completed"]);
  });

  it("lists manual sales without a linked order", async () => {
    const saved = await request("/sales", "POST", { customerName: "Fictional Walk-in", description: "Manual test sale", amountMinor: 250, currency: "PHP", channel: "Manual" });
    assert.equal(saved.status, 201);
    const entry = ((await request("/sales")).body.items as Row[]).find((sale) => sale.id === saved.body.id);
    assert.ok(entry);
    assert.equal(entry.orderId, null);
    assert.equal(entry.amountMinor, 250);
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

  it("generates persistent unique payment references when blank and preserves manual references", async () => {
    const variantId = await product();
    const references: string[] = [];
    for (const reference of [undefined, "", "   "]) {
      const created = await order(variantId);
      const result = await request(`/orders/${created.id}/payments`, "POST", {
        method: "Cash", reference, amountMinor: created.totalMinor, currency: "PHP",
      });
      assert.equal(result.status, 200);
      const submitted = (result.body.payments as Row[])[0];
      assert.match(String(submitted.reference), /^PAY-[0-9A-F]{8}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{12}$/);
      assert.equal(submitted.status, "submitted");
      assert.equal(result.body.stage, "received");
      references.push(String(submitted.reference));
      const reread = (await request(`/orders/${created.id}`)).body;
      assert.equal((reread.payments as Row[])[0].reference, submitted.reference);
      assert.equal((await request(`/orders/${created.id}/payments`, "POST", {
        method: "Cash", amountMinor: created.totalMinor, currency: "PHP",
      })).status, 409);
    }
    assert.equal(new Set(references).size, 3);
    const manual = await order(variantId);
    const preserved = await request(`/orders/${manual.id}/payments`, "POST", {
      method: "Bank transfer", reference: "  REAL-TRANSACTION-001  ", amountMinor: manual.totalMinor, currency: "PHP",
    });
    assert.equal((preserved.body.payments as Row[])[0].reference, "REAL-TRANSACTION-001");
    const publicOrder = await order(variantId);
    const token = String(publicOrder.trackingPath).split("/").at(-1);
    const publicResult = await request(`/public/tracking/${token}/payments`, "POST", {
      method: "GCash", reference: "", amountMinor: publicOrder.totalMinor, currency: "PHP",
    }, "");
    assert.equal(publicResult.status, 201);
    assert.equal(publicResult.body.paymentStatus, "submitted");
    assert.ok(!JSON.stringify(publicResult.body).includes("PAY-"));
    const privateResult = (await request(`/orders/${publicOrder.id}`)).body;
    assert.match(String((privateResult.payments as Row[])[0].reference), /^PAY-/);
    const invalidOrder = await order(variantId);
    for (const reference of [null, 123, "x".repeat(151)]) {
      assert.equal((await request(`/orders/${invalidOrder.id}/payments`, "POST", {
        method: "Cash", reference, amountMinor: invalidOrder.totalMinor, currency: "PHP",
      })).status, 400);
    }
    assert.equal(((await request(`/orders/${invalidOrder.id}`)).body.payments as Row[]).length, 0);
    assert.equal((await balance(variantId)).quantityReserved, 0);
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
    assert.equal((await request(`/orders/${created.id}`, "PATCH", { stage: "shipped", carrier: "Courier" })).status, 409);
    assert.equal((await request(`/orders/${created.id}`)).body.trackingNumber, null);
    assert.equal((await balance(variantId)).quantityReserved, 2);
    assert.equal((await balance(variantId)).quantityOnHand, 10);
    assert.equal((await request(`/orders/${created.id}/shipping`, "POST", { customerPhone: "09123456789", shippingAddress: "Updated address" })).status, 200);
    assert.equal((await request(`/orders/${created.id}`, "PATCH", { stage: "shipped", carrier: "Courier", trackingNumber: "SHIP-1" })).status, 200);
    assert.equal((await request(`/orders/${created.id}/shipping`, "POST", { customerPhone: "09123456789", shippingAddress: "Changed address" })).status, 409);
  });

  it("generates unique shipment numbers on dispatch, validates input and preserves retries", async () => {
    const numbers: string[] = [];
    for (const trackingNumber of [undefined, "", "   "]) {
      const variantId = await product();
      const created = await order(variantId);
      const paymentId = await payment(created);
      assert.equal((await request(`/orders/${created.id}/verify-payment`, "POST", { paymentId })).status, 200);
      assert.equal((await request(`/orders/${created.id}`, "PATCH", { stage: "packing" })).status, 200);
      assert.equal((await request(`/orders/${created.id}`)).body.trackingNumber, null);
      for (const invalid of [null, 123, "X".repeat(151)]) {
        assert.equal((await request(`/orders/${created.id}`, "PATCH", { stage: "shipped", carrier: "J&T Express", trackingNumber: invalid })).status, 400);
      }
      assert.equal((await request(`/orders/${created.id}`, "PATCH", { stage: "shipped", carrier: "" })).status, 400);
      assert.equal((await balance(variantId)).quantityOnHand, 10);
      assert.equal((await balance(variantId)).quantityReserved, 2);
      const dispatched = await request(`/orders/${created.id}`, "PATCH", { stage: "shipped", carrier: "J&T Express", trackingNumber });
      assert.equal(dispatched.status, 200);
      assert.equal(dispatched.body.stage, "shipped");
      assert.equal(dispatched.body.carrier, "J&T Express");
      const generated = String(dispatched.body.trackingNumber);
      assert.match(generated, /^SO-TRACK-[0-9A-F]{8}-[0-9A-F]{4}-4[0-9A-F]{3}-[89AB][0-9A-F]{3}-[0-9A-F]{12}$/);
      numbers.push(generated);
      assert.equal((await request(`/orders/${created.id}`)).body.trackingNumber, generated);
      const retry = await request(`/orders/${created.id}`, "PATCH", { stage: "shipped", carrier: "Different carrier", trackingNumber: "REPLACEMENT" });
      assert.equal(retry.status, 200);
      assert.equal(retry.body.trackingNumber, generated);
      assert.equal(retry.body.carrier, "J&T Express");
      assert.equal((await balance(variantId)).quantityOnHand, 8);
      assert.equal((await balance(variantId)).quantityReserved, 0);
      const tracked = await request(`/public/tracking/${String(created.trackingPath).split("/").at(-1)}`, "GET", undefined, "");
      assert.equal(tracked.status, 200);
      assert.equal(tracked.body.trackingNumber, generated);
      assert.equal(tracked.body.carrier, "J&T Express");
    }
    assert.equal(new Set(numbers).size, 3);
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

  it("reports exactly 90 calendar days in the workspace timezone with matching expense totals", async () => {
    const before = (await request("/reports")).body;
    assert.equal(before.timezone, "Asia/Manila");
    const startTime = new Date(`${before.startDay}T00:00:00+08:00`).getTime();
    const end = new Date(`${before.endDay}T00:00:00+08:00`).getTime() + 86400000;
    assert.equal(end - startTime, 90 * 86400000);
    await stop();
    const db = new DatabaseSync(databasePath);
    try {
      const sale = db.prepare(`INSERT INTO sales (id, customer_name, description, amount_minor, currency, channel, created_at)
        VALUES (?, 'Report fixture', 'Report fixture', ?, ?, 'Manual', ?)`);
      const expense = db.prepare(`INSERT INTO expenses (id, description, category, amount_minor, currency, created_at)
        VALUES (?, 'Report fixture', 'Report boundary test', ?, 'PHP', ?)`);
      for (const [index, timestamp, amount] of [[0, startTime - 1, 10000], [1, startTime, 100], [2, startTime + 86400000 - 1, 200], [3, end - 1, 300], [4, end, 20000]]) {
        const date = new Date(timestamp).toISOString();
        sale.run(`report-sale-${index}`, amount, "PHP", date);
        expense.run(`report-expense-${index}`, amount, date);
      }
      sale.run("report-foreign-currency", 99999, "USD", new Date(startTime).toISOString());
    } finally { db.close(); }
    await start();
    const report = (await request("/reports")).body;
    const previousSales = before.sales as Row[];
    const sales = report.sales as Row[];
    const total = (rows: Row[]) => rows.reduce((sum, row) => sum + Number(row.amountMinor), 0);
    assert.equal(total(sales) - total(previousSales), 600);
    const firstDay = sales.find((row) => row.day === before.startDay);
    assert.ok(firstDay);
    assert.equal(Number(firstDay.amountMinor) - Number(previousSales.find((row) => row.day === before.startDay)?.amountMinor ?? 0), 300);
    assert.equal(Number(firstDay.transactionCount) - Number(previousSales.find((row) => row.day === before.startDay)?.transactionCount ?? 0), 2);
    assert.ok(sales.every((row) => String(row.day) >= String(report.startDay) && String(row.day) <= String(report.endDay)));
    const expenses = report.expenses as Row[];
    const boundaryExpenses = expenses.find((row) => row.category === "Report boundary test");
    assert.ok(boundaryExpenses);
    assert.equal(boundaryExpenses.amountMinor, 600);
    assert.equal(boundaryExpenses.transactionCount, 3);
  });

  it("persists workflow and reservations across restart and migrates legacy statuses", async () => {
    const variantId = await product();
    const created = await order(variantId);
    const paymentId = await payment(created);
    await request(`/orders/${created.id}/verify-payment`, "POST", { paymentId });
    const shipment = await order(variantId, 1);
    const shipmentPayment = await payment(shipment);
    assert.equal((await request(`/orders/${shipment.id}/verify-payment`, "POST", { paymentId: shipmentPayment })).status, 200);
    assert.equal((await request(`/orders/${shipment.id}`, "PATCH", { stage: "packing" })).status, 200);
    const dispatched = await request(`/orders/${shipment.id}`, "PATCH", { stage: "shipped", carrier: "Custom courier" });
    assert.equal(dispatched.status, 200);
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
    const restoredShipment = (await request(`/orders/${shipment.id}`)).body;
    assert.equal(restoredShipment.stage, "shipped");
    assert.equal(restoredShipment.trackingNumber, dispatched.body.trackingNumber);
    assert.equal(restoredShipment.carrier, "Custom courier");
    const legacy = (await request("/orders/legacy-order")).body;
    assert.equal(legacy.stage, "received");
    assert.equal(legacy.trackingPath, null);
    assert.equal((await request(`/public/tracking/${String(restored.trackingPath).split("/").at(-1)}`, "GET", undefined, "")).status, 200);
  });
});
