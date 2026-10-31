import { useEffect, useState } from "react";
import {
  getDigitalServices, updateDigitalService, createDigitalService, deleteDigitalService,
  getDigitalServicePayments, addDigitalServicePayment,
  type DigitalService, type DigitalServicePayment,
} from "../api/client";

// Veille des abonnements & paiements numériques (module administrateur).
// Évite toute interruption des services numériques (API IA, Claude Code,
// Scalingo…) : statut, échéance, consommation, enregistrement des paiements.
// Aucun secret bancaire n'est saisi ni stocké.

const STATUS: Record<DigitalService["status"], { label: string; color: string; soft: string }> = {
  a_jour: { label: "À jour", color: "#2F7D4A", soft: "#E6F0E9" },
  a_surveiller: { label: "À surveiller", color: "#B87400", soft: "#FBEEDA" },
  en_retard: { label: "En retard", color: "#B23A2E", soft: "#F6E2DE" },
};
const KIND_LABEL: Record<DigitalService["kind"], string> = {
  subscription_monthly: "Abonnement mensuel",
  usage_based: "Forfait à l'usage (budget + consommation)",
};
const fmtDate = (s: string | null) => (s ? new Date(s).toLocaleDateString("fr-FR", { day: "2-digit", month: "long", year: "numeric" }) : "à renseigner");
const fmtNum = (n: number) => n.toLocaleString("fr-FR");
const todayInput = () => new Date().toISOString().slice(0, 10);

export function SubscriptionsPage({ canManage }: { canManage: boolean }) {
  const [data, setData] = useState<{ services: DigitalService[]; summary: { total: number; to_watch: number; late: number } } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [adding, setAdding] = useState(false);

  const load = () => getDigitalServices().then(setData).catch((e) => setError(e instanceof Error ? e.message : "Chargement impossible."));
  useEffect(() => { load(); /* eslint-disable-next-line */ }, []);

  async function run(fn: () => Promise<unknown>, ok: string) {
    setBusy(true); setError(null); setMessage(null);
    try { await fn(); await load(); setMessage(ok); } catch (e) { setError(e instanceof Error ? e.message : "Opération impossible."); } finally { setBusy(false); }
  }

  if (!data) return <div style={{ padding: 24, color: "var(--muted)" }}>Chargement…</div>;

  return (
    <div style={{ padding: "clamp(16px, 4vw, 28px)", maxWidth: 920 }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 10, flexWrap: "wrap" }}>
        <h1 style={{ fontSize: 22, margin: 0 }}>Veille des abonnements</h1>
        <span style={{ fontSize: 12.5, color: "var(--muted)", textTransform: "uppercase", letterSpacing: ".06em" }}>Surveillance des services numériques</span>
      </div>
      <p style={{ color: "var(--muted)", fontSize: 13, lineHeight: 1.6, marginTop: 6 }}>
        Suivi des échéances et paiements des services indispensables (API IA, développement, hébergement) pour éviter toute interruption.
        Les alertes (J-15, J-7, J-3, J-1, dépassé ; 70/85/95 % du budget) sont envoyées automatiquement — cloche et e-mail. Aucun numéro de carte n'est stocké.
      </p>

      {error && <div style={{ background: "var(--alert-soft, #F6E2DE)", color: "var(--alert, #B23A2E)", borderRadius: 8, padding: "8px 12px", fontSize: 13, marginBottom: 10 }}>{error}</div>}
      {message && <div style={{ background: "var(--eclosion-soft, #FBEEDA)", color: "var(--ink)", borderRadius: 8, padding: "8px 12px", fontSize: 13, marginBottom: 10 }}>{message}</div>}

      {/* Compteurs */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 12, margin: "6px 0 18px" }}>
        <Tile n={data.summary.total} label="Services suivis" color="#2F7D4A" />
        <Tile n={data.summary.to_watch} label="À surveiller" color="#B87400" />
        <Tile n={data.summary.late} label="En retard" color="#B23A2E" />
      </div>

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
        <h2 style={{ fontSize: 15, margin: 0 }}>Services à surveiller</h2>
        {canManage && <button onClick={() => setAdding((v) => !v)} style={linkBtn}>{adding ? "Annuler" : "+ Ajouter un service"}</button>}
      </div>

      {adding && canManage && <AddServiceForm busy={busy} onCreate={(body) => run(() => createDigitalService(body), "Service ajouté.").then(() => setAdding(false))} />}

      <div style={{ display: "grid", gap: 12 }}>
        {data.services.filter((s) => s.active).map((s) => (
          <ServiceCard key={s.id} s={s} canManage={canManage} busy={busy} run={run} />
        ))}
        {data.services.filter((s) => s.active).length === 0 && <p style={{ color: "var(--muted)", fontSize: 13 }}>Aucun service configuré.</p>}
      </div>
    </div>
  );
}

