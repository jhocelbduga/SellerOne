import React, { useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { api, dateLabel, money, useLoad } from "./api";

const channels = ["Manual", "TikTok Shop", "Facebook Marketplace", "Facebook Page", "Facebook Messenger", "Instagram", "Shareable Order Link"];
const stages = ["received", "payment_verified", "packing", "shipped", "delivered", "completed", "cancelled"];
interface Variant { id: string; name: string; sku: string; uom: string; currency: string; active: boolean }
interface Product { id: string; name: string; active: boolean; variants: Variant[] }
interface CartLine { key: string; variantId: string; quantity: string; price: string }
interface Item { id?: string; variantId?: string; description: string; sku?: string; uom: string; quantity: number; unitPriceMinor: number; totalMinor: number }
interface Payment { id: string; method: string; reference: string; amountMinor: number; currency: string; status: string; reviewNote?: string }
interface Event { sequence: number; stage: string; message: string; actor?: string; createdAt: string }
interface Communication { id: string; message: string; status?: string; actor?: string; createdAt: string }
interface Order {
  id: string; orderNumber: string; customerId?: string; customerName: string; customerEmail?: string; customerPhone?: string;
  shippingAddress?: string; channel: string; externalId?: string; stage: string; paymentStatus?: string;
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
function ErrorBox({ message }: { message: string }): React.JSX.Element | null {
  return message ? <div className="error-box" role="alert">{message}</div> : null;
}
function Panel({ title, children }: { title: string; children: React.ReactNode }): React.JSX.Element {
  return <section className="panel commerce-panel"><h2>{title}</h2>{children}</section>;
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
    <label className="field-label">Payment reference<input name="reference" required maxLength={150} placeholder="Transaction ID / cash receipt number" /></label>
    <button className="button button-primary" disabled={busy}>Submit payment reference</button>
  </form>;
}
function CustomerFields({ required = false }: { required?: boolean }): React.JSX.Element {
  return <div className="form-grid">
    <label className="field-label">Customer name<input name="customerName" required maxLength={200} /></label>
    <label className="field-label">Customer email<input name="customerEmail" type="email" maxLength={254} /></label>
    <label className="field-label">Customer phone<input name="customerPhone" required={required} maxLength={50} /></label>
    <label className="field-label field-span">Shipping address<textarea name="shippingAddress" required={required} maxLength={1000} rows={2} /></label>
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
  return <form className="modal-form" onSubmit={(event) => void submit(event)}>
    <ErrorBox message={products.error || locations.error || customers.error || error} />
    {linkMode ? <div className="form-grid"><label className="field-label">Link title<input name="title" required maxLength={200} /></label><label className="field-label">Valid for (days)<input name="validDays" type="number" min={1} max={90} defaultValue={7} required /></label></div>
      : <><label className="field-label">Existing customer<select value={customerId} onChange={(event) => setCustomerId(event.target.value)}><option value="">Create customer from details below</option>{customers.data?.items.map((customer) => <option key={customer.id} value={customer.id}>{customer.name}</option>)}</select></label>{!customerId && <CustomerFields />}<label className="field-label">External order ID (optional)<input name="externalId" maxLength={150} placeholder="Used to detect duplicate channel orders" /></label></>}
    <div className="form-grid"><label className="field-label">Source channel<select name="channel" defaultValue={linkMode ? "Shareable Order Link" : "Manual"}>{channels.map((channel) => <option key={channel}>{channel}</option>)}</select></label>
      <label className="field-label">Fulfillment location<select name="locationId" required>{locations.data?.items.map((location) => <option key={location.id} value={location.id}>{location.name}</option>)}</select></label></div>
    {lines.map((line, index) => <div className="commerce-cart-line" key={line.key}>
      <label className="field-label">Product {index + 1}<select required value={line.variantId} onChange={(event) => edit(line.key, { variantId: event.target.value })}><option value="">Choose an active variant</option>{variants.map((variant) => <option key={variant.id} value={variant.id}>{variant.productName} · {variant.name} ({variant.sku}, {variant.uom}, {variant.currency})</option>)}</select></label>
      <div className="form-grid">{!linkMode && <label className="field-label">Quantity<input type="number" required min={1} step={1} value={line.quantity} onChange={(event) => edit(line.key, { quantity: event.target.value })} /></label>}
        <label className="field-label">Selling price per UOM<input required type="number" min={0} step="0.01" value={line.price} onChange={(event) => edit(line.key, { price: event.target.value })} /></label></div>
      {lines.length > 1 && <button className="button button-secondary" type="button" onClick={() => setLines((current) => current.filter((item) => item.key !== line.key))}>Remove item {index + 1}</button>}
    </div>)}
    <button className="button button-secondary" type="button" disabled={lines.length >= 50} onClick={() => setLines((current) => [...current, { key: crypto.randomUUID(), variantId: "", quantity: "1", price: "" }])}>Add another item</button>
    {!linkMode && <><strong>Order total: {money(totalMinor, currency)}</strong><label className="field-label">Internal notes<textarea name="notes" maxLength={2000} /></label></>}
    <p className="form-footnote">{linkMode ? "Customers choose quantities. Prices come from this link; catalog costs are never exposed. No payment gateway is connected." : "Orders begin at received. Stock is reserved only after payment verification, and deducted at dispatch."}</p>
    <button className="button button-primary" disabled={busy || products.loading || locations.loading}>{busy ? "Saving..." : linkMode ? "Create checkout link" : "Create order"}</button>
  </form>;
}

export function CommerceOrders({ role }: { role: string }): React.JSX.Element {
  const links = useLoad<{ items: CheckoutLink[] }>(role === "staff" ? "" : "/checkout-links");
  const navigate = useNavigate();
  const [tab, setTab] = useState("orders");
  const [capture, setCapture] = useState<"order" | "link" | null>(null);
  const [search, setSearch] = useState("");
  const [stage, setStage] = useState("all");
  const [channel, setChannel] = useState("all");
  const [payment, setPayment] = useState("all");
  const [page, setPage] = useState(1);
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
    <Heading title="Social commerce orders"><button className="button button-primary" onClick={() => setCapture("order")}>New order</button>{role !== "staff" && <button className="button button-secondary" onClick={() => { setTab("links"); setCapture("link"); }}>Create app link</button>}</Heading>
    <p>One workflow for every channel. Social-platform API capture is not connected; use manual entry, checkout links, or authenticated imports.</p>
    <ErrorBox message={orders.error || links.error || error} />
    <div className="tabs">{["orders", ...(role !== "staff" ? ["links", "import"] : [])].map((item) => <button key={item} className={tab === item ? "tab active" : "tab"} onClick={() => { setTab(item); setCapture(null); }}>{label(item)}</button>)}</div>
    {capture && <Panel title={capture === "link" ? "Create a shareable checkout link" : "Capture a customer order"}><button className="button button-secondary" onClick={() => setCapture(null)}>Close form</button><CaptureForm linkMode={capture === "link"} saved={(order) => { setCapture(null); orders.reload(); links.reload(); if (order) navigate(`/orders/${order.id}`); }} /></Panel>}
    {tab === "orders" && <Panel title={`Unified inbox (${orders.data?.total ?? 0})`}>
      <div className="form-grid commerce-filters"><label className="field-label">Search orders<input maxLength={200} value={search} onChange={(event) => { setSearch(event.target.value); setPage(1); }} placeholder="Order, customer, external ID" /></label>
        <label className="field-label">Stage<select value={stage} onChange={(event) => { setStage(event.target.value); setPage(1); }}><option value="all">All stages</option>{stages.map((item) => <option value={item} key={item}>{label(item)}</option>)}</select></label>
        <label className="field-label">Channel<select value={channel} onChange={(event) => { setChannel(event.target.value); setPage(1); }}><option value="all">All channels</option>{channels.map((item) => <option key={item}>{item}</option>)}</select></label>
        <label className="field-label">Payment<select value={payment} onChange={(event) => { setPayment(event.target.value); setPage(1); }}><option value="all">All payments</option>{["unpaid", "submitted", "verified", "rejected", "refund_due", "refunded"].map((item) => <option key={item} value={item}>{label(item)}</option>)}</select></label></div>
      {orders.loading ? <p>Loading orders...</p> : <div className="commerce-table-wrap"><table className="commerce-table"><thead><tr><th>Order</th><th>Customer</th><th>Channel</th><th>Stage / payment</th><th>Total</th></tr></thead><tbody>{rows.map((order) => <tr key={order.id}><td><Link className="inline-link" to={`/orders/${order.id}`}>{order.orderNumber}</Link><small>{dateLabel(order.createdAt)}</small></td><td>{order.customerName}</td><td>{order.channel}<small>{order.externalId}</small></td><td>{label(order.stage)}<small>{label(order.paymentStatus ?? "unpaid")}</small></td><td>{money(order.totalMinor, order.currency)}</td></tr>)}</tbody></table>{!rows.length && <p>No matching orders.</p>}</div>}
      <div className="button-group"><button className="button button-secondary" disabled={page === 1 || orders.loading} onClick={() => setPage((page) => page - 1)}>Previous page</button><span>Page {page}</span><button className="button button-secondary" disabled={orders.loading || page * (orders.data?.pageSize ?? 50) >= (orders.data?.total ?? 0)} onClick={() => setPage((page) => page + 1)}>Next page</button></div>
    </Panel>}
    {tab === "links" && <Panel title="Checkout app links"><p>Share these links in social posts, chats, or your bio. Each link offers a reusable cart; each customer gets a private tracking link. Treat tracking links as confidential.</p>{links.data?.items.map((link) => <article className="commerce-link-card" key={link.id}><strong>{link.title}</strong><p>{link.channel} · Expires {dateLabel(link.expiresAt)} · {link.active && new Date(link.expiresAt).getTime() > Date.now() ? "Active" : "Unavailable"}</p><ShareLink path={link.checkoutPath} />{Boolean(link.active) && <button className="button button-secondary" disabled={busy} onClick={() => void disable(link.id)}>Disable link</button>}</article>)}{!links.data?.items.length && <p>No checkout links yet.</p>}</Panel>}
    {tab === "import" && <Panel title="Import a channel order"><p>Paste one normalized JSON order. The combination of channel and externalId prevents duplicate imports. This is not a live social-platform connection.</p><pre className="commerce-example">{JSON.stringify({ channel: "TikTok Shop", externalId: "channel-order-123", customerName: "Customer", customerPhone: "09123456789", shippingAddress: "Delivery address", currency: "PHP", items: [{ sku: "YOUR-SKU", quantity: 1, unitPriceMinor: 15000 }] }, null, 2)}</pre><form className="modal-form" onSubmit={(event) => void importOrder(event)}><label className="field-label">Order JSON<textarea rows={12} value={importBody} onChange={(event) => setImportBody(event.target.value)} required /></label><button className="button button-primary" disabled={busy}>Import order</button></form></Panel>}
  </>;
}

export function CommerceOrderDetails({ role }: { role: string }): React.JSX.Element {
  const { id } = useParams();
  const order = useLoad<Order>(`/orders/${id}`);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [reviewNote, setReviewNote] = useState("");
  const [shipping, setShipping] = useState(false);
  const run = async (action: string, body: Record<string, unknown>, method = "POST") => {
    setBusy(true); setError(""); setNotice("");
    try { await api(`/orders/${id}${action ? `/${action}` : ""}`, { method, body: JSON.stringify(body) }); setNotice("Order updated."); order.reload(); }
    catch (caught) { setError(caught instanceof Error ? caught.message : "Order update failed."); }
    finally { setBusy(false); }
  };
  const fromForm = (event: React.FormEvent<HTMLFormElement>, action: string) => { event.preventDefault(); void run(action, Object.fromEntries(new FormData(event.currentTarget))); };
  if (order.loading) return <p>Loading order...</p>;
  if (!order.data) return <ErrorBox message={order.error || "Order unavailable."} />;
  const data = order.data;
  const next: Record<string, string> = { payment_verified: "packing", shipped: "delivered", delivered: "completed" };
  const canCancel = ["received", "payment_verified", "packing"].includes(data.stage);
  const pendingPayment = data.payments.find((payment) => payment.status === "submitted");
  return <>
    <Link className="back-link" to="/orders">Back to orders</Link>
    <Heading title="Order details"><button className="button button-secondary" onClick={() => window.print()}>Print invoice</button></Heading>
    <ErrorBox message={order.error || error} />{notice && <div className="success-box" role="status">{notice}</div>}
    <Panel title={`Invoice ${data.invoiceNumber}`}><strong>{data.businessName}</strong><p className="mono">{data.orderNumber}</p><p>{data.customerName} · {data.channel}{data.externalId ? ` · ${data.externalId}` : ""}</p><p>{data.customerEmail} {data.customerPhone}</p><p>{data.shippingAddress || "No shipping address yet"}</p>{data.customerId && <Link className="inline-link commerce-no-print" to={`/customers/${data.customerId}`}>View customer profile</Link>}<Items items={data.items} currency={data.currency} /><div className="order-total"><span>Total</span><strong>{money(data.totalMinor, data.currency)}</strong></div><p>Stage: <strong>{label(data.stage)}</strong>. Payment: <strong>{data.refundDue ? "Refund due" : label(data.payments.at(-1)?.status ?? "unpaid")}</strong></p></Panel>
    <div className="detail-grid commerce-no-print"><div>
      <Panel title="Workflow"><p>Received → payment verified + stock reserved → packing → shipped + stock deducted → delivered → completed + sale recorded.</p><div className="button-group">
        {next[data.stage] && <button className="button button-primary" disabled={busy} onClick={() => void run("", { stage: next[data.stage] }, "PATCH")}>Mark {label(next[data.stage])}</button>}
        {canCancel && <button className="button button-secondary" disabled={busy} onClick={() => { if (window.confirm("Cancel this order and release its reserved stock? A verified payment will require a manual refund.")) void run("", { stage: "cancelled" }, "PATCH"); }}>Cancel order</button>}
      </div>
      {data.stage === "packing" && <form className="modal-form" onSubmit={(event) => { event.preventDefault(); void run("", { ...Object.fromEntries(new FormData(event.currentTarget)), stage: "shipped" }, "PATCH"); }}><label className="field-label">Carrier<input name="carrier" required maxLength={100} /></label><label className="field-label">Tracking number<input name="trackingNumber" required maxLength={150} /></label><button className="button button-primary" disabled={busy}>Dispatch shipment</button></form>}
      {data.carrier && <p>Carrier: {data.carrier} · Tracking: {data.trackingNumber}</p>}
      {canCancel && <><button className="button button-secondary" onClick={() => setShipping(!shipping)}>Edit shipping details</button>{shipping && <form className="modal-form" onSubmit={(event) => fromForm(event, "shipping")}><label className="field-label">Customer phone<input name="customerPhone" defaultValue={data.customerPhone} required maxLength={50} /></label><label className="field-label">Shipping address<textarea name="shippingAddress" defaultValue={data.shippingAddress} required maxLength={1000} /></label><button className="button button-primary" disabled={busy}>Save shipping details</button></form>}</>}
      </Panel>
      <Panel title="Payment validation">{data.payments.map((payment) => <article className="commerce-link-card" key={payment.id}><strong>{payment.method} · {payment.reference}</strong><p>{money(payment.amountMinor, payment.currency)} · {label(payment.status)}</p>{payment.reviewNote && <p>{payment.reviewNote}</p>}</article>)}
        {data.stage === "received" && !pendingPayment && <PaymentForm totalMinor={data.totalMinor} currency={data.currency} busy={busy} submit={(body) => run("payments", body)} />}
        {pendingPayment && data.stage === "received" && role !== "staff" && <><p>Verify the funds independently before approval. Approval reserves inventory atomically.</p><label className="field-label">Review note / rejection reason<textarea maxLength={1000} value={reviewNote} onChange={(event) => setReviewNote(event.target.value)} /></label><div className="button-group"><button className="button button-primary" disabled={busy} onClick={() => void run("verify-payment", { paymentId: pendingPayment.id, note: reviewNote })}>Verify payment & reserve stock</button><button className="button button-secondary" disabled={busy || !reviewNote.trim()} onClick={() => void run("reject-payment", { paymentId: pendingPayment.id, note: reviewNote })}>Reject payment</button></div></>}
        {pendingPayment && data.stage === "received" && role === "staff" && <p>An owner or admin must review this payment.</p>}
        {data.refundDue && role !== "staff" && <form className="modal-form" onSubmit={(event) => fromForm(event, "refund")}><p>Issue the refund outside SellerOne, then record its reference. This does not transfer money.</p><label className="field-label">Refund reference / note<input name="note" required maxLength={1000} /></label><button className="button button-primary" disabled={busy}>Record manual refund</button></form>}
      </Panel>
      <Panel title="Customer communication">{data.trackingPath ? <><ShareLink path={data.trackingPath} /><p>Send this private link to the customer for order confirmation and live status. Do not post it publicly.</p></> : <p>This legacy order has no public tracking link.</p>}
        <p>No automatic email or social message is sent. Prepare a message, send it through your channel, then log it as sent. Sent messages also appear on customer tracking.</p>
        <form className="modal-form" onSubmit={(event) => fromForm(event, "communications")}><label className="field-label">Customer message<textarea name="message" required maxLength={2000} defaultValue={`Your order ${data.orderNumber} is ${label(data.stage).toLowerCase()}.`} key={data.stage} /></label><label className="field-label">Delivery status<select name="status"><option value="prepared">Prepared (not sent)</option><option value="sent">Sent manually</option></select></label><button className="button button-primary" disabled={busy}>Save communication</button></form>
        {data.communications.map((message) => <article className="commerce-link-card" key={message.id}><strong>{label(message.status ?? "")}</strong><p>{message.message}</p><small>{dateLabel(message.createdAt)} · {message.actor}</small></article>)}
      </Panel>
    </div><div><Panel title="Order timeline"><Timeline events={data.timeline} /></Panel>{data.notes && <Panel title="Internal notes"><p>{data.notes}</p></Panel>}</div></div>
  </>;
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
    {tracking.loading ? <p>Loading status...</p> : data && <><Panel title={data.orderNumber}><p>Order: <strong>{label(data.stage)}</strong> · Payment: <strong>{data.refundDue ? "Refund due" : label(data.paymentStatus)}</strong></p><Items items={data.items} currency={data.currency} /><strong>Total: {money(data.totalMinor, data.currency)}</strong>{data.carrier && <p>Carrier: {data.carrier} · Tracking number: {data.trackingNumber}</p>}</Panel>
      {data.stage === "received" && ["unpaid", "rejected"].includes(data.paymentStatus) && <Panel title="Submit payment reference"><p>Contact your seller for payment instructions. Do not pay until the seller confirms the correct payment destination.</p><PaymentForm totalMinor={data.totalMinor} currency={data.currency} busy={busy} submit={submit} /></Panel>}
      <Panel title="Order progress"><Timeline events={data.timeline} /></Panel>
      {data.messages.length > 0 && <Panel title="Seller messages">{data.messages.map((message) => <article className="commerce-link-card" key={message.id}><p>{message.message}</p><small>{dateLabel(message.createdAt)}</small></article>)}</Panel>}
    </>}
  </main>;
}
