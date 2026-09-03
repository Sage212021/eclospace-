import { useEffect, useState } from "react";
import {
  listMarketingPartners,
  createMarketingPartner,
  updateMarketingPartner,
  deleteMarketingPartner,
  type MarketingPartner,
  type MarketingPartnerInput,
  type MarketingPartnerType,
} from "../api/client";

// Pôle Marketing, Communication & Distribution — Réseau de partenaires.
// Annuaire des relais de diffusion : librairies, écoles, universités,
// bibliothèques, distributeurs, grossistes, médias, organisateurs…

const TYPE: Record<MarketingPartnerType, string> = {
  librairie: "Librairie",
  ecole: "École",
  universite: "Université",
  bibliotheque: "Bibliothèque",
  distributeur: "Distributeur",
  grossiste: "Grossiste",
  revendeur: "Revendeur",
  association: "Association",
  institution: "Institution",
  media: "Média",
  organisateur_evenement: "Organisateur d'événements",
  autre: "Autre",
};

export function MarketingPartnersPage({ canManage }: { canManage?: boolean }) {
  const [items, setItems] = useState<MarketingPartner[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [type, setType] = useState("");
  const [q, setQ] = useState("");
  const [qd, setQd] = useState("");
  const [editing, setEditing] = useState<MarketingPartner | "new" | null>(null);

  useEffect(() => { const t = setTimeout(() => setQd(q), 300); return () => clearTimeout(t); }, [q]);
  const load = () => listMarketingPartners({ type: type || undefined, q: qd || undefined }).then((r) => { setItems(r.items); setErr(null); }).catch((e) => setErr(e instanceof Error ? e.message : "Chargement impossible."));
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [type, qd]);

  return (
    <div className="ecl-page" style={{ maxWidth: 1040 }}>
      <h1 className="ecl-page__title">Réseau de partenaires</h1>
      <p className="ecl-page__lead">Le carnet d'adresses de la diffusion : librairies, écoles, universités, bibliothèques, distributeurs, grossistes, médias, organisateurs d'événements… avec leurs contacts et conditions.</p>

      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "flex-end", margin: "12px 0" }}>
        <label style={lbl}>Type
          <select value={type} onChange={(e) => setType(e.target.value)} style={inp}>
            <option value="">Tous</option>
            {(Object.keys(TYPE) as MarketingPartnerType[]).map((t) => <option key={t} value={t}>{TYPE[t]}</option>)}
          </select>
        </label>
        <label style={lbl}>Rechercher
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Nom, ville, contact…" style={{ ...inp, minWidth: 220 }} />
        </label>
        {canManage && <button onClick={() => setEditing("new")} style={primaryBtn}>+ Nouveau partenaire</button>}
      </div>

      {err && <div style={alertBox}>{err}</div>}
      {!items ? <p style={{ color: "var(--muted)", fontSize: 13 }}>Chargement…</p> : items.length === 0 ? (
        <p style={{ color: "var(--muted)", fontSize: 13 }}>Aucun partenaire. Ajoutez vos librairies, écoles, distributeurs… avec « Nouveau partenaire ».</p>
      ) : (
        <div style={{ overflowX: "auto" }}>
          <table className="ecl-table">
            <thead><tr><th>Partenaire</th><th>Type</th><th>Ville</th><th>Contact</th><th>Partenariat</th>{canManage && <th></th>}</tr></thead>
            <tbody>
              {items.map((p) => (
                <tr key={p.id} style={{ opacity: p.active ? 1 : 0.55 }}>
                  <td>
                    <div style={{ fontWeight: 600 }}>{p.name}{!p.active && <span style={{ fontSize: 10.5, color: "var(--muted)", marginLeft: 6 }}>(inactif)</span>}</div>
                    {(p.email || p.website) && <div style={{ fontSize: 12, color: "var(--muted)" }}>{p.email}{p.email && p.website ? " · " : ""}{p.website}</div>}
                  </td>
                  <td>{TYPE[p.type]}</td>
                  <td>{[p.city, p.country].filter(Boolean).join(", ") || "—"}</td>
                  <td>{p.contact_name || "—"}{p.phone && <div style={{ fontSize: 12, color: "var(--muted)", fontFamily: "var(--font-mono)" }}>{p.phone}</div>}</td>
                  <td>{p.partnership_type || "—"}</td>
                  {canManage && <td><button onClick={() => setEditing(p)} style={{ ...ghostBtn, padding: "3px 8px" }}>Modifier</button></td>}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {editing && canManage && (
        <PartnerModal partner={editing === "new" ? null : editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); load(); }} />
      )}
    </div>
  );
}

function PartnerModal({ partner, onClose, onSaved }: { partner: MarketingPartner | null; onClose: () => void; onSaved: () => void }) {
  const [f, setF] = useState<MarketingPartnerInput>({
    type: partner?.type ?? "librairie",
    name: partner?.name ?? "",
    city: partner?.city ?? "",
    country: partner?.country ?? "",
    contact_name: partner?.contact_name ?? "",
    phone: partner?.phone ?? "",
    email: partner?.email ?? "",
    website: partner?.website ?? "",
    partnership_type: partner?.partnership_type ?? "",
    conditions: partner?.conditions ?? "",
    notes: partner?.notes ?? "",
    active: partner?.active ?? true,
  });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function save() {
    if (!f.name.trim()) { setErr("Le nom du partenaire est obligatoire."); return; }
    setBusy(true); setErr(null);
    try {
      if (partner) await updateMarketingPartner(partner.id, f);
      else await createMarketingPartner(f);
      onSaved();
    } catch (e) { setErr(e instanceof Error ? e.message : "Enregistrement impossible."); setBusy(false); }
  }
  async function remove() {
    if (!partner || !window.confirm(`Retirer « ${partner.name} » du réseau ?`)) return;
    setBusy(true);
    try { await deleteMarketingPartner(partner.id); onSaved(); }
    catch (e) { setErr(e instanceof Error ? e.message : "Suppression impossible."); setBusy(false); }
  }

  return (
    <div style={overlay} onClick={onClose}>
      <div style={modalBox} onClick={(e) => e.stopPropagation()}>
        <div style={{ fontFamily: "var(--font-title)", fontSize: 16, marginBottom: 10 }}>{partner ? "Modifier le partenaire" : "Nouveau partenaire"}</div>
        {err && <div style={alertBox}>{err}</div>}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
          <Lbl t="Type"><select value={f.type} onChange={(e) => setF({ ...f, type: e.target.value as MarketingPartnerType })} style={inp}>{(Object.keys(TYPE) as MarketingPartnerType[]).map((t) => <option key={t} value={t}>{TYPE[t]}</option>)}</select></Lbl>
          <Lbl t="Nom"><input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} style={inp} /></Lbl>
          <Lbl t="Ville"><input value={f.city} onChange={(e) => setF({ ...f, city: e.target.value })} style={inp} /></Lbl>
          <Lbl t="Pays"><input value={f.country} onChange={(e) => setF({ ...f, country: e.target.value })} placeholder="Cameroun" style={inp} /></Lbl>
          <Lbl t="Personne de contact"><input value={f.contact_name} onChange={(e) => setF({ ...f, contact_name: e.target.value })} style={inp} /></Lbl>
          <Lbl t="Téléphone"><input value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} style={inp} /></Lbl>
          <Lbl t="E-mail"><input value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} style={inp} /></Lbl>
          <Lbl t="Site web"><input value={f.website} onChange={(e) => setF({ ...f, website: e.target.value })} style={inp} /></Lbl>
          <Lbl t="Type de partenariat"><input value={f.partnership_type} onChange={(e) => setF({ ...f, partnership_type: e.target.value })} placeholder="dépôt-vente, achat ferme, convention…" style={inp} /></Lbl>
        </div>
        <Lbl t="Conditions commerciales"><textarea value={f.conditions} onChange={(e) => setF({ ...f, conditions: e.target.value })} rows={2} style={{ ...inp, resize: "vertical" }} /></Lbl>
        <Lbl t="Notes"><textarea value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} rows={2} style={{ ...inp, resize: "vertical" }} /></Lbl>
        <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, marginTop: 8 }}>
          <input type="checkbox" checked={f.active} onChange={(e) => setF({ ...f, active: e.target.checked })} /> Partenaire actif
        </label>
        <div style={{ display: "flex", justifyContent: "space-between", marginTop: 14 }}>
          <div>{partner && <button onClick={remove} disabled={busy} style={{ ...ghostBtn, color: "var(--alert, #B23A2E)" }}>Retirer</button>}</div>
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
  return <label style={{ display: "flex", flexDirection: "column", gap: 3, fontSize: 11.5, color: "var(--muted)", marginTop: 6 }}>{t}{children}</label>;
}

