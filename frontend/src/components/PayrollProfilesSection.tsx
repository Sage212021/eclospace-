import { useEffect, useMemo, useState } from "react";
import {
  getPayrollProfile,
  getPayslip,
  getMonthlyDeductions,
  saveMonthlyDeductions,
  setAbsenceAutoDeduction,
  getPayrollRateSet,
  previewPayslipEmail,
  savePayrollProfile,
  sendPayslipEmail,
  getPayslipDispatches,
  createDocument,
  uploadDocumentVersion,
  type Employee,
  type PayslipDispatch,
  type PayrollProfileInput,
  type PayslipResult,
  type PayrollRateSet,
  type Payslip,
} from "../api/client";
import { computePayslip, ratesFromRateSet } from "../lib/payrollEngine";
import { Card } from "./Card";
import { Field } from "./Modal";
import { Button } from "./Button";
import { EmailModal } from "./EmailModal";
import { buildPayslipPdfBase64, printPayslipPdf } from "../lib/payslipPdf";
import { IconAdmin } from "./icons";
import { useI18n } from "../i18n";

// Fiche paie par employé (D-007, incrément 2) : données propres au bulletin
// (matricule, N° CNPS, NIU, brut contractuel, parts fiscales, ancienneté…).

const EMPTY: PayrollProfileInput = {
  matricule: "",
  email: "",
  cnps_number: "",
  niu: "",
  category: "",
  payment_mode: "",
  account_number: "",
  gross_contractual: 0,
  base_pct: 0.6,
  fiscal_base: null,
  fiscal_parts: 1,
  apply_fiscal_parts: true,
  seniority_years: 0,
  seniority_rate: null,
  seniority_threshold: null,
  apply_seniority: false,
};

const DISPATCH_LABEL: Record<string, string> = { sent: "Envoyé", failed: "Échec", pending: "En attente" };
function dispatchChip(status: string): React.CSSProperties {
  const map: Record<string, [string, string]> = { sent: ["#DDF0E5", "#2E6B4F"], failed: ["#F7E2DE", "#C24B3A"], pending: ["#F7E7DA", "#C4661F"] };
  const [bg, fg] = map[status] ?? ["#eee", "#555"];
  return { background: bg, color: fg, fontSize: 11, fontWeight: 700, borderRadius: 6, padding: "2px 8px", whiteSpace: "nowrap" };
}

function fcfa(n: number): string {
  return `${Math.round(n).toLocaleString("fr-FR")} FCFA`;
}

function SlipRow({ label, value, strong, tone }: { label: string; value: number; strong?: boolean; tone?: "gold" }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", gap: 8, padding: "4px 8px", background: "var(--paper)", borderRadius: 6 }}>
      <span style={{ color: "var(--muted)" }}>{label}</span>
      <span style={{ fontFamily: "var(--font-mono, monospace)", fontWeight: strong ? 700 : 400, color: tone === "gold" ? "var(--eclosion, #d9b21a)" : "var(--ink)" }}>{fcfa(value)}</span>
    </div>
  );
}

