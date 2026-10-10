import React, { useEffect, useId, useRef, useState } from "react";
import { MoreVertical } from "lucide-react";
import { Link, useLocation } from "react-router-dom";
import { api, useLoad } from "./api";
import { isAdmin, roleLabel, type Role } from "./roles";

export const lifecycleLabel = (status: string): string => ({
  active: "Active", phase_out: "Phase-Out", eol: "End of Life (EOL)", discontinued: "Discontinued", archived: "Archived",
}[status] ?? status);
const reasons = ["End of Life (EOL)", "Product Phase-Out", "Product Discontinued", "Duplicate Product Record", "Incorrect Product Setup", "Supplier No Longer Available", "Regulatory or Compliance Requirements", "Other"];
type Action = "delete" | "archive" | "deactivate" | "restore";
const actionLabel = (action: Action) => ({ delete: "Delete Product", archive: "Archive Product", deactivate: "Deactivate Product", restore: "Restore Product" }[action]);
interface LifecycleEvent {
  id: string; productId: string; productName: string; action: string; reason: string; comments: string;
  actorId: string; actorName: string; actorRole: string; createdAt: string; previousStatus: string; newStatus: string;
}
export function ProductLifecycleControls({ productId, productName, status, role, onChanged, history = false, cardActions = false }: {
  productId: string; productName: string; status: string; role: Role; onChanged: () => void; history?: boolean; cardActions?: boolean;
}): React.JSX.Element {
  const location = useLocation();
  const [action, setAction] = useState<Action | null>(null);
  const [reason, setReason] = useState("");
  const [comments, setComments] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [requestKey, setRequestKey] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const [expectedStatus, setExpectedStatus] = useState(status);
  const dialog = useRef<HTMLDialogElement>(null);
  const reasonInput = useRef<HTMLSelectElement>(null);
  const trigger = useRef<HTMLButtonElement | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuId = useId();
  const menuRoot = useRef<HTMLDivElement>(null);
  const menuButton = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const productPath = `/products/${encodeURIComponent(productId)}`;
  const historyLoad = useLoad<{ items: LifecycleEvent[]; status: string }>(history ? `/product-lifecycle/${encodeURIComponent(productId)}` : "");
  useEffect(() => {
    if (history && location.hash === "#lifecycle-history" && !historyLoad.loading) {
      document.getElementById("lifecycle-history")?.scrollIntoView({ block: "start" });
    }
  }, [history, location.hash, historyLoad.loading]);
  const target = action === "restore" ? "active" : action === "archive" ? "archived" : action === "deactivate" ? "discontinued"
    : reason === "End of Life (EOL)" ? "eol" : reason === "Product Phase-Out" ? "phase_out" : reason === "Product Discontinued" ? "discontinued" : "archived";
  const valid = !!reason && (!(reason === "Other" || action === "restore") || !!comments.trim()) && target !== expectedStatus;
  useEffect(() => {
    if (action) { dialog.current?.showModal(); reasonInput.current?.focus(); }
    else { dialog.current?.close(); trigger.current?.focus(); }
  }, [action]);
  useEffect(() => {
    if (!menuOpen) return;
    menu.current?.querySelector<HTMLElement>('[role="menuitem"]:not(:disabled)')?.focus();
    const dismiss = (event: Event) => {
      if (event.target instanceof Node && !menuRoot.current?.contains(event.target)) setMenuOpen(false);
    };
    document.addEventListener("pointerdown", dismiss);
    document.addEventListener("focusin", dismiss);
    return () => {
      document.removeEventListener("pointerdown", dismiss);
      document.removeEventListener("focusin", dismiss);
    };
  }, [menuOpen]);
  const menuKeys = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape") {
      event.preventDefault(); event.stopPropagation(); setMenuOpen(false); menuButton.current?.focus(); return;
    }
    if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const items = Array.from(menu.current?.querySelectorAll<HTMLElement>('[role="menuitem"]:not(:disabled)') ?? []);
    const current = items.findIndex((item) => item === document.activeElement);
    const index = event.key === "Home" ? 0 : event.key === "End" ? items.length - 1
      : (current + (event.key === "ArrowDown" ? 1 : -1) + items.length) % items.length;
    items[index]?.focus();
  };
  const close = () => { if (busy) return; setAction(null); };
  const open = (value: Action, button: HTMLButtonElement) => {
    trigger.current = cardActions ? menuButton.current : button; setMenuOpen(false); setAction(value); setReason(""); setComments(""); setError(""); setNotice(""); setExpectedStatus(status);
    setRequestKey(crypto.randomUUID()); setSubmitted(false);
  };
  const changeDraft = () => { setSubmitted(false); setRequestKey(crypto.randomUUID()); setError(""); };
  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!valid || busy || !action) { setError("Select a reason and complete the required explanation."); return; }
    if (!window.confirm(`${actionLabel(action)}: "${productName}" will become ${lifecycleLabel(target)}. Records, stock and historical transactions will be retained. Confirm this change?`)) return;
    setBusy(true); setError(""); setSubmitted(true);
    try {
      const result = await api<{ status: string }>(`/product-lifecycle/${encodeURIComponent(productId)}`, { method: "POST", body: JSON.stringify({ action, reason, comments: comments.trim(), requestKey, expectedStatus, confirmed: true }) });
      setNotice(`${productName} updated to ${lifecycleLabel(result.status)}. Audit history and stakeholder notifications recorded.`);
      setAction(null); historyLoad.reload(); onChanged();
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Could not update product lifecycle."); }
    finally { setBusy(false); }
  };
  return <div className="product-retirement">
    {cardActions ? <div className="catalogue-card-header">
      <span className={`lifecycle-badge lifecycle-badge-${status}`} aria-label={`Lifecycle Status: ${lifecycleLabel(status)}`}><span>Lifecycle Status</span><strong>{lifecycleLabel(status)}</strong></span>
      <div className="catalogue-action-menu" ref={menuRoot}>
        <button ref={menuButton} type="button" className="catalogue-menu-trigger" aria-label={`Product actions for ${productName}`} aria-haspopup="menu" aria-expanded={menuOpen} aria-controls={menuOpen ? menuId : undefined}
          onClick={() => setMenuOpen((value) => !value)} onKeyDown={(event) => { if (event.key === "ArrowDown" || event.key === "ArrowUp") { event.preventDefault(); setMenuOpen(true); } }}><MoreVertical size={20} aria-hidden="true" /></button>
        {menuOpen && <div id={menuId} ref={menu} role="menu" aria-label={`Manage ${productName}`} className="catalogue-menu-items" onKeyDown={menuKeys}>
          <Link role="menuitem" tabIndex={-1} to={productPath} onClick={() => setMenuOpen(false)}>View Product</Link>
          {role === "owner" && <Link role="menuitem" tabIndex={-1} to={`${productPath}/edit`} onClick={() => setMenuOpen(false)}>Edit Product</Link>}
          <Link role="menuitem" tabIndex={-1} to={`${productPath}#lifecycle-history`} onClick={() => setMenuOpen(false)}>View Status History</Link>
          {isAdmin(role) && <>
            <div role="separator" className="catalogue-menu-divider" />
            <button role="menuitem" tabIndex={-1} type="button" onClick={(event) => open("archive", event.currentTarget)} disabled={status === "archived"}>Archive Product</button>
            <button role="menuitem" tabIndex={-1} type="button" onClick={(event) => open("deactivate", event.currentTarget)} disabled={status === "discontinued"}>Deactivate Product</button>
            {status !== "active" && <button role="menuitem" tabIndex={-1} type="button" onClick={(event) => open("restore", event.currentTarget)}>Restore Product</button>}
            <button role="menuitem" tabIndex={-1} type="button" className="catalogue-menu-danger" onClick={(event) => open("delete", event.currentTarget)}>Delete Product</button>
          </>}
        </div>}
      </div>
    </div> : isAdmin(role) && <div className="button-group lifecycle-actions">
      <button type="button" className="button button-danger" onClick={(event) => open("delete", event.currentTarget)}>Delete Product</button>
      <button type="button" className="button button-secondary" onClick={(event) => open("archive", event.currentTarget)} disabled={status === "archived"}>Archive Product</button>
      <button type="button" className="button button-secondary" onClick={(event) => open("deactivate", event.currentTarget)} disabled={status === "discontinued"}>Deactivate Product</button>
      {status !== "active" && <button type="button" className="button button-secondary" onClick={(event) => open("restore", event.currentTarget)}>Restore Product</button>}
    </div>}
    {notice && <p className="success-box" role="status">{notice}</p>}
    <dialog className="modal-card lifecycle-dialog" ref={dialog} aria-label="Product retirement" onCancel={(event) => { event.preventDefault(); close(); }}>
      {action && <form className="modal-form" onSubmit={(event) => void submit(event)}>
        <h2>{actionLabel(action)}</h2><strong>{productName}</strong>
        <p>{action === "delete" ? "Delete Product is a soft retirement: the reason determines the lifecycle status. No records are permanently removed." : action === "archive" ? "Archive Product retains records and blocks new orders." : action === "deactivate" ? "Deactivate Product marks it Discontinued and blocks new orders." : "Restore Product re-enables the product for new orders. Individual archived variants remain unchanged."}</p>
        <p>Existing orders, quantities, images, BOMs and transaction history are preserved. Inventory staff can still receive, transfer or reconcile stock.</p>
        <label className="field-label">Deletion / retirement reason *<select ref={reasonInput} required aria-label="Deletion / retirement reason" disabled={busy} value={reason} onChange={(event) => { changeDraft(); setReason(event.target.value); }}><option value="">Select a business reason</option>{reasons.map((value) => <option key={value}>{value}</option>)}</select></label>
        {!reason && <p className="field-error">A business reason is required before confirmation.</p>}
        <label className="field-label">Comments / notes {(reason === "Other" || action === "restore") ? "(required)" : "(optional)"}<textarea aria-label="Retirement comments" maxLength={2000} required={reason === "Other" || action === "restore"} disabled={busy} value={comments} onChange={(event) => { changeDraft(); setComments(event.target.value); }} /></label>
        {(reason === "Other" || action === "restore") && !comments.trim() && <p className="field-error">Explain the business reason to proceed.</p>}
        {reason && <p>Previous status: <strong>{lifecycleLabel(expectedStatus)}</strong> → New status: <strong>{lifecycleLabel(target)}</strong>. {target === "phase_out" ? "Phase-Out remains available for new orders." : target === "active" ? "New orders will be allowed for active variants." : "New orders and checkout purchases will be blocked."}</p>}
        {reason && target === expectedStatus && <p role="alert">The product already has this status. Choose another action.</p>}
        {error && <p className="error-box" role="alert">{error}</p>}
        <small>The action, reason, comments, acting user/role and timestamp will be logged. Owners, Admins and Inventory Controllers receive an in-app notification. No email is sent.</small>
        <div className="button-group"><button className="button button-secondary" type="button" disabled={busy} onClick={close}>Cancel retirement</button><button className="button button-danger" type="submit" disabled={!valid || busy}>{busy ? "Updating lifecycle..." : submitted ? "Retry confirmed change" : "Confirm lifecycle change"}</button></div>
      </form>}
    </dialog>
    {history && <details id="lifecycle-history" className="lifecycle-history" open={location.hash === "#lifecycle-history" ? true : undefined}><summary>Product status history &amp; transaction logs</summary>
      {historyLoad.loading ? <p role="status">Loading lifecycle history...</p> : historyLoad.error ? <p role="alert">{historyLoad.error}<button type="button" className="button" onClick={historyLoad.reload}>Retry history</button></p> : historyLoad.data?.items.length ? <ol>{historyLoad.data.items.map((event) => <li key={event.id}>
        <strong>{lifecycleLabel(event.previousStatus)} → {lifecycleLabel(event.newStatus)}</strong><p>{event.action} · {event.reason}</p>
        <p>Product: {event.productName} · ID: {event.productId}</p><p>{event.actorName} ({roleLabel(event.actorRole)}) · User ID: {event.actorId} · {new Date(event.createdAt).toLocaleString()}</p>
        {event.comments && <p>Comments: {event.comments}</p>}<small>Transaction ID: {event.id}</small>
      </li>)}</ol> : <p>No lifecycle changes have been recorded. Current status: {lifecycleLabel(historyLoad.data?.status ?? status)}.</p>}
    </details>}
  </div>;
}
