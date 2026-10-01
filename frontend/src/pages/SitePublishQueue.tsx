import { useEffect, useState } from "react";
import {
  listPendingSitePublications,
  setSiteFiche,
  setSitePublished,
  siteCoverDownloadUrl,
  type PendingSitePublication,
} from "../api/client";

// Rubrique « À publier (site) » : les ouvrages arrivés à l'infographie et NON
// encore publiés restent listés ici — même si l'étape du manuscrit a avancé —
// jusqu'à publication. Consultable par l'infographe, le marketing, le commercial
// et la direction ; SEUL l'infographe (production:administration) peut compléter
// la fiche (résumé/prix) et publier. La publication ne bloque jamais le workflow.
export function SitePublishQueue({ permissions }: { permissions: Set<string> }) {
  const canPublish = permissions.has("production:administration");
  const [rows, setRows] = useState<PendingSitePublication[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const load = () =>
    listPendingSitePublications()
      .then((r) => { setRows(r); setLoading(false); })
      .catch((e) => { setError(e instanceof Error ? e.message : "Chargement impossible."); setLoading(false); });
  useEffect(() => { load(); }, []);

  return (
    <div style={{ padding: "clamp(16px, 4vw, 32px)" }}>
      <h1 style={{ fontFamily: "var(--font-title)", fontSize: 20, margin: "0 0 4px" }}>À publier (site)</h1>
      <p style={{ fontSize: 13, color: "var(--muted)", marginTop: 0 }}>
        Ouvrages prêts pour le catalogue du site, non encore publiés. {canPublish
          ? "Complétez la fiche (résumé, prix) puis publiez."
          : "Consultation seule — seul l'infographe publie."}
      </p>

      {error && <p style={{ color: "var(--alert)", fontSize: 13 }}>{error}</p>}
      {message && <div style={{ background: "var(--eclosion-soft)", color: "var(--eclosion-dark, #9a7a12)", borderRadius: 6, padding: "8px 12px", fontSize: 13, margin: "8px 0" }}>{message}</div>}

      {loading ? (
        <p style={{ fontSize: 13, color: "var(--muted)" }}>Chargement…</p>
      ) : rows.length === 0 ? (
        <p style={{ fontSize: 13, color: "var(--muted)" }}>Aucun ouvrage en attente de publication.</p>
      ) : (
        <div style={{ display: "grid", gap: 14, marginTop: 8 }}>
          {rows.map((r) => (
            <PublishCard key={r.id} row={r} canPublish={canPublish} onChanged={load} onMessage={setMessage} onError={setError} />
          ))}
        </div>
      )}
    </div>
  );
}

function Check({ ok, label }: { ok: boolean; label: string }) {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 12, fontWeight: 600, color: ok ? "var(--valid, #2F7D4A)" : "var(--eclosion-retard, #C4661F)" }}>
      {ok ? "✓" : "✗"} {label}
    </span>
  );
}

