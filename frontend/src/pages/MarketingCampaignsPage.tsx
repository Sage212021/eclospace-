import { useEffect, useState } from "react";
import {
  listMarketingCampaigns,
  createMarketingCampaign,
  updateMarketingCampaign,
  deleteMarketingCampaign,
  searchMarketingManuscripts,
  type MarketingCampaign,
  type MarketingCampaignInput,
  type MarketingCampaignStatus,
} from "../api/client";

// Pôle Marketing, Communication & Distribution — Campagnes.
const STATUT: Record<MarketingCampaignStatus, { label: string; color: string }> = {
  planifiee: { label: "Planifiée", color: "var(--muted)" },
  en_cours: { label: "En cours", color: "#2F7D4A" },
  terminee: { label: "Terminée", color: "var(--eclosion-dark, #9a7a12)" },
  annulee: { label: "Annulée", color: "var(--alert, #B23A2E)" },
};
const fcfa = (n: number | null | undefined) => (n == null ? "—" : `${Number(n).toLocaleString("fr-FR")} FCFA`);
const dfr = (s: string | null) => (s ? new Date(s).toLocaleDateString("fr-FR") : "—");

export function MarketingCampaignsPage({ canManage }: { canManage?: boolean }) {
  const [items, setItems] = useState<MarketingCampaign[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [statut, setStatut] = useState("");
  const [editing, setEditing] = useState<MarketingCampaign | "new" | null>(null);

  const load = () => listMarketingCampaigns(statut || undefined).then((r) => { setItems(r.items); setErr(null); }).catch((e) => setErr(e instanceof Error ? e.message : "Chargement impossible."));
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [statut]);

  return (
    <div className="ecl-page" style={{ maxWidth: 1040 }}>
      <h1 className="ecl-page__title">Campagnes</h1>
      <p className="ecl-page__lead">Opérations datées et budgétées : lancements, promotions de rentrée, tournées de dédicaces… avec leur période, leur budget et leurs résultats.</p>

      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "flex-end", margin: "12px 0" }}>
        <label style={lbl}>Statut
          <select value={statut} onChange={(e) => setStatut(e.target.value)} style={inp}>
            <option value="">Tous</option>
            {(Object.keys(STATUT) as MarketingCampaignStatus[]).map((s) => <option key={s} value={s}>{STATUT[s].label}</option>)}
          </select>
        </label>
        {canManage && <button onClick={() => setEditing("new")} style={primaryBtn}>+ Nouvelle campagne</button>}
      </div>

      {err && <div style={alertBox}>{err}</div>}
      {!items ? <p style={{ color: "var(--muted)", fontSize: 13 }}>Chargement…</p> : items.length === 0 ? (
        <p style={{ color: "var(--muted)", fontSize: 13 }}>Aucune campagne. Créez-en une avec « Nouvelle campagne ».</p>
      ) : (
        <div style={{ overflowX: "auto" }}>
          <table className="ecl-table">
            <thead><tr><th>Campagne</th><th>Ouvrage</th><th>Période</th><th className="r">Budget prévu</th><th className="r">Engagé</th><th>Statut</th>{canManage && <th></th>}</tr></thead>
            <tbody>
              {items.map((c) => (
                <tr key={c.id}>
                  <td><div style={{ fontWeight: 600 }}>{c.name}</div>{c.objective && <div style={{ fontSize: 12, color: "var(--muted)" }}>{c.objective}</div>}</td>
                  <td>{c.book?.title ?? "—"}</td>
                  <td className="mono" style={{ whiteSpace: "nowrap" }}>{dfr(c.start_date)} → {dfr(c.end_date)}</td>
                  <td className="r mono">{fcfa(c.budget_prevu)}</td>
                  <td className="r mono">{fcfa(c.budget_engage)}</td>
                  <td><span style={{ fontWeight: 700, fontSize: 12, color: STATUT[c.statut].color }}>{STATUT[c.statut].label}</span></td>
                  {canManage && <td><button onClick={() => setEditing(c)} style={{ ...ghostBtn, padding: "3px 8px" }}>Modifier</button></td>}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {editing && canManage && <CampaignModal campaign={editing === "new" ? null : editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); load(); }} />}
    </div>
  );
}

function CampaignModal({ campaign, onClose, onSaved }: { campaign: MarketingCampaign | null; onClose: () => void; onSaved: () => void }) {
  const [f, setF] = useState<MarketingCampaignInput>({
    name: campaign?.name ?? "",
    objective: campaign?.objective ?? "",
    manuscript_id: campaign?.book?.id ?? null,
    start_date: campaign?.start_date?.slice(0, 10) ?? "",
    end_date: campaign?.end_date?.slice(0, 10) ?? "",
    budget_prevu: campaign?.budget_prevu ?? null,
    budget_engage: campaign?.budget_engage ?? null,
    statut: campaign?.statut ?? "planifiee",
    resultats: campaign?.resultats ?? "",
    notes: campaign?.notes ?? "",
  });
  const [bookLabel, setBookLabel] = useState(campaign?.book?.title ?? "");
  const [bookQuery, setBookQuery] = useState("");
  const [bookResults, setBookResults] = useState<{ id: string; title: string; authors: string[] }[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!bookQuery.trim()) { setBookResults([]); return; }
    const t = setTimeout(() => { searchMarketingManuscripts(bookQuery).then((r) => setBookResults(r.items)).catch(() => setBookResults([])); }, 250);
    return () => clearTimeout(t);
  }, [bookQuery]);

  async function save() {
    if (!f.name.trim()) { setErr("Le nom de la campagne est obligatoire."); return; }
    setBusy(true); setErr(null);
    const payload: MarketingCampaignInput = { ...f, start_date: f.start_date || null, end_date: f.end_date || null };
    try {
      if (campaign) await updateMarketingCampaign(campaign.id, payload);
      else await createMarketingCampaign(payload);
      onSaved();
    } catch (e) { setErr(e instanceof Error ? e.message : "Enregistrement impossible."); setBusy(false); }
  }
  async function remove() {
    if (!campaign || !window.confirm(`Retirer la campagne « ${campaign.name} » ?`)) return;
    setBusy(true);
    try { await deleteMarketingCampaign(campaign.id); onSaved(); }
    catch (e) { setErr(e instanceof Error ? e.message : "Suppression impossible."); setBusy(false); }
  }

  return (
    <div style={overlay} onClick={onClose}>
      <div style={modalBox} onClick={(e) => e.stopPropagation()}>
        <div style={{ fontFamily: "var(--font-title)", fontSize: 16, marginBottom: 10 }}>{campaign ? "Modifier la campagne" : "Nouvelle campagne"}</div>
        {err && <div style={alertBox}>{err}</div>}
        <Lbl t="Nom de la campagne"><input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="ex. Lancement — Management financier" style={inp} /></Lbl>
        <Lbl t="Objectif"><input value={f.objective} onChange={(e) => setF({ ...f, objective: e.target.value })} style={inp} /></Lbl>

        <Lbl t="Ouvrage concerné (facultatif)">
          {f.manuscript_id ? (
            <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13 }}>
              <b>{bookLabel}</b>
              <button onClick={() => { setF({ ...f, manuscript_id: null }); setBookLabel(""); }} style={{ ...ghostBtn, padding: "2px 8px" }}>retirer</button>
            </div>
          ) : (
            <>
              <input value={bookQuery} onChange={(e) => setBookQuery(e.target.value)} placeholder="Rechercher un ouvrage…" style={inp} />
              {bookResults.length > 0 && (
                <div style={{ border: "1px solid var(--line)", borderRadius: 6, marginTop: 4, maxHeight: 140, overflowY: "auto" }}>
                  {bookResults.map((b) => (
                    <button key={b.id} onClick={() => { setF({ ...f, manuscript_id: b.id }); setBookLabel(b.title); setBookQuery(""); setBookResults([]); }} style={{ display: "block", width: "100%", textAlign: "left", background: "#fff", border: "none", borderBottom: "1px solid var(--line)", padding: "6px 9px", fontSize: 12.5, cursor: "pointer" }}>
                      {b.title} <span style={{ color: "var(--muted)" }}>· {b.authors.join(", ")}</span>
                    </button>
                  ))}
                </div>
              )}
            </>
          )}
        </Lbl>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
          <Lbl t="Début"><input type="date" value={f.start_date ?? ""} onChange={(e) => setF({ ...f, start_date: e.target.value })} style={inp} /></Lbl>
          <Lbl t="Fin"><input type="date" value={f.end_date ?? ""} onChange={(e) => setF({ ...f, end_date: e.target.value })} style={inp} /></Lbl>
          <Lbl t="Budget prévu (FCFA)"><input type="number" min={0} value={f.budget_prevu ?? ""} onChange={(e) => setF({ ...f, budget_prevu: e.target.value === "" ? null : Number(e.target.value) })} style={inp} /></Lbl>
          <Lbl t="Budget engagé (FCFA)"><input type="number" min={0} value={f.budget_engage ?? ""} onChange={(e) => setF({ ...f, budget_engage: e.target.value === "" ? null : Number(e.target.value) })} style={inp} /></Lbl>
          <Lbl t="Statut"><select value={f.statut} onChange={(e) => setF({ ...f, statut: e.target.value as MarketingCampaignStatus })} style={inp}>{(Object.keys(STATUT) as MarketingCampaignStatus[]).map((s) => <option key={s} value={s}>{STATUT[s].label}</option>)}</select></Lbl>
        </div>
        <Lbl t="Résultats"><textarea value={f.resultats} onChange={(e) => setF({ ...f, resultats: e.target.value })} rows={2} style={{ ...inp, resize: "vertical" }} /></Lbl>
        <Lbl t="Notes"><textarea value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} rows={2} style={{ ...inp, resize: "vertical" }} /></Lbl>

        <div style={{ display: "flex", justifyContent: "space-between", marginTop: 14 }}>
          <div>{campaign && <button onClick={remove} disabled={busy} style={{ ...ghostBtn, color: "var(--alert, #B23A2E)" }}>Retirer</button>}</div>
          <div style={{ display: "flex", gap: 8 }}>
            <button onClick={onClose} style={ghostBtn}>Annuler</button>
            <button onClick={save} disabled={busy} style={primaryBtn}>{busy ? "…" : "Enregistrer"}</button>
          </div>
        </div>
      </div>
    </div>
  );
}

