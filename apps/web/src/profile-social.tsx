import React, { useEffect, useState } from "react";
import { Facebook, Instagram, Globe, MessageCircle, Music2 } from "lucide-react";
import { api, useLoad } from "./api";

export const profilePlatforms = [
  { field: "facebookUrl", label: "Facebook", icon: Facebook, placeholder: "https://www.facebook.com/username" },
  { field: "instagramUrl", label: "Instagram", icon: Instagram, placeholder: "https://www.instagram.com/username" },
  { field: "tiktokUrl", label: "TikTok", icon: Music2, placeholder: "https://www.tiktok.com/@username" },
  { field: "whatsappUrl", label: "WhatsApp", icon: MessageCircle, placeholder: "https://wa.me/12025550101" },
  { field: "websiteUrl", label: "Website", icon: Globe, placeholder: "https://example.com" },
] as const;
export type ProfileLinks = Record<typeof profilePlatforms[number]["field"], { url: string | null; visible: boolean }>;

export function ProfileSocialLinks(): React.JSX.Element {
  const { data, loading, error, reload } = useLoad<{ links: ProfileLinks }>("/me/social-links");
  const [draft, setDraft] = useState<ProfileLinks | null>(null);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState("");
  const [notice, setNotice] = useState("");
  useEffect(() => { if (data && !draft) setDraft(data.links); }, [data, draft]);
  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!draft || busy) return;
    setBusy(true); setProblem(""); setNotice("");
    try {
      const result = await api<{ links: ProfileLinks }>("/me/social-links", { method: "PATCH", body: JSON.stringify({ links: draft }) });
      setDraft(result.links); setNotice("Social media links saved.");
    } catch (caught) { setProblem(caught instanceof Error ? caught.message : "Could not save social media links."); }
    finally { setBusy(false); }
  };
  return <section className="panel form-panel">
    <h2>Social Media Links</h2>
    <p>Use full HTTPS profile URLs. Visible links appear only in your own profile menu; hidden links remain saved here. These are personal shortcuts, not public profiles or connected social integrations.</p>
    {error && <div className="error-box" role="alert">{error}<button type="button" className="button button-secondary" onClick={reload}>Retry social links</button></div>}
    {problem && <div className="error-box" role="alert">{problem}</div>}
    {notice && <div className="success-box" role="status">{notice}</div>}
    {loading ? <p role="status">Loading social media links...</p> : draft && <form className="modal-form" onSubmit={(event) => void save(event)}>
      {profilePlatforms.map(({ field, label, icon: Icon, placeholder }) => <div key={field}>
        <label className="field-label"><span><Icon size={17} aria-hidden="true" /> {label} profile URL<input type="url" maxLength={2000} placeholder={placeholder} value={draft[field].url ?? ""} disabled={busy} onChange={(event) => setDraft((current) => current ? { ...current, [field]: { ...current[field], url: event.target.value } } : current)} /></span></label>
        <label className="toggle-row"><span>Show {label} in my profile menu</span><input type="checkbox" checked={draft[field].visible} disabled={busy} onChange={(event) => setDraft((current) => current ? { ...current, [field]: { ...current[field], visible: event.target.checked } } : current)} /></label>
        <button type="button" className="text-button" disabled={busy || (!draft[field].url && !draft[field].visible)} onClick={() => setDraft((current) => current ? { ...current, [field]: { url: null, visible: false } } : current)}>Clear {label} link</button>
      </div>)}
      <button type="submit" className="button" disabled={busy}>{busy ? "Saving..." : "Save social media links"}</button>
    </form>}
  </section>;
}
