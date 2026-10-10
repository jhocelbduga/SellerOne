import React, { useEffect, useState } from "react";
import { api, useLoad } from "./api";
import { roleLabel, workspaceRoles, type Role } from "./roles";

interface Rule { variantId: string; lowEnabled: boolean; lowThreshold: number | null; outEnabled: boolean; reorderThreshold: number | null }
interface Config {
  rules: Rule[];
  recipients: { roles: Role[]; userIds: string[] };
  variants: { id: string; productName: string; name: string; sku: string; uom: string; minimum: number }[];
  users: { id: string; name: string; role: Role; active: number }[];
}

export function InventoryAlerts(): React.JSX.Element {
  const load = useLoad<Config>("/inventory-alerts");
  const [draft, setDraft] = useState<Config | null>(null);
  const [selected, setSelected] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  useEffect(() => { if (load.data && !draft) setDraft(load.data); }, [load.data, draft]);
  const variant = draft?.variants.find((entry) => entry.id === selected);
  const rule: Rule = draft?.rules.find((entry) => entry.variantId === selected) ?? { variantId: selected, lowEnabled: true, lowThreshold: null, outEnabled: true, reorderThreshold: null };
  const update = (patch: Partial<Rule>) => {
    setNotice(""); setError("");
    setDraft((current) => current ? { ...current, rules: [...current.rules.filter((entry) => entry.variantId !== selected), { ...rule, ...patch }] } : current);
  };
  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!draft || busy) return;
    setBusy(true); setError(""); setNotice("");
    try {
      const result = await api<Config>("/inventory-alerts", { method: "PUT", body: JSON.stringify({ rules: draft.rules, recipients: draft.recipients }) });
      setDraft(result); setNotice("Inventory alert configuration saved. Available stock is now monitored against these thresholds.");
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Could not save inventory alerts."); }
    finally { setBusy(false); }
  };
  return <section className="panel form-panel" aria-label="Inventory Alerts">
    <h2>Inventory Alerts</h2>
    <p>Thresholds apply per SKU at each location, in its existing UOM. Available stock = on hand minus reserved stock. Alert recipients are the union of selected roles and users; selecting none stops delivery to everyone.</p>
    {load.error && <div className="error-box" role="alert">{load.error}<button className="button button-secondary" type="button" onClick={load.reload}>Retry inventory alerts</button></div>}
    {error && <div className="error-box" role="alert">{error}</div>}
    {notice && <div className="success-box" role="status">{notice}</div>}
    {load.loading ? <p>Loading inventory alerts...</p> : draft && <form className="modal-form" onSubmit={(event) => void save(event)}>
      <fieldset disabled={busy}>
        <legend>SKU thresholds</legend>
        <label className="field-label">Product / SKU<select value={selected} onChange={(event) => setSelected(event.target.value)}>
          <option value="">Select a SKU to configure</option>
          {draft.variants.map((entry) => <option key={entry.id} value={entry.id}>{entry.productName} - {entry.name} - {entry.sku} ({entry.uom})</option>)}
        </select></label>
        {variant && <>
          <label className="toggle-row"><span>Low-stock alerts</span><input type="checkbox" checked={rule.lowEnabled} onChange={(event) => update({ lowEnabled: event.target.checked })} /></label>
          <label className="field-label">Low-stock threshold ({variant.uom})<input type="number" min={0} step={1} max={Number.MAX_SAFE_INTEGER} value={rule.lowThreshold ?? ""} placeholder={`Use minimum: ${variant.minimum}`} onChange={(event) => update({ lowThreshold: event.target.value === "" ? null : Number(event.target.value) })} /><small>Blank follows the catalogue minimum ({variant.minimum} {variant.uom}). Zero is a valid explicit threshold.</small></label>
          <label className="toggle-row"><span>Out-of-stock alerts at zero available stock</span><input type="checkbox" checked={rule.outEnabled} onChange={(event) => update({ outEnabled: event.target.checked })} /></label>
          <label className="field-label">Reorder threshold ({variant.uom})<input type="number" min={0} step={1} max={Number.MAX_SAFE_INTEGER} value={rule.reorderThreshold ?? ""} onChange={(event) => update({ reorderThreshold: event.target.value === "" ? null : Number(event.target.value) })} /><small>Blank disables replenishment alerts. No purchase orders are created.</small></label>
          <button className="button button-secondary" type="button" onClick={() => { setDraft({ ...draft, rules: draft.rules.filter((entry) => entry.variantId !== selected) }); setNotice(""); }}>Reset this SKU to defaults</button>
        </>}
      </fieldset>
      <fieldset disabled={busy}><legend>Alert recipient roles</legend>
        {[{ value: "owner" as const, label: "Owner" }, ...workspaceRoles].map(({ value, label }) => <label className="toggle-row" key={value}><span>{label}</span><input type="checkbox" checked={draft.recipients.roles.includes(value)} onChange={(event) => { setNotice(""); setDraft({ ...draft, recipients: { ...draft.recipients, roles: event.target.checked ? [...draft.recipients.roles, value] : draft.recipients.roles.filter((role) => role !== value) } }); }} /></label>)}
      </fieldset>
      <fieldset disabled={busy}><legend>Additional recipient users</legend>
        {draft.users.filter((user) => user.active || draft.recipients.userIds.includes(user.id)).map((user) => <label className="toggle-row" key={user.id}><span>{user.name} ({roleLabel(user.role)}){!user.active && " - inactive; remove this recipient before saving"}</span><input type="checkbox" checked={draft.recipients.userIds.includes(user.id)} onChange={(event) => { setNotice(""); setDraft({ ...draft, recipients: { ...draft.recipients, userIds: event.target.checked ? [...draft.recipients.userIds, user.id] : draft.recipients.userIds.filter((id) => id !== user.id) } }); }} /></label>)}
      </fieldset>
      <p>Low-stock and out-of-stock use one shortage alert, escalating to out-of-stock at zero. Replenishment alerts are separate. Viewed alerts stay acknowledged until their condition recovers and triggers again. Role/user recipient changes take effect on refresh.</p>
      <button className="button" type="submit" disabled={busy}>{busy ? "Saving..." : "Save inventory alerts"}</button>
    </form>}
  </section>;
}
