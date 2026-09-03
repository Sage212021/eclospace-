import { useEffect, useState } from "react";
import {
  listMarketingPlans,
  searchMarketingManuscripts,
  getMarketingPlan,
  saveMarketingPlan,
  addMarketingAction,
  updateMarketingAction,
  deleteMarketingAction,
  type MarketingPlanListItem,
  type MarketingPlanResponse,
  type MarketingActionRow,
  type MarketingActionInput,
  type MarketingCanal,
  type MarketingActionStatus,
  type MarketingPriorite,
} from "../api/client";

// Pôle Marketing, Communication & Distribution — Fiche marketing par ouvrage.
// Positionnement + plan d'action budgété, rattachés à la fiche ouvrage centrale.

const CANAL: Record<MarketingCanal, string> = {
  reseaux_sociaux: "Réseaux sociaux",
  presse: "Presse / médias",
  newsletter: "Newsletter / mailing",
  lancement: "Lancement",
  dedicace: "Dédicace",
  salon: "Salon",
  partenariat: "Partenariat",
  influenceur: "Influenceur / prescripteur",
  institutionnel: "Institutionnel",
  vente_directe: "Vente directe",
  autre: "Autre",
};
const STATUT: Record<MarketingActionStatus, { label: string; color: string }> = {
  a_faire: { label: "À faire", color: "var(--muted)" },
  en_cours: { label: "En cours", color: "#B87400" },
  fait: { label: "Fait", color: "#2F7D4A" },
  annule: { label: "Annulé", color: "var(--alert, #B23A2E)" },
};
const PRIORITE: Record<MarketingPriorite, string> = { basse: "Basse", normale: "Normale", haute: "Haute" };

const fcfa = (n: number | null | undefined) => (n == null ? "—" : `${Number(n).toLocaleString("fr-FR")} FCFA`);

export function MarketingPlansPage({ canManage }: { canManage?: boolean }) {
  const [selected, setSelected] = useState<string | null>(null); // manuscriptId en cours d'édition
  const [picking, setPicking] = useState(false);

  if (selected) return <PlanEditor manuscriptId={selected} canManage={!!canManage} onBack={() => setSelected(null)} />;

  return (
    <div className="ecl-page" style={{ maxWidth: 1040 }}>
      <h1 className="ecl-page__title">Fiches marketing</h1>
      <p className="ecl-page__lead">Une fiche par ouvrage : positionnement (cible, argumentaire) et plan d'action budgété. Reliée à la fiche de l'ouvrage — aucune ressaisie des informations du livre.</p>
      {canManage && (
        <div style={{ margin: "10px 0" }}>
          <button onClick={() => setPicking(true)} style={primaryBtn}>+ Nouvelle fiche marketing</button>
        </div>
      )}
      <PlanList onOpen={setSelected} />
      {picking && <ManuscriptPicker onClose={() => setPicking(false)} onPick={(id) => { setPicking(false); setSelected(id); }} />}
    </div>
  );
}

