import { useEffect, useState } from "react";
import {
  getPayrollProfile,
  getPayslip,
  previewPayslipEmail,
  savePayrollProfile,
  sendPayslipEmail,
  createDocument,
  uploadDocumentVersion,
  type Employee,
  type PayrollProfileInput,
  type PayslipResult,
} from "../api/client";
import { Card } from "./Card";
import { Field } from "./Modal";
import { Button } from "./Button";
import { EmailModal } from "./EmailModal";
import { printPayslip } from "../lib/print";
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

function fcfa(n: number): string {
  return `${Math.round(n).toLocaleString("fr-FR")} FCFA`;
}

function SlipRow({ label, value, strong, tone }: { label: string; value: number; strong?: boolean; tone?: "gold" }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", gap: 8, padding: "4px 8px", background: "var(--paper)", borderRadius: 6 }}>
      <span style={{ color: "var(--muted)" }}>{label}</span>
      <span style={{ fontFamily: "var(--font-mono, monospace)", fontWeight: strong ? 700 : 400, color: tone === "gold" ? "var(--eclosion, #C89A1B)" : "var(--ink)" }}>{fcfa(value)}</span>
    </div>
  );
}

export function PayrollProfilesSection({ employees, canManage }: { employees: Employee[]; canManage: boolean }) {
  const { t, lang } = useI18n();
  const [employeeId, setEmployeeId] = useState("");
  const [form, setForm] = useState<PayrollProfileInput>(EMPTY);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [period, setPeriod] = useState(new Date().toISOString().slice(0, 7));
  const [slip, setSlip] = useState<PayslipResult | null>(null);
  const [emailOpen, setEmailOpen] = useState(false);
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

  async function computeSlip() {
    if (!employeeId) return;
    try {
      setSlip(await getPayslip(employeeId, period));
      setError(null);
    } catch (err) {
      setSlip(null);
      setError(err instanceof Error ? err.message : "Calcul impossible.");
    }
  }

  const base = Math.round(form.gross_contractual * form.base_pct);

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
    <Card title={t("pay.profiles", "Fiches paie (par employé)")} icon={<IconAdmin />} subtitle={t("pay.profiles_sub", "Données de rémunération servant au calcul du bulletin.")}>
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
            <div style={{ position: "fixed", inset: 0, background: "rgba(22,35,61,.4)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 60, padding: 16 }} onClick={() => setModifyOpen(false)}>
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

          {/* Aperçu du bulletin calculé (moteur brut → net) */}
          <div style={{ marginTop: 16, borderTop: "1px solid var(--line)", paddingTop: 12 }}>
            <div style={{ display: "flex", flexWrap: "wrap", alignItems: "flex-end", gap: 8 }}>
              <Field label={t("pay.period_field", "Période (AAAA-MM)")}><input value={period} onChange={(e) => setPeriod(e.target.value)} style={{ fontFamily: "var(--font-mono, monospace)" }} /></Field>
              <Button variant="edit" size="sm" type="button" onClick={computeSlip}>{t("pay.compute_slip", "Calculer le bulletin")}</Button>
            </div>
            {slip && (
              <div style={{ marginTop: 12, display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))", gap: 8, fontSize: 13 }}>
                <SlipRow label={t("pay.slip.gross", "Salaire brut")} value={slip.payslip.salaire_brut} strong />
                <SlipRow label={t("pay.slip.cnps_base", "Assiette CNPS")} value={slip.payslip.assiette_cnps} />
                <SlipRow label={t("pay.slip.pvid_emp", "PVID salarié")} value={slip.payslip.pvid_salarie} />
                <SlipRow label={t("pay.slip.cfc_emp", "CFC salarié")} value={slip.payslip.cfc_salarie} />
                <SlipRow label={t("pay.slip.communal_tax", "Taxe communale")} value={slip.payslip.taxe_communale} />
                <SlipRow label={t("pay.slip.rav", "RAV")} value={slip.payslip.rav} />
                <SlipRow label={t("pay.slip.irpp_cac", "IRPP + CAC")} value={slip.payslip.irpp_cac} />
                <SlipRow label={t("pay.slip.absence_deduction", "Retenue absence (Présences)")} value={slip.payslip.retenue_absence} />
                <SlipRow label={t("pay.slip.total_emp_deductions", "Total retenues salariales")} value={slip.payslip.total_retenues_salariales} />
                <SlipRow label={t("pay.slip.net", "NET À PAYER")} value={slip.payslip.net_a_payer} strong tone="gold" />
                <SlipRow label={t("pay.slip.total_emp_charges", "Total charges patronales")} value={slip.payslip.total_charges_patronales} />
                <SlipRow label={t("pay.slip.employer_cost", "Coût employeur")} value={slip.payslip.cout_employeur} strong />
              </div>
            )}
            {slip && (
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 10 }}>
                <Button
                  variant="view"
                  size="sm"
                  type="button"
                  onClick={() =>
                    printPayslip({
                      employee_name: slip.employee.name,
                      period: slip.period,
                      matricule: form.matricule || null,
                      cnps_number: form.cnps_number || null,
                      niu: form.niu || null,
                      fiscal_parts: form.fiscal_parts,
                      payslip: slip.payslip,
                    })
                  }
                >
                  {t("pay.print_slip", "Imprimer le bulletin / PDF")}
                </Button>
                <Button variant="export" size="sm" type="button" onClick={() => setEmailOpen(true)}>{t("pay.send_email", "Envoyer par e-mail")}</Button>
              </div>
            )}
            {slip && <p style={{ fontSize: 12, color: "var(--muted)", marginTop: 6 }}>{t("pay.scale_since", "Barème en vigueur depuis le")} {slip.rate_set_effective_from}.</p>}
          </div>

          {emailOpen && slip && (
            <EmailModal
              title={`${t("pay.email_title", "Envoyer le bulletin —")} ${slip.employee.name} (${slip.period})`}
              initialMessage={lang === "en"
                ? `Hello ${slip.employee.name},\n\nPlease find your payslip for the period ${slip.period}.\n\nKind regards,\nÉditions Éclosion`
                : `Bonjour ${slip.employee.name},\n\nVeuillez trouver votre bulletin de paie pour la période ${slip.period}.\n\nCordialement,\nÉditions Éclosion`}
              loadPreview={(message) => previewPayslipEmail(employeeId, slip.period, message)}
              onSend={(to, message) => sendPayslipEmail(employeeId, slip.period, message, to)}
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