export function PayrollProfilesSection({ employees, canManage, collapsible, defaultOpen }: { employees: Employee[]; canManage: boolean; collapsible?: boolean; defaultOpen?: boolean }) {
  const { t, lang } = useI18n();
  const [employeeId, setEmployeeId] = useState("");
  const [form, setForm] = useState<PayrollProfileInput>(EMPTY);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [period, setPeriod] = useState(new Date().toISOString().slice(0, 7));
  const [slip, setSlip] = useState<PayslipResult | null>(null);
  // Barème en vigueur pour la période, servant à l'aperçu EN DIRECT du bulletin.
  const [rateSet, setRateSet] = useState<PayrollRateSet | null>(null);
  // Retenue d'absence SAISIE PAR LE RH (règle métier 07/08/2026 : le cahier de
  // présence est un simple témoin, jamais relié automatiquement au calcul).
  const [manualRetenue, setManualRetenue] = useState(0);
  // Temps 2 : retenue automatique des absences non payées (interrupteur RH) et
  // montant suggéré (jours d'absences non payées × salaire journalier).
  const [autoAbs, setAutoAbs] = useState<{ enabled: boolean; suggested: number; days: number }>({ enabled: false, suggested: 0, days: 0 });
  // Retenues internes du mois saisies par le RH (prêts, avances, retards…).
  // Modèle moteur : elles réduisent le NET (pas le brut, ni l'assiette d'impôt).
  const [internal, setInternal] = useState({ avance: 0, pret: 0, retard: 0, autres: 0 });
  // Gains variables du mois (imposables), synchronisés avec la grille mensuelle.
  const [gains, setGains] = useState({ primes: 0, heures_sup: 0 });
  // Sanction : saisie uniquement dans la grille mensuelle → lecture seule ici,
  // mais prise en compte dans le net. Verrou dès que le mois est soumis/validé.
  const [sanction, setSanction] = useState(0);
  // Lignes libres saisies dans la grille : reprises telles quelles pour que
  // l'aperçu/PDF du bulletin unitaire égale exactement la grille mensuelle.
  const [extraLines, setExtraLines] = useState<{ label: string; kind: "gain" | "retenue"; amount: number }[]>([]);
  const [dedLocked, setDedLocked] = useState(false);
  const [dedStatus, setDedStatus] = useState<"brouillon" | "soumis_dg" | "valide" | null>(null);
  const [emailOpen, setEmailOpen] = useState(false);
  const [dispatches, setDispatches] = useState<PayslipDispatch[]>([]);
  const loadDispatches = () => getPayslipDispatches(employeeId, period).then(setDispatches).catch(() => setDispatches([]));
  // Verrou après enregistrement : une fiche enregistrée n'est plus modifiable
  // sans passer par « Modifier », qui exige un motif (justificatif facultatif).
  const [locked, setLocked] = useState(false);
  const [modifyOpen, setModifyOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [justifFile, setJustifFile] = useState<File | null>(null);

  useEffect(() => {
    setSlip(null);
    setModifyOpen(false);
    setReason("");
    setJustifFile(null);
    if (!employeeId) {
      setLocked(false);
      return;
    }
    getPayrollProfile(employeeId)
      .then((r) => {
        if (r.profile) {
          const { base_salary: _b, complements: _c, ...rest } = r.profile;
          setForm(rest);
          setLocked(true); // fiche déjà enregistrée → verrouillée
        } else {
          setForm(EMPTY);
          setLocked(false); // nouvelle fiche → éditable
        }
        setMessage(null);
        setError(null);
      })
      .catch((err) => setError(err instanceof Error ? err.message : "Chargement impossible."));
  }, [employeeId]);

  async function save() {
    if (!employeeId) return;
    try {
      await savePayrollProfile(
        employeeId,
        {
          ...form,
          matricule: form.matricule || null,
          cnps_number: form.cnps_number || null,
          niu: form.niu || null,
          category: form.category || null,
          payment_mode: form.payment_mode || null,
          account_number: form.account_number || null,
        },
        reason || undefined,
      );
      // Justificatif facultatif : versé aux pièces de l'employé (au mieux ; en
      // cas de droit « documents » manquant, la fiche reste enregistrée).
      if (justifFile) {
        try {
          const doc = await createDocument({ entity_type: "employee", entity_id: employeeId, category: "justificatif_paie", title: `Justificatif modification paie — ${new Date().toLocaleDateString("fr-FR")}` });
          await uploadDocumentVersion(doc.id, justifFile, reason || "Justificatif de modification");
        } catch {
          setError("Fiche enregistrée, mais le justificatif n'a pu être joint (droit « documents » requis).");
        }
      }
      setMessage(t("pay.msg.profile_saved", "Fiche paie enregistrée."));
      if (!justifFile) setError(null);
      setLocked(true);
      setReason("");
      setJustifFile(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Enregistrement impossible.");
    }
  }

  // Chargement silencieux du barème (pour la période) et de la retenue d'absence,
  // à chaque changement d'employé ou de période : alimente l'aperçu en direct.
  useEffect(() => {
    getPayrollRateSet(`${period}-01`).then(setRateSet).catch(() => setRateSet(null));
    const resetDed = () => {
      setManualRetenue(0);
      setInternal({ avance: 0, pret: 0, retard: 0, autres: 0 });
      setGains({ primes: 0, heures_sup: 0 });
      setSanction(0);
      setExtraLines([]);
      setDedLocked(false);
      setDedStatus(null);
    };
    if (!employeeId) {
      resetDed();
      setSlip(null);
      return;
    }
    // Éléments du mois (reliés à la grille mensuelle) : on les re-propose (sinon 0).
    getMonthlyDeductions(employeeId, period)
      .then((d) => {
        setAutoAbs({ enabled: d.auto_absence_enabled, suggested: d.suggested_retenue_absence, days: d.unpaid_absence_days });
        // Mode automatique : si aucune retenue n'a encore été saisie, on pré-remplit
        // avec le montant calculé (le RH peut toujours le corriger avant d'enregistrer).
        setManualRetenue(d.auto_absence_enabled && d.retenue_absence === 0 && !d.saved ? d.suggested_retenue_absence : d.retenue_absence);
        setInternal({ avance: d.avance, pret: d.pret, retard: d.retard, autres: d.autres });
        setGains({ primes: d.primes, heures_sup: d.heures_sup });
        setSanction(d.sanction);
        setExtraLines(d.extra_lines ?? []);
        setDedLocked(d.locked);
        setDedStatus(d.status);
      })
      .catch(resetDed);
    getPayslip(employeeId, period)
      .then((r) => {
        setSlip(r);
      })
      .catch(() => {
        // Attendu tant que la fiche n'est pas enregistrée.
        setSlip(null);
      });
  }, [employeeId, period]);

  // Bouton « Actualiser » : rafraîchit le barème (serveur).
  async function computeSlip() {
    if (!employeeId) return;
    try {
      const r = await getPayslip(employeeId, period, { retenue_absence: manualRetenue, ...internal, autres: internal.autres + sanction });
      setSlip(r);
      setError(null);
      loadDispatches();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Calcul impossible.");
    }
  }

  // Enregistre les retenues du mois pour cet employé (mémorisées, re-proposées).
  async function saveDeductions() {
    if (!employeeId) return;
    try {
      const d = await saveMonthlyDeductions(employeeId, period, { primes: gains.primes, heures_sup: gains.heures_sup, retenue_absence: manualRetenue, ...internal });
      setDedStatus(d.status);
      setDedLocked(d.locked);
      setMessage(t("pay.deductions_saved", "Éléments du mois enregistrés (grille mensuelle mise à jour)."));
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("pay.deductions_save_err", "Enregistrement des retenues impossible."));
    }
  }

  const base = Math.round(form.gross_contractual * form.base_pct);

  // Aperçu du bulletin EN DIRECT : recalculé à chaque frappe (moteur porté côté
  // navigateur). Supprime l'effet « net figé » : le net à payer suit les %/montants.
  const liveSlip = useMemo<Payslip | null>(() => {
    if (!rateSet) return null;
    const gross = form.gross_contractual;
    const b = Math.round(gross * form.base_pct);
    // Mêmes règles que la grille mensuelle (computeMonthlyLine) : primes + heures
    // sup + gains libres = imposables (brut & assiette) ; sanction + retenues
    // libres s'ajoutent aux « autres » (net).
    const extraGains = extraLines.filter((e) => e.kind === "gain").reduce((s, e) => s + e.amount, 0);
    const extraRetenues = extraLines.filter((e) => e.kind === "retenue").reduce((s, e) => s + e.amount, 0);
    const extraTaxable = gains.primes + gains.heures_sup + extraGains;
    return computePayslip(
      {
        base: b,
        complements: Math.round(gross - b) + extraTaxable,
        fiscalBase: (form.fiscal_base != null ? form.fiscal_base : gross) + extraTaxable,
        fiscalParts: form.fiscal_parts,
        applyFiscalParts: form.apply_fiscal_parts,
        seniorityYears: form.seniority_years,
        seniorityRate: form.seniority_rate,
        seniorityThreshold: form.seniority_threshold ?? 0,
        applySeniority: form.apply_seniority,
        retenueAbsence: manualRetenue,
        internal: { ...internal, autres: internal.autres + sanction + extraRetenues },
      },
      ratesFromRateSet(rateSet),
    );
  }, [form, rateSet, manualRetenue, internal, sanction, gains, extraLines]);

  // Valeurs affichées / imprimées / envoyées : l'aperçu en direct s'il existe,
  // sinon le calcul serveur.
  const displaySlip: Payslip | null = liveSlip ?? slip?.payslip ?? null;
  const employee = employees.find((e) => e.id === employeeId);
  const employeeName = employee ? `${employee.firstName} ${employee.lastName}` : slip?.employee.name ?? "";
  const rateEffective = slip?.rate_set_effective_from ?? rateSet?.effective_from ?? null;
  // Taux d'affichage du bulletin (colonne « Taux » du modèle moteur), dérivés du
  // barème en vigueur. Pas de retenue interne sur un bulletin unitaire (les
  // avances/prêts/retards se saisissent dans la grille mensuelle).
  const slipRates = rateSet
    ? { vid_sal: rateSet.cnps.vid_sal_pct, vid_pat: rateSet.cnps.vid_pat_pct, pf: rateSet.cnps.pf_pct, at: rateSet.cnps.at_pct, cfc_sal: rateSet.fiscal.cfc_sal_pct, cfc_pat: rateSet.fiscal.cfc_pat_pct, fne: rateSet.fiscal.fne_pct, cac: rateSet.fiscal.cac_pct }
    : null;
  const slipMeta = {
    matricule: form.matricule || null,
    cnps_number: form.cnps_number || null,
    // NIU : priorité à la fiche RH (identité de l'employé), repli sur le profil de paie.
    niu: employee?.niu || form.niu || null,
    fiscal_parts: form.fiscal_parts,
    department: employee?.department?.name ?? null,
    position: employee?.position ?? null,
    hire_date: employee?.hireDate ? employee.hireDate.slice(0, 10) : null,
    birth_date: employee?.birthDate ? employee.birthDate.slice(0, 10) : null,
    situation_familiale: employee?.maritalStatus ?? null,
    children_count: employee?.childrenCount ?? null,
    phone: employee?.phone ?? null,
    emergency_contact: employee?.emergencyContact ?? null,
    leave_taken: employee?.leaveTakenDays != null ? Number(employee.leaveTakenDays) : null,
    category: form.category || null,
    email: form.email || null,
    payment_mode: form.payment_mode || null,
    account_number: form.account_number || null,
    rates: slipRates,
    // Comme la grille : sanction fondue dans « autres », lignes libres itemisées.
    internal: { ...internal, autres: internal.autres + sanction },
    extra_lines: extraLines,
  };

  const readOnly = !canManage || locked;
  function txt(label: string, key: keyof PayrollProfileInput) {
    return (
      <Field label={label}>
        <input value={(form[key] as string) ?? ""} onChange={(e) => setForm({ ...form, [key]: e.target.value })} disabled={readOnly} />
      </Field>
    );
  }
  function n(label: string, key: keyof PayrollProfileInput, step = "any") {
    return (
      <Field label={label}>
        <input type="number" step={step} value={(form[key] as number) ?? 0} onChange={(e) => setForm({ ...form, [key]: Number(e.target.value) })} disabled={readOnly} style={{ fontFamily: "var(--font-mono, monospace)" }} />
      </Field>
    );
  }

  return (
    <Card title={t("pay.profiles", "Fiches paie & bulletin (par employé)")} icon={<IconAdmin />} subtitle={t("pay.profiles_sub", "Données de rémunération, aperçu du bulletin en direct, impression et envoi.")} collapsible={collapsible} defaultOpen={defaultOpen}>
      <Field label={t("pay.employee", "Employé")}>
        <select value={employeeId} onChange={(e) => setEmployeeId(e.target.value)}>
          <option value="">{t("pay.choose_employee", "— Choisir un employé —")}</option>
          {employees.map((e) => <option key={e.id} value={e.id}>{e.firstName} {e.lastName}</option>)}
        </select>
      </Field>

      {employeeId && (
        <>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 10, marginTop: 10 }}>
            {txt(t("pay.matricule", "Matricule"), "matricule")}
            {txt(t("pay.employee_email", "E-mail du salarié (bulletin)"), "email")}
            {txt(t("pay.cnps_number", "N° CNPS"), "cnps_number")}
            {txt(t("pay.niu", "NIU (contribuable)"), "niu")}
            {txt(t("pay.category", "Catégorie / échelon"), "category")}
            {n(t("pay.gross_contractual", "Brut contractuel (FCFA)"), "gross_contractual")}
            {n(t("pay.base_pct", "% salaire de base (0-1)"), "base_pct")}
            {n(t("pay.fiscal_parts", "Parts fiscales"), "fiscal_parts")}
            {n(t("pay.seniority_years", "Ancienneté (ans)"), "seniority_years", "1")}
            {txt(t("pay.payment_mode", "Mode de paiement"), "payment_mode")}
            {txt(t("pay.account_number", "N° de compte"), "account_number")}
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 16, marginTop: 10, fontSize: 13 }}>
            <label style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
              <input type="checkbox" checked={form.apply_fiscal_parts} disabled={readOnly} onChange={(e) => setForm({ ...form, apply_fiscal_parts: e.target.checked })} /> {t("pay.apply_fiscal_parts", "Appliquer les parts fiscales")}
            </label>
            <label style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
              <input type="checkbox" checked={form.apply_seniority} disabled={readOnly} onChange={(e) => setForm({ ...form, apply_seniority: e.target.checked })} /> {t("pay.apply_seniority", "Appliquer la prime d'ancienneté")}
            </label>
          </div>
          <div style={{ marginTop: 10, fontSize: 13, color: "var(--muted)" }}>
            {t("pay.base_computed", "Salaire de base calculé :")} <strong style={{ fontFamily: "var(--font-mono, monospace)", color: "var(--ink)" }}>{fcfa(base)}</strong> · {t("pay.complements", "Compléments :")} <strong style={{ fontFamily: "var(--font-mono, monospace)", color: "var(--ink)" }}>{fcfa(form.gross_contractual - base)}</strong>
          </div>
          {canManage && (
            <div style={{ marginTop: 10, display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
              {locked ? (
                <>
                  <Button variant="edit" size="sm" type="button" onClick={() => setModifyOpen(true)}>{t("pay.modify_profile", "Modifier")}</Button>
                  <Button variant="view" size="sm" type="button" onClick={() => setEmployeeId("")}>{t("pay.back", "Retour")}</Button>
                  <span style={{ fontSize: 12, color: "var(--muted)" }}>{t("pay.locked_hint", "Fiche enregistrée — verrouillée.")}</span>
                </>
              ) : (
                <>
                  <Button variant="add" size="sm" type="button" onClick={save}>{t("pay.save_profile", "Enregistrer la fiche paie")}</Button>
                  {reason
                    ? <span style={{ fontSize: 12, color: "var(--muted)" }}>{t("pay.modifying", "Modification en cours (motif enregistré).")}</span>
                    : <span style={{ fontSize: 12, color: "var(--muted)" }}>{t("pay.save_hint", "Après enregistrement, la fiche se verrouille : « Modifier » (avec motif) et « Retour » apparaîtront.")}</span>}
                </>
              )}
            </div>
          )}

          {/* Fenêtre « Modifier » : motif obligatoire, justificatif facultatif. */}
          {modifyOpen && (
            <div style={{ position: "fixed", inset: 0, background: "rgba(11,11,12,.4)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 60, padding: 16 }} onClick={() => setModifyOpen(false)}>
              <div style={{ background: "var(--card, #fff)", borderRadius: 12, padding: 18, maxWidth: 460, width: "100%" }} onClick={(e) => e.stopPropagation()}>
                <div style={{ fontFamily: "var(--font-title)", fontSize: 16, marginBottom: 4 }}>{t("pay.modify_title", "Modifier la fiche paie")}</div>
                <p style={{ fontSize: 12.5, color: "var(--muted)", margin: "0 0 12px" }}>{t("pay.modify_sub", "Indiquez le motif de la modification. Vous pouvez joindre un justificatif (facultatif).")}</p>
                <Field label={t("pay.reason", "Motif de la modification (obligatoire)")}>
                  <textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={3} placeholder={t("pay.reason_ph", "Ex. : correction du brut contractuel après avenant.")} />
                </Field>
                <div style={{ marginTop: 10 }}>
                  <Field label={t("pay.justif", "Justificatif (facultatif)")}>
                    <input type="file" onChange={(e) => setJustifFile(e.target.files?.[0] ?? null)} />
                  </Field>
                  {justifFile && <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 4 }}>📎 {justifFile.name}</div>}
                </div>
                <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 14 }}>
                  <Button variant="view" size="sm" type="button" onClick={() => { setModifyOpen(false); setReason(""); setJustifFile(null); }}>{t("pay.cancel", "Annuler")}</Button>
                  <Button variant="add" size="sm" type="button" disabled={!reason.trim()} onClick={() => { setModifyOpen(false); setLocked(false); }}>{t("pay.unlock", "Déverrouiller pour modifier")}</Button>
                </div>
              </div>
            </div>
          )}

          {/* Aperçu du bulletin EN DIRECT (moteur brut → net). Le net à payer suit
              chaque modification de %/montant — plus d'effet « figé ». */}
          <div style={{ marginTop: 16, borderTop: "1px solid var(--line)", paddingTop: 12 }}>
            <div style={{ display: "flex", flexWrap: "wrap", alignItems: "flex-end", gap: 8 }}>
              <Field label={t("pay.period_field", "Mois du bulletin (AAAA-MM)")}><input type="month" value={period} onChange={(e) => setPeriod(e.target.value)} style={{ fontFamily: "var(--font-mono, monospace)" }} /></Field>
              <Button variant="edit" size="sm" type="button" onClick={computeSlip}>{t("pay.compute_slip", "Actualiser (barème)")}</Button>
              {liveSlip && (
                <span style={{ fontSize: 11.5, fontWeight: 700, color: "var(--eclosion-dark, #9a7a12)", background: "var(--eclosion-soft)", borderRadius: 999, padding: "3px 10px" }}>
                  ● {t("pay.live", "Aperçu en direct")}
                </span>
              )}
            </div>
            {/* Gains variables du mois (imposables), synchronisés avec la grille. */}
            <div style={{ marginTop: 10 }}>
              <div style={{ fontSize: 12.5, fontWeight: 600, color: "var(--ink)", marginBottom: 6 }}>{t("pay.gains_title", "Gains du mois (saisie RH)")}</div>
              <div style={{ display: "flex", flexWrap: "wrap", alignItems: "flex-end", gap: 8 }}>
                <Field label={t("pay.gain_primes", "Primes du mois")}>
                  <input type="number" min={0} step={100} disabled={dedLocked} value={gains.primes} onChange={(e) => setGains({ ...gains, primes: Math.max(Number(e.target.value) || 0, 0) })} style={{ fontFamily: "var(--font-mono, monospace)", width: 120 }} />
                </Field>
                <Field label={t("pay.gain_heures_sup", "Heures sup (montant)")}>
                  <input type="number" min={0} step={100} disabled={dedLocked} value={gains.heures_sup} onChange={(e) => setGains({ ...gains, heures_sup: Math.max(Number(e.target.value) || 0, 0) })} style={{ fontFamily: "var(--font-mono, monospace)", width: 120 }} />
                </Field>
              </div>
              <p style={{ fontSize: 12, color: "var(--muted)", marginTop: 4 }}>{t("pay.gains_hint", "Imposables : ils s'ajoutent au salaire brut et à l'assiette d'impôt (comme dans la grille mensuelle).")}</p>
            </div>
            {/* Retenues du mois saisies par le RH : l'absence réduit le brut (avant
                impôt) ; les prêts/avances/retards/autres réduisent le NET. Chaque
                montant recalcule l'aperçu en direct. */}
            <div style={{ marginTop: 10 }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, flexWrap: "wrap", marginBottom: 6 }}>
                <div style={{ fontSize: 12.5, fontWeight: 600, color: "var(--ink)" }}>{t("pay.deductions_title", "Retenues du mois (saisie RH)")}</div>
                {canManage && (
                  <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: "var(--muted)" }} title="Quand c'est activé, la retenue d'absence est calculée à partir des absences non payées validées et pré-remplie ; sinon, saisie manuelle.">
                    <input
                      type="checkbox"
                      checked={autoAbs.enabled}
                      onChange={async (e) => {
                        try { const r = await setAbsenceAutoDeduction(e.target.checked); setAutoAbs((a) => ({ ...a, enabled: r.enabled })); }
                        catch (err) { setError(err instanceof Error ? err.message : "Réglage impossible."); }
                      }}
                    />
                    Retenue des absences automatique
                  </label>
                )}
              </div>
              <div style={{ display: "flex", flexWrap: "wrap", alignItems: "flex-end", gap: 8 }}>
                <Field label={t("pay.manual_deduction", "Retenue d'absence")}>
                  <input type="number" min={0} step={100} disabled={dedLocked} value={manualRetenue} onChange={(e) => setManualRetenue(Math.max(Number(e.target.value) || 0, 0))} style={{ fontFamily: "var(--font-mono, monospace)", width: 120 }} />
                  {autoAbs.enabled && (
                    <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 3, display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                      <span>Auto : {autoAbs.suggested.toLocaleString("fr-FR")} F ({autoAbs.days} j non payés)</span>
                      {!dedLocked && autoAbs.suggested !== manualRetenue && (
                        <button type="button" onClick={() => setManualRetenue(autoAbs.suggested)} style={{ background: "none", border: "1px solid var(--line)", borderRadius: 5, padding: "1px 7px", fontSize: 11, fontWeight: 600, color: "var(--eclosion-dark, #9a7a12)", cursor: "pointer" }}>Appliquer</button>
                      )}
                    </div>
                  )}
                </Field>
                <Field label={t("pay.int_avance", "Avance sur salaire")}>
                  <input type="number" min={0} step={100} disabled={dedLocked} value={internal.avance} onChange={(e) => setInternal({ ...internal, avance: Math.max(Number(e.target.value) || 0, 0) })} style={{ fontFamily: "var(--font-mono, monospace)", width: 120 }} />
                </Field>
                <Field label={t("pay.int_pret", "Remboursement prêt")}>
                  <input type="number" min={0} step={100} disabled={dedLocked} value={internal.pret} onChange={(e) => setInternal({ ...internal, pret: Math.max(Number(e.target.value) || 0, 0) })} style={{ fontFamily: "var(--font-mono, monospace)", width: 120 }} />
                </Field>
                <Field label={t("pay.int_retard", "Retard non justifié")}>
                  <input type="number" min={0} step={100} disabled={dedLocked} value={internal.retard} onChange={(e) => setInternal({ ...internal, retard: Math.max(Number(e.target.value) || 0, 0) })} style={{ fontFamily: "var(--font-mono, monospace)", width: 120 }} />
                </Field>
                <Field label={t("pay.int_autres", "Autres retenues")}>
                  <input type="number" min={0} step={100} disabled={dedLocked} value={internal.autres} onChange={(e) => setInternal({ ...internal, autres: Math.max(Number(e.target.value) || 0, 0) })} style={{ fontFamily: "var(--font-mono, monospace)", width: 120 }} />
                </Field>
                {sanction > 0 && (
                  <Field label={t("pay.int_sanction", "Sanction (grille)")}>
                    <input type="number" value={sanction} readOnly disabled style={{ fontFamily: "var(--font-mono, monospace)", width: 120 }} />
                  </Field>
                )}
                {canManage && !dedLocked && (
                  <Button variant="add" size="sm" type="button" onClick={saveDeductions}>{t("pay.save_deductions", "Enregistrer les retenues du mois")}</Button>
                )}
              </div>
              {dedLocked ? (
                <p style={{ fontSize: 12, color: "var(--alert, #C4661F)", marginTop: 4 }}>
                  {dedStatus === "valide"
                    ? t("pay.deductions_locked_valide", "Mois validé par la Direction : les retenues ne sont plus modifiables. Rouvrez le mois dans la grille mensuelle pour corriger.")
                    : t("pay.deductions_locked_soumis", "Mois soumis au Directeur général : en attente de validation, les retenues ne sont plus modifiables ici.")}
                </p>
              ) : (
                <p style={{ fontSize: 12, color: "var(--muted)", marginTop: 4 }}>{t("pay.deductions_hint", "Retenues reliées à la grille mensuelle : ce que vous enregistrez ici met à jour la préparation de paie du mois (et inversement). Modifiables tant que le mois n'est pas soumis au DG.")}</p>
              )}
            </div>
            {!rateSet && <p style={{ fontSize: 12, color: "var(--alert, #C4661F)", marginTop: 8 }}>{t("pay.no_scale_period", "Aucun barème en vigueur pour ce mois : renseignez le barème dans « Paramètres de paie ».")}</p>}
            {displaySlip && (
              <div style={{ marginTop: 12, display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))", gap: 8, fontSize: 13 }}>
                <SlipRow label={t("pay.slip.base", "Salaire de base")} value={displaySlip.base} />
                <SlipRow label={t("pay.slip.complements", "Compléments (primes du poste)")} value={displaySlip.complements} />
                <SlipRow label={t("pay.slip.seniority", "Prime d'ancienneté")} value={displaySlip.prime_anciennete} />
                <SlipRow label={t("pay.slip.gross", "Salaire brut")} value={displaySlip.salaire_brut} strong />
                <SlipRow label={t("pay.slip.cnps_base", "Assiette CNPS")} value={displaySlip.assiette_cnps} />
                <SlipRow label={t("pay.slip.pvid_emp", "PVID salarié")} value={displaySlip.pvid_salarie} />
                <SlipRow label={t("pay.slip.cfc_emp", "CFC salarié")} value={displaySlip.cfc_salarie} />
                <SlipRow label={t("pay.slip.communal_tax", "Taxe communale")} value={displaySlip.taxe_communale} />
                <SlipRow label={t("pay.slip.rav", "RAV")} value={displaySlip.rav} />
                <SlipRow label={t("pay.slip.irpp_cac", "IRPP + CAC")} value={displaySlip.irpp_cac} />
                <SlipRow label={t("pay.slip.total_emp_deductions", "Total retenues salariales")} value={displaySlip.total_retenues_salariales} />
                <SlipRow label={t("pay.slip.absence_deduction", "Retenue absence")} value={displaySlip.retenue_absence} />
                <SlipRow label={t("pay.int_avance", "Avance sur salaire")} value={internal.avance} />
                <SlipRow label={t("pay.int_pret", "Remboursement prêt")} value={internal.pret} />
                <SlipRow label={t("pay.int_retard", "Retard non justifié")} value={internal.retard} />
                <SlipRow label={t("pay.int_autres", "Autres retenues")} value={internal.autres} />
                {sanction > 0 && <SlipRow label={t("pay.int_sanction", "Sanction (grille)")} value={sanction} />}
                <SlipRow label={t("pay.slip.total_internal", "Total retenues internes")} value={displaySlip.total_retenues_internes} />
                <SlipRow label={t("pay.slip.net", "NET À PAYER")} value={displaySlip.net_a_payer} strong tone="gold" />
                <SlipRow label={t("pay.slip.total_emp_charges", "Total charges patronales")} value={displaySlip.total_charges_patronales} />
                <SlipRow label={t("pay.slip.employer_cost", "Coût employeur")} value={displaySlip.cout_employeur} strong />
              </div>
            )}
            {displaySlip && (
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 10 }}>
                <Button
                  variant="view"
                  size="sm"
                  type="button"
                  onClick={() => printPayslipPdf({ employee_name: employeeName, period, ...slipMeta, payslip: displaySlip })}
                >
                  {t("pay.print_slip", "Imprimer le bulletin / PDF")}
                </Button>
                <Button variant="export" size="sm" type="button" disabled={!locked} title={locked ? undefined : t("pay.save_before_email", "Enregistrez la fiche avant l'envoi.")} onClick={() => setEmailOpen(true)}>{t("pay.send_email", "Envoyer par e-mail")}</Button>
              </div>
            )}
            {displaySlip && !locked && <p style={{ fontSize: 12, color: "var(--alert, #C4661F)", marginTop: 6 }}>{t("pay.live_hint", "Aperçu en direct de vos saisies. Enregistrez la fiche pour figer les valeurs officielles et activer l'envoi par e-mail.")}</p>}
            {rateEffective && <p style={{ fontSize: 12, color: "var(--muted)", marginTop: 6 }}>{t("pay.scale_since", "Barème en vigueur depuis le")} {rateEffective}.</p>}

            {/* Journal des envois du bulletin (statut + relance = renvoyer). */}
            {slip && dispatches.length > 0 && (
              <div style={{ marginTop: 12, borderTop: "1px solid var(--line)", paddingTop: 10 }}>
                <div style={{ fontSize: 12.5, fontWeight: 600, marginBottom: 6 }}>{t("pay.dispatch_log", "Journal des envois")}</div>
                {dispatches.map((d) => (
                  <div key={d.id} style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center", fontSize: 12.5, padding: "3px 0" }}>
                    <span style={dispatchChip(d.status)}>{DISPATCH_LABEL[d.status]}</span>
                    <span style={{ fontFamily: "var(--font-mono)" }}>{d.period}</span>
                    <span style={{ color: "var(--muted)" }}>{d.recipient}</span>
                    {d.has_pdf && <span style={{ color: "var(--muted)" }}>📎 PDF</span>}
                    <span style={{ color: "var(--muted)" }}>{new Date(d.created_at).toLocaleString("fr-FR")}</span>
                    {d.status === "failed" && (
                      <button type="button" onClick={() => setEmailOpen(true)} style={{ marginLeft: "auto", border: "1px solid var(--alert)", color: "var(--alert)", background: "#fff", borderRadius: 6, padding: "2px 8px", fontSize: 11.5, cursor: "pointer" }}>
                        {t("pay.retry", "Relancer")}
                      </button>
                    )}
                    {d.error && <span style={{ color: "var(--alert)", width: "100%" }}>{d.error}</span>}
                  </div>
                ))}
              </div>
            )}
          </div>

          {emailOpen && displaySlip && (
            <EmailModal
              title={`${t("pay.email_title", "Envoyer le bulletin —")} ${employeeName} (${period})`}
              initialMessage={lang === "en"
                ? `Hello ${employeeName},\n\nPlease find your payslip for the period ${period}.\n\nKind regards,\nÉditions Éclosion`
                : `Bonjour ${employeeName},\n\nVeuillez trouver votre bulletin de paie pour la période ${period}.\n\nCordialement,\nÉditions Éclosion`}
              loadPreview={(message) => previewPayslipEmail(employeeId, period, message, manualRetenue)}
              onSend={async (to, message) => {
                // Bulletin PDF généré ici (navigateur), joint automatiquement à l'e-mail.
                const pdf = buildPayslipPdfBase64({ employee_name: employeeName, period, ...slipMeta, payslip: displaySlip });
                const r = await sendPayslipEmail(employeeId, period, message, to, pdf, manualRetenue);
                loadDispatches();
                return r;
              }}
              onClose={() => setEmailOpen(false)}
            />
          )}
        </>
      )}

      {message && <div style={{ background: "var(--gold-soft, #f6efdc)", color: "var(--ink)", borderRadius: 8, padding: "8px 12px", fontSize: 13, marginTop: 12 }}>{message}</div>}
      {error && <div style={{ background: "#f8e3df", color: "var(--danger, #C24B3A)", borderRadius: 8, padding: "8px 12px", fontSize: 13, marginTop: 12 }}>{error}</div>}
    </Card>
  );
}
