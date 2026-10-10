import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api, useLoad } from "./api";
import { isAdmin, type Role } from "./roles";

interface MaterialVariant {
  id: string; productName: string; name: string; sku: string; uom: string;
  active: boolean; isRawMaterial: boolean;
}
interface Component {
  variantId: string; quantity: number; uom: string;
}
interface Bom {
  variantId: string; outputQuantity: number; outputUom: string;
  notes: string; updatedAt: string; components: Component[];
}
interface BomData { variants: MaterialVariant[]; boms: Bom[] }
interface DraftComponent { key: number; variantId: string; quantity: string; uom: string }

export function RawMaterialBomPage({ enabled, role }: { enabled: boolean; role: Role }): React.JSX.Element {
  const { data, loading, error, reload } = useLoad<BomData>(enabled ? "/raw-material-bom" : "");
  const [selected, setSelected] = useState("");
  const [materialId, setMaterialId] = useState("");
  const [search, setSearch] = useState("");
  const [outputQuantity, setOutputQuantity] = useState("1");
  const [outputUom, setOutputUom] = useState("");
  const [notes, setNotes] = useState("");
  const [components, setComponents] = useState<DraftComponent[]>([]);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState("");
  const [notice, setNotice] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const canEdit = isAdmin(role);
  const variants = data?.variants ?? [];
  const materials = variants.filter((variant) => variant.isRawMaterial);
  const outputs = variants.filter((variant) => !variant.isRawMaterial);
  const output = variants.find((variant) => variant.id === selected);
  const saved = data?.boms.find((bom) => bom.variantId === selected);
  useEffect(() => {
    const bom = data?.boms.find((entry) => entry.variantId === selected);
    const variant = data?.variants.find((entry) => entry.id === selected);
    if (variant?.isRawMaterial) setSelected("");
    setOutputQuantity(String(bom?.outputQuantity ?? 1));
    setOutputUom(bom?.outputUom ?? variant?.uom ?? "");
    setNotes(bom?.notes ?? "");
    setComponents(bom?.components.map((entry, key) => ({ ...entry, key, quantity: String(entry.quantity) })) ?? []);
    setConfirmDelete(false);
  }, [selected, data]);
  useEffect(() => {
    if (data?.variants.find((variant) => variant.id === materialId)?.isRawMaterial) setMaterialId("");
  }, [data, materialId]);
  const mutate = async (path: string, method: string, body: object | undefined, message: string) => {
    setBusy(true); setProblem(""); setNotice("");
    try {
      await api(path, { method, body: body === undefined ? undefined : JSON.stringify(body) });
      setNotice(message); reload();
    } catch (caught) { setProblem(caught instanceof Error ? caught.message : "Could not update the BOM view."); }
    finally { setBusy(false); }
  };
  const save = (event: React.FormEvent) => {
    event.preventDefault();
    if (!output || busy) return;
    void mutate(`/raw-material-bom/${selected}`, "PUT", {
      outputQuantity: Number(outputQuantity), outputUom, notes,
      components: components.map((entry) => ({ variantId: entry.variantId, quantity: Number(entry.quantity), uom: entry.uom })),
    }, "BOM saved. Catalog, stock, and orders were not changed.");
  };
  if (!enabled) return <section className="panel form-panel"><h1>Raw Material BOM</h1><p>This optional view is disabled. Saved classifications and BOMs are retained.</p>{canEdit ? <Link to="/settings#preferences">Enable in Settings preferences</Link> : <p>Ask an owner or admin to enable it.</p>}<p>The standard Product catalogue remains available.</p><Link to="/products">View products</Link></section>;
  return <>
    <div className="page-heading"><div><span className="page-eyebrow">MATERIAL PLANNING</span><h1>Raw Material BOM</h1><p>Classify raw materials and define a single-level bill of materials for each finished-product variant.</p></div></div>
    <p>Optional planning view only. Product listings, recipe attributes, stock receipts, reservations, and order fulfillment are unchanged. Decimal BOM quantities use the exact displayed UOM; no unit conversion or automatic deduction is performed.</p>
    {!canEdit && <p>Read-only access. Owners and admins manage classifications and BOMs.</p>}
    {error && <div className="error-box" role="alert">{error}</div>}
    {problem && <div className="error-box" role="alert">{problem}</div>}
    {notice && <div className="success-box" role="status">{notice}</div>}
    {loading ? <p role="status">Loading materials and BOMs...</p> : error ? <button type="button" className="button button-secondary" onClick={reload}>Retry loading</button> : <>
      <section className="panel form-panel">
        <h2>Raw material components ({materials.length})</h2>
        {canEdit && <form className="form-grid" onSubmit={(event) => { event.preventDefault(); void mutate(`/raw-material-bom/materials/${materialId}`, "PATCH", { isRawMaterial: true }, "Raw material classified. Product catalogue visibility is unchanged."); }}>
          <label className="field-label">Classify catalog variant as raw material<select required value={materialId} disabled={busy} onChange={(event) => setMaterialId(event.target.value)}><option value="">Choose a variant</option>{outputs.filter((variant) => variant.active).map((variant) => <option key={variant.id} value={variant.id}>{variant.productName} · {variant.name} · {variant.sku} ({variant.uom})</option>)}</select></label>
          <div className="form-actions"><button type="submit" className="button" disabled={busy || !materialId}>Classify as raw material</button></div>
        </form>}
        <label className="field-label">Search raw materials<input type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Name or SKU" /></label>
        <div className="table-scroll"><table className="data-table"><thead><tr><th>RAW MATERIAL / SKU</th><th>UOM</th><th>USED IN BOMS</th>{canEdit && <th>CLASSIFICATION</th>}</tr></thead><tbody>
          {materials.filter((variant) => `${variant.productName} ${variant.name} ${variant.sku}`.toLowerCase().includes(search.toLowerCase())).map((variant) => {
            const used = data?.boms.filter((bom) => bom.components.some((entry) => entry.variantId === variant.id)) ?? [];
            return <tr key={variant.id}><td><strong>{variant.productName} · {variant.name}</strong><div>{variant.sku}{!variant.active && " · Inactive"}</div></td><td>{variant.uom}</td><td>{used.length ? used.map((bom) => <button type="button" className="text-button" key={bom.variantId} disabled={busy} onClick={() => setSelected(bom.variantId)}>{variants.find((entry) => entry.id === bom.variantId)?.sku ?? bom.variantId}</button>) : "Not used"}</td>
              {canEdit && <td><button type="button" className="button button-secondary" disabled={busy || used.length > 0} onClick={() => void mutate(`/raw-material-bom/materials/${variant.id}`, "PATCH", { isRawMaterial: false }, "Classification removed. Catalog and stock are unchanged.")}>Remove classification</button>{used.length > 0 && <small>Remove from BOMs first.</small>}</td>}
            </tr>;
          })}
        </tbody></table></div>
        {!materials.length && <p>No raw materials classified yet.</p>}
        {materials.length > 0 && !materials.some((variant) => `${variant.productName} ${variant.name} ${variant.sku}`.toLowerCase().includes(search.toLowerCase())) && <p>No raw materials match your search.</p>}
      </section>
      <section className="panel form-panel">
        <h2>Finished-product BOM</h2>
        <label className="field-label">Finished-product variant<select value={selected} disabled={busy} onChange={(event) => { setSelected(event.target.value); setProblem(""); setNotice(""); }}><option value="">Choose a finished-product variant</option>{outputs.map((variant) => <option key={variant.id} value={variant.id}>{variant.productName} · {variant.name} · {variant.sku} ({variant.uom}){data?.boms.some((bom) => bom.variantId === variant.id) ? " · BOM saved" : ""}{!variant.active ? " · Inactive" : ""}</option>)}</select></label>
        {output && <form onSubmit={save}>
          <p>{saved ? `Saved BOM · Updated ${new Date(saved.updatedAt).toLocaleString()}` : "No BOM saved for this variant."}</p>
          {!output.active && <div className="error-box" role="alert">This output is inactive. Reactivate it in the catalogue before saving a BOM.</div>}
          {outputUom !== output.uom && <div className="error-box" role="alert">Saved output UOM ({outputUom}) differs from the catalog ({output.uom}). Review quantities before updating.</div>}
          <div className="form-grid"><label className="field-label">Output quantity ({outputUom})<input required type="number" min="0" max="1000000000" step="any" value={outputQuantity} disabled={!canEdit || busy} onChange={(event) => setOutputQuantity(event.target.value)} /></label>
            <label className="field-label">BOM notes<textarea maxLength={2000} rows={2} value={notes} disabled={!canEdit || busy} onChange={(event) => setNotes(event.target.value)} /></label></div>
          {canEdit && outputUom !== output.uom && <button className="button button-secondary" type="button" disabled={busy} onClick={() => setOutputUom(output.uom)}>Use current output UOM after reviewing quantities</button>}
          <h3>Components per {outputQuantity || "?"} {outputUom}</h3>
          {components.map((entry, index) => {
            const material = variants.find((variant) => variant.id === entry.variantId);
            const invalid = material && (!material.active || !material.isRawMaterial || material.uom !== entry.uom);
            return <div className="bom-component" key={entry.key}>
              <label className="field-label">Component {index + 1}<select required value={entry.variantId} disabled={!canEdit || busy} onChange={(event) => {
                const id = event.target.value;
                setComponents((current) => current.map((row) => row.key === entry.key ? { ...row, variantId: id, uom: variants.find((variant) => variant.id === id)?.uom ?? "" } : row));
              }}><option value="">Choose raw material</option>{materials.filter((variant) => variant.active || variant.id === entry.variantId).map((variant) => <option key={variant.id} value={variant.id}>{variant.productName} · {variant.name} · {variant.sku} ({variant.uom})</option>)}</select></label>
              <label className="field-label">Quantity ({entry.uom || "UOM"})<input required type="number" min="0" max="1000000000" step="any" value={entry.quantity} disabled={!canEdit || busy} onChange={(event) => setComponents((current) => current.map((row) => row.key === entry.key ? { ...row, quantity: event.target.value } : row))} /></label>
              {canEdit && <button type="button" className="button button-secondary" disabled={busy} onClick={() => setComponents((current) => current.filter((row) => row.key !== entry.key))}>Remove component {index + 1}</button>}
              {invalid && <div className="error-box" role="alert">This component is inactive or its UOM changed. Review and reselect an active raw material before saving; quantities are not converted.</div>}
            </div>;
          })}
          {!components.length && <p>No components. Add at least one raw material to save a BOM.</p>}
          {canEdit && <div className="form-actions"><button className="button button-secondary" type="button" disabled={busy || components.length >= 100 || !materials.some((variant) => variant.active)} onClick={() => setComponents((current) => [...current, { key: Math.max(-1, ...current.map((row) => row.key)) + 1, variantId: "", quantity: "", uom: "" }])}>Add component</button>
            <button className="button" type="submit" disabled={busy || !output.active || !components.length}>{busy ? "Saving..." : "Save BOM"}</button>
            {saved && <button className="button button-secondary" type="button" disabled={busy} onClick={() => setConfirmDelete(true)}>Delete BOM</button>}
          </div>}
          {confirmDelete && <div className="error-box"><p>Delete only this BOM structure? Classification, catalogue, and stock will be kept.</p><button className="button" type="button" disabled={busy} onClick={() => void mutate(`/raw-material-bom/${selected}`, "DELETE", undefined, "BOM deleted. Catalog and stock are unchanged.")}>Confirm delete BOM</button><button className="button button-secondary" type="button" disabled={busy} onClick={() => setConfirmDelete(false)}>Cancel deletion</button></div>}
        </form>}
      </section>
    </>}
  </>;
}
