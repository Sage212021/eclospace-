import { useEffect, useState } from "react";
import {
  createPayrollRateSet,
  getPayrollConfig,
  getPayrollRateSet,
  listPayrollRateSets,
  setPayrollConfig,
  type PayrollRateSet,
} from "../api/client";
import { Card } from "./Card";
import { Field } from "./Modal";
import { Button } from "./Button";
import { IconAdmin } from "./icons";

// Module Paie natif (D-007) — écran des paramètres : interrupteur d'internalisation
// (oui/non) et barème légal versionné (CNPS, IRPP, CFC/FNE/CAC, TC/RAV).

function pctStr(n: number): string {
  return `${(n * 100).toLocaleString("fr-FR", { maximumFractionDigits: 2 })} %`;
}
function fcfa(n: number): string {
  return `${n.toLocaleString("fr-FR")} FCFA`;
}

type Draft = Omit<PayrollRateSet, "id" | "active">;

function toDraft(r: PayrollRateSet): Draft {
  const { id: _id, active: _active, ...rest } = r;
  return JSON.parse(JSON.stringify(rest));
}

export function PayrollSettingsSection({ canManage }: { canManage: boolean }) {
  const [internal, setInternal] = useState<boolean | null>(null);
  const [current, setCurrent] = useState<PayrollRateSet | null>(null);
  const [versions, setVersions] = useState<PayrollRateSet[]>([]);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  async function refresh() {
    try {
      const [cfg, rs, list] = await Promise.all([getPayrollConfig(), getPayrollRateSet().catch(() => null), listPayrollRateSets()]);
      setInternal(cfg.internal_enabled);
      setCurrent(rs);
      setVersions(list);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Chargement impossible.");
    }
  }

  useEffect(() => {
    refresh();
  }, []);

  async function toggleInternal() {
    try {
      const r = await setPayrollConfig(!internal);
      setInternal(r.internal_enabled);
      setMessage(r.internal_enabled ? "Paie internalisée activée (l'ERP calcule les bulletins)." : "Paie internalisée désactivée (export externe).");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Changement impossible.");
    }
  }

  async function saveVersion() {
    if (!draft) return;
    try {
      await createPayrollRateSet(draft);
      setDraft(null);
      setMessage("Nouvelle version du barème enregistrée.");
      setError(null);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Enregistrement impossible.");
    }
  }

  function numField(label: string, value: number, set: (n: number) => void, step = "any") {
    return (
      <Field label={label}>
        <input type="number" step={step} value={value} onChange={(e) => set(Number(e.target.value))} style={{ fontFamily: "var(--font-mono, monospace)" }} />
      </Field>
    );
  }

  return (
    <Card
      title="Paramètres de paie (barème légal)"
      icon={<IconAdmin />}
      subtitle="Barème camerounais paramétrable et versionné. La paie interne est activable/désactivable (D-007)."
    >
      {/* Interrupteur d'internalisation */}
      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 12, marginBottom: 14, paddingBottom: 12, borderBottom: "1px solid var(--line)" }}>
        <div style={{ fontSize: 13 }}>
          Paie internalisée : <strong style={{ color: internal ? "var(--eclosion, #C89A1B)" : "var(--muted)" }}>{internal == null ? "…" : internal ? "OUI (l'ERP calcule les bulletins)" : "NON (export externe)"}</strong>
        </div>
        {canManage && internal != null && <Button variant="edit" size="sm" type="button" onClick={toggleInternal}>Basculer</Button>}
      </div>

      {/* Barème en vigueur */}
      {current ? (
        <>
          <div style={{ fontSize: 13, marginBottom: 6 }}>Barème en vigueur — effet le <span style={{ fontFamily: "var(--font-mono, monospace)" }}>{current.effective_from}</span>{current.label ? ` · ${current.label}` : ""}</div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 18, fontSize: 13 }}>
            <div><div style={{ fontSize: 12, color: "var(--muted)" }}>CNPS PVID (sal./pat.)</div><div style={{ fontFamily: "var(--font-mono, monospace)" }}>{pctStr(current.cnps.vid_sal_pct)} / {pctStr(current.cnps.vid_pat_pct)}</div></div>
            <div><div style={{ fontSize: 12, color: "var(--muted)" }}>Plafond CNPS</div><div style={{ fontFamily: "var(--font-mono, monospace)" }}>{fcfa(current.cnps.ceiling)}</div></div>
            <div><div style={{ fontSize: 12, color: "var(--muted)" }}>IRPP (tranches)</div><div style={{ fontFamily: "var(--font-mono, monospace)" }}>{pctStr(current.irpp.t1_pct)}/{pctStr(current.irpp.t2_pct)}/{pctStr(current.irpp.t3_pct)}/{pctStr(current.irpp.t4_pct)}</div></div>
            <div><div style={{ fontSize: 12, color: "var(--muted)" }}>CAC</div><div style={{ fontFamily: "var(--font-mono, monospace)" }}>{pctStr(current.fiscal.cac_pct)}</div></div>
            <div><div style={{ fontSize: 12, color: "var(--muted)" }}>CFC (sal./pat.)</div><div style={{ fontFamily: "var(--font-mono, monospace)" }}>{pctStr(current.fiscal.cfc_sal_pct)} / {pctStr(current.fiscal.cfc_pat_pct)}</div></div>
            <div><div style={{ fontSize: 12, color: "var(--muted)" }}>Abattement IRPP</div><div style={{ fontFamily: "var(--font-mono, monospace)" }}>{pctStr(current.fiscal.abat_pct)} + {fcfa(current.fiscal.abat_fixe)}/an</div></div>
          </div>
        </>
      ) : (
        <p style={{ color: "var(--muted)", fontSize: 13, margin: 0 }}>Aucun barème en vigueur.</p>
      )}

      {canManage && (
        <div style={{ marginTop: 12 }}>
          {!draft ? (
            <Button variant="add" size="sm" type="button" onClick={() => setDraft(current ? toDraft(current) : null)} disabled={!current}>Nouvelle version du barème</Button>
          ) : (
            <div style={{ borderTop: "1px solid var(--line)", paddingTop: 12 }}>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 10 }}>
                <Field label="Date d'effet"><input type="date" value={draft.effective_from} onChange={(e) => setDraft({ ...draft, effective_from: e.target.value })} /></Field>
                <Field label="Libellé"><input value={draft.label ?? ""} onChange={(e) => setDraft({ ...draft, label: e.target.value })} /></Field>
                {numField("PVID salarial (0-1)", draft.cnps.vid_sal_pct, (n) => setDraft({ ...draft, cnps: { ...draft.cnps, vid_sal_pct: n } }))}
                {numField("PVID patronal (0-1)", draft.cnps.vid_pat_pct, (n) => setDraft({ ...draft, cnps: { ...draft.cnps, vid_pat_pct: n } }))}
                {numField("Prest. familiales (0-1)", draft.cnps.pf_pct, (n) => setDraft({ ...draft, cnps: { ...draft.cnps, pf_pct: n } }))}
                {numField("Accidents travail (0-1)", draft.cnps.at_pct, (n) => setDraft({ ...draft, cnps: { ...draft.cnps, at_pct: n } }))}
                {numField("Plafond CNPS (FCFA)", draft.cnps.ceiling, (n) => setDraft({ ...draft, cnps: { ...draft.cnps, ceiling: n } }))}
                {numField("Abattement IRPP (0-1)", draft.fiscal.abat_pct, (n) => setDraft({ ...draft, fiscal: { ...draft.fiscal, abat_pct: n } }))}
                {numField("Abatt. forfait (FCFA/an)", draft.fiscal.abat_fixe, (n) => setDraft({ ...draft, fiscal: { ...draft.fiscal, abat_fixe: n } }))}
                {numField("CAC (0-1)", draft.fiscal.cac_pct, (n) => setDraft({ ...draft, fiscal: { ...draft.fiscal, cac_pct: n } }))}
                {numField("CFC salarial (0-1)", draft.fiscal.cfc_sal_pct, (n) => setDraft({ ...draft, fiscal: { ...draft.fiscal, cfc_sal_pct: n } }))}
                {numField("CFC patronal (0-1)", draft.fiscal.cfc_pat_pct, (n) => setDraft({ ...draft, fiscal: { ...draft.fiscal, cfc_pat_pct: n } }))}
                {numField("FNE (0-1)", draft.fiscal.fne_pct, (n) => setDraft({ ...draft, fiscal: { ...draft.fiscal, fne_pct: n } }))}
                {numField("IRPP plafond T1", draft.irpp.t1_ceiling, (n) => setDraft({ ...draft, irpp: { ...draft.irpp, t1_ceiling: n } }))}
                {numField("IRPP taux T1 (0-1)", draft.irpp.t1_pct, (n) => setDraft({ ...draft, irpp: { ...draft.irpp, t1_pct: n } }))}
                {numField("IRPP plafond T2", draft.irpp.t2_ceiling, (n) => setDraft({ ...draft, irpp: { ...draft.irpp, t2_ceiling: n } }))}
                {numField("IRPP taux T2 (0-1)", draft.irpp.t2_pct, (n) => setDraft({ ...draft, irpp: { ...draft.irpp, t2_pct: n } }))}
                {numField("IRPP plafond T3", draft.irpp.t3_ceiling, (n) => setDraft({ ...draft, irpp: { ...draft.irpp, t3_ceiling: n } }))}
                {numField("IRPP taux T3 (0-1)", draft.irpp.t3_pct, (n) => setDraft({ ...draft, irpp: { ...draft.irpp, t3_pct: n } }))}
                {numField("IRPP taux T4 (0-1)", draft.irpp.t4_pct, (n) => setDraft({ ...draft, irpp: { ...draft.irpp, t4_pct: n } }))}
              </div>
              <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
                <Button variant="add" size="sm" type="button" onClick={saveVersion}>Enregistrer la version</Button>
                <Button variant="subtle" size="sm" type="button" onClick={() => setDraft(null)}>Annuler</Button>
              </div>
              <p style={{ fontSize: 12, color: "var(--muted)", marginTop: 6 }}>Les barèmes TC/RAV et divers reprennent la version précédente ; ajustez-les via une prochaine itération de l'écran si besoin.</p>
            </div>
          )}
        </div>
      )}

      {versions.length > 1 && (
        <details style={{ marginTop: 12 }}>
          <summary style={{ cursor: "pointer", fontSize: 13, color: "var(--muted)" }}>Historique des barèmes ({versions.length})</summary>
          <ul style={{ margin: "8px 0 0", paddingLeft: 18, fontSize: 13 }}>
            {versions.map((v) => <li key={v.id}><span style={{ fontFamily: "var(--font-mono, monospace)" }}>{v.effective_from}</span>{v.label ? ` — ${v.label}` : ""}</li>)}
          </ul>
        </details>
      )}

      {message && <div style={{ background: "var(--gold-soft, #f6efdc)", color: "var(--ink)", borderRadius: 8, padding: "8px 12px", fontSize: 13, marginTop: 12 }}>{message}</div>}
      {error && <div style={{ background: "#f8e3df", color: "var(--danger, #C24B3A)", borderRadius: 8, padding: "8px 12px", fontSize: 13, marginTop: 12 }}>{error}</div>}
    </Card>
  );
}