function PlanList({ onOpen }: { onOpen: (manuscriptId: string) => void }) {
  const [items, setItems] = useState<MarketingPlanListItem[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => { listMarketingPlans().then((r) => setItems(r.items)).catch((e) => setErr(e instanceof Error ? e.message : "Chargement impossible.")); }, []);
  if (err) return <div style={alertBox}>{err}</div>;
  if (!items) return <p style={{ color: "var(--muted)", fontSize: 13 }}>Chargement…</p>;
  if (items.length === 0) return <p style={{ color: "var(--muted)", fontSize: 13 }}>Aucune fiche marketing pour l'instant. Créez-en une pour un ouvrage avec « Nouvelle fiche marketing ».</p>;
  return (
    <div style={{ overflowX: "auto" }}>
      <table className="ecl-table">
        <thead><tr><th>Ouvrage</th><th>Responsable</th><th>Actions</th><th className="r">Budget prévu</th><th className="r">Engagé</th></tr></thead>
        <tbody>
          {items.map((p) => (
            <tr key={p.id} onClick={() => onOpen(p.manuscript.id)} style={{ cursor: "pointer" }}>
              <td><div style={{ fontWeight: 600 }}>{p.manuscript.title}</div><div style={{ fontSize: 12, color: "var(--muted)" }}>{p.manuscript.authors.join(", ")}</div></td>
              <td>{p.responsable?.name ?? "—"}</td>
              <td className="mono">{p.actions_done}/{p.actions_total}</td>
              <td className="r mono">{fcfa(p.budget_prevu)}</td>
              <td className="r mono">{fcfa(p.budget_engage)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ManuscriptPicker({ onClose, onPick }: { onClose: () => void; onPick: (id: string) => void }) {
  const [q, setQ] = useState("");
  const [rows, setRows] = useState<{ id: string; reference: string; title: string; authors: string[]; has_plan: boolean }[]>([]);
  useEffect(() => {
    const t = setTimeout(() => { searchMarketingManuscripts(q).then((r) => setRows(r.items)).catch(() => setRows([])); }, 250);
    return () => clearTimeout(t);
  }, [q]);
  return (
    <div style={overlay} onClick={onClose}>
      <div style={{ ...modalBox, maxWidth: 560 }} onClick={(e) => e.stopPropagation()}>
        <div style={{ fontFamily: "var(--font-title)", fontSize: 16, marginBottom: 8 }}>Choisir l'ouvrage</div>
        <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Rechercher un ouvrage (titre, référence)…" style={{ ...inp, width: "100%", boxSizing: "border-box", marginBottom: 10 }} />
        <div style={{ maxHeight: 340, overflowY: "auto", display: "grid", gap: 6 }}>
          {rows.map((m) => (
            <button key={m.id} onClick={() => onPick(m.id)} style={{ textAlign: "left", background: "#fff", border: "1px solid var(--line)", borderRadius: 8, padding: "8px 11px", cursor: "pointer" }}>
              <div style={{ fontWeight: 600, fontSize: 13.5 }}>{m.title} {m.has_plan && <span style={{ fontSize: 10.5, color: "var(--eclosion-dark, #9a7a12)", fontWeight: 700 }}>• fiche existante</span>}</div>
              <div style={{ fontSize: 12, color: "var(--muted)" }}>{m.authors.join(", ") || "—"} · <span style={{ fontFamily: "var(--font-mono)" }}>{m.reference}</span></div>
            </button>
          ))}
          {rows.length === 0 && <p style={{ color: "var(--muted)", fontSize: 12.5 }}>Aucun ouvrage.</p>}
        </div>
        <div style={{ textAlign: "right", marginTop: 12 }}><button onClick={onClose} style={ghostBtn}>Fermer</button></div>
      </div>
    </div>
  );
}

const EMPTY_POS = { public_cible: "", public_secondaire: "", zone_geo: "", besoin: "", argumentaire: "", arguments_vente: "", positionnement: "", notes: "" };

function PlanEditor({ manuscriptId, canManage, onBack }: { manuscriptId: string; canManage: boolean; onBack: () => void }) {
  const [data, setData] = useState<MarketingPlanResponse | null>(null);
  const [pos, setPos] = useState({ ...EMPTY_POS });
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [savingPos, setSavingPos] = useState(false);
  const [actionModal, setActionModal] = useState<MarketingActionRow | "new" | null>(null);

  const load = () =>
    getMarketingPlan(manuscriptId).then((r) => {
      setData(r);
      setPos({
        public_cible: r.plan?.public_cible ?? "", public_secondaire: r.plan?.public_secondaire ?? "", zone_geo: r.plan?.zone_geo ?? "",
        besoin: r.plan?.besoin ?? "", argumentaire: r.plan?.argumentaire ?? "", arguments_vente: r.plan?.arguments_vente ?? "",
        positionnement: r.plan?.positionnement ?? "", notes: r.plan?.notes ?? "",
      });
    });
  useEffect(() => { load().catch((e) => setErr(e instanceof Error ? e.message : "Chargement impossible.")); /* eslint-disable-next-line */ }, [manuscriptId]);

  if (err) return <div className="ecl-page"><button onClick={onBack} style={ghostBtn}>← Retour</button><div style={alertBox}>{err}</div></div>;
  if (!data) return <div className="ecl-page"><p style={{ color: "var(--muted)" }}>Chargement…</p></div>;

  const m = data.manuscript;
  const plan = data.plan;
  const actions = plan?.actions ?? [];
  const budgetPrevu = actions.filter((a) => a.statut !== "annule").reduce((s, a) => s + (a.budget_prevu ?? 0), 0);
  const budgetEngage = actions.filter((a) => a.statut !== "annule").reduce((s, a) => s + (a.budget_engage ?? 0), 0);

  async function savePos() {
    setSavingPos(true); setErr(null); setMsg(null);
    try { await saveMarketingPlan(manuscriptId, pos); setMsg("Positionnement enregistré."); await load(); }
    catch (e) { setErr(e instanceof Error ? e.message : "Enregistrement impossible."); }
    finally { setSavingPos(false); }
  }

  return (
    <div className="ecl-page" style={{ maxWidth: 1040 }}>
      <button onClick={onBack} style={ghostBtn}>← Toutes les fiches</button>
      <h1 className="ecl-page__title" style={{ marginTop: 8 }}>Fiche marketing — {m.title}</h1>
      {/* A. Identification (repris de la fiche ouvrage). */}
      <div style={{ display: "flex", flexWrap: "wrap", gap: "4px 18px", fontSize: 12.5, color: "var(--muted)", marginBottom: 6 }}>
        <span>{m.authors.join(", ") || "Auteur non renseigné"}</span>
        {m.collection && <span>Collection : <b style={{ color: "var(--ink)" }}>{m.collection}</b></span>}
        {m.genre && <span>Genre : <b style={{ color: "var(--ink)" }}>{m.genre}</b></span>}
        {m.publication_date && <span>Parution : <b style={{ color: "var(--ink)" }}>{new Date(m.publication_date).getUTCFullYear()}</b></span>}
        {m.price_public != null && <span>Prix : <b style={{ color: "var(--ink)" }}>{fcfa(m.price_public)}</b></span>}
        <span style={{ fontFamily: "var(--font-mono)" }}>{m.reference}</span>
      </div>

      {msg && <div style={okBox}>{msg}</div>}
      {err && <div style={alertBox}>{err}</div>}

      {/* B. Positionnement. */}
      <section className="ecl-card" style={{ marginTop: 10 }}>
        <h2 style={h2}>Positionnement</h2>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
          <Txt label="Public cible" v={pos.public_cible} on={(v) => setPos({ ...pos, public_cible: v })} disabled={!canManage} />
          <Txt label="Public secondaire" v={pos.public_secondaire} on={(v) => setPos({ ...pos, public_secondaire: v })} disabled={!canManage} />
          <Txt label="Zone géographique" v={pos.zone_geo} on={(v) => setPos({ ...pos, zone_geo: v })} disabled={!canManage} />
          <Txt label="Positionnement" v={pos.positionnement} on={(v) => setPos({ ...pos, positionnement: v })} disabled={!canManage} />
        </div>
        <Area label="Besoin / problématique auquel répond l'ouvrage" v={pos.besoin} on={(v) => setPos({ ...pos, besoin: v })} disabled={!canManage} />
        <Area label="Argumentaire principal" v={pos.argumentaire} on={(v) => setPos({ ...pos, argumentaire: v })} disabled={!canManage} />
        <Area label="Arguments de vente (un par ligne)" v={pos.arguments_vente} on={(v) => setPos({ ...pos, arguments_vente: v })} disabled={!canManage} />
        <Area label="Notes internes" v={pos.notes} on={(v) => setPos({ ...pos, notes: v })} disabled={!canManage} />
        {canManage && <div style={{ marginTop: 8 }}><button onClick={savePos} disabled={savingPos} style={primaryBtn}>{savingPos ? "Enregistrement…" : plan ? "Enregistrer" : "Créer la fiche"}</button></div>}
      </section>

      {/* D. Plan d'action budgété. */}
      {plan ? (
        <section className="ecl-card" style={{ marginTop: 14 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
            <h2 style={h2}>Plan d'action</h2>
            <div style={{ fontSize: 12.5, color: "var(--muted)" }}>Budget prévu <b style={{ color: "var(--ink)" }}>{fcfa(budgetPrevu)}</b> · engagé <b style={{ color: "var(--ink)" }}>{fcfa(budgetEngage)}</b></div>
          </div>
          {canManage && <div style={{ margin: "6px 0 10px" }}><button onClick={() => setActionModal("new")} style={primaryBtn}>+ Ajouter une action</button></div>}
          {actions.length === 0 ? (
            <p style={{ color: "var(--muted)", fontSize: 13 }}>Aucune action. Ajoutez la première étape de la campagne (ex. « Campagne de lancement — Réseaux sociaux »).</p>
          ) : (
            <div style={{ overflowX: "auto" }}>
              <table className="ecl-table">
                <thead><tr><th>Canal</th><th>Action</th><th>Responsable</th><th>Échéance</th><th className="r">Budget</th><th>Statut</th>{canManage && <th></th>}</tr></thead>
                <tbody>
                  {actions.map((a) => (
                    <tr key={a.id}>
                      <td>{CANAL[a.canal]}</td>
                      <td><div style={{ fontWeight: 600 }}>{a.action}</div>{a.lien && <a href={a.lien} target="_blank" rel="noreferrer" style={{ fontSize: 12, color: "var(--eclosion-dark, #9a7a12)" }}>lien</a>}{a.priorite === "haute" && <span style={{ marginLeft: 6, fontSize: 10, fontWeight: 700, color: "var(--alert, #B23A2E)" }}>PRIORITÉ</span>}</td>
                      <td>{a.responsable ?? "—"}</td>
                      <td className="mono">{a.echeance ? new Date(a.echeance).toLocaleDateString("fr-FR") : "—"}</td>
                      <td className="r mono">{a.budget_prevu != null ? fcfa(a.budget_prevu) : "—"}</td>
                      <td><span style={{ fontWeight: 700, color: STATUT[a.statut].color, fontSize: 12 }}>{STATUT[a.statut].label}</span></td>
                      {canManage && <td><button onClick={() => setActionModal(a)} style={{ ...ghostBtn, padding: "3px 8px" }}>Modifier</button></td>}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      ) : (
        <p style={{ color: "var(--muted)", fontSize: 13, marginTop: 12 }}>Enregistrez d'abord le positionnement pour créer la fiche, puis ajoutez le plan d'action.</p>
      )}

      {actionModal && plan && (
        <ActionModal
          planId={plan.id}
          action={actionModal === "new" ? null : actionModal}
          onClose={() => setActionModal(null)}
          onSaved={async () => { setActionModal(null); await load(); }}
        />
      )}
    </div>
  );
}

function ActionModal({ planId, action, onClose, onSaved }: { planId: string; action: MarketingActionRow | null; onClose: () => void; onSaved: () => void }) {
  const [f, setF] = useState<MarketingActionInput>({
    canal: action?.canal ?? "reseaux_sociaux",
    action: action?.action ?? "",
    responsable: action?.responsable ?? "",
    date_debut: action?.date_debut?.slice(0, 10) ?? "",
    echeance: action?.echeance?.slice(0, 10) ?? "",
    budget_prevu: action?.budget_prevu ?? null,
    budget_engage: action?.budget_engage ?? null,
    statut: action?.statut ?? "a_faire",
    priorite: action?.priorite ?? "normale",
    lien: action?.lien ?? "",
    resultat: action?.resultat ?? "",
    commentaire: action?.commentaire ?? "",
  });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function save() {
    if (!f.action.trim()) { setErr("Le libellé de l'action est obligatoire."); return; }
    setBusy(true); setErr(null);
    const payload: MarketingActionInput = { ...f, date_debut: f.date_debut || null, echeance: f.echeance || null };
    try {
      if (action) await updateMarketingAction(action.id, payload);
      else await addMarketingAction(planId, payload);
      onSaved();
    } catch (e) { setErr(e instanceof Error ? e.message : "Enregistrement impossible."); }
    finally { setBusy(false); }
  }

  async function remove() {
    if (!action) return;
    if (!window.confirm("Retirer cette action ?")) return;
    setBusy(true);
    try { await deleteMarketingAction(action.id); onSaved(); }
    catch (e) { setErr(e instanceof Error ? e.message : "Suppression impossible."); setBusy(false); }
  }

  return (
    <div style={overlay} onClick={onClose}>
      <div style={modalBox} onClick={(e) => e.stopPropagation()}>
        <div style={{ fontFamily: "var(--font-title)", fontSize: 16, marginBottom: 10 }}>{action ? "Modifier l'action" : "Nouvelle action"}</div>
        {err && <div style={alertBox}>{err}</div>}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
          <Lbl t="Canal"><select value={f.canal} onChange={(e) => setF({ ...f, canal: e.target.value as MarketingCanal })} style={inp}>{(Object.keys(CANAL) as MarketingCanal[]).map((c) => <option key={c} value={c}>{CANAL[c]}</option>)}</select></Lbl>
          <Lbl t="Responsable"><input value={f.responsable} onChange={(e) => setF({ ...f, responsable: e.target.value })} placeholder="Marketing, Communication…" style={inp} /></Lbl>
        </div>
        <Lbl t="Action"><input value={f.action} onChange={(e) => setF({ ...f, action: e.target.value })} placeholder="ex. Campagne de lancement" style={inp} /></Lbl>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
          <Lbl t="Début"><input type="date" value={f.date_debut ?? ""} onChange={(e) => setF({ ...f, date_debut: e.target.value })} style={inp} /></Lbl>
          <Lbl t="Échéance"><input type="date" value={f.echeance ?? ""} onChange={(e) => setF({ ...f, echeance: e.target.value })} style={inp} /></Lbl>
          <Lbl t="Budget prévu (FCFA)"><input type="number" min={0} value={f.budget_prevu ?? ""} onChange={(e) => setF({ ...f, budget_prevu: e.target.value === "" ? null : Number(e.target.value) })} style={inp} /></Lbl>
          <Lbl t="Budget engagé (FCFA)"><input type="number" min={0} value={f.budget_engage ?? ""} onChange={(e) => setF({ ...f, budget_engage: e.target.value === "" ? null : Number(e.target.value) })} style={inp} /></Lbl>
          <Lbl t="Statut"><select value={f.statut} onChange={(e) => setF({ ...f, statut: e.target.value as MarketingActionStatus })} style={inp}>{(Object.keys(STATUT) as MarketingActionStatus[]).map((s) => <option key={s} value={s}>{STATUT[s].label}</option>)}</select></Lbl>
          <Lbl t="Priorité"><select value={f.priorite} onChange={(e) => setF({ ...f, priorite: e.target.value as MarketingPriorite })} style={inp}>{(Object.keys(PRIORITE) as MarketingPriorite[]).map((p) => <option key={p} value={p}>{PRIORITE[p]}</option>)}</select></Lbl>
        </div>
        <Lbl t="Lien (publication / support)"><input value={f.lien} onChange={(e) => setF({ ...f, lien: e.target.value })} placeholder="https://…" style={inp} /></Lbl>
        <Lbl t="Résultat"><input value={f.resultat} onChange={(e) => setF({ ...f, resultat: e.target.value })} style={inp} /></Lbl>
        <Lbl t="Commentaire"><input value={f.commentaire} onChange={(e) => setF({ ...f, commentaire: e.target.value })} style={inp} /></Lbl>
        <div style={{ display: "flex", justifyContent: "space-between", marginTop: 14 }}>
          <div>{action && <button onClick={remove} disabled={busy} style={{ ...ghostBtn, color: "var(--alert, #B23A2E)" }}>Retirer</button>}</div>
          <div style={{ display: "flex", gap: 8 }}>
            <button onClick={onClose} style={ghostBtn}>Annuler</button>
            <button onClick={save} disabled={busy} style={primaryBtn}>{busy ? "…" : "Enregistrer"}</button>
          </div>
        </div>
      </div>
    </div>
  );
}

function Txt({ label, v, on, disabled }: { label: string; v: string; on: (v: string) => void; disabled?: boolean }) {
  return <Lbl t={label}><input value={v} onChange={(e) => on(e.target.value)} disabled={disabled} style={inp} /></Lbl>;
}
function Area({ label, v, on, disabled }: { label: string; v: string; on: (v: string) => void; disabled?: boolean }) {
  return <div style={{ marginTop: 10 }}><Lbl t={label}><textarea value={v} onChange={(e) => on(e.target.value)} disabled={disabled} rows={2} style={{ ...inp, resize: "vertical" }} /></Lbl></div>;
}
function Lbl({ t, children }: { t: string; children: React.ReactNode }) {
  return <label style={{ display: "flex", flexDirection: "column", gap: 3, fontSize: 11.5, color: "var(--muted)", marginTop: 2 }}>{t}{children}</label>;
}

const inp: React.CSSProperties = { padding: "7px 9px", border: "1px solid var(--line)", borderRadius: 6, fontSize: 13, fontFamily: "inherit", background: "#fff", width: "100%", boxSizing: "border-box" };
const primaryBtn: React.CSSProperties = { background: "var(--eclosion)", color: "#0B0B0C", border: "none", borderRadius: 7, padding: "8px 15px", fontSize: 13, fontWeight: 700, cursor: "pointer" };
const ghostBtn: React.CSSProperties = { background: "#fff", border: "1px solid var(--line)", borderRadius: 7, padding: "6px 12px", fontSize: 12.5, cursor: "pointer" };
const h2: React.CSSProperties = { fontSize: 14.5, margin: "0 0 8px", color: "var(--ink)" };
const overlay: React.CSSProperties = { position: "fixed", inset: 0, background: "rgba(11,11,12,.4)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 60, padding: 16 };
const modalBox: React.CSSProperties = { background: "#fff", borderRadius: 12, padding: 18, maxWidth: 520, width: "100%", maxHeight: "90vh", overflow: "auto" };
const alertBox: React.CSSProperties = { background: "var(--alert-soft, #F6E2DE)", color: "var(--alert, #B23A2E)", borderRadius: 8, padding: "9px 13px", fontSize: 13, margin: "8px 0" };
const okBox: React.CSSProperties = { background: "var(--eclosion-soft)", color: "var(--eclosion-dark, #9a7a12)", borderRadius: 8, padding: "9px 13px", fontSize: 13, margin: "8px 0" };