function Tile({ n, label, color }: { n: number; label: string; color: string }) {
  return (
    <div style={{ background: "var(--paper, #FAF8F2)", border: "1px solid var(--line)", borderRadius: 10, padding: "12px 14px" }}>
      <div style={{ fontFamily: "var(--font-mono)", fontSize: 28, fontWeight: 700, color }}>{String(n).padStart(2, "0")}</div>
      <div style={{ fontSize: 12.5, color: "var(--muted)" }}>{label}</div>
    </div>
  );
}

function ServiceCard({ s, canManage, busy, run }: { s: DigitalService; canManage: boolean; busy: boolean; run: (fn: () => Promise<unknown>, ok: string) => Promise<void> }) {
  const st = STATUS[s.status];
  return (
    <div style={{ border: "1px solid var(--line)", borderRadius: 10, padding: 14, background: "#fff" }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "flex-start", flexWrap: "wrap" }}>
        <div>
          <div style={{ fontSize: 15, fontWeight: 700 }}>{s.name}</div>
          <div style={{ fontSize: 12.5, color: "var(--muted)" }}>{s.description || KIND_LABEL[s.kind]}</div>
          <div style={{ fontSize: 12.5, color: "var(--muted)", marginTop: 4 }}>
            Prochaine échéance : <strong style={{ color: "var(--ink)" }}>{fmtDate(s.next_due_date)}</strong>
            {s.days_to_due != null && <span> ({s.days_to_due < 0 ? `${-s.days_to_due} j de retard` : `dans ${s.days_to_due} j`})</span>}
            {s.kind === "usage_based" && s.usage_pct != null && <span> · Consommation : <strong style={{ color: "var(--ink)" }}>{s.usage_pct}%</strong> du budget</span>}
          </div>
        </div>
        <span style={{ background: st.soft, color: st.color, borderRadius: 999, padding: "2px 12px", fontSize: 12.5, fontWeight: 700, whiteSpace: "nowrap" }}>{st.label}</span>
      </div>

      {s.billing_url && (
        <a href={s.billing_url} target="_blank" rel="noreferrer" style={{ display: "inline-block", marginTop: 10, border: "1px solid var(--line)", borderRadius: 8, padding: "7px 14px", fontSize: 13, color: "var(--ink)", textDecoration: "none" }}>
          {s.billing_label || "Accéder au paiement"} ↗
        </a>
      )}

      {canManage && (
        <details style={{ marginTop: 10 }}>
          <summary style={{ cursor: "pointer", fontSize: 12.5, color: "var(--eclosion-dark, #9a7a12)", fontWeight: 600 }}>Gérer (paiement, échéance, budget, historique)</summary>
          <ManagePanel s={s} busy={busy} run={run} />
        </details>
      )}
    </div>
  );
}

const input: React.CSSProperties = { width: "100%", padding: "7px 9px", border: "1px solid var(--line)", borderRadius: 7, fontSize: 13, boxSizing: "border-box" };
const linkBtn: React.CSSProperties = { background: "none", border: "none", color: "var(--eclosion-dark, #9a7a12)", fontSize: 12.5, fontWeight: 600, cursor: "pointer", textDecoration: "underline" };
const primaryBtn: React.CSSProperties = { background: "var(--eclosion, #D9B21A)", color: "#0B0B0C", border: "none", borderRadius: 7, padding: "8px 14px", fontSize: 13, fontWeight: 700, cursor: "pointer" };
const Label = ({ children }: { children: React.ReactNode }) => <label style={{ fontSize: 11.5, color: "var(--muted)", fontWeight: 600, display: "block", marginBottom: 2 }}>{children}</label>;

