import React, { useEffect, useState } from "react";
import { Link, useLocation, useNavigate, useParams } from "react-router-dom";
import { api, dateLabel, money, useLoad } from "./api";
import { canAccessPage, isAdmin, type Role } from "./roles";

const channels = ["Manual", "TikTok Shop", "Facebook Marketplace", "Facebook Page", "Facebook Messenger", "Instagram", "Shareable Order Link"];
const carriers = ["J&T Express", "JRS Express", "LBC Express", "Ninja Van", "Flash Express", "SPX Express", "GoGo Xpress", "GrabExpress", "Lalamove"];
const stages = ["received", "payment_verified", "packing", "shipped", "delivered", "completed", "cancelled"];
interface Variant { id: string; name: string; sku: string; uom: string; currency: string; active: boolean; sellingPriceMinor: number | null }
interface Product { id: string; name: string; active: boolean; variants: Variant[] }
interface CartLine { key: string; variantId: string; quantity: string; price: string }
interface Item { id?: string; variantId?: string; description: string; sku?: string; uom: string; quantity: number; unitPriceMinor: number; totalMinor: number }
interface Payment { id: string; method: string; reference: string; amountMinor: number; currency: string; status: string; reviewNote?: string }
interface Event { sequence: number; stage: string; message: string; actor?: string; createdAt: string }
interface Communication { id: string; message: string; status?: string; actor?: string; createdAt: string }
interface Order {
  id: string; orderNumber: string; customerId?: string; customerName: string; customerEmail?: string; customerPhone?: string;
  shippingAddress?: string; channel: string; externalId?: string; stage: string; paymentStatus?: string; locationId: string;
  totalMinor: number; currency: string; createdAt: string; notes?: string; carrier?: string; trackingNumber?: string;
  trackingPath: string | null; invoiceNumber: string; items: Item[]; payments: Payment[]; timeline: Event[];
  businessName: string;
  communications: Communication[]; refundDue: boolean;
}
interface Tracking {
  orderNumber: string; stage: string; totalMinor: number; currency: string; items: Item[]; timeline: Event[];
  trackingPath: string; carrier?: string; trackingNumber?: string; paymentStatus: string; refundDue: boolean; messages: Communication[];
}
interface CheckoutLink { id: string; title: string; channel: string; active: number; currency: string; checkoutPath: string; expiresAt: string }
interface Offer { title: string; currency: string; expiresAt: string; items: { variantId: string; description: string; uom: string; unitPriceMinor: number; maxQuantity: number }[] }