function Lbl({ t, children }: { t: string; children: React.ReactNode }) {
  return <label style={{ display: "flex", flexDirection: "column", gap: 3, fontSize: 11.5, color: "var(--muted)", marginTop: 8 }}>{t}{children}</label>;
}
const lbl: React.CSSProperties = { display: "flex", flexDirection: "column", gap: 3, fontSize: 11.5, color: "var(--muted)" };
const inp: React.CSSProperties = { padding: "7px 9px", border: "1px solid var(--line)", borderRadius: 6, fontSize: 13, fontFamily: "inherit", background: "#fff", width: "100%", boxSizing: "border-box" };
const primaryBtn: React.CSSProperties = { background: "var(--eclosion)", color: "#0B0B0C", border: "none", borderRadius: 7, padding: "8px 15px", fontSize: 13, fontWeight: 700, cursor: "pointer" };
const ghostBtn: React.CSSProperties = { background: "#fff", border: "1px solid var(--line)", borderRadius: 7, padding: "6px 12px", fontSize: 12.5, cursor: "pointer" };
const overlay: React.CSSProperties = { position: "fixed", inset: 0, background: "rgba(11,11,12,.4)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 60, padding: 16 };
const modalBox: React.CSSProperties = { background: "#fff", borderRadius: 12, padding: 18, maxWidth: 540, width: "100%", maxHeight: "90vh", overflow: "auto" };
const alertBox: React.CSSProperties = { background: "var(--alert-soft, #F6E2DE)", color: "var(--alert, #B23A2E)", borderRadius: 8, padding: "9px 13px", fontSize: 13, margin: "8px 0" };
