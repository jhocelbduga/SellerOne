import React, { useEffect, useRef, useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import { api, useLoad } from "./api";
import type { Role } from "./roles";
import { ProductLifecycleControls, lifecycleLabel } from "./product-lifecycle";

interface Variant {
  id: string; name: string; description?: string | null; sku: string; barcode?: string | null;
  uom: string; uomLocked: boolean; attributes: Record<string, string>; currency: string;
  unitCostMinor: number; sellingPriceMinor: number | null; reorderPoint: number;
  mediumStockLevel: number | null; maximumStockLevel: number | null; active: boolean | number;
}
interface Product { id: string; name: string; description?: string | null; active: boolean | number; updatedAt: string; lifecycleStatus: string; categories: string[]; images: string[]; variants: Variant[] }
interface VariantDraft {
  id: string; name: string; description: string; sku: string; barcode: string; uom: string;
  attributes: string; currency: string; cost: string; price: string; minimum: string;
  medium: string; maximum: string; active: boolean;
}
interface Draft { name: string; description: string; categories: string; images: string[]; active: boolean; variants: VariantDraft[] }
const emptyVariant = (): VariantDraft => ({ id: "new", name: "Standard", description: "", sku: "", barcode: "", uom: "pcs", attributes: "", currency: "PHP", cost: "", price: "", minimum: "0", medium: "", maximum: "", active: true });
const emptyDraft = (): Draft => ({ name: "", description: "", categories: "", images: [], active: true, variants: [emptyVariant()] });
const fromProduct = (product: Product): Draft => ({
  name: product.name, description: product.description ?? "", categories: product.categories.join("\n"), images: product.images, active: Boolean(product.active),
  variants: product.variants.map((v) => ({ id: v.id, name: v.name, description: v.description ?? "", sku: v.sku, barcode: v.barcode ?? "", uom: v.uom, attributes: Object.entries(v.attributes).map(([key, value]) => `${key}=${value}`).join("\n"), currency: v.currency, cost: (v.unitCostMinor / 100).toFixed(2), price: v.sellingPriceMinor == null ? "" : (v.sellingPriceMinor / 100).toFixed(2), minimum: String(v.reorderPoint), medium: v.mediumStockLevel == null ? "" : String(v.mediumStockLevel), maximum: v.maximumStockLevel == null ? "" : String(v.maximumStockLevel), active: Boolean(v.active) })),
});
function isDraft(value: unknown): value is Draft {
  if (!value || typeof value !== "object") return false;
  const d = value as Record<string, unknown>;
  return ["name", "description", "categories"].every((key) => typeof d[key] === "string") && typeof d.active === "boolean"
    && Array.isArray(d.images) && d.images.length <= 3 && d.images.every((image) => typeof image === "string")
    && Array.isArray(d.variants) && d.variants.length > 0 && d.variants.every((v) => v && typeof v === "object"
      && ["id", "name", "description", "sku", "barcode", "uom", "attributes", "currency", "cost", "price", "minimum", "medium", "maximum"].every((key) => typeof v[key] === "string") && typeof v.active === "boolean");
}
function validate(draft: Draft): Record<string, string> {
  const issues: Record<string, string> = {};
  if (!draft.name.trim() || draft.name.length > 200) issues.name = "Enter a product name (1–200 characters).";
  if (draft.description.length > 2000) issues.description = "Keep the description within 2,000 characters.";
  const categories = draft.categories.split("\n").map((value) => value.trim()).filter(Boolean);
  if (categories.length > 20 || categories.some((value) => value.length > 100) || new Set(categories.map((value) => value.toLowerCase())).size !== categories.length) issues.categories = "Use up to 20 unique categories, each at most 100 characters.";
  if (!draft.variants.length) issues.variants = "At least one variant is required.";
  const skus = new Set<string>();
  draft.variants.forEach((v, index) => {
    const key = (field: string) => `v${index}.${field}`;
    for (const [field, max] of [["name", 200], ["sku", 100], ["uom", 30]] as const) if (!v[field].trim() || v[field].length > max) issues[key(field)] = `Enter ${field === "uom" ? "UOM" : field} (1–${max} characters).`;
    if (skus.has(v.sku.trim())) issues[key("sku")] = "Each variant needs a unique SKU.";
    skus.add(v.sku.trim());
    if (!/^[A-Z]{3}$/.test(v.currency) || !Intl.supportedValuesOf("currency").includes(v.currency)) issues[key("currency")] = "Select a supported currency.";
    for (const field of ["cost", "price"] as const) if ((field === "cost" || v[field] !== "") && (!/^\d+(\.\d{1,2})?$/.test(v[field]) || !Number.isSafeInteger(Math.round(Number(v[field]) * 100)))) issues[key(field)] = "Enter a non-negative amount with at most two decimal places.";
    for (const field of ["minimum", "medium", "maximum"] as const) if ((field === "minimum" || v[field] !== "") && (!/^\d+$/.test(v[field]) || !Number.isSafeInteger(Number(v[field])))) issues[key(field)] = "Enter a non-negative whole number.";
    if (v.medium !== "" && Number(v.medium) < Number(v.minimum)) issues[key("medium")] = "Medium stock must be at least minimum stock.";
    if (v.maximum !== "" && Number(v.maximum) < Number(v.medium || v.minimum)) issues[key("maximum")] = "Maximum stock must be at least medium (or minimum) stock.";
    if (v.description.length > 2000) issues[key("description")] = "Keep descriptions within 2,000 characters.";
    if (v.barcode.length > 100) issues[key("barcode")] = "Keep barcodes within 100 characters.";
    const attributes = v.attributes.split("\n").filter((line) => line.trim());
    const names = new Set<string>();
    for (const line of attributes) {
      const split = line.indexOf("=");
      const name = line.slice(0, split).trim();
      if (split < 1 || !name || name.length > 50 || line.slice(split + 1).trim().length > 100 || names.has(name)) issues[key("attributes")] = "Use unique specification=value lines (key ≤50, value ≤100 characters).";
      names.add(name);
    }
  });
  return issues;
}

export function ProductSheet({ role, userId }: { role: Role; userId: string }): React.JSX.Element {
  const { id } = useParams();
  const location = useLocation();
  return <ProductSheetEditor key={`${userId}:${location.pathname}`} id={id} role={role} userId={userId} />;
}
function ProductSheetEditor({ id, role, userId }: { id?: string; role: Role; userId: string }): React.JSX.Element {
  const owner = role === "owner";
  const existing = useLoad<Product>(id ? `/products/${id}` : "");
  const catalogue = useLoad<{ items: Product[] }>(owner ? "/products" : "");
  const stock = useLoad<{ items: { variantId: string; quantityOnHand: number; quantityAvailable: number; quantityReserved: number; uom: string; locationName: string }[] }>(id ? "/stock" : "");
  const navigate = useNavigate();
  const location = useLocation();
  const [draft, setDraft] = useState<Draft>(emptyDraft);
  const [baseline, setBaseline] = useState<Draft>(emptyDraft);
  const [ready, setReady] = useState(false);
  const [editing, setEditing] = useState(owner && (!id || location.pathname.endsWith("/edit")));
  const [busy, setBusy] = useState(false);
  const [imageBusy, setImageBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [draftStatus, setDraftStatus] = useState("");
  const storageKey = `sellerone-product-draft:${userId}:${id ?? "new"}`;
  const dirty = JSON.stringify(draft) !== JSON.stringify(baseline);
  const issues = validate(draft);
  draft.variants.forEach((variant, index) => {
    if (catalogue.data?.items.some((product) => product.id !== id && product.variants.some((entry) => entry.sku === variant.sku.trim()))) issues[`v${index}.sku`] = "This SKU is already used by another product. Choose a unique SKU.";
  });
  const editable = owner && editing && !busy;
  const leaveAllowed = useRef(false);
  const storageFailed = useRef(false);
  useEffect(() => {
    if (ready || (id && !existing.data)) return;
    const saved = existing.data ? fromProduct(existing.data) : emptyDraft();
    setBaseline(saved); setDraft(saved);
    if (owner) {
      try {
        const raw = localStorage.getItem(storageKey);
        if (raw) {
          const parsed: unknown = JSON.parse(raw);
          if (!parsed || typeof parsed !== "object" || !("draft" in parsed) || !("updatedAt" in parsed) || !isDraft(parsed.draft)) throw new Error("Stored draft is invalid.");
          if (parsed.updatedAt !== (existing.data?.updatedAt ?? null) || parsed.draft.variants.map((v) => v.id).join() !== saved.variants.map((v) => v.id).join()) throw new Error("The product changed after this draft was saved. Review current details before editing; the old draft was not applied.");
          if (editing) { setDraft(parsed.draft); setNotice("Recovered your local product draft. Review it before saving."); }
        }
      } catch (caught) { setError(caught instanceof Error ? `Could not recover draft: ${caught.message}` : "Could not recover the local draft."); }
    }
    setReady(true);
  }, [existing.data, id, owner, ready, storageKey]);
  useEffect(() => {
    if (!ready || !owner || !editing || storageFailed.current) return;
    const timer = window.setTimeout(() => {
      try {
        if (dirty) { localStorage.setItem(storageKey, JSON.stringify({ updatedAt: existing.data?.updatedAt ?? null, draft })); setDraftStatus("Draft saved on this device. Not applied to the catalogue."); }
        else { localStorage.removeItem(storageKey); setDraftStatus(""); }
      } catch { storageFailed.current = true; setDraftStatus("Draft autosave failed: browser storage is unavailable or full. Keep this screen open until you save, or discard changes."); }
    }, 400);
    return () => window.clearTimeout(timer);
  }, [draft, dirty, ready, editing, owner, storageKey]);
  useEffect(() => {
    if (!dirty || !editing) return;
    const warning = () => Object.keys(issues).length ? "Required product information is missing or invalid. Leave with an incomplete draft? Changes are not saved to the catalogue." : "You have unsaved product changes. Leave this screen?";
    const unload = (event: BeforeUnloadEvent) => { if (!leaveAllowed.current) { event.preventDefault(); event.returnValue = ""; } };
    const click = (event: MouseEvent) => {
      if (!(event.target instanceof Element) || leaveAllowed.current) return;
      const link = event.target.closest("a");
      if (!link || link.target === "_blank" || link.getAttribute("href")?.startsWith("#")) return;
      if (!window.confirm(warning())) { event.preventDefault(); event.stopPropagation(); }
    };
    window.addEventListener("beforeunload", unload);
    document.addEventListener("click", click, true);
    return () => { window.removeEventListener("beforeunload", unload); document.removeEventListener("click", click, true); };
  }, [dirty, editing, issues]);
  const discard = () => {
    if (dirty && !window.confirm("Discard all unsaved product changes and the local draft?")) return false;
    setDraft(baseline); setError(""); setNotice(""); storageFailed.current = false;
    try { localStorage.removeItem(storageKey); setDraftStatus(""); } catch { setDraftStatus("Could not remove the draft from browser storage."); }
    return true;
  };
  const update = (field: keyof Pick<Draft, "name" | "description" | "categories">, value: string) => { setNotice(""); setDraft((current) => ({ ...current, [field]: value })); };
  const editVariant = (index: number, field: keyof VariantDraft, value: string | boolean) => { setNotice(""); setDraft((current) => ({ ...current, variants: current.variants.map((v, i) => i === index ? { ...v, [field]: value } : v) })); };
  const upload = async (files: FileList | null) => {
    if (!files?.length) return;
    setImageBusy(true); setError("");
    try {
      if (draft.images.length + files.length > 3) throw new Error("Use at most three product images. Remove an image before adding another.");
      const images: string[] = [];
      for (const file of Array.from(files)) {
        if (!["image/png", "image/jpeg", "image/webp"].includes(file.type) || file.size > 5 * 1024 * 1024) throw new Error("Select PNG, JPEG or WebP images, at most 5 MB each.");
        const image = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => typeof reader.result === "string" ? resolve(reader.result) : reject(new Error("Could not read product image."));
          reader.onerror = () => reject(new Error("Could not read product image."));
          reader.readAsDataURL(file);
        });
        images.push(image);
      }
      setDraft((current) => ({ ...current, images: [...current.images, ...images] }));
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Could not load product images."); }
    finally { setImageBusy(false); }
  };
  const save = async (event: React.FormEvent) => {
    event.preventDefault(); setError(""); setNotice("");
    if (!owner) { setError("Access denied: only Workspace Owners can modify products."); return; }
    if (Object.keys(issues).length || busy || imageBusy || catalogue.loading || catalogue.error) { setError("Complete the required fields and load the catalogue before saving."); return; }
    setBusy(true);
    try {
      const variants = draft.variants.map((v) => ({ id: id ? v.id : undefined, name: v.name.trim(), description: v.description || null, sku: v.sku.trim(), barcode: v.barcode || null, uom: v.uom.trim(), currency: v.currency, active: v.active, attributes: Object.fromEntries(v.attributes.split("\n").filter((line) => line.trim()).map((line) => { const at = line.indexOf("="); return [line.slice(0, at).trim(), line.slice(at + 1).trim()]; })), unitCostMinor: Math.round(Number(v.cost) * 100), sellingPriceMinor: v.price === "" ? null : Math.round(Number(v.price) * 100), reorderPoint: Number(v.minimum), mediumStockLevel: v.medium === "" ? null : Number(v.medium), maximumStockLevel: v.maximum === "" ? null : Number(v.maximum) }));
      const result = await api<Product>(id ? `/products/${id}/sheet` : "/products", { method: id ? "PUT" : "POST", body: JSON.stringify({ expectedUpdatedAt: existing.data?.updatedAt, name: draft.name.trim(), description: draft.description || null, categories: draft.categories.split("\n").map((value) => value.trim()).filter(Boolean), images: draft.images, active: draft.active, variants }) });
      const saved = fromProduct(result); existing.setData(result); setDraft(saved); setBaseline(saved); setEditing(false); leaveAllowed.current = true;
      try { localStorage.removeItem(storageKey); setDraftStatus(""); } catch { setDraftStatus("Product saved, but the old local draft could not be removed."); }
      setNotice("Product saved successfully. All product and variant changes were committed together.");
      if (!id) navigate(`/products/${result.id}`, { state: { productSaved: true } });
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Could not save product."); }
    finally { setBusy(false); }
  };
  if (!id && !owner) return <section className="panel"><h1>Access denied</h1><p role="alert">Only Workspace Owners can create or modify catalogue records.</p></section>;
  if (id && existing.loading && !ready) return <p role="status">Loading product information...</p>;
  if (existing.error) return <section className="panel"><p role="alert">{existing.error}</p><button className="button" onClick={existing.reload}>Retry product</button></section>;
  const field = (key: string, title: string, value: string, onChange: (value: string) => void, options: { type?: string; max?: number; multiline?: boolean; required?: boolean; locked?: boolean } = {}) => <label className="field-label" key={key}>{title}{options.required && " *"}
    {options.multiline ? <textarea rows={3} aria-label={title + (options.required ? " *" : "")} disabled={!editable} maxLength={options.max} value={value} aria-invalid={Boolean(issues[key])} onChange={(event) => onChange(event.target.value)} /> : <input aria-label={title + (options.required ? " *" : "")} type={options.type ?? "text"} step={options.type === "number" ? key.endsWith("cost") || key.endsWith("price") ? "0.01" : "1" : undefined} min={options.type === "number" ? 0 : undefined} readOnly={options.locked} required={options.required} disabled={!editable} maxLength={options.max} value={value} aria-invalid={Boolean(issues[key])} onChange={(event) => onChange(event.target.value)} />}
    {editing && issues[key] && <small className="field-error">{issues[key]}</small>}{options.locked && <small>UOM is locked by stock history. Create a new variant for a different unit.</small>}
  </label>;
  return <>
    <button className="button button-secondary" type="button" onClick={() => { if (!dirty || window.confirm("Leave with unsaved product changes? Review any missing information before leaving.")) { leaveAllowed.current = true; navigate("/products"); } }}>Back to products</button>
    <div className="page-heading"><div><span className="page-eyebrow">PRODUCT INFORMATION SHEET · {editing ? "EDIT MODE" : "VIEW MODE"}</span><h1>{id ? draft.name || "Product information" : "Add a product"}</h1><p>{owner ? "Complete required fields marked * before saving. Stock quantities are managed through inventory movements." : "Read-only access. Only Workspace Owners can modify catalogue records."}</p></div>{owner && !editing && <button className="button button-primary" onClick={() => { leaveAllowed.current = false; if (id && !location.pathname.endsWith("/edit")) navigate(`/products/${id}/edit`); else setEditing(true); }}>Edit Product</button>}</div>
    {(notice || location.state?.productSaved) && <div className="success-box" role="status">{notice || "Product created successfully."}</div>}
    {error && <div className="error-box" role="alert">{error}</div>}
    <form onSubmit={(event) => void save(event)} className="form-layout product-sheet">
      <section className="panel product-completion"><strong>Completion status: {Object.keys(issues).length ? "Missing Required Information" : dirty ? "In Progress" : "Complete"}</strong>
        {editing && Object.keys(issues).length > 0 && <div role="alert"><p>Complete or correct these fields to enable Save Changes:</p><ul>{Object.entries(issues).map(([key, message]) => <li key={key}>{key.startsWith("v") ? `Variant ${Number(key.split(".")[0].slice(1)) + 1}, ${key.split(".")[1]}: ` : ""}{message}</li>)}</ul></div>}
        {owner && catalogue.error && <p role="alert">{catalogue.error}<button className="button" type="button" onClick={catalogue.reload}>Retry catalogue validation</button></p>}
        {draftStatus && <p role={storageFailed.current ? "alert" : "status"}>{draftStatus}</p>}
      </section>
      <section className="panel"><h2>Product details</h2><div className="form-grid">
        {field("name", "Product name", draft.name, (value) => update("name", value), { required: true, max: 200 })}
        {field("description", "Description", draft.description, (value) => update("description", value), { multiline: true, max: 2000 })}
        {field("categories", "Categories (one per line, optional)", draft.categories, (value) => update("categories", value), { multiline: true })}
        <p>Lifecycle status: <strong>{lifecycleLabel(existing.data?.lifecycleStatus ?? "active")}</strong>. Use the reason-based retirement workflow to change this status.</p>
      </div></section>
      <section className="panel"><h2>Product images</h2><p>Up to three PNG, JPEG or WebP images, 5 MB each, single-frame and at most 4096 × 4096 pixels. Images are validated and metadata removed on save.</p><div className="product-images">{draft.images.map((image, index) => <figure key={`${index}:${image.slice(-30)}`}><img src={image} alt={`${draft.name || "Product"} image ${index + 1}`} />{editable && <button type="button" className="button button-secondary" onClick={() => setDraft((current) => ({ ...current, images: current.images.filter((_, i) => i !== index) }))}>Remove image {index + 1}</button>}</figure>)}</div>{editable && <label className="field-label">Add product images<input type="file" accept="image/png,image/jpeg,image/webp" multiple disabled={imageBusy || draft.images.length >= 3} onChange={(event) => { void upload(event.target.files); event.target.value = ""; }} /></label>}{imageBusy && <p role="status">Preparing images...</p>}</section>
      {id && <section className="panel"><h2>Current inventory (read-only)</h2>{stock.loading ? <p role="status">Loading stock balances...</p> : stock.error ? <p role="alert">{stock.error}<button className="button" type="button" onClick={stock.reload}>Retry stock</button></p> : <ul>{stock.data?.items.filter((row) => draft.variants.some((variant) => variant.id === row.variantId)).map((row) => <li key={`${row.variantId}:${row.locationName}`}>{draft.variants.find((variant) => variant.id === row.variantId)?.name} · {row.locationName}: {row.quantityOnHand} {row.uom} on hand · {row.quantityReserved} reserved · {row.quantityAvailable} available</li>)}</ul>}<p>Use authorised receiving, stock movement or reconciliation screens to change quantities.</p></section>}
      {draft.variants.map((v, index) => <section className="panel" key={v.id}><h2>Variant {index + 1}: {v.name || "Required information"}</h2><div className="form-grid">
        {([["name", "Variant name", true, 200], ["sku", "SKU", true, 100], ["uom", "Unit of measure (UOM)", true, 30], ["barcode", "Barcode", false, 100], ["description", "Variant description", false, 2000], ["attributes", "Specifications (one key=value per line)", false, undefined]] as const).map(([key, title, required, max]) => field(`v${index}.${key}`, title, v[key], (value) => editVariant(index, key, value), { required, max, multiline: key === "description" || key === "attributes", locked: key === "uom" && existing.data?.variants[index]?.uomLocked }))}
        <label className="field-label">Currency *<select disabled={!editable} value={v.currency} onChange={(event) => editVariant(index, "currency", event.target.value)}>{[...new Set(["PHP", "USD", "SGD", "AUD", "EUR", "GBP", v.currency])].map((value) => <option key={value}>{value}</option>)}</select>{issues[`v${index}.currency`] && <small className="field-error">{issues[`v${index}.currency`]}</small>}</label>
        {([["cost", "Unit cost", true], ["price", "Selling price (blank = manual pricing)", false], ["minimum", "Minimum stock", true], ["medium", "Medium stock (optional)", false], ["maximum", "Maximum stock (optional)", false]] as const).map(([key, title, required]) => field(`v${index}.${key}`, `${title} (${key === "cost" || key === "price" ? v.currency + " / " : ""}${v.uom})`, v[key], (value) => editVariant(index, key, value), { type: "number", required }))}
        {id && <label className="field-label">Variant status<select disabled={!editable} value={v.active ? "active" : "archived"} onChange={(event) => editVariant(index, "active", event.target.value === "active")}><option value="active">Active</option><option value="archived">Archived</option></select></label>}
      </div><small>Stock levels are planning targets, not stock receipts or hard limits. Existing stock and order history are preserved.</small></section>)}
      {owner && editing && <div className="form-actions"><button type="button" className="button button-secondary" disabled={busy || imageBusy} onClick={() => { if (discard()) { setEditing(false); if (!id) { leaveAllowed.current = true; navigate("/products"); } } }}>Cancel Changes</button><button type="button" className="button button-secondary" disabled={busy || imageBusy} onClick={discard}>Reset</button><button type="submit" className="button button-primary" disabled={busy || imageBusy || catalogue.loading || !!catalogue.error || !!Object.keys(issues).length || !dirty}>{busy ? "Saving..." : "Save Changes"}</button></div>}
      {busy && <p role="status">Saving product information...</p>}
    </form>
    {id && !editing && existing.data && <section className="panel"><h2>Product lifecycle management</h2><ProductLifecycleControls productId={id} productName={existing.data.name} status={existing.data.lifecycleStatus} role={role} history onChanged={() => { setNotice("Product lifecycle updated. Audit history and stakeholder notifications recorded."); setReady(false); existing.reload(); stock.reload(); }} /></section>}
    {id && editing && <p>Save or cancel product edits to manage lifecycle status and view its audit history.</p>}
  </>;
}