function AddServiceForm({ busy, onCreate }: { busy: boolean; onCreate: (body: Record<string, unknown>) => void }) {
  const [f, setF] = useState({ key: "", name: "", kind: "subscription_monthly", billing_url: "", billing_label: "" });
  return (
    <div style={{ border: "1px dashed var(--line)", borderRadius: 10, padding: 12, marginBottom: 12, background: "var(--paper, #FAF8F2)" }}>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
        <div><Label>Clé (minuscules)</Label><input style={input} value={f.key} onChange={(e) => setF({ ...f, key: e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, "_") })} placeholder="ex. api_ia" /></div>
        <div><Label>Nom</Label><input style={input} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="ex. API — Corrections IA" /></div>
        <div><Label>Type</Label><select style={input} value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value })}><option value="subscription_monthly">Abonnement mensuel</option><option value="usage_based">Forfait à l'usage</option></select></div>
        <div><Label>Libellé du bouton</Label><input style={input} value={f.billing_label} onChange={(e) => setF({ ...f, billing_label: e.target.value })} placeholder="Accéder au paiement" /></div>
        <div style={{ gridColumn: "1 / -1" }}><Label>URL de facturation</Label><input style={input} value={f.billing_url} onChange={(e) => setF({ ...f, billing_url: e.target.value })} placeholder="https://…" /></div>
      </div>
      <button disabled={busy || !f.key || f.name.trim().length < 2} onClick={() => onCreate({ key: f.key, name: f.name.trim(), kind: f.kind, billing_url: f.billing_url || undefined, billing_label: f.billing_label || undefined })} style={{ ...primaryBtn, marginTop: 10 }}>Ajouter</button>
    </div>
  );
}

