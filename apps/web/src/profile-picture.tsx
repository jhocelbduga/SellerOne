import React, { useEffect, useState } from "react";
import { api } from "./api";

export function initials(name: string): string {
  return name.trim().split(/\s+/).slice(0, 2).map((part) => part[0]?.toUpperCase() ?? "").join("");
}

export function UserAvatar({ name, avatarUrl, className = "" }: { name: string; avatarUrl: string | null; className?: string }): React.JSX.Element {
  return <span className={`avatar ${className}`}>{avatarUrl ? <img src={avatarUrl} alt={`${name}'s profile picture`} /> : initials(name)}</span>;
}

function readImage(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Could not read the selected image. Select it again."));
    reader.onabort = () => reject(new Error("Image reading was cancelled."));
    reader.onload = () => typeof reader.result === "string" ? resolve(reader.result) : reject(new Error("Could not read the selected image."));
    reader.readAsDataURL(file);
  });
}

export function ProfilePicture({ name, avatarUrl, onSaved }: { name: string; avatarUrl: string | null; onSaved: (url: string | null) => void }): React.JSX.Element {
  const [selected, setSelected] = useState<{ file: File; url: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  useEffect(() => () => { if (selected) URL.revokeObjectURL(selected.url); }, [selected]);
  const choose = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setNotice(""); setError("");
    if (!["image/png", "image/jpeg", "image/webp"].includes(file.type)) {
      setError("Upload a PNG, JPEG, or WebP image."); return;
    }
    if (!file.size || file.size > 5 * 1024 * 1024) {
      setError("Select a non-empty image no larger than 5 MB."); return;
    }
    setSelected({ file, url: URL.createObjectURL(file) });
  };
  const save = async (remove = false) => {
    if (busy || (!remove && !selected)) return;
    setBusy(true); setError(""); setNotice("");
    try {
      const image = !remove && selected ? await readImage(selected.file) : null;
      const result = await api<{ user: { avatarUrl: string | null } }>("/me/profile-picture", {
        method: remove ? "DELETE" : "PUT",
        ...(!remove ? { body: JSON.stringify({ image }) } : {}),
      });
      onSaved(result.user.avatarUrl);
      setSelected(null);
      setNotice(remove ? "Profile picture removed." : "Profile picture saved.");
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Could not update your profile picture."); }
    finally { setBusy(false); }
  };
  return <section className="panel form-panel" aria-label="Profile picture">
    <h2>Profile Picture</h2>
    <p>Upload a PNG, JPEG, or WebP image up to 5 MB and 4096 x 4096 pixels. Saved pictures are cropped to a square and shown in your account avatars and team list.</p>
    {error && <div className="error-box" role="alert">{error}</div>}
    {notice && <div className="success-box" role="status">{notice}</div>}
    <div className="profile-picture-preview">
      {selected ? <span className="avatar avatar-profile"><img src={selected.url} alt="Selected profile picture preview" onError={() => { setError("The selected image could not be previewed. Choose a valid PNG, JPEG, or WebP image."); setSelected(null); }} /></span>
        : <UserAvatar name={name} avatarUrl={avatarUrl} className="avatar-profile" />}
      <p>{selected ? `${selected.file.name} - preview only; save to apply.` : avatarUrl ? "Your current profile picture." : "No profile picture. Your initials are shown instead."}</p>
    </div>
    <label className="field-label">{avatarUrl ? "Change profile picture" : "Upload profile picture"}
      <input type="file" accept="image/png,image/jpeg,image/webp" disabled={busy} onChange={choose} />
    </label>
    <div className="form-actions">
      {selected && <><button type="button" className="button" disabled={busy} onClick={() => void save()}>{busy ? "Saving..." : "Save profile picture"}</button>
        <button type="button" className="button button-secondary" disabled={busy} onClick={() => { setSelected(null); setError(""); setNotice(""); }}>Cancel picture change</button></>}
      {avatarUrl && <button type="button" className="button button-secondary" disabled={busy} onClick={() => void save(true)}>Remove profile picture</button>}
    </div>
  </section>;
}
