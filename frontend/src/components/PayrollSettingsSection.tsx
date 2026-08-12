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
import { useI18n } from "../i18n";

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

export function PayrollSettingsSection({ canManage, collapsible, defaultOpen }: { canManage: boolean; collapsible?: boolean; defaultOpen?: boolean }) {
  const { t } = useI18n();
  const [internal, setInternal] = useState<boolean | null>(null);
  const [current, setCurrent] = useState<PayrollRateSet | null>(null);
  const [versions, setVersions] = useState<PayrollRateSet[]>([]);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [reason, setReason] = useState(""); // motif obligatoire (Lot 4, ch. 10)
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
      setMessage(r.internal_enabled ? t("pay.msg.internal_on", "Paie internalisée activée (l'ERP calcule les bulletins).") : t("pay.msg.internal_off", "Paie internalisée désactivée (export externe)."));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Changement impossible.");
    }
  }

  async function saveVersion() {
    if (!draft) return;
    if (reason.trim().length < 3) {
      setError(t("pay.reason_required", "Le motif de la modification est obligatoire (ex. loi de finances 2026, correction du taux CFC)."));
      return;
    }
    try {
      await createPayrollRateSet({ ...draft, change_reason: reason.trim() });
      setDraft(null);
      setReason("");
      setMessage(t("pay.msg.scale_saved", "Nouvelle version du barème enregistrée."));
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
      title={t("pay.settings", "Paramètres de paie (barème légal)")}
      icon={<IconAdmin />}
      subtitle={t("pay.settings_sub", "Barème camerounais paramétrable et versionné. La paie interne est activable/désactivable (D-007).")}
      collapsible={collapsible}
      defaultOpen={defaultOpen}
    >
      {/* Interrupteur d'internalisation */}
      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 12, marginBottom: 14, paddingBottom: 12, borderBottom: "1px solid var(--line)" }}>
        <div style={{ fontSize: 13 }}>
          {t("pay.internal", "Paie internalisée :")} <strong style={{ color: internal ? "var(--eclosion, #C89A1B)" : "var(--muted)" }}>{internal == null ? "…" : internal ? t("pay.internal_yes", "OUI (l'ERP calcule les bulletins)") : t("pay.internal_no", "NON (export externe)")}</strong>
        </div>
        {canManage && internal != null && <Button variant="edit" size="sm" type="button" onClick={toggleInternal}>{t("pay.toggle", "Basculer")}</Button>}
      </div>

      {/* Barème en vigueur */}
      {current ? (
        <>
          <div style={{ fontSize: 13, marginBottom: 6 }}>{t("pay.current_scale", "Barème en vigueur — effet le")} <span style={{ fontFamily: "var(--font-mono, monospace)" }}>{current.effective_from}</span>{current.label ? ` · ${current.label}` : ""}</div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 18, fontSize: 13 }}>
            <div><div style={{ fontSize: 12, color: "var(--muted)" }}>{t("pay.cnps_pvid", "CNPS PVID (sal./pat.)")}</div><div style={{ fontFamily: "var(--font-mono, monospace)" }}>{pctStr(current.cnps.vid_sal_pct)} / {pctStr(current.cnps.vid_pat_pct)}</div></div>
            <div><div style={{ fontSize: 12, color: "var(--muted)" }}>{t("pay.cnps_ceiling", "Plafond CNPS")}</div><div style={{ fontFamily: "var(--font-mono, monospace)" }}>{fcfa(current.cnps.ceiling)}</div></div>
            <div><div style={{ fontSize: 12, color: "var(--muted)" }}>{t("pay.irpp_brackets", "IRPP (tranches)")}</div><div style={{ fontFamily: "var(--font-mono, monospace)" }}>{pctStr(current.irpp.t1_pct)}/{pctStr(current.irpp.t2_pct)}/{pctStr(current.irpp.t3_pct)}/{pctStr(current.irpp.t4_pct)}</div></div>
            <div><div style={{ fontSize: 12, color: "var(--muted)" }}>{t("pay.cac", "CAC")}</div><div style={{ fontFamily: "var(--font-mono, monospace)" }}>{pctStr(current.fiscal.cac_pct)}</div></div>
            <div><div style={{ fontSize: 12, color: "var(--muted)" }}>{t("pay.cfc", "CFC (sal./pat.)")}</div><div style={{ fontFamily: "var(--font-mono, monospace)" }}>{pctStr(current.fiscal.cfc_sal_pct)} / {pctStr(current.fiscal.cfc_pat_pct)}</div></div>
            <div><div style={{ fontSize: 12, color: "var(--muted)" }}>{t("pay.irpp_abatement", "Abattement IRPP")}</div><div style={{ fontFamily: "var(--font-mono, monospace)" }}>{pctStr(current.fiscal.abat_pct)} + {fcfa(current.fiscal.abat_fixe)}{t("pay.per_year", "/an")}</div></div>
          </div>
        </>
      ) : (
        <p style={{ color: "var(--muted)", fontSize: 13, margin: 0 }}>{t("pay.no_scale", "Aucun barème en vigueur.")}</p>
      )}

      {canManage && (
        <div style={{ marginTop: 12 }}>
          {!draft ? (
            <Button variant="add" size="sm" type="button" onClick={() => setDraft(current ? toDraft(current) : null)} disabled={!current}>{t("pay.new_scale", "Nouvelle version du barème")}</Button>
          ) : (
            <div style={{ borderTop: "1px solid var(--line)", paddingTop: 12 }}>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 10 }}>
                <Field label={t("pay.effective_date", "Date d'effet")}><input type="date" value={draft.effective_from} onChange={(e) => setDraft({ ...draft, effective_from: e.target.value })} /></Field>
                <Field label={t("pay.label", "Libellé")}><input value={draft.label ?? ""} onChange={(e) => setDraft({ ...draft, label: e.target.value })} /></Field>
                <Field label={t("pay.change_reason", "Motif de la modification *")}><input value={reason} onChange={(e) => setReason(e.target.value)} placeholder={t("pay.change_reason_ph", "ex. Loi de finances 2026")} /></Field>
                {numField(t("pay.pvid_sal", "PVID salarial (0-1)"), draft.cnps.vid_sal_pct, (n) => setDraft({ ...draft, cnps: { ...draft.cnps, vid_sal_pct: n } }))}
                {numField(t("pay.pvid_pat", "PVID patronal (0-1)"), draft.cnps.vid_pat_pct, (n) => setDraft({ ...draft, cnps: { ...draft.cnps, vid_pat_pct: n } }))}
                {numField(t("pay.pf", "Prest. familiales (0-1)"), draft.cnps.pf_pct, (n) => setDraft({ ...draft, cnps: { ...draft.cnps, pf_pct: n } }))}
                {numField(t("pay.at", "Accidents travail (0-1)"), draft.cnps.at_pct, (n) => setDraft({ ...draft, cnps: { ...draft.cnps, at_pct: n } }))}
                {numField(t("pay.cnps_ceiling_field", "Plafond CNPS (FCFA)"), draft.cnps.ceiling, (n) => setDraft({ ...draft, cnps: { ...draft.cnps, ceiling: n } }))}
                {numField(t("pay.abat_pct", "Abattement IRPP (0-1)"), draft.fiscal.abat_pct, (n) => setDraft({ ...draft, fiscal: { ...draft.fiscal, abat_pct: n } }))}
                {numField(t("pay.abat_fixe", "Abatt. forfait (FCFA/an)"), draft.fiscal.abat_fixe, (n) => setDraft({ ...draft, fiscal: { ...draft.fiscal, abat_fixe: n } }))}
                {numField(t("pay.cac_field", "CAC (0-1)"), draft.fiscal.cac_pct, (n) => setDraft({ ...draft, fiscal: { ...draft.fiscal, cac_pct: n } }))}
                {numField(t("pay.cfc_sal", "CFC salarial (0-1)"), draft.fiscal.cfc_sal_pct, (n) => setDraft({ ...draft, fiscal: { ...draft.fiscal, cfc_sal_pct: n } }))}
                {numField(t("pay.cfc_pat", "CFC patronal (0-1)"), draft.fiscal.cfc_pat_pct, (n) => setDraft({ ...draft, fiscal: { ...draft.fiscal, cfc_pat_pct: n } }))}
                {numField(t("pay.fne", "FNE (0-1)"), draft.fiscal.fne_pct, (n) => setDraft({ ...draft, fiscal: { ...draft.fiscal, fne_pct: n } }))}
                {numField(t("pay.irpp_t1_ceiling", "IRPP plafond T1"), draft.irpp.t1_ceiling, (n) => setDraft({ ...draft, irpp: { ...draft.irpp, t1_ceiling: n } }))}
                {numField(t("pay.irpp_t1_pct", "IRPP taux T1 (0-1)"), draft.irpp.t1_pct, (n) => setDraft({ ...draft, irpp: { ...draft.irpp, t1_pct: n } }))}
                {numField(t("pay.irpp_t2_ceiling", "IRPP plafond T2"), draft.irpp.t2_ceiling, (n) => setDraft({ ...draft, irpp: { ...draft.irpp, t2_ceiling: n } }))}
                {numField(t("pay.irpp_t2_pct", "IRPP taux T2 (0-1)"), draft.irpp.t2_pct, (n) => setDraft({ ...draft, irpp: { ...draft.irpp, t2_pct: n } }))}
                {numField(t("pay.irpp_t3_ceiling", "IRPP plafond T3"), draft.irpp.t3_ceiling, (n) => setDraft({ ...draft, irpp: { ...draft.irpp, t3_ceiling: n } }))}
                {numField(t("pay.irpp_t3_pct", "IRPP taux T3 (0-1)"), draft.irpp.t3_pct, (n) => setDraft({ ...draft, irpp: { ...draft.irpp, t3_pct: n } }))}
                {numField(t("pay.irpp_t4_pct", "IRPP taux T4 (0-1)"), draft.irpp.t4_pct, (n) => setDraft({ ...draft, irpp: { ...draft.irpp, t4_pct: n } }))}
              </div>
              <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
                <Button variant="add" size="sm" type="button" onClick={saveVersion}>{t("pay.save_version", "Enregistrer la version")}</Button>
                <Button variant="subtle" size="sm" type="button" onClick={() => { setDraft(null); setReason(""); }}>{t("pay.cancel", "Annuler")}</Button>
              </div>
              <p style={{ fontSize: 12, color: "var(--muted)", marginTop: 6 }}>{t("pay.scale_note", "Les barèmes TC/RAV et divers reprennent la version précédente ; ajustez-les via une prochaine itération de l'écran si besoin.")}</p>
            </div>
          )}
        </div>
      )}

      {versions.length > 0 && (
        <details style={{ marginTop: 12 }} open={versions.length > 1}>
          <summary style={{ cursor: "pointer", fontSize: 13, color: "var(--muted)" }}>{t("pay.scale_history", "Historique des versions du barème")} ({versions.length})</summary>
          <div style={{ overflowX: "auto", marginTop: 8 }}>
            <table style={{ borderCollapse: "collapse", fontSize: 12.5, minWidth: 520 }}>
              <thead><tr style={{ color: "var(--muted)", textAlign: "left", fontSize: 11.5 }}>
                <th style={{ padding: "4px 8px" }}>{t("pay.effective_date", "Date d'effet")}</th>
                <th style={{ padding: "4px 8px" }}>{t("pay.label", "Libellé")}</th>
                <th style={{ padding: "4px 8px" }}>{t("pay.change_reason", "Motif")}</th>
                <th style={{ padding: "4px 8px" }}>{t("pay.created_on", "Créée le")}</th>
              </tr></thead>
              <tbody>
                {versions.map((v) => (
                  <tr key={v.id} style={{ borderTop: "1px solid var(--line)" }}>
                    <td style={{ padding: "4px 8px", fontFamily: "var(--font-mono, monospace)", whiteSpace: "nowrap" }}>
                      {v.effective_from}
                      {current && v.id === current.id && <span style={{ marginLeft: 6, color: "var(--eclosion, #C89A1B)", fontWeight: 700 }}>● en vigueur</span>}
                    </td>
                    <td style={{ padding: "4px 8px" }}>{v.label ?? "—"}</td>
                    <td style={{ padding: "4px 8px", color: "var(--muted)" }}>{v.change_reason ?? "—"}</td>
                    <td style={{ padding: "4px 8px", fontFamily: "var(--font-mono, monospace)", color: "var(--muted)", whiteSpace: "nowrap" }}>{v.created_at ? new Date(v.created_at).toLocaleDateString("fr-FR") : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      )}

      {message && <div style={{ background: "var(--gold-soft, #f6efdc)", color: "var(--ink)", borderRadius: 8, padding: "8px 12px", fontSize: 13, marginTop: 12 }}>{message}</div>}
      {error && <div style={{ background: "#f8e3df", color: "var(--danger, #C24B3A)", borderRadius: 8, padding: "8px 12px", fontSize: 13, marginTop: 12 }}>{error}</div>}
    </Card>
  );
}
