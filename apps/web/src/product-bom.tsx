import React, { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { api, money, useLoad } from "./api";
import type { Role } from "./roles";

interface Material { id: string; productId: string; productName: string; name: string; sku: string; description: string; uom: string; active: boolean; isRawMaterial: boolean }
interface Component { variantId: string; quantity: number; uom: string; description: string; remarks: string }
interface Bom { variantId: string; outputQuantity: number; outputUom: string; notes: string; updatedAt: string; components: Component[] }
interface Transaction { id: string; variantId: string; quantity: number; locationId: string; actorName: string; actorRole: string; createdAt: string; note: string; costMinor: number; currency: string; materials: Requirement[] }
interface Data { enabled: boolean; version: string; variants: Material[]; materials: Material[]; boms: Bom[]; uoms: string[]; transactions: Transaction[] }
interface DraftComponent { variantId: string; quantity: string; description: string; remarks: string }
interface Requirement { variantId: string; productName: string; name: string; sku: string; uom: string; required: number; available: number; shortage: number }
interface Plan { variantId: string; locationId: string; quantity: number; currency: string; expectedUpdatedAt: string; materials: Requirement[]; canProduce: boolean }
const decimalUom = (uom: string) => ["kg", "g", "lb", "L", "ml"].includes(uom);
const uomNames: Record<string, string> = { kg: "Kilogram (kg)", g: "Gram (g)", lb: "Pound (lb)", pc: "Piece (pc)", ea: "Unit (ea)", set: "Set", pack: "Pack", box: "Box", case: "Case", bundle: "Bundle", L: "Litre (L)", ml: "Millilitre (ml)", scoop: "Scoop", sachet: "Sachet", bottle: "Bottle", bag: "Bag", tube: "Tube" };

export function ProductBom({ productId, role, onStockChanged }: { productId: string; role: Role; onStockChanged: () => void }): React.JSX.Element {
  const load = useLoad<Data>(`/product-bom/${encodeURIComponent(productId)}`);
  const locations = useLoad<{ items: { id: string; name: string }[] }>("/locations");
  const catalogue = useLoad<{ items: { variants: Material[]; name: string }[] }>(role === "owner" ? "/products" : "");
  const [editing, setEditing] = useState(false);
  const [enabled, setEnabled] = useState(false);
  const [drafts, setDrafts] = useState<Record<string, DraftComponent[]>>({});
  const [version, setVersion] = useState("");
  const [baseline, setBaseline] = useState("");
  const panel = useRef<HTMLElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [selected, setSelected] = useState("");
  const [quantity, setQuantity] = useState("1");
  const [locationId, setLocationId] = useState("main");
  const [plan, setPlan] = useState<Plan | null>(null);
  const [note, setNote] = useState("");
  const [requestKey, setRequestKey] = useState("");
  const [quickAdd, setQuickAdd] = useState(false);
  const [existingId, setExistingId] = useState("");
  const [material, setMaterial] = useState({ name: "", sku: "", description: "", uom: "kg", cost: "", currency: "PHP" });
  const owner = role === "owner";
  const canProduce = ["owner", "admin", "staff", "inventory_controller"].includes(role);
  const data = load.data;
  const outputs = data?.variants.filter((v) => v.active && !v.isRawMaterial) ?? [];
  const beginEdit = () => {
    if (!data) return;
    setEnabled(data.enabled); setVersion(data.version);
    const next = Object.fromEntries(outputs.map((v) => [v.id, data.boms.find((b) => b.variantId === v.id)?.components.map((c) => ({
      variantId: c.variantId, quantity: String(c.quantity / (data.boms.find((b) => b.variantId === v.id)?.outputQuantity ?? 1)), description: c.description, remarks: c.remarks,
    })) ?? []]));
    setDrafts(next); setBaseline(JSON.stringify({ enabled: data.enabled, drafts: next }));
    setError(""); setNotice(""); setEditing(true);
  };
  useEffect(() => { setPlan(null); setRequestKey(""); }, [selected, quantity, locationId, data?.version]);
  const dirty = editing && baseline !== JSON.stringify({ enabled, drafts });
  useEffect(() => {
    if (!dirty) return;
    const unload = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    const click = (event: MouseEvent) => {
      if (!(event.target instanceof Element) || panel.current?.contains(event.target)) return;
      const target = event.target.closest("a, button");
      if (target && (target.tagName === "A" || ["Edit Product", "Back to products", "Profile Settings"].includes(target.textContent?.trim() ?? target.getAttribute("aria-label") ?? ""))
        && !window.confirm("Leave with unsaved BOM changes? Save the BOM configuration first, or confirm to discard your edits.")) {
        event.preventDefault(); event.stopPropagation();
      }
    };
    window.addEventListener("beforeunload", unload); document.addEventListener("click", click, true);
    return () => { window.removeEventListener("beforeunload", unload); document.removeEventListener("click", click, true); };
  }, [dirty]);
  const issue = (c: DraftComponent, list: DraftComponent[]) => {
    const m = data?.materials.find((v) => v.id === c.variantId);
    if (!m || !m.active || !m.productName.trim() || !m.sku.trim()) return "Choose an active raw material with a name and SKU.";
    if (!data?.uoms.includes(m.uom)) return "Raw material needs a supported Stock UOM. Update or create its inventory record.";
    if (list.filter((r) => r.variantId === c.variantId).length > 1) return "Duplicate raw material. Each component may appear once.";
    const amount = Number(c.quantity);
    if (!c.quantity.trim() || !Number.isFinite(amount) || Number(amount.toFixed(6)) <= 0 || amount > 1e9 || Math.abs(amount - Number(amount.toFixed(6))) > 1e-10 || (!decimalUom(m.uom) && !Number.isSafeInteger(amount))) return "Usage must be greater than zero: whole count units or up to six weight/volume decimals.";
    return "";
  };
  const invalid = enabled && (!outputs.length || outputs.some((v) => !drafts[v.id]?.length || drafts[v.id].some((c) => issue(c, drafts[v.id]))));
  const update = (id: string, index: number, values: Partial<DraftComponent>) => setDrafts((current) => ({
    ...current, [id]: current[id].map((c, i) => i === index ? { ...c, ...values } : c),
  }));
  const save = async () => {
    if (!data || invalid || busy) return;
    setBusy(true); setError(""); setNotice("");
    try {
      const saved = await api<Data>(`/product-bom/${productId}`, { method: "PUT", body: JSON.stringify({ enabled, expectedVersion: version,
        boms: enabled ? outputs.map((v) => ({ variantId: v.id, outputUom: v.uom, notes: data.boms.find((b) => b.variantId === v.id)?.notes ?? "",
          components: drafts[v.id].map((c) => ({ ...c, quantity: Number(c.quantity), uom: data.materials.find((m) => m.id === c.variantId)?.uom })) })) : [] }) });
      load.setData({ ...saved, transactions: data.transactions }); setEditing(false); setNotice(enabled ? "Raw Material BOM saved. No inventory was consumed." : "BOM disabled. Saved components and production history are retained."); load.reload();
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Could not save BOM."); }
    finally { setBusy(false); }
  };
  const quickSave = async (event: React.FormEvent) => {
    event.preventDefault(); setBusy(true); setError("");
    try {
      const result = await api<Data>(`/product-bom/${productId}/materials`, { method: "POST", body: JSON.stringify(existingId ? { variantId: existingId } :
        { ...material, unitCostMinor: Math.round(Number(material.cost) * 100) }) });
      load.setData({ ...result, transactions: data?.transactions ?? [] });
      setVersion(result.version); catalogue.reload(); setQuickAdd(false); setExistingId("");
      setMaterial({ name: "", sku: "", description: "", uom: "kg", cost: "", currency: "PHP" });
      setNotice("Raw material linked to inventory. Select it in the component list; receive its stock before production.");
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Could not add raw material."); }
    finally { setBusy(false); }
  };
  const preview = async () => {
    setBusy(true); setError(""); setPlan(null); setNotice("");
    try {
      const result = await api<Plan>(`/product-bom/${productId}/requirements`, { method: "POST", body: JSON.stringify({ variantId: selected, locationId, quantity: Number(quantity) }) });
      setPlan(result); setRequestKey(crypto.randomUUID());
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Could not calculate material requirements."); }
    finally { setBusy(false); }
  };
  const produce = async () => {
    if (!plan || !plan.canProduce || busy) return;
    if (!window.confirm(`Produce ${plan.quantity} units? This will consume the listed raw materials and receive finished stock at the selected location.`)) return;
    setBusy(true); setError("");
    try {
      const result = await api<{ id: string; duplicate?: boolean }>(`/production/${productId}`, { method: "POST", body: JSON.stringify({
        variantId: plan.variantId, locationId: plan.locationId, quantity: plan.quantity, expectedUpdatedAt: plan.expectedUpdatedAt, requestKey, note, confirmed: true,
      }) });
      setNotice(`Production recorded (${result.id}). Material consumption and finished-stock receipt are logged${result.duplicate ? "; duplicate retry did not consume again" : ""}.`);
      setPlan(null); setNote(""); load.reload(); onStockChanged();
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Could not record production."); }
    finally { setBusy(false); }
  };
  const showBom = editing ? enabled : data?.enabled;
  return <section ref={panel} className="panel product-bom-panel" aria-label="Product Raw Material BOM">
    <div className="section-heading"><h2>Product Details · Raw Material BOM</h2>{owner && !editing && data && <button type="button" className="button button-secondary" disabled={busy || load.loading} onClick={beginEdit}>Edit Raw Material BOM</button>}</div>
    {load.loading && <p role="status">Loading product BOM...</p>}
    {load.error && <p className="error-box" role="alert">{load.error}<button type="button" className="button" onClick={load.reload}>Retry BOM</button></p>}
    {error && <p className="error-box" role="alert">{error}</p>}{notice && <p className="success-box" role="status">{notice}</p>}
    {data && <>
      <label className="bom-toggle"><input type="checkbox" checked={Boolean(showBom)} disabled={!editing || busy} onChange={(event) => setEnabled(event.target.checked)} /> Uses Raw Material BOM</label>
      <p>Standard products default to unchecked. BOMs are defined per finished-product variant. Inventory records provide material names, SKUs and stock UOM; no unit conversion is performed.</p>
      {!owner && <p>Read-only BOM configuration. Only Workspace Owners define components.</p>}
      {showBom && <>
        <h3>Raw Material BOM Components ({editing ? Object.values(drafts).reduce((sum, list) => sum + list.length, 0) : data.boms.reduce((sum, b) => sum + b.components.length, 0)})</h3>
        {editing && <button type="button" className="button button-secondary" disabled={busy} onClick={() => setQuickAdd((v) => !v)}>Quick-add raw material inventory record</button>}
        {editing && !outputs.length && <p role="alert">An active, non-raw-material output variant is required.</p>}
        {(editing ? outputs : data.variants.filter((v) => data.boms.some((b) => b.variantId === v.id))).map((output) => {
          const bom = data.boms.find((b) => b.variantId === output.id);
          const list = editing ? drafts[output.id] ?? [] : bom?.components.map((c) => ({ ...c, quantity: String(c.quantity / (bom.outputQuantity || 1)) })) ?? [];
          return <div className="bom-variant" key={output.id}><h4>{output.name} · {output.sku} ({list.length} components)</h4>
            <div className="table-scroll"><table className="data-table"><thead><tr><th>Raw Material Name</th><th>SKU / Material Code</th><th>Component Description</th><th>Stock UOM</th><th>Usage Per Unit Produced</th><th>Remarks</th>{editing && <th>Action</th>}</tr></thead><tbody>
              {list.map((c, index) => {
                const m = data.materials.find((v) => v.id === c.variantId); const problem = editing ? issue(c, list) : "";
                return <tr key={index}><td>{editing ? <><select aria-label={`Raw Material Name ${output.sku} ${index + 1}`} required disabled={busy} value={c.variantId} onChange={(event) => { const next = data.materials.find((v) => v.id === event.target.value); update(output.id, index, { variantId: event.target.value, description: next?.description ?? "" }); }}><option value="">Choose raw material</option>{data.materials.map((v) => <option key={v.id} value={v.id} disabled={!v.active}>{v.productName} · {v.name} · {v.sku}{!v.active && " (inactive)"}</option>)}</select>{problem && <small className="field-error" role="alert">{problem}</small>}</> : m?.productName ?? "Unavailable material"}</td>
                  <td>{m?.sku ?? "Required"}</td><td>{editing ? <input aria-label={`Component Description ${output.sku} ${index + 1}`} maxLength={2000} disabled={busy} value={c.description} onChange={(event) => update(output.id, index, { description: event.target.value })} /> : c.description || "—"}</td>
                  <td>{m ? uomNames[m.uom] ?? m.uom : "Required"}</td><td>{editing ? <input aria-label={`Usage Per Unit ${output.sku} ${index + 1}`} type="number" min={decimalUom(m?.uom ?? "") ? "0.000001" : "1"} step={decimalUom(m?.uom ?? "") ? "0.000001" : "1"} required disabled={busy} aria-invalid={!!problem} value={c.quantity} onChange={(event) => update(output.id, index, { quantity: event.target.value })} /> : c.quantity}</td>
                  <td>{editing ? <input aria-label={`Remarks ${output.sku} ${index + 1}`} maxLength={2000} disabled={busy} value={c.remarks} onChange={(event) => update(output.id, index, { remarks: event.target.value })} /> : c.remarks || "—"}</td>
                  {editing && <td><button type="button" className="button button-secondary" disabled={busy} onClick={() => setDrafts((current) => ({ ...current, [output.id]: current[output.id].filter((_, i) => i !== index) }))}>Remove component</button></td>}</tr>;
              })}
            </tbody></table></div>
            {!list.length && <p className="field-error">Add at least one component for this finished-product variant.</p>}
            {editing && <button type="button" className="button button-secondary" disabled={busy || list.length >= 100} onClick={() => setDrafts((current) => ({ ...current, [output.id]: [...current[output.id] ?? [], { variantId: "", quantity: "1", description: "", remarks: "" }] }))}>Add component to {output.name}</button>}
          </div>;
        })}
      </>}
      {editing && <div className="button-group"><button type="button" className="button button-secondary" disabled={busy} onClick={() => { if (window.confirm("Discard unsaved BOM changes?")) { setEditing(false); setQuickAdd(false); setError(""); } }}>Cancel BOM changes</button><button type="button" className="button button-primary" disabled={busy || invalid} onClick={() => void save()}>{busy ? "Saving..." : "Save BOM configuration"}</button></div>}
      {editing && quickAdd && <form className="bom-quick-add form-grid" onSubmit={(event) => void quickSave(event)}>
        <h3 className="field-span">Quick-add raw material</h3>
        <label className="field-label field-span">Use existing inventory variant<select disabled={busy || catalogue.loading} value={existingId} onChange={(event) => setExistingId(event.target.value)}><option value="">Create a new raw material</option>{catalogue.data?.items.flatMap((p) => p.variants.filter((v) => !data.materials.some((m) => m.id === v.id) && !data.variants.some((o) => o.id === v.id)).map((v) => <option key={v.id} value={v.id}>{p.name} · {v.name} · {v.sku} ({v.uom})</option>))}</select>{catalogue.error && <span role="alert">{catalogue.error}</span>}</label>
        {!existingId && <>{(["name", "sku", "description"] as const).map((field) => <label className="field-label" key={field}>{field === "name" ? "Raw Material Name *" : field === "sku" ? "SKU / Material Code *" : "Component Description"}<input required={field !== "description"} maxLength={field === "description" ? 2000 : field === "sku" ? 100 : 200} disabled={busy} value={material[field]} onChange={(event) => setMaterial((current) => ({ ...current, [field]: event.target.value }))} /></label>)}
          <label className="field-label">Stock UOM *<select required disabled={busy} value={material.uom} onChange={(event) => setMaterial((current) => ({ ...current, uom: event.target.value }))}>{data.uoms.map((uom) => <option key={uom} value={uom}>{uomNames[uom]}</option>)}</select></label>
          <label className="field-label">Unit cost per stock UOM *<input type="number" required min="0" step="0.01" disabled={busy} value={material.cost} onChange={(event) => setMaterial((current) => ({ ...current, cost: event.target.value }))} /></label>
          <label className="field-label">Currency<select disabled={busy} value={material.currency} onChange={(event) => setMaterial((current) => ({ ...current, currency: event.target.value }))}>{["PHP", "USD", "SGD", "AUD", "EUR", "GBP"].map((c) => <option key={c}>{c}</option>)}</select></label></>}
        <p className="field-span">Creates/classifies inventory only, with zero stock. This record persists even if you cancel BOM edits.</p>
        <button type="submit" className="button button-primary" disabled={busy}>Save raw material inventory record</button>
      </form>}
      {!editing && data.enabled && <section className="bom-production"><h3>Material requirements &amp; production / assembly</h3><p>Preview requirements for a production or order quantity. Record production explicitly to consume materials and receive finished stock; orders do not consume raw materials automatically.</p>
        {locations.error && <p role="alert">{locations.error}<button type="button" onClick={locations.reload}>Retry locations</button></p>}
        <div className="form-grid"><label className="field-label">Output variant<select value={selected} disabled={busy} onChange={(event) => setSelected(event.target.value)}><option value="">Choose output</option>{outputs.map((v) => <option key={v.id} value={v.id}>{v.name} · {v.sku}</option>)}</select></label>
          <label className="field-label">Production / order quantity<input type="number" min="1" max="1000000" step="1" value={quantity} disabled={busy} onChange={(event) => setQuantity(event.target.value)} /></label>
          <label className="field-label">Production location<select value={locationId} disabled={busy} onChange={(event) => setLocationId(event.target.value)}>{locations.data?.items.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}</select></label></div>
        <button type="button" className="button button-secondary" disabled={busy || !selected || !Number.isSafeInteger(Number(quantity)) || Number(quantity) <= 0 || locations.loading || !!locations.error} onClick={() => void preview()}>Calculate material requirements</button>
        {plan && <><div className="table-scroll"><table className="data-table"><thead><tr><th>Raw Material / SKU</th><th>Required</th><th>Available</th><th>Shortage</th><th>Action</th></tr></thead><tbody>{plan.materials.map((m) => <tr key={m.variantId}><td>{m.productName} · {m.sku}</td><td>{m.required} {m.uom}</td><td>{m.available} {m.uom}</td><td>{m.shortage} {m.uom}</td><td>{m.shortage > 0 && canProduce && <Link to={`/inventory?receive=${encodeURIComponent(m.variantId)}&quantity=${m.shortage}&locationId=${encodeURIComponent(plan.locationId)}`}>Receive material stock</Link>}</td></tr>)}</tbody></table></div>
          {!plan.canProduce && <p role="alert">Insufficient raw materials. Receive the missing stock and recalculate before production.</p>}
          {canProduce && <><label className="field-label">Production notes (optional)<input maxLength={2000} value={note} disabled={busy} onChange={(event) => { setNote(event.target.value); setRequestKey(crypto.randomUUID()); }} /></label><button type="button" className="button button-primary" disabled={busy || !plan.canProduce} onClick={() => void produce()}>Record production / assembly</button></>}
        </>}
      </section>}
      {!!data.transactions?.length && <details><summary>Production / assembly transaction history ({data.transactions.length})</summary><ol>{data.transactions.map((t) => <li key={t.id}><strong>{t.quantity} finished units · {t.actorName} ({t.actorRole}) · {new Date(t.createdAt).toLocaleString()}</strong><p>Transaction: {t.id} · Location: {t.locationId} · Consumed cost: {money(t.costMinor, t.currency)}</p>{t.note && <p>{t.note}</p>}<ul>{t.materials.map((m) => <li key={m.variantId}>{m.sku}: {m.required} {m.uom} consumed</li>)}</ul></li>)}</ol></details>}
    </>}
  </section>;
}
