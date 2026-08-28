import { useEffect, useRef, useState } from "react";
import {
  getManuscriptAuthorFiles,
  shareFileToAuthor,
  manuscriptAuthorFileDownloadUrl,
  type StaffAuthorFile,
} from "../api/client";

// Échange de fichiers avec l'auteur (Espace Auteur inc. 2a), côté personnel :
// voir les dépôts de l'auteur et lui partager des documents (BAT, épreuves,
// contrat…). L'auteur retrouve ces fichiers dans son portail, et est notifié.

function humanSize(n: number | null | undefined): string {
  if (!n || n <= 0) return "";
  if (n < 1024) return `${n} o`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} Ko`;
  return `${(n / (1024 * 1024)).toFixed(1)} Mo`;
}

export function AuthorFilesSection({ manuscriptId, canManage }: { manuscriptId: string; canManage: boolean }) {
  const [files, setFiles] = useState<StaffAuthorFile[]>([]);
  const [label, setLabel] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const load = () => getManuscriptAuthorFiles(manuscriptId).then(setFiles).catch(() => {});
  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [manuscriptId]);

  async function share(file: File) {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await shareFileToAuthor(manuscriptId, label.trim(), file);
      setLabel("");
      if (fileRef.current) fileRef.current.value = "";
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Envoi impossible.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="ecl-card">
      <h3 style={{ fontSize: 15, margin: "0 0 4px", color: "var(--ink)" }}>Échange de fichiers avec l'auteur</h3>
      <p style={{ fontSize: 13, color: "var(--muted)", marginTop: 0 }}>
        Les dépôts de l'auteur et les documents que vous lui partagez (visibles dans son espace auteur).
      </p>
      {error && <div style={{ background: "var(--alert-soft)", color: "var(--alert)", borderRadius: 8, padding: "8px 12px", fontSize: 13, marginBottom: 10 }}>{error}</div>}

      <div style={{ display: "grid", gap: 8 }}>
        {files.length === 0 && <p style={{ fontSize: 13, color: "var(--muted)", margin: 0 }}>Aucun fichier échangé pour l'instant.</p>}
        {files.map((f) => (
          <div key={f.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, border: "1px solid var(--line)", borderRadius: 8, padding: "8px 12px" }}>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontWeight: 600, color: "var(--ink)", fontSize: 13.5 }}>📎 {f.label || f.name} <span style={{ color: "var(--muted)", fontWeight: 400 }}>{f.size ? `(${humanSize(f.size)})` : ""}</span></div>
              <div style={{ fontSize: 11, marginTop: 2 }}>
                {f.from_house
                  ? <span style={{ color: "var(--eclosion-dark, #9a7a12)", fontWeight: 700 }}>→ Partagé à l'auteur</span>
                  : <span style={{ color: "var(--muted)", fontWeight: 700 }}>← Déposé par l'auteur</span>}
              </div>
            </div>
            <a href={manuscriptAuthorFileDownloadUrl(manuscriptId, f.id)} target="_blank" rel="noreferrer" style={{ fontSize: 12.5, color: "var(--eclosion)", fontWeight: 600, flexShrink: 0 }}>Télécharger</a>
          </div>
        ))}
      </div>

      {canManage && (
        <div style={{ marginTop: 12, border: "1px dashed var(--line)", borderRadius: 10, padding: 12 }}>
          <div style={{ fontSize: 12.5, fontWeight: 700, color: "var(--ink)", marginBottom: 8 }}>Partager un document à l'auteur</div>
          <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Intitulé (ex. BAT à valider)" style={{ width: "100%", padding: "8px 11px", border: "1px solid var(--line)", borderRadius: 8, fontSize: 13, marginBottom: 8, boxSizing: "border-box" }} />
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <input ref={fileRef} type="file" onChange={(e) => { const f = e.target.files?.[0]; if (f) share(f); }} style={{ fontSize: 12.5 }} />
            {busy && <span style={{ fontSize: 12.5, color: "var(--muted)" }}>Envoi…</span>}
          </div>
        </div>
      )}
    </section>
  );
}