const lbl: React.CSSProperties = { display: "flex", flexDirection: "column", gap: 3, fontSize: 11.5, color: "var(--muted)" };
const inp: React.CSSProperties = { padding: "7px 9px", border: "1px solid var(--line)", borderRadius: 6, fontSize: 13, fontFamily: "inherit", background: "#fff", width: "100%", boxSizing: "border-box" };
const primaryBtn: React.CSSProperties = { background: "var(--eclosion)", color: "#0B0B0C", border: "none", borderRadius: 7, padding: "8px 15px", fontSize: 13, fontWeight: 700, cursor: "pointer" };
const ghostBtn: React.CSSProperties = { background: "#fff", border: "1px solid var(--line)", borderRadius: 7, padding: "6px 12px", fontSize: 12.5, cursor: "pointer" };
const overlay: React.CSSProperties = { position: "fixed", inset: 0, background: "rgba(11,11,12,.4)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 60, padding: 16 };
const modalBox: React.CSSProperties = { background: "#fff", borderRadius: 12, padding: 18, maxWidth: 560, width: "100%", maxHeight: "90vh", overflow: "auto" };
const alertBox: React.CSSProperties = { background: "var(--alert-soft, #F6E2DE)", color: "var(--alert, #B23A2E)", borderRadius: 8, padding: "9px 13px", fontSize: 13, margin: "8px 0" };