function label(value: string): string { return value.replaceAll("_", " ").replace(/^\w/, (letter) => letter.toUpperCase()); }
function orderGuidance(order: Pick<Order, "stage" | "paymentStatus" | "refundDue">, role: Role): { title: string; description: string; target?: string } {
  if (order.refundDue || order.paymentStatus === "refund_due") return { title: isAdmin(role) ? "Record the manual refund" : "Await Owner / Admin refund", description: "The order is cancelled. Refund the customer outside SellerOne, then an Owner or Admin records the reference.", target: "order-payment" };
  if (order.stage === "received") {
    if (order.paymentStatus === "submitted") return { title: isAdmin(role) ? "Verify payment & reserve stock" : "Await payment verification", description: isAdmin(role) ? "Check the funds independently and confirm stock availability before approving. Approval reserves stock; it does not deduct stock." : "An Owner or Admin must verify payment. Ask inventory staff to resolve shortages before approval.", target: "order-payment" };
    return { title: order.paymentStatus === "rejected" ? "Submit a corrected payment reference" : "Submit payment reference", description: "Record the full payment amount and reference for Owner / Admin review. Creating an order does not reserve stock.", target: "order-payment" };
  }
  const guidance: Record<string, { title: string; description: string; target?: string }> = {
    payment_verified: { title: "Start packing", description: "Payment is verified and stock is reserved. Pick and pack the order before dispatch." },
    packing: { title: "Prepare and dispatch shipment", description: "Confirm the phone and address, select a carrier, then dispatch. Dispatch deducts the reserved stock once.", target: "order-fulfillment" },
    shipped: { title: "Confirm delivery", description: "Mark delivered only after the customer receives the order." },
    delivered: { title: "Complete order & record sale", description: "Confirm fulfilment is finished. Completion records the sale once and enables invoice printing." },
    completed: { title: "Order complete", description: "The sale has been recorded. You can print the invoice or review the order history." },
    cancelled: { title: "Order cancelled", description: "No further fulfilment actions are required. Any reserved stock has been released." },
  };
  return guidance[order.stage] ?? { title: "Review order status", description: "Review the timeline before proceeding." };
}
function ErrorBox({ message }: { message: string }): React.JSX.Element | null {
  return message ? <div className="error-box" role="alert">{message}</div> : null;
}
function Panel({ title, children, className = "" }: { title: string; children: React.ReactNode; className?: string }): React.JSX.Element {
  return <section className={`panel commerce-panel ${className}`}><h2>{title}</h2>{children}</section>;
}
function Heading({ title, children }: { title: string; children?: React.ReactNode }): React.JSX.Element {
  return <div className="page-heading"><div><span className="page-eyebrow">SOCIAL COMMERCE</span><h1>{title}</h1></div><div className="button-group">{children}</div></div>;
}
function Items({ items, currency }: { items: Item[]; currency: string }): React.JSX.Element {
  return <div className="commerce-table-wrap"><table className="commerce-table"><thead><tr><th>Item</th><th>Quantity</th><th>Unit price</th><th>Total</th></tr></thead><tbody>{items.map((item, index) => <tr key={item.id ?? index}><td>{item.description}{item.sku && <small className="mono">{item.sku}</small>}</td><td>{item.quantity} {item.uom}</td><td>{money(item.unitPriceMinor, currency)}</td><td>{money(item.totalMinor, currency)}</td></tr>)}</tbody></table></div>;
}
function Timeline({ events }: { events: Event[] }): React.JSX.Element {
  return <ol className="commerce-timeline">{events.map((event) => <li key={event.sequence}><strong>{label(event.stage)}</strong><p>{event.message}</p><small>{dateLabel(event.createdAt)}{event.actor ? ` · ${event.actor}` : ""}</small></li>)}</ol>;
}
function ShareLink({ path }: { path: string }): React.JSX.Element {
  const [notice, setNotice] = useState("");
  const url = new URL(path, window.location.origin).href;
  const copy = async () => {
    try { await navigator.clipboard.writeText(url); setNotice("Link copied."); }
    catch { setNotice("Could not copy automatically. Select and copy the link below."); }
  };
  return <div className="commerce-share"><input aria-label="Shareable app link" readOnly value={url} onFocus={(event) => event.currentTarget.select()} /><div className="button-group"><button className="button button-secondary" type="button" onClick={() => void copy()}>Copy link</button><Link className="inline-link" to={path} target="_blank" rel="noreferrer">Open link</Link></div>{notice && <small role="status">{notice}</small>}</div>;
}
function PaymentForm({ totalMinor, currency, submit, busy }: { totalMinor: number; currency: string; submit: (body: Record<string, unknown>) => Promise<void>; busy: boolean }): React.JSX.Element {
  return <form className="modal-form" onSubmit={(event) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    void submit({ method: form.get("method"), reference: form.get("reference"), amountMinor: totalMinor, currency });
  }}><p>Full amount: <strong>{money(totalMinor, currency)}</strong>. A reference is not proof of payment; the seller must verify it independently.</p>
    <label className="field-label">Payment method<select name="method"><option>Bank transfer</option><option>GCash</option><option>Maya</option><option>Cash</option></select></label>
    <label className="field-label">Payment reference <span className="field-optional">AUTOMATIC IF BLANK</span><input name="reference" maxLength={150} placeholder="Enter transaction ID / cash receipt number, or leave blank" /><small>A unique SellerOne reference is generated on submission if blank. It is not a bank transaction ID, proof of payment, or an official cash receipt.</small></label>
    <button className="button button-primary" disabled={busy}>Submit payment reference</button>
  </form>;
}
function ShipmentForm({ submit, busy }: { submit: (body: Record<string, unknown>) => Promise<void>; busy: boolean }): React.JSX.Element {
  const [carrier, setCarrier] = useState("");
  return <form className="modal-form" onSubmit={(event) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    void submit({ stage: "shipped", carrier: carrier === "custom" ? form.get("customCarrier") : carrier, trackingNumber: form.get("trackingNumber") });
  }}>
    <label className="field-label">Carrier<select name="carrier" required value={carrier} onChange={(event) => setCarrier(event.target.value)}>
      <option value="" disabled>Select a carrier</option>{carriers.map((name) => <option key={name}>{name}</option>)}<option value="custom">Custom carrier</option>
    </select></label>
    {carrier === "custom" && <label className="field-label">Custom carrier name<input name="customCarrier" required maxLength={100} /></label>}
    <label className="field-label">Tracking number <span className="field-optional">AUTOMATIC IF BLANK</span><input name="trackingNumber" maxLength={150} placeholder="Enter courier tracking number, or leave blank" /><small>Dispatch generates a unique internal SellerOne number if blank. It is not a courier-issued tracking number and cannot track a parcel on the courier's website.</small></label>
    <button className="button button-primary" disabled={busy}>Dispatch shipment</button>
  </form>;
}
function ShipmentDetails({ carrier, trackingNumber }: { carrier?: string; trackingNumber?: string }): React.JSX.Element | null {
  return carrier ? <div><p>Carrier: {carrier} · Tracking number: {trackingNumber}</p>{trackingNumber?.startsWith("SO-TRACK-") && <small>Internal SellerOne tracking number; not valid on the courier's website.</small>}</div> : null;
}
function CustomerFields({ required = false }: { required?: boolean }): React.JSX.Element {
  return <div className="form-grid">
    <label className="field-label">Customer name<input name="customerName" required maxLength={200} /></label>
    <label className="field-label">Customer email<input name="customerEmail" type="email" maxLength={254} /></label>
    <label className="field-label">Customer phone<input name="customerPhone" required={required} maxLength={50} /></label>
    <label className="field-label field-span">Shipping address<textarea name="shippingAddress" required={required} maxLength={1000} rows={2} /></label>
  </div>;
}

function OrderStockCheck({ order, canReceive }: { order: Order; canReceive: boolean }): React.JSX.Element {
  const stock = useLoad<{ items: { variantId: string; sku: string; uom: string; locationName: string; quantityOnHand: number; quantityReserved: number; quantityAvailable: number }[] }>(`/stock?locationId=${encodeURIComponent(order.locationId)}`);
  const requirements = new Map<string, { item: Item; quantity: number }>();
  for (const item of order.items) {
    const key = item.variantId ?? item.sku ?? item.description;
    const existing = requirements.get(key);
    requirements.set(key, { item, quantity: (existing?.quantity ?? 0) + item.quantity });
  }
  return <div className="commerce-stock-check">
    <h3>Stock required before payment verification</h3>
    <p>Stock is checked at this order's fulfillment location. Ingredient stock does not supply finished drinks; recipe deduction and unit conversion are not enabled.</p>
    <ErrorBox message={stock.error} />
    {stock.loading ? <p>Checking available stock...</p> : !stock.error && <ul>{[...requirements].map(([key, { item, quantity }]) => {
      const balance = stock.data?.items.find((row) => item.variantId ? row.variantId === item.variantId : row.sku === item.sku);
      const available = balance?.quantityAvailable ?? 0;
      const shortage = Math.max(0, quantity - available);
      const uomChanged = balance && balance.uom !== item.uom;
      const query = new URLSearchParams({ receive: balance?.variantId ?? item.variantId ?? "", locationId: order.locationId, quantity: String(shortage || quantity), orderId: order.id });
      return <li key={key}><strong>{item.description}</strong><p>Required: {quantity} {item.uom} · Available: {available} {balance?.uom ?? item.uom} · Reserved: {balance?.quantityReserved ?? 0} {balance?.uom ?? item.uom}{balance ? ` · ${balance.locationName}` : ""}</p>
        {uomChanged ? <p role="alert">Catalog UOM changed. Cancel and recreate this order with the current UOM.</p>
          : shortage > 0 && <><p role="alert">Shortage: {shortage} {item.uom}. {canReceive ? "Receive stock before retrying verification." : "Ask an inventory controller, owner, or admin to receive stock."}</p>{canReceive && (balance || item.variantId) && <Link className="inline-link" to={`/inventory?${query}`}>Receive stock for {item.description}</Link>}</>}
        {!balance && <p role="alert">No matching inventory balance found. Check the catalog variant and fulfillment location.</p>}
      </li>;
    })}</ul>}
    <button type="button" className="button button-secondary" disabled={stock.loading} onClick={stock.reload}>Refresh stock availability</button>
    <p>Refreshing does not verify payment or reserve stock. The server rechecks availability atomically when you verify payment.</p>
  </div>;
}

function CaptureForm({ linkMode, saved }: { linkMode: boolean; saved: (order?: Order) => void }): React.JSX.Element {
  const products = useLoad<{ items: Product[] }>("/products");
  const locations = useLoad<{ items: { id: string; name: string }[] }>("/locations");
  const customers = useLoad<{ items: { id: string; name: string }[] }>(linkMode ? "" : "/customers");
  const variants = (products.data?.items ?? []).filter((product) => product.active)
    .flatMap((product) => product.variants.filter((variant) => variant.active).map((variant) => ({ ...variant, productName: product.name })));
  const [lines, setLines] = useState<CartLine[]>([{ key: crypto.randomUUID(), variantId: "", quantity: "1", price: "" }]);
  const [customerId, setCustomerId] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [submissionKey] = useState(() => crypto.randomUUID());
  const edit = (key: string, patch: Partial<CartLine>) => setLines((current) => current.map((line) => line.key === key ? { ...line, ...patch } : line));
  const currency = variants.find((variant) => variant.id === lines[0]?.variantId)?.currency ?? "PHP";
  const totalMinor = lines.reduce((sum, line) => sum + Number(line.quantity) * Math.round(Number(line.price) * 100), 0);
  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault(); setBusy(true); setError("");
    const fields = Object.fromEntries(new FormData(event.currentTarget));
    try {
      if (lines.some((line) => !line.variantId || line.price === "" || variants.find((variant) => variant.id === line.variantId)?.currency !== currency)) throw new Error("Choose every item and a selling price in the same currency.");
      const payload = { ...fields, idempotencyKey: submissionKey, customerId: customerId || undefined, currency, items: lines.map((line) => ({ variantId: line.variantId, quantity: Number(line.quantity), unitPriceMinor: Math.round(Number(line.price) * 100) })), validDays: Number(fields.validDays ?? 7) };
      if (linkMode) { await api("/checkout-links", { method: "POST", body: JSON.stringify(payload) }); saved(); }
      else { saved(await api<Order>("/orders", { method: "POST", body: JSON.stringify(payload) })); }
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Could not save."); }
    finally { setBusy(false); }
  };
  return <form className="modal-form order-capture-form" onSubmit={(event) => void submit(event)}>
    <ErrorBox message={products.error || locations.error || customers.error || error} />
    {!linkMode && <div className="order-create-intro"><h3>Create an order in one screen</h3><p>1. Customer &amp; delivery → 2. Items &amp; pricing → 3. Review &amp; create. Payment verification comes after creation.</p></div>}
    <fieldset className="order-form-section"><legend>{linkMode ? "Offer details" : "1. Customer & delivery"}</legend>
    {linkMode ? <div className="form-grid"><label className="field-label">Link title<input name="title" required maxLength={200} /></label><label className="field-label">Valid for (days)<input name="validDays" type="number" min={1} max={90} defaultValue={7} required /></label></div>
      : <><label className="field-label">Existing customer<select value={customerId} onChange={(event) => setCustomerId(event.target.value)}><option value="">Create customer from details below</option>{customers.data?.items.map((customer) => <option key={customer.id} value={customer.id}>{customer.name}</option>)}</select></label>{!customerId && <CustomerFields />}<label className="field-label">External order ID (optional)<input name="externalId" maxLength={150} placeholder="Used to detect duplicate channel orders" /></label></>}
    <div className="form-grid"><label className="field-label">Source channel<select name="channel" defaultValue={linkMode ? "Shareable Order Link" : "Manual"}>{channels.map((channel) => <option key={channel}>{channel}</option>)}</select></label>
      <label className="field-label">Fulfillment location<select name="locationId" required>{locations.data?.items.map((location) => <option key={location.id} value={location.id}>{location.name}</option>)}</select></label></div>
    {!linkMode && <small>Phone and shipping address can be added later, but both are required before dispatch. Existing customers use their saved contact details.</small>}
    </fieldset>
    <fieldset className="order-form-section"><legend>{linkMode ? "Offer items" : "2. Items & pricing"}</legend>
    {lines.map((line, index) => <div className="commerce-cart-line" key={line.key}>
      <label className="field-label">Product {index + 1}<select required value={line.variantId} onChange={(event) => {
        const variant = variants.find((variant) => variant.id === event.target.value);
        edit(line.key, { variantId: event.target.value, price: variant?.sellingPriceMinor == null ? "" : (variant.sellingPriceMinor / 100).toFixed(2) });
      }}><option value="">Choose an active variant</option>{variants.map((variant) => <option key={variant.id} value={variant.id}>{variant.productName} · {variant.name} ({variant.sku}, {variant.uom}, {variant.currency})</option>)}</select></label>
      <div className="form-grid">{!linkMode && <label className="field-label">Quantity<input type="number" required min={1} step={1} value={line.quantity} onChange={(event) => edit(line.key, { quantity: event.target.value })} /></label>}
        <label className="field-label">Selling price per UOM<input required type="number" min={0} step="0.01" value={line.price} onChange={(event) => edit(line.key, { price: event.target.value })} /><small>Auto-filled from the selected variant's saved price. Override for this {linkMode ? "offer" : "order"} only. Switching products resets the price; variants without a saved price require manual entry.</small></label></div>
      {lines.length > 1 && <button className="button button-secondary" type="button" onClick={() => setLines((current) => current.filter((item) => item.key !== line.key))}>Remove item {index + 1}</button>}
      {!linkMode && <small className="order-line-total">Line total: {money(Number(line.quantity) * Math.round(Number(line.price) * 100), currency)}</small>}
    </div>)}
    <button className="button button-secondary" type="button" disabled={lines.length >= 50} onClick={() => setLines((current) => [...current, { key: crypto.randomUUID(), variantId: "", quantity: "1", price: "" }])}>Add another item</button>
    </fieldset>
    {!linkMode && <fieldset className="order-form-section"><legend>3. Review & create</legend><div className="order-capture-total" aria-live="polite"><span>{lines.length} {lines.length === 1 ? "item line" : "item lines"} · {currency}</span><strong>Order total: {money(totalMinor, currency)}</strong></div><label className="field-label">Internal notes (optional)<textarea name="notes" maxLength={2000} /></label></fieldset>}
    <p className="form-footnote">{linkMode ? "Customers choose quantities. Prices come from this link; catalog costs are never exposed. No payment gateway is connected." : "Orders begin at received. Stock is reserved only after payment verification, and deducted at dispatch."}</p>
    <button className="button button-primary" disabled={busy || products.loading || locations.loading || customers.loading || !!products.error || !!locations.error || !!customers.error}>{busy ? "Saving..." : linkMode ? "Create checkout link" : "Create order & continue to payment"}</button>
  </form>;
}

export function CommerceOrders({ role }: { role: Role }): React.JSX.Element {
  const location = useLocation();
  const links = useLoad<{ items: CheckoutLink[] }>(isAdmin(role) ? "/checkout-links" : "");
  const navigate = useNavigate();
  const [tab, setTab] = useState("orders");
  const [capture, setCapture] = useState<"order" | "link" | null>(null);
  const [search, setSearch] = useState(() => new URLSearchParams(location.search).get("search") ?? "");
  const [stage, setStage] = useState("all");
  const [channel, setChannel] = useState("all");
  const [payment, setPayment] = useState("all");
  const [page, setPage] = useState(1);
  useEffect(() => {
    setSearch(new URLSearchParams(location.search).get("search") ?? "");
    setPage(1);
    setTab("orders");
    setStage("all");
    setChannel("all");
    setPayment("all");
  }, [location.search]);
  const query = new URLSearchParams({ page: String(page) });
  if (search.trim()) query.set("search", search.trim());
  if (stage !== "all") query.set("stage", stage);
  if (channel !== "all") query.set("channel", channel);
  if (payment !== "all") query.set("payment", payment);
  const orders = useLoad<{ items: Order[]; total: number; pageSize: number }>(`/orders?${query}`);
  const [importBody, setImportBody] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const rows = orders.data?.items ?? [];
  const importOrder = async (event: React.FormEvent) => {
    event.preventDefault(); setBusy(true); setError("");
    try { const result = await api<Order>("/orders/import", { method: "POST", body: JSON.stringify(JSON.parse(importBody)) }); navigate(`/orders/${result.id}`); }
    catch (caught) { setError(caught instanceof Error ? caught.message : "Import failed."); }
    finally { setBusy(false); }
  };
  const disable = async (id: string) => {
    setError(""); setBusy(true);
    try { await api(`/checkout-links/${id}`, { method: "DELETE" }); links.reload(); }
    catch (caught) { setError(caught instanceof Error ? caught.message : "Could not disable link."); }
    finally { setBusy(false); }
  };
  return <>
    <Heading title="Social commerce orders"><button className="button button-primary" onClick={() => setCapture("order")}>New order</button>{isAdmin(role) && <button className="button button-secondary" onClick={() => { setTab("links"); setCapture("link"); }}>Create app link</button>}</Heading>
    <p>Create → verify payment &amp; reserve → pack → dispatch → deliver → complete. Each order shows what to do next.</p>
    <ErrorBox message={orders.error || links.error || error} />
    <div className="tabs">{["orders", ...(isAdmin(role) ? ["links", "import"] : [])].map((item) => <button key={item} className={tab === item ? "tab active" : "tab"} onClick={() => { setTab(item); setCapture(null); }}>{label(item)}</button>)}</div>
    {capture && <Panel title={capture === "link" ? "Create a shareable checkout link" : "Capture a customer order"}><button className="button button-secondary" onClick={() => setCapture(null)}>Close form</button><CaptureForm linkMode={capture === "link"} saved={(order) => { setCapture(null); orders.reload(); links.reload(); if (order) navigate(`/orders/${order.id}`); }} /></Panel>}
    {tab === "orders" && <Panel title={`Unified inbox (${orders.data?.total ?? 0})`}>
      <div className="order-stage-filters" aria-label="Quick order stage filters">{[["all", "All orders"], ["received", "Payment & review"], ["payment_verified", "Ready to pack"], ["packing", "Ready to ship"], ["shipped", "In transit"], ["delivered", "Ready to complete"], ["completed", "Completed"]].map(([value, title]) => <button className={stage === value ? "button button-primary" : "button button-secondary"} key={value} type="button" aria-pressed={stage === value} onClick={() => { setStage(value); setPage(1); }}>{title}</button>)}</div>
      <div className="form-grid commerce-filters"><label className="field-label">Search orders<input maxLength={200} value={search} onChange={(event) => { setSearch(event.target.value); setPage(1); }} placeholder="Order, customer, external ID" /></label>
        <label className="field-label">Stage<select value={stage} onChange={(event) => { setStage(event.target.value); setPage(1); }}><option value="all">All stages</option>{stages.map((item) => <option value={item} key={item}>{label(item)}</option>)}</select></label>
        <label className="field-label">Channel<select value={channel} onChange={(event) => { setChannel(event.target.value); setPage(1); }}><option value="all">All channels</option>{channels.map((item) => <option key={item}>{item}</option>)}</select></label>
        <label className="field-label">Payment<select value={payment} onChange={(event) => { setPayment(event.target.value); setPage(1); }}><option value="all">All payments</option>{["unpaid", "submitted", "verified", "rejected", "refund_due", "refunded"].map((item) => <option key={item} value={item}>{label(item)}</option>)}</select></label></div>
      <div className="button-group"><button className="button button-secondary" type="button" disabled={orders.loading} onClick={orders.reload}>Refresh orders</button><button className="button button-secondary" type="button" onClick={() => { setSearch(""); setStage("all"); setChannel("all"); setPayment("all"); setPage(1); }}>Clear filters</button></div>
      {orders.loading ? <p role="status">Loading orders...</p> : orders.error ? <p>Orders could not be loaded. Use Refresh orders to retry.</p> : <div className="commerce-table-wrap"><table className="commerce-table"><thead><tr><th>Order</th><th>Customer</th><th>Channel</th><th>Stage / payment</th><th>Total</th><th>Next action</th></tr></thead><tbody>{rows.map((order) => <tr key={order.id}><td><Link className="inline-link" to={`/orders/${order.id}`}>{order.orderNumber}</Link><small>{dateLabel(order.createdAt)}</small></td><td>{order.customerName}</td><td>{order.channel}<small>{order.externalId}</small></td><td><span className={`order-stage-badge order-stage-${order.stage}`}>{label(order.stage)}</span><small>{label(order.paymentStatus ?? "unpaid")}</small></td><td>{money(order.totalMinor, order.currency)}</td><td><Link className="inline-link order-next-link" to={`/orders/${order.id}`}>{orderGuidance(order, role).title} →</Link></td></tr>)}</tbody></table>{!rows.length && <div className="order-empty"><h3>No matching orders</h3><p>Clear the filters to see more orders, or create a new customer order.</p><button className="button button-primary" type="button" onClick={() => setCapture("order")}>Create your next order</button></div>}</div>}
      <div className="button-group"><button className="button button-secondary" disabled={page === 1 || orders.loading} onClick={() => setPage((page) => page - 1)}>Previous page</button><span>Page {page}</span><button className="button button-secondary" disabled={orders.loading || page * (orders.data?.pageSize ?? 50) >= (orders.data?.total ?? 0)} onClick={() => setPage((page) => page + 1)}>Next page</button></div>
    </Panel>}
    {tab === "links" && <Panel title="Checkout app links"><p>Share these links in social posts, chats, or your bio. Each link offers a reusable cart; each customer gets a private tracking link. Treat tracking links as confidential.</p>{links.data?.items.map((link) => <article className="commerce-link-card" key={link.id}><strong>{link.title}</strong><p>{link.channel} · Expires {dateLabel(link.expiresAt)} · {link.active && new Date(link.expiresAt).getTime() > Date.now() ? "Active" : "Unavailable"}</p><ShareLink path={link.checkoutPath} />{Boolean(link.active) && <button className="button button-secondary" disabled={busy} onClick={() => void disable(link.id)}>Disable link</button>}</article>)}{!links.data?.items.length && <p>No checkout links yet.</p>}</Panel>}
    {tab === "import" && <Panel title="Import a channel order"><p>Paste one normalized JSON order. The combination of channel and externalId prevents duplicate imports. This is not a live social-platform connection.</p><pre className="commerce-example">{JSON.stringify({ channel: "TikTok Shop", externalId: "channel-order-123", customerName: "Customer", customerPhone: "09123456789", shippingAddress: "Delivery address", currency: "PHP", items: [{ sku: "YOUR-SKU", quantity: 1, unitPriceMinor: 15000 }] }, null, 2)}</pre><form className="modal-form" onSubmit={(event) => void importOrder(event)}><label className="field-label">Order JSON<textarea rows={12} value={importBody} onChange={(event) => setImportBody(event.target.value)} required /></label><button className="button button-primary" disabled={busy}>Import order</button></form></Panel>}
  </>;
}

export function CommerceOrderDetails({ role }: { role: Role }): React.JSX.Element {
  const { id } = useParams();
  const order = useLoad<Order>(`/orders/${id}`);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [saving, setBusy] = useState(false);
  const busy = saving || order.loading;
  const [reviewNote, setReviewNote] = useState("");
  const [shipping, setShipping] = useState(false);
  const run = async (action: string, body: Record<string, unknown>, method = "POST") => {
    setBusy(true); setError(""); setNotice("");
    try { await api(`/orders/${id}${action ? `/${action}` : ""}`, { method, body: JSON.stringify(body) }); setNotice("Order updated."); order.reload(); }
    catch (caught) { setError(caught instanceof Error ? caught.message : "Order update failed."); if (action === "verify-payment") order.reload(); }
    finally { setBusy(false); }
  };
  const fromForm = (event: React.FormEvent<HTMLFormElement>, action: string) => { event.preventDefault(); void run(action, Object.fromEntries(new FormData(event.currentTarget))); };
  if (order.loading && !order.data) return <p role="status">Loading order...</p>;
  if (!order.data) return <ErrorBox message={order.error || "Order unavailable."} />;
  const data = order.data;
  const completed = data.stage === "completed";
  const next: Record<string, string> = { payment_verified: "packing", shipped: "delivered", delivered: "completed" };
  const canCancel = ["received", "payment_verified", "packing"].includes(data.stage);
  const pendingPayment = data.payments.find((payment) => payment.status === "submitted");
  const guidance = orderGuidance({ ...data, paymentStatus: pendingPayment ? "submitted" : data.payments.at(-1)?.status ?? data.paymentStatus }, role);
  const lifecycle = ["received", "payment_verified", "packing", "shipped", "delivered", "completed"];
  const stageIndex = lifecycle.indexOf(data.stage);
  return <div className="commerce-order-details">
    <Link className="back-link" to="/orders">Back to orders</Link>
    <Heading title="Order details"><button className="button button-secondary" disabled={!completed || busy || !!order.error} title={completed ? "Preview and print the completed invoice" : "Mark the delivered order completed to enable invoice printing"} onClick={() => window.print()}>Print invoice</button></Heading>
    {!completed && <p className="commerce-no-print">Invoice printing is available after the order is marked completed.</p>}
    <ErrorBox message={order.error || error} />{notice && <div className="success-box" role="status">{notice}</div>}
    <section className="panel order-next-action commerce-no-print" aria-label="Next required action">
      <div><span className="page-eyebrow">{data.orderNumber} · {label(data.stage)}</span><h2>{guidance.title}</h2><p>{guidance.description}</p></div>
      <div className="button-group">
        {next[data.stage] && <button className="button button-primary" disabled={busy || !!order.error} onClick={() => void run("", { stage: next[data.stage] }, "PATCH")}>{busy ? "Updating..." : guidance.title}</button>}
        {guidance.target && <a className="button button-primary" href={`#${guidance.target}`}>{data.stage === "packing" ? "Go to dispatch" : "Go to payment review"}</a>}
        {completed && <button className="button button-primary" disabled={busy || !!order.error} onClick={() => window.print()}>Print completed invoice</button>}
      </div>
      {data.stage !== "cancelled" && <ol className="order-progress" aria-label="Order lifecycle">{lifecycle.map((stage, index) => <li key={stage} className={index < stageIndex ? "done" : index === stageIndex ? "current" : ""} aria-current={index === stageIndex ? "step" : undefined}><span>{index < stageIndex ? "✓" : index + 1}</span><strong>{label(stage)}</strong><small>{stage === "payment_verified" ? "Stock reserved" : stage === "shipped" ? "Stock deducted" : stage === "completed" ? "Sale recorded" : index === stageIndex ? "Current stage" : ""}</small></li>)}</ol>}
      {data.stage === "packing" && (!data.customerPhone?.trim() || !data.shippingAddress?.trim()) && <p className="error-box" role="alert">Delivery details are missing. Add the customer phone and shipping address below before dispatch.</p>}
    </section>
    <Panel className="commerce-invoice" title={`Invoice ${data.invoiceNumber}`}><strong>{data.businessName}</strong><p>Issued: {dateLabel(data.createdAt)}</p><p className="mono">{data.orderNumber}</p><p>{data.customerName} · {data.channel}{data.externalId ? ` · ${data.externalId}` : ""}</p><p>{data.customerEmail} {data.customerPhone}</p><p>{data.shippingAddress || "No shipping address yet"}</p>{data.customerId && canAccessPage(role, "/customers") && <Link className="inline-link commerce-no-print" to={`/customers/${data.customerId}`}>View customer profile</Link>}<Items items={data.items} currency={data.currency} /><div className="order-total"><span>Total</span><strong>{money(data.totalMinor, data.currency)}</strong></div><p>Stage: <strong>{label(data.stage)}</strong>. Payment: <strong>{data.refundDue ? "Refund due" : label(data.payments.at(-1)?.status ?? "unpaid")}</strong></p></Panel>
    <div className="detail-grid commerce-no-print"><div>
      <div id="order-fulfillment" className="order-anchor"><Panel title="Fulfillment & delivery"><p>{data.stage === "received" ? "Resolve stock shortages before payment verification." : guidance.description}</p><div className="button-group">
        {canCancel && <button className="button button-secondary" disabled={busy} onClick={() => { if (window.confirm("Cancel this order and release its reserved stock? A verified payment will require a manual refund.")) void run("", { stage: "cancelled" }, "PATCH"); }}>Cancel order</button>}
      </div>
      {data.stage === "received" && <OrderStockCheck order={data} canReceive={canAccessPage(role, "/inventory")} />}
      <ShipmentDetails carrier={data.carrier} trackingNumber={data.trackingNumber} />
      {canCancel && <><button className="button button-secondary" disabled={busy} onClick={() => setShipping(!shipping)}>Edit shipping details</button>{(shipping || (data.stage === "packing" && (!data.customerPhone?.trim() || !data.shippingAddress?.trim()))) && <form className="modal-form" onSubmit={(event) => fromForm(event, "shipping")}><label className="field-label">Customer phone<input name="customerPhone" defaultValue={data.customerPhone} required maxLength={50} /></label><label className="field-label">Shipping address<textarea name="shippingAddress" defaultValue={data.shippingAddress} required maxLength={1000} /></label><button className="button button-primary" disabled={busy}>Save shipping details</button></form>}</>}
      {data.stage === "packing" && <ShipmentForm busy={busy} submit={(body) => run("", body, "PATCH")} />}
      </Panel></div>
      <div id="order-payment" className="order-anchor"><Panel title="Payment validation">{data.payments.map((payment) => <article className="commerce-link-card" key={payment.id}><strong>{payment.method} · {payment.reference}</strong><p>{money(payment.amountMinor, payment.currency)} · {label(payment.status)}</p>{payment.reviewNote && <p>{payment.reviewNote}</p>}</article>)}
        {data.stage === "received" && !pendingPayment && <PaymentForm totalMinor={data.totalMinor} currency={data.currency} busy={busy} submit={(body) => run("payments", body)} />}
        {pendingPayment && data.stage === "received" && isAdmin(role) && <><p>Verify the funds independently before approval. Approval reserves inventory atomically.</p><label className="field-label">Review note / rejection reason<textarea maxLength={1000} value={reviewNote} onChange={(event) => setReviewNote(event.target.value)} /></label><div className="button-group"><button className="button button-primary" disabled={busy} onClick={() => void run("verify-payment", { paymentId: pendingPayment.id, note: reviewNote })}>Verify payment & reserve stock</button><button className="button button-secondary" disabled={busy || !reviewNote.trim()} onClick={() => void run("reject-payment", { paymentId: pendingPayment.id, note: reviewNote })}>Reject payment</button></div></>}
        {pendingPayment && data.stage === "received" && !isAdmin(role) && <p>An owner or admin must review this payment.</p>}
        {data.refundDue && isAdmin(role) && <form className="modal-form" onSubmit={(event) => fromForm(event, "refund")}><p>Issue the refund outside SellerOne, then record its reference. This does not transfer money.</p><label className="field-label">Refund reference / note<input name="note" required maxLength={1000} /></label><button className="button button-primary" disabled={busy}>Record manual refund</button></form>}
      </Panel></div>
      <details className="order-secondary"><summary>Customer communication &amp; tracking</summary><Panel title="Customer communication">{data.trackingPath ? <><ShareLink path={data.trackingPath} /><p>Send this private link to the customer for order confirmation and live status. Do not post it publicly.</p></> : <p>This legacy order has no public tracking link.</p>}
        <p>No automatic email or social message is sent. Prepare a message, send it through your channel, then log it as sent. Sent messages also appear on customer tracking.</p>
        <form className="modal-form" onSubmit={(event) => fromForm(event, "communications")}><label className="field-label">Customer message<textarea name="message" required maxLength={2000} defaultValue={`Your order ${data.orderNumber} is ${label(data.stage).toLowerCase()}.`} key={data.stage} /></label><label className="field-label">Delivery status<select name="status"><option value="prepared">Prepared (not sent)</option><option value="sent">Sent manually</option></select></label><button className="button button-primary" disabled={busy}>Save communication</button></form>
        {data.communications.map((message) => <article className="commerce-link-card" key={message.id}><strong>{label(message.status ?? "")}</strong><p>{message.message}</p><small>{dateLabel(message.createdAt)} · {message.actor}</small></article>)}
      </Panel></details>
    </div><div><Panel title="Order timeline"><Timeline events={data.timeline} /></Panel>{data.notes && <Panel title="Internal notes"><p>{data.notes}</p></Panel>}</div></div>
  </div>;
}

export function CheckoutPage(): React.JSX.Element {
  const { token } = useParams();
  const offer = useLoad<Offer>(`/public/checkout/${encodeURIComponent(token ?? "")}`);
  const [quantities, setQuantities] = useState<Record<string, string>>({});
  const [key] = useState(() => crypto.randomUUID());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const navigate = useNavigate();
  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault(); setBusy(true); setError("");
    const fields = Object.fromEntries(new FormData(event.currentTarget));
    try {
      const items = Object.entries(quantities).filter(([, quantity]) => Number(quantity) > 0).map(([variantId, quantity]) => ({ variantId, quantity: Number(quantity) }));
      const result = await api<Tracking>(`/public/checkout/${token}`, { method: "POST", body: JSON.stringify({ ...fields, items, idempotencyKey: key }) });
      navigate(result.trackingPath, { replace: true });
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Checkout failed."); }
    finally { setBusy(false); }
  };
  const data = offer.data;
  return <main className="commerce-public"><Link className="brand" to="/login">SellerOne</Link><Heading title={data?.title ?? "Customer checkout"} /><ErrorBox message={offer.error || error} />
    {offer.loading ? <p>Loading checkout...</p> : data && <Panel title="Your cart"><p>Choose quantities in the listed units. No unit conversion or online payment gateway. Orders are confirmed after the seller verifies payment and reserves stock.</p><form className="modal-form" onSubmit={(event) => void submit(event)}>
      {data.items.map((item) => <label className="field-label commerce-cart-line" key={item.variantId}>{item.description}<small>{money(item.unitPriceMinor, data.currency)} / {item.uom} · {item.maxQuantity} available</small><input aria-label={`Quantity for ${item.description}`} type="number" min={0} step={1} max={item.maxQuantity} disabled={!item.maxQuantity} value={quantities[item.variantId] ?? "0"} onChange={(event) => setQuantities((current) => ({ ...current, [item.variantId]: event.target.value }))} /></label>)}
      <strong>Total: {money(data.items.reduce((sum, item) => sum + Number(quantities[item.variantId] ?? 0) * item.unitPriceMinor, 0), data.currency)}</strong>
      <CustomerFields required /><button className="button button-primary" disabled={busy}>{busy ? "Submitting..." : "Place order"}</button>
    </form></Panel>}
  </main>;
}

export function TrackingPage(): React.JSX.Element {
  const { token } = useParams();
  const tracking = useLoad<Tracking>(`/public/tracking/${encodeURIComponent(token ?? "")}`);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const submit = async (body: Record<string, unknown>) => {
    setBusy(true); setError("");
    try { await api(`/public/tracking/${token}/payments`, { method: "POST", body: JSON.stringify(body) }); tracking.reload(); }
    catch (caught) { setError(caught instanceof Error ? caught.message : "Could not submit payment."); }
    finally { setBusy(false); }
  };
  const data = tracking.data;
  return <main className="commerce-public"><Heading title="Track your order"><button className="button button-secondary" onClick={tracking.reload}>Refresh status</button></Heading><p>This private link provides order updates. Keep it confidential.</p><ErrorBox message={tracking.error || error} />
    {tracking.loading ? <p>Loading status...</p> : data && <><Panel title={data.orderNumber}><p>Order: <strong>{label(data.stage)}</strong> · Payment: <strong>{data.refundDue ? "Refund due" : label(data.paymentStatus)}</strong></p><Items items={data.items} currency={data.currency} /><strong>Total: {money(data.totalMinor, data.currency)}</strong><ShipmentDetails carrier={data.carrier} trackingNumber={data.trackingNumber} /></Panel>
      {data.stage === "received" && ["unpaid", "rejected"].includes(data.paymentStatus) && <Panel title="Submit payment reference"><p>Contact your seller for payment instructions. Do not pay until the seller confirms the correct payment destination.</p><PaymentForm totalMinor={data.totalMinor} currency={data.currency} busy={busy} submit={submit} /></Panel>}
      <Panel title="Order progress"><Timeline events={data.timeline} /></Panel>
      {data.messages.length > 0 && <Panel title="Seller messages">{data.messages.map((message) => <article className="commerce-link-card" key={message.id}><p>{message.message}</p><small>{dateLabel(message.createdAt)}</small></article>)}</Panel>}
    </>}
  </main>;
}
