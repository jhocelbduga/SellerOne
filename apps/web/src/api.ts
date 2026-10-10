import { useEffect, useState } from "react";

export async function api<T>(path: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(`/api${path}`, {
    ...options,
    headers: { ...(options.body ? { "content-type": "application/json" } : {}), ...options.headers },
  });
  const payload = await response.json() as Record<string, unknown>;
  if (!response.ok) throw new Error(typeof payload.error === "string" ? payload.error : `Request failed (${response.status}).`);
  return payload as T;
}
export function money(minor: unknown, currency = "PHP"): string {
  return new Intl.NumberFormat("en-PH", { style: "currency", currency }).format(Number(minor ?? 0) / 100);
}
export function dateLabel(value: unknown): string {
  if (!value) return "—";
  return new Intl.DateTimeFormat("en-PH", { dateStyle: "medium" }).format(new Date(String(value)));
}
export function useLoad<T>(path: string): { data: T | null; error: string; loading: boolean; reload: () => void } {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [version, setVersion] = useState(0);
  useEffect(() => {
    if (!path) { setLoading(false); setData(null); return; }
    let alive = true;
    setLoading(true);
    api<T>(path).then((result) => { if (alive) { setData(result); setError(""); } })
      .catch((caught: unknown) => { if (alive) setError(caught instanceof Error ? caught.message : "Could not load this page."); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [path, version]);
  return { data, error, loading, reload: () => setVersion((value) => value + 1) };
}
