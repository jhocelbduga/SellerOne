import React, { useEffect, useRef, useState } from "react";
import { Search, X } from "lucide-react";
import { Link, useLocation } from "react-router-dom";
import { api } from "./api";
import { canAccessPage, type Role } from "./roles";

interface SearchLink { to: string; label: string; detail?: string }
interface SearchGroup { label: string; items: SearchLink[]; total: number; to: string }
interface Product { id: string; name: string; variants: { name: string; sku: string }[] }
interface Customer { id: string; name: string; email?: string | null; phone?: string | null }
interface Order { id: string; orderNumber: string; customerName: string; externalId?: string | null }
const matches = (value: string, query: string) => value.toLocaleLowerCase().includes(query.toLocaleLowerCase());

function SearchResults({ query, role, close }: { query: string; role: Role; close: () => void }): React.JSX.Element {
  const [result, setResult] = useState<{ query: string; groups: SearchGroup[] } | null>(null);
  const [error, setError] = useState("");
  const [version, setVersion] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setResult(null);
    setError("");
    const timer = window.setTimeout(() => {
      const options = { signal: controller.signal };
      const search = encodeURIComponent(query);
      const requests: Promise<SearchGroup>[] = [];
      if (canAccessPage(role, "/products")) requests.push(api<{ items: Product[] }>("/products", options).then(({ items }) => {
        const found = items.filter((product) => matches(`${product.name} ${product.variants.map((variant) => `${variant.name} ${variant.sku}`).join(" ")}`, query));
        return { label: "Products / SKUs", total: found.length, to: `/products?search=${search}`, items: found.slice(0, 8).map((product) => ({
          to: `/products/${encodeURIComponent(product.id)}`, label: product.name,
          detail: product.variants.filter((variant) => matches(`${product.name} ${variant.name} ${variant.sku}`, query)).map((variant) => `${variant.name} - ${variant.sku}`).join(", "),
        })) };
      }));
      if (canAccessPage(role, "/orders")) requests.push(api<{ items: Order[]; total: number }>(`/orders?search=${search}`, options).then(({ items, total }) => ({
        label: "Orders", total, to: `/orders?search=${search}`, items: items.slice(0, 8).map((order) => ({
          to: `/orders/${encodeURIComponent(order.id)}`, label: order.orderNumber,
          detail: `${order.customerName}${order.externalId ? ` - ${order.externalId}` : ""}`,
        })),
      })));
      if (canAccessPage(role, "/customers")) requests.push(api<{ items: Customer[] }>("/customers", options).then(({ items }) => {
        const found = items.filter((customer) => matches(`${customer.name} ${customer.email ?? ""} ${customer.phone ?? ""}`, query));
        return { label: "Customers", total: found.length, to: `/customers?search=${search}`, items: found.slice(0, 8).map((customer) => ({
          to: `/customers/${encodeURIComponent(customer.id)}`, label: customer.name,
          detail: [customer.email, customer.phone].filter(Boolean).join(" - "),
        })) };
      }));
      void Promise.all(requests).then((groups) => {
        if (!controller.signal.aborted) setResult({ query, groups });
      }).catch((caught: unknown) => {
        if (!controller.signal.aborted) setError(caught instanceof Error ? caught.message : "Could not search your workspace.");
      });
    }, 250);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [query, role, version]);
  if (error) return <div className="error-box" role="alert">{error} <button className="button button-secondary" type="button" onClick={() => setVersion((current) => current + 1)}>Retry search</button></div>;
  if (!result || result.query !== query) return <p role="status">Searching workspace...</p>;
  return <div aria-live="polite">
    {!result.groups.some((group) => group.total > 0) && <p role="status">No matching products, orders, or customers in your accessible workspace.</p>}
    {result.groups.filter((group) => group.total > 0).map((group) => <section key={group.label} className="workspace-search-group">
      <h3>{group.label} ({group.total})</h3>
      <ul>{group.items.map((item) => <li key={item.to}><Link to={item.to} onClick={close}><strong>{item.label}</strong>{item.detail && <small>{item.detail}</small>}</Link></li>)}</ul>
      {group.total > group.items.length && <Link className="inline-link" to={group.to} onClick={close}>View all {group.total} {group.label.toLowerCase()} results</Link>}
    </section>)}
  </div>;
}

export function HeaderSearch({ role, pages }: { role: Role; pages: SearchLink[] }): React.JSX.Element {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const dialog = useRef<HTMLDialogElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const location = useLocation();
  const dialogId = React.useId();
  const close = () => { setOpen(false); trigger.current?.focus(); };
  useEffect(() => { setOpen(false); }, [location.key, role]);
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k" && !event.altKey) {
        event.preventDefault();
        setOpen((current) => !current);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);
  useEffect(() => {
    if (open) { setQuery(""); dialog.current?.showModal(); input.current?.focus(); }
    else dialog.current?.close();
  }, [open]);
  const trimmed = query.trim();
  const destinations = pages.filter((item) => canAccessPage(role, item.to) && matches(item.label, trimmed));
  return <>
    <button ref={trigger} className="icon-button search-trigger" type="button" aria-label="Search workspace" aria-haspopup="dialog" aria-expanded={open} aria-controls={dialogId} onClick={() => setOpen(true)}><Search size={18} /><span>Search</span><kbd>Ctrl K</kbd></button>
    <dialog ref={dialog} id={dialogId} className="modal-card workspace-search" aria-label="Search workspace" onCancel={close} onClose={() => setOpen(false)} onClick={(event) => {
      if (event.target !== event.currentTarget) return;
      const rect = event.currentTarget.getBoundingClientRect();
      if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) close();
    }}>
      <div className="modal-heading"><h2>Search workspace</h2><button className="icon-button" type="button" aria-label="Close search" onClick={close}><X size={18} /></button></div>
      {open && <>
        <label className="field-label">Search products, SKUs, orders, customers, or pages<input ref={input} type="search" maxLength={200} value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Type a name, SKU, order number, email..." /></label>
        <small>Only records and pages available to your workspace role are searched. Ctrl+K or Command+K opens search; Escape closes it.</small>
        {destinations.length > 0 && <section className="workspace-search-group"><h3>Workspace pages</h3><ul>{destinations.map((item) => <li key={item.to}><Link to={item.to} onClick={close}>{item.label}</Link></li>)}</ul></section>}
        {trimmed ? <SearchResults key={`${role}:${trimmed}`} query={trimmed} role={role} close={close} /> : <p role="status">Start typing to search your records, or choose a page above.</p>}
      </>}
    </dialog>
  </>;
}