function PublishCard({ row, canPublish, onChanged, onMessage, onError }: { row: PendingSitePublication; canPublish: boolean; onChanged: () => void; onMessage: (m: string) => void; onError: (m: string) => void }) {
  const [editing, setEditing] = useState(false);
  const [summary, setSummary] = useState(row.summary ?? "");
  const [price, setPrice] = useState(row.price != null ? String(row.price) : "");
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);

  const hasCover = row.cover.available && row.cover.is_image;
  const hasIsbn = !!row.isbn;
  const hasPrice = row.price != null;
  const hasSummary = !!row.summary;
  const complete = hasCover && hasIsbn && hasPrice && hasSummary;

  async function saveFiche() {
    setBusy(true);
    try {
      const input: { summary?: string; price?: number } = {};
      input.summary = summary;
      const p = Number(price.replace(/[^0-9.]/g, ""));
      if (price.trim() && Number.isFinite(p) && p > 0) input.price = p;
      await setSiteFiche(row.id, input);
      onMessage(`Fiche de « ${row.title} » enregistrée.`);
      setEditing(false);
      onChanged();
    } catch (e) {
      onError(e instanceof Error ? e.message : "Enregistrement impossible.");
    } finally {
      setBusy(false);
    }
  }

  async function publish() {
    if (!complete && !window.confirm("Des éléments manquent (couverture, ISBN, prix ou résumé). Publier quand même ?")) return;
    setBusy(true);
    try {
      await setSitePublished(row.id, true, url.trim() || undefined);
      onMessage(`« ${row.title} » marqué comme publié sur le site.`);
      onChanged();
    } catch (e) {
      onError(e instanceof Error ? e.message : "Publication impossible.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section style={{ background: "var(--card)", border: "1px solid var(--line)", borderRadius: 10, padding: 14, display: "flex", gap: 14, flexWrap: "wrap" }}>
      {hasCover ? (
        <img src={siteCoverDownloadUrl(row.id, true)} alt="" style={{ width: 70, height: 100, objectFit: "cover", borderRadius: 6, border: "1px solid var(--line)", background: "#fff", flexShrink: 0 }} />
      ) : (
        <div style={{ width: 70, height: 100, borderRadius: 6, border: "1px dashed var(--line)", display: "flex", alignItems: "center", justifyContent: "center", color: "var(--muted)", fontSize: 10, textAlign: "center", flexShrink: 0 }}>Pas de couverture</div>
      )}
      <div style={{ flex: 1, minWidth: 220 }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: 8, flexWrap: "wrap" }}>
          <span style={{ fontWeight: 700, fontSize: 14 }}>{row.title}</span>
          <span style={{ fontFamily: "var(--font-mono)", fontSize: 11.5, color: "var(--muted)" }}>{row.manuscriptNumber}</span>
          <span style={{ fontSize: 11, color: "var(--muted)" }}>· étape : {row.stepLabel}</span>
        </div>
        <div style={{ fontSize: 12.5, color: "var(--muted)", marginTop: 2 }}>
          {row.author ?? "Auteur —"} · {row.genre ?? "Genre —"} · {row.price != null ? `${row.price.toLocaleString("fr-FR")} FCFA` : "Prix —"}
        </div>
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginTop: 8 }}>
          <Check ok={hasCover} label="Couverture" />
          <Check ok={hasIsbn} label="ISBN" />
          <Check ok={hasPrice} label="Prix" />
          <Check ok={hasSummary} label="Résumé" />
        </div>

        {canPublish && editing && (
          <div style={{ marginTop: 10, display: "grid", gap: 8 }}>
            <label style={{ fontSize: 12, color: "var(--muted)" }}>
              Résumé (part sur le site avec les références)
              <textarea value={summary} onChange={(e) => setSummary(e.target.value)} rows={3} style={{ width: "100%", padding: "8px 10px", border: "1px solid var(--line)", borderRadius: 6, fontSize: 13, fontFamily: "inherit", boxSizing: "border-box" }} />
            </label>
            <label style={{ fontSize: 12, color: "var(--muted)" }}>
              Prix (FCFA)
              <input value={price} onChange={(e) => setPrice(e.target.value)} inputMode="numeric" placeholder="ex. 4000" style={{ display: "block", width: 160, padding: "7px 10px", border: "1px solid var(--line)", borderRadius: 6, fontSize: 13, marginTop: 2 }} />
            </label>
            <div style={{ display: "flex", gap: 8 }}>
              <button type="button" disabled={busy} onClick={saveFiche} style={{ background: "var(--eclosion)", color: "#fff", border: "none", borderRadius: 6, padding: "7px 14px", fontSize: 13, fontWeight: 700, cursor: "pointer" }}>Enregistrer la fiche</button>
              <button type="button" disabled={busy} onClick={() => { setEditing(false); setSummary(row.summary ?? ""); setPrice(row.price != null ? String(row.price) : ""); }} style={{ background: "#fff", border: "1px solid var(--line)", borderRadius: 6, padding: "7px 14px", fontSize: 13, cursor: "pointer" }}>Annuler</button>
            </div>
          </div>
        )}

        {canPublish && !editing && (
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginTop: 10 }}>
            <button type="button" onClick={() => setEditing(true)} style={{ background: "#fff", border: "1px solid var(--eclosion, #D9B21A)", color: "var(--eclosion-dark, #9a7a12)", borderRadius: 6, padding: "6px 12px", fontSize: 12.5, fontWeight: 700, cursor: "pointer" }}>Compléter la fiche (résumé / prix)</button>
            <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="Lien de la fiche en ligne (facultatif)" style={{ flex: 1, minWidth: 180, padding: "6px 10px", border: "1px solid var(--line)", borderRadius: 6, fontSize: 12.5 }} />
            <button type="button" disabled={busy} onClick={publish} style={{ background: "var(--eclosion)", color: "#0B0B0C", border: "none", borderRadius: 6, padding: "6px 14px", fontSize: 13, fontWeight: 800, cursor: "pointer" }}>Publier</button>
          </div>
        )}
      </div>
    </section>
  );
}