function ManagePanel({ s, busy, run }: { s: DigitalService; busy: boolean; run: (fn: () => Promise<unknown>, ok: string) => Promise<void> }) {
  const [edit, setEdit] = useState({
    billing_url: s.billing_url ?? "", billing_label: s.billing_label ?? "",
    next_due_date: s.next_due_date ? s.next_due_date.slice(0, 10) : "",
    monthly_budget: s.monthly_budget != null ? String(s.monthly_budget) : "",
    current_usage: s.current_usage != null ? String(s.current_usage) : "",
    usage_period: s.usage_period ?? "",
  });
  const [pay, setPay] = useState({ amount: "", paid_at: todayInput(), reference: "", method: "", new_due_date: "", status: "confirmed" });
  const [history, setHistory] = useState<DigitalServicePayment[] | null>(null);
  useEffect(() => { getDigitalServicePayments(s.id).then(setHistory).catch(() => setHistory([])); }, [s.id]);

  const saveEdit = () => run(() => updateDigitalService(s.id, {
    billing_url: edit.billing_url || null, billing_label: edit.billing_label || null,
    next_due_date: edit.next_due_date ? new Date(edit.next_due_date + "T00:00:00").toISOString() : null,
    monthly_budget: edit.monthly_budget === "" ? null : Number(edit.monthly_budget),
    current_usage: edit.current_usage === "" ? null : Number(edit.current_usage),
    usage_period: edit.usage_period || null,
  }), "Service mis à jour.");

  const submitPay = () => run(async () => {
    await addDigitalServicePayment(s.id, {
      amount: Number(pay.amount), paid_at: new Date(pay.paid_at + "T00:00:00").toISOString(),
      reference: pay.reference || undefined, method: pay.method || undefined, status: pay.status,
      new_due_date: pay.new_due_date ? new Date(pay.new_due_date + "T00:00:00").toISOString() : undefined,
    });
    setHistory(await getDigitalServicePayments(s.id));
  }, "Paiement enregistré.");

  return (
    <div style={{ marginTop: 10, display: "grid", gap: 14 }}>
      {/* Réglages */}
      <div>
        <div style={{ fontSize: 12.5, fontWeight: 700, marginBottom: 6 }}>Réglages</div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
          <div><Label>URL de facturation</Label><input style={input} value={edit.billing_url} onChange={(e) => setEdit({ ...edit, billing_url: e.target.value })} placeholder="https://…" /></div>
          <div><Label>Libellé du bouton</Label><input style={input} value={edit.billing_label} onChange={(e) => setEdit({ ...edit, billing_label: e.target.value })} /></div>
          <div><Label>Prochaine échéance</Label><input type="date" style={input} value={edit.next_due_date} onChange={(e) => setEdit({ ...edit, next_due_date: e.target.value })} /></div>
          {s.kind === "usage_based" && <>
            <div><Label>Mois de consommation</Label><input style={input} value={edit.usage_period} onChange={(e) => setEdit({ ...edit, usage_period: e.target.value })} placeholder="2026-10" /></div>
            <div><Label>Budget du mois</Label><input type="number" style={input} value={edit.monthly_budget} onChange={(e) => setEdit({ ...edit, monthly_budget: e.target.value })} /></div>
            <div><Label>Consommation à ce jour</Label><input type="number" style={input} value={edit.current_usage} onChange={(e) => setEdit({ ...edit, current_usage: e.target.value })} /></div>
          </>}
        </div>
        <button disabled={busy} onClick={saveEdit} style={{ ...primaryBtn, marginTop: 8 }}>Enregistrer les réglages</button>
      </div>

      {/* Enregistrer un paiement */}
      <div>
        <div style={{ fontSize: 12.5, fontWeight: 700, marginBottom: 6 }}>Enregistrer un paiement</div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
          <div><Label>Montant</Label><input type="number" style={input} value={pay.amount} onChange={(e) => setPay({ ...pay, amount: e.target.value })} /></div>
          <div><Label>Date de paiement</Label><input type="date" style={input} value={pay.paid_at} onChange={(e) => setPay({ ...pay, paid_at: e.target.value })} /></div>
          <div><Label>Référence</Label><input style={input} value={pay.reference} onChange={(e) => setPay({ ...pay, reference: e.target.value })} /></div>
          <div><Label>Mode</Label><input style={input} value={pay.method} onChange={(e) => setPay({ ...pay, method: e.target.value })} placeholder="carte, virement…" /></div>
          <div><Label>Nouvelle échéance (si confirmé)</Label><input type="date" style={input} value={pay.new_due_date} onChange={(e) => setPay({ ...pay, new_due_date: e.target.value })} /></div>
          <div><Label>Statut</Label><select style={input} value={pay.status} onChange={(e) => setPay({ ...pay, status: e.target.value })}><option value="confirmed">Confirmé</option><option value="pending">En attente de confirmation</option></select></div>
        </div>
        <button disabled={busy || !pay.amount} onClick={submitPay} style={{ ...primaryBtn, marginTop: 8 }}>Enregistrer le paiement</button>
        <div style={{ fontSize: 11.5, color: "var(--muted)", marginTop: 4 }}>Un paiement n'avance l'échéance que s'il est <strong>confirmé</strong> et porte une nouvelle échéance.</div>
      </div>

      {/* Historique */}
      <div>
        <div style={{ fontSize: 12.5, fontWeight: 700, marginBottom: 6 }}>Historique des paiements</div>
        {!history ? <span style={{ fontSize: 12, color: "var(--muted)" }}>Chargement…</span> : history.length === 0 ? (
          <span style={{ fontSize: 12, color: "var(--muted)" }}>Aucun paiement enregistré.</span>
        ) : (
          <div style={{ display: "grid", gap: 4 }}>
            {history.map((p) => (
              <div key={p.id} style={{ display: "flex", gap: 10, alignItems: "baseline", fontSize: 12.5, flexWrap: "wrap", borderTop: "1px solid var(--line)", paddingTop: 4 }}>
                <span style={{ fontFamily: "var(--font-mono)" }}>{new Date(p.paid_at).toLocaleDateString("fr-FR")}</span>
                <strong style={{ fontFamily: "var(--font-mono)" }}>{fmtNum(p.amount)} {p.currency}</strong>
                {p.reference && <span style={{ color: "var(--muted)" }}>réf. {p.reference}</span>}
                <span style={{ color: p.status === "confirmed" ? "#2F7D4A" : "#B87400" }}>{p.status === "confirmed" ? "confirmé" : "en attente"}</span>
                {p.new_due_date && <span style={{ color: "var(--muted)" }}>→ échéance {new Date(p.new_due_date).toLocaleDateString("fr-FR")}</span>}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
