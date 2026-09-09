import { useEffect, useState } from "react";
import { getPayrollMonth, preparePayrollMonth, savePayrollMonthLine, validatePayrollMonth, reopenPayrollMonth, submitPayrollMonth, returnPayrollMonth, requestPayrollReopen, listPayrollReopenRequests, decidePayrollReopen, getSalaryElements, type PayrollMonth, type PayrollMonthLine, type PayrollMonthElements, type PayrollExtraLine, type ReopenRequest, type SalaryElement } from "../api/client";
import { downloadPayslipsPdf } from "../lib/payslipPdf";
import type { PayslipPrintData } from "../lib/print";
import { Card } from "./Card";
import { TableScroll } from "./TableScroll";
import { Field, Modal } from "./Modal";
import { Button } from "./Button";
import { IconAdmin } from "./icons";

// Cycle mensuel de paie (chantier 07/08/2026) — Étape 1 : grille éditable.
// Le RH prépare le mois pour tous les salariés, saisit les éléments variables
// (primes, heures sup, absences, retards, avances, prêts, sanctions, autres) ;
// le NET se recalcule automatiquement. Le mois reste modifiable (brouillon).

function fcfa(n: number): string {
  return `${Math.round(n).toLocaleString("fr-FR")} FCFA`;
}
function currentPeriod(): string {
  const d = new Date();
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

// Types d'avantages en nature évaluables au barème (CGI art. 33). Le pourcentage
// réel vient du barème versionné (réponse du mois) ; ces libellés servent l'UI.
type BaremeType = "logement" | "electricite" | "eau" | "domestique" | "vehicule" | "nourriture";
const AN_BAREME: { value: BaremeType; label: string; parUnite?: string }[] = [
  { value: "logement", label: "Logement" },
  { value: "electricite", label: "Électricité" },
  { value: "eau", label: "Eau" },
  { value: "domestique", label: "Domestique", parUnite: "par personne" },
  { value: "vehicule", label: "Véhicule", parUnite: "par véhicule" },
  { value: "nourriture", label: "Nourriture" },
];

const COLS: { key: keyof PayrollMonthElements; label: string; hint: string }[] = [
  { key: "primes", label: "Primes", hint: "Primes exceptionnelles (imposable)" },
  { key: "heures_sup", label: "H. sup", hint: "Heures supplémentaires — montant (imposable)" },
  { key: "retenue_absence", label: "Absences", hint: "Retenue d'absence (avant impôt)" },
  { key: "retard", label: "Retards", hint: "Retenue de retard (net)" },
  { key: "avance", label: "Avances", hint: "Avance sur salaire (net)" },
  { key: "pret", label: "Prêts", hint: "Remboursement de prêt (net)" },
  { key: "sanction", label: "Sanctions", hint: "Sanction (net)" },
  { key: "autres", label: "Autres", hint: "Autres retenues internes (net)" },
];

export function PayrollMonthlySection({ canManage, canValidateDg, collapsible, defaultOpen }: { canManage: boolean; canValidateDg?: boolean; collapsible?: boolean; defaultOpen?: boolean }) {
  const [period, setPeriod] = useState(currentPeriod());
  const [month, setMonth] = useState<PayrollMonth | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  // Copie éditable locale des éléments par salarié (saisie fluide).
  const [draft, setDraft] = useState<Record<string, PayrollMonthElements>>({});
  // Lignes libres par salarié + salarié dont on édite les lignes (modale).
  const [extraDraft, setExtraDraft] = useState<Record<string, PayrollExtraLine[]>>({});
  const [linesFor, setLinesFor] = useState<{ employeeId: string; name: string } | null>(null);
  // Rubriques « en vigueur » du catalogue (Niveau 2, étape B) : rattachables à une
  // ligne libre pour appliquer automatiquement leur traitement fiscal/CNPS.
  const [activeRubriques, setActiveRubriques] = useState<SalaryElement[]>([]);
  // Réouverture exceptionnelle (ch. 23) : demandes + formulaire.
  const [reopenReqs, setReopenReqs] = useState<ReopenRequest[]>([]);
  const [reopenOpen, setReopenOpen] = useState(false);
  const emptyReopen = { employeeId: "", element: "", oldValue: "", correction: "", reason: "" };
  const [reopenForm, setReopenForm] = useState(emptyReopen);

  async function load() {
    setBusy(true);
    setError(null);
    try {
      const m = await getPayrollMonth(period);
      setMonth(m);
      const d: Record<string, PayrollMonthElements> = {};
      const ex: Record<string, PayrollExtraLine[]> = {};
      for (const l of m.lines ?? []) {
        d[l.employee_id] = { ...l.elements };
        ex[l.employee_id] = (l.extra_lines ?? []).map((e) => ({ ...e }));
      }
      setDraft(d);
      setExtraDraft(ex);
      if (m.exists) listPayrollReopenRequests(period).then(setReopenReqs).catch(() => setReopenReqs([]));
      else setReopenReqs([]);
    } catch (err) {
      setMonth(null);
      setError(err instanceof Error ? err.message : "Chargement impossible.");
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [period]);

  // Rubriques activées (« en vigueur ») rattachables à une ligne libre.
  useEffect(() => {
    getSalaryElements()
      .then((cfg) => setActiveRubriques(cfg.elements.filter((e) => e.in_force && e.active)))
      .catch(() => setActiveRubriques([]));
  }, []);

  async function prepare() {
    setBusy(true);
    setError(null);
    try {
      await preparePayrollMonth(period);
      setMessage(`Mois ${period} préparé pour tous les salariés dotés d'une fiche paie.`);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Préparation impossible.");
    } finally {
      setBusy(false);
    }
  }

  const locked = month?.status === "valide";
  const submitted = month?.status === "soumis_dg";
  // La grille n'est saisissable qu'en brouillon (ni soumise au DG, ni validée).
  const editable = month?.status === "brouillon";

  async function submit() {
    if (!window.confirm(`Soumettre la paie de ${period} au Directeur général ?\n\nLa grille sera figée en attente de validation ; vous ne pourrez plus la modifier tant que le DG ne l'aura pas validée ou retournée.`)) return;
    setBusy(true);
    try {
      await submitPayrollMonth(period);
      setMessage(`Paie de ${period} soumise au Directeur général.`);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Soumission impossible.");
    } finally {
      setBusy(false);
    }
  }

  async function returnToRh() {
    const reason = window.prompt("Motif du retour au RH (obligatoire) — précisez ce qui doit être corrigé :");
    if (reason == null) return;
    if (reason.trim().length < 3) {
      setError("Le motif du retour est obligatoire (au moins quelques mots).");
      return;
    }
    setBusy(true);
    try {
      await returnPayrollMonth(period, reason.trim());
      setMessage(`Paie de ${period} retournée au RH pour correction.`);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Retour impossible.");
    } finally {
      setBusy(false);
    }
  }

  // Le RH DEMANDE une réouverture d'un mois verrouillé (ch. 23).
  async function submitReopenRequest() {
    if (reopenForm.element.trim().length < 2 || reopenForm.correction.trim().length < 2 || reopenForm.reason.trim().length < 3) {
      setError("Renseignez l'élément concerné, la correction demandée et le motif.");
      return;
    }
    setBusy(true);
    try {
      await requestPayrollReopen(period, {
        employee_id: reopenForm.employeeId || null,
        element: reopenForm.element.trim(),
        old_value: reopenForm.oldValue.trim() || null,
        requested_correction: reopenForm.correction.trim(),
        reason: reopenForm.reason.trim(),
      });
      setMessage("Demande de réouverture transmise au Directeur général.");
      setReopenOpen(false);
      setReopenForm(emptyReopen);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Demande impossible.");
    } finally {
      setBusy(false);
    }
  }
  // Le DG décide (autorise → réouverture ; refuse → reste verrouillé).
  async function decideReopen(id: string, decision: "autorisee" | "refusee") {
    const reason = decision === "refusee" ? (window.prompt("Motif du refus (facultatif) :") ?? "") : "";
    setBusy(true);
    try {
      await decidePayrollReopen(id, decision, reason || undefined);
      setMessage(decision === "autorisee" ? `Réouverture autorisée : ${period} repasse en brouillon pour correction.` : "Demande de réouverture refusée.");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Décision impossible.");
    } finally {
      setBusy(false);
    }
  }

  // Enregistrement EXPLICITE de toute la grille (bouton « Enregistrer la saisie »).
  async function saveAll() {
    if (!editable) return;
    setBusy(true);
    try {
      for (const l of month?.lines ?? []) {
        await savePayrollMonthLine(period, l.employee_id, draft[l.employee_id], l.note, extraDraft[l.employee_id] ?? []);
      }
      setMessage("Saisie enregistrée. Vous pouvez continuer à la modifier tant que le mois n'est pas soumis ni validé.");
      setError(null);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Enregistrement impossible.");
    } finally {
      setBusy(false);
    }
  }

  async function saveRow(l: PayrollMonthLine) {
    if (!editable) return;
    try {
      await savePayrollMonthLine(period, l.employee_id, draft[l.employee_id], l.note, extraDraft[l.employee_id] ?? []);
      setError(null);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Enregistrement impossible.");
    }
  }

  // Enregistre les lignes libres d'un salarié (depuis la modale). Nettoie les
  // lignes vides et préserve les éléments variables et la note déjà saisis.
  async function saveLines() {
    if (!linesFor) return;
    const id = linesFor.employeeId;
    const clean = (extraDraft[id] ?? [])
      // On garde une ligne si elle a un libellé ET (un montant > 0 OU un avantage en
      // nature au barème, dont le montant est calculé par le moteur).
      .filter((e) => e.label.trim() !== "" && (e.amount > 0 || e.bareme_type != null))
      .map((e) => ({
        label: e.label.trim(), kind: e.kind, amount: Math.max(e.amount, 0),
        ...(e.element_code ? { element_code: e.element_code } : {}),
        ...(e.bareme_type ? { bareme_type: e.bareme_type, quantity: e.quantity ?? 1 } : {}),
      }));
    const note = month?.lines?.find((l) => l.employee_id === id)?.note ?? null;
    setBusy(true);
    try {
      await savePayrollMonthLine(period, id, draft[id], note, clean);
      setLinesFor(null);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Enregistrement des lignes impossible.");
    } finally {
      setBusy(false);
    }
  }
  // Barème (%) d'un avantage en nature, issu de la réponse du mois. Null si absent.
  function anBaremePct(t: BaremeType): number | null {
    const b = month?.rates?.avantages_nature;
    return b ? (b[t] ?? null) : null;
  }
  function setExtra(id: string, idx: number, patch: Partial<PayrollExtraLine>) {
    setExtraDraft((cur) => ({ ...cur, [id]: (cur[id] ?? []).map((e, i) => (i === idx ? { ...e, ...patch } : e)) }));
  }
  function addExtra(id: string) {
    setExtraDraft((cur) => ({ ...cur, [id]: [...(cur[id] ?? []), { label: "", kind: "gain", amount: 0 }] }));
  }
  function removeExtra(id: string, idx: number) {
    setExtraDraft((cur) => ({ ...cur, [id]: (cur[id] ?? []).filter((_, i) => i !== idx) }));
  }

  function setCell(employeeId: string, key: keyof PayrollMonthElements, value: string) {
    setDraft((cur) => ({ ...cur, [employeeId]: { ...cur[employeeId], [key]: Math.max(Number(value) || 0, 0) } }));
  }

  async function validate() {
    if (!window.confirm(`Valider définitivement la paie de ${period} ?\n\nLe mois sera figé et les bulletins pourront être imprimés. Vous pourrez le rouvrir si besoin.`)) return;
    setBusy(true);
    try {
      await validatePayrollMonth(period);
      setMessage(`Paie de ${period} validée par la Direction. Impression des bulletins possible.`);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Validation impossible.");
    } finally {
      setBusy(false);
    }
  }

  async function reopen() {
    // Le DG rouvre une paie validée pour la renvoyer au RH : motif obligatoire,
    // enregistré et notifié au RH (il saura quoi corriger).
    const reason = window.prompt("Renvoyer la paie au RH pour correction.\nMotif (obligatoire) — précisez ce qui doit être corrigé :");
    if (reason == null) return;
    if (reason.trim().length < 3) {
      setError("Le motif du renvoi est obligatoire (au moins quelques mots).");
      return;
    }
    setBusy(true);
    try {
      await reopenPayrollMonth(period, reason.trim());
      setMessage(`Paie de ${period} renvoyée au RH pour correction.`);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Renvoi impossible.");
    } finally {
      setBusy(false);
    }
  }

  // Génération de TOUS les bulletins du mois en un seul PDF (modèle du classeur).
  function printAll() {
    const list: PayslipPrintData[] = (month?.lines ?? []).map((l) => ({
      employee_name: l.employee_name,
      period,
      matricule: l.matricule,
      cnps_number: l.cnps_number,
      niu: l.niu,
      fiscal_parts: l.fiscal_parts,
      department: l.department,
      position: l.position,
      hire_date: l.hire_date,
      birth_date: l.birth_date,
      contract_type: l.contract_type,
      category: l.category,
      payment_mode: l.payment_mode,
      account_number: l.account_number,
      leave_balance: l.leave_balance,
      leave_taken: l.leave_taken,
      situation_familiale: l.marital_status,
      children_count: l.children_count,
      phone: l.phone,
      emergency_contact: l.emergency_contact,
      extra_lines: l.extra_lines ?? [],
      rates: month?.rates ?? null,
      // Détail des retenues internes (la sanction est comptée avec « autres »,
      // comme dans le moteur : cf. computeMonthlyLine).
      internal: { avance: l.elements.avance, pret: l.elements.pret, retard: l.elements.retard, autres: l.elements.autres + l.elements.sanction },
      payslip: l.payslip,
    }));
    if (list.length > 0) downloadPayslipsPdf(list, `bulletins-${period}.pdf`);
  }

  return (
    <Card
      title="Génération mensuelle (tous les salariés)"
      icon={<IconAdmin />}
      subtitle="Préparez le mois, saisissez les éléments variables par salarié ; le net se recalcule automatiquement."
      collapsible={collapsible}
      defaultOpen={defaultOpen}
    >
      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "flex-end", gap: 8 }}>
        <Field label="Mois de paie (AAAA-MM)"><input type="month" value={period} onChange={(e) => setPeriod(e.target.value)} style={{ fontFamily: "var(--font-mono, monospace)" }} /></Field>
        {month && !month.exists && canManage && (
          <Button variant="add" size="sm" type="button" disabled={busy} onClick={prepare}>{busy ? "…" : "Préparer le mois de paie"}</Button>
        )}
        {month?.exists && (
          <span style={{ fontSize: 12, fontWeight: 700, borderRadius: 999, padding: "3px 10px", ...(locked ? { background: "var(--eclosion-soft)", color: "var(--eclosion-dark, #9a7a12)" } : submitted ? { background: "#fdeede", color: "var(--alert, #C4661F)" } : { background: "#f3efe4", color: "var(--muted)" }) }}>
            {locked ? `✓ Validé${month.validated_at ? ` le ${month.validated_at.slice(0, 10)}` : ""}` : submitted ? "⏳ Soumis au DG (en attente de validation)" : "● Brouillon (modifiable)"}
          </span>
        )}
        {/* RH : enregistrer explicitement la saisie (en plus de l'auto-enregistrement). */}
        {month?.exists && editable && canManage && (month.lines?.length ?? 0) > 0 && (
          <Button variant="edit" size="sm" type="button" disabled={busy} onClick={saveAll}>💾 Enregistrer la saisie</Button>
        )}
        {/* RH : soumettre au DG (brouillon → en attente). */}
        {month?.exists && editable && canManage && (month.lines?.length ?? 0) > 0 && (
          <Button variant="add" size="sm" type="button" disabled={busy} onClick={submit}>➤ Soumettre au DG</Button>
        )}
        {/* DG : valider (depuis brouillon ou soumis). */}
        {month?.exists && !locked && canValidateDg && (month.lines?.length ?? 0) > 0 && (
          <Button variant="add" size="sm" type="button" disabled={busy} onClick={validate}>✓ Valider le mois (DG)</Button>
        )}
        {/* DG : retourner au RH pour correction (uniquement si soumis). */}
        {month?.exists && submitted && canValidateDg && (
          <Button variant="edit" size="sm" type="button" disabled={busy} onClick={returnToRh}>↩ Retourner au RH (DG)</Button>
        )}
        {month?.exists && locked && (
          <Button variant="view" size="sm" type="button" onClick={printAll}>🖨 Imprimer tous les bulletins</Button>
        )}
        {month?.exists && locked && canValidateDg && (
          <Button variant="edit" size="sm" type="button" disabled={busy} onClick={reopen}>↩ Renvoyer au RH pour correction (motif)</Button>
        )}
        {/* RH : demande de réouverture exceptionnelle d'un mois verrouillé. */}
        {month?.exists && locked && canManage && (
          <Button variant="view" size="sm" type="button" disabled={busy} onClick={() => { setReopenForm(emptyReopen); setReopenOpen(true); }}>🔓 Demander une réouverture</Button>
        )}
      </div>

      {/* Motif du dernier retour DG : visible pour le RH tant que le mois est en
          brouillon, pour savoir quoi corriger avant de re-soumettre. */}
      {month?.exists && editable && month.return_reason && (
        <div style={{ marginTop: 8, background: "#fdeede", color: "var(--alert, #C4661F)", border: "1px solid var(--alert, #C4661F)", borderRadius: 8, padding: "8px 12px", fontSize: 13 }}>
          ↩ <b>Retourné par la Direction pour correction</b>{month.returned_at ? ` (le ${month.returned_at.slice(0, 10)})` : ""} : {month.return_reason}
        </div>
      )}

      {/* Demandes de réouverture exceptionnelle (ch. 23) : statut + décision DG. */}
      {reopenReqs.length > 0 && (
        <div style={{ marginTop: 10, border: "1px solid var(--line)", borderRadius: 8, padding: "8px 12px" }}>
          <div style={{ fontSize: 12.5, fontWeight: 600, marginBottom: 6 }}>🔓 Demandes de réouverture exceptionnelle</div>
          {reopenReqs.map((r) => {
            const chip = r.status === "en_attente"
              ? { bg: "#fdeede", fg: "var(--alert, #C4661F)", label: "En attente DG" }
              : r.status === "autorisee"
                ? { bg: "var(--eclosion-soft, #f3efdc)", fg: "var(--eclosion-dark, #9a7a12)", label: "Autorisée" }
                : { bg: "#f3efe4", fg: "var(--muted)", label: "Refusée" };
            return (
              <div key={r.id} style={{ borderTop: "1px solid var(--line)", padding: "6px 0", fontSize: 12.5 }}>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
                  <span style={{ borderRadius: 999, padding: "2px 9px", fontWeight: 700, background: chip.bg, color: chip.fg }}>{chip.label}</span>
                  <b>{r.element}</b>{r.employee_name ? <span style={{ color: "var(--muted)" }}> · {r.employee_name}</span> : null}
                  <span style={{ color: "var(--muted)" }}>· demandée par {r.requested_by ?? "—"} le {new Date(r.requested_at).toLocaleDateString("fr-FR")}</span>
                  {r.status === "en_attente" && canValidateDg && (
                    <span style={{ marginLeft: "auto", display: "flex", gap: 6 }}>
                      <Button variant="add" size="sm" type="button" disabled={busy} onClick={() => decideReopen(r.id, "autorisee")}>✅ Autoriser</Button>
                      <Button variant="edit" size="sm" type="button" disabled={busy} onClick={() => decideReopen(r.id, "refusee")}>✕ Refuser</Button>
                    </span>
                  )}
                </div>
                <div style={{ color: "var(--muted)", marginTop: 2 }}>
                  {r.old_value ? <>Ancienne valeur : <b>{r.old_value}</b> · </> : null}
                  Correction : <b>{r.requested_correction}</b> · Motif : {r.reason}
                  {r.decided_by ? <> · décidée par {r.decided_by}{r.decision_reason ? ` (${r.decision_reason})` : ""}</> : null}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {month?.exists && month.lines && (
        <>
          <div style={{ marginTop: 10, fontSize: 13 }}>
            {month.lines.length} salarié(s) · barème depuis le {month.rate_effective_from} · Net total :{" "}
            <span style={{ fontFamily: "var(--font-mono)", fontWeight: 700, color: "var(--eclosion, #d9b21a)" }}>{fcfa(month.totals?.net ?? 0)}</span> · Coût employeur :{" "}
            <span style={{ fontFamily: "var(--font-mono)" }}>{fcfa(month.totals?.cout ?? 0)}</span>
          </div>
          {editable && <p style={{ fontSize: 12, color: "var(--muted)", margin: "6px 0 0" }}>Saisissez les montants (FCFA) : chaque case s'enregistre en la quittant, et le net se met à jour. Vous pouvez aussi cliquer <b>« Enregistrer la saisie »</b> pour tout enregistrer d'un coup avant de soumettre.</p>}

          {/* Employés sans fiche paie : ils n'apparaissent PAS dans la grille (le
              calcul exige une fiche). On les liste ici pour que le RH sache qui
              reste à compléter — sinon ils semblent avoir disparu. */}
          {(month.missing_profiles?.length ?? 0) > 0 && (
            <div style={{ marginTop: 10, background: "#fdeede", color: "var(--alert, #C4661F)", border: "1px solid var(--alert, #C4661F)", borderRadius: 8, padding: "8px 12px", fontSize: 12.5 }}>
              <b>{month.missing_profiles!.length} salarié(s) sans fiche paie</b> — non inclus dans la paie tant que leur fiche n'est pas créée. Créez-la dans <b>« Fiches paie &amp; bulletin (par employé) »</b> (choisir l'employé → renseigner la rémunération → Enregistrer) : ils apparaîtront ensuite ici.
              <div style={{ marginTop: 4, color: "var(--ink)" }}>
                {month.missing_profiles!.map((m) => m.name + (m.department ? ` (${m.department})` : "")).join(" · ")}
              </div>
            </div>
          )}

          <TableScroll style={{ marginTop: 10 }}>
            <table style={{ borderCollapse: "collapse", fontSize: 12.5, minWidth: 900 }}>
              <thead>
                <tr style={{ textAlign: "right", color: "var(--muted)", fontSize: 11.5 }}>
                  <th style={{ padding: "5px 8px", textAlign: "left", position: "sticky", left: 0, background: "var(--card, #fff)" }}>Salarié</th>
                  {COLS.map((c) => <th key={c.key} style={{ padding: "5px 6px" }} title={c.hint}>{c.label}</th>)}
                  <th style={{ padding: "5px 8px" }}>Net à payer</th>
                </tr>
              </thead>
              <tbody>
                {month.lines.map((l) => (
                  <tr key={l.employee_id} style={{ borderTop: "1px solid var(--line)" }}>
                    <td style={{ padding: "4px 8px", whiteSpace: "nowrap", position: "sticky", left: 0, background: "var(--card, #fff)" }}>
                      {l.employee_name}
                      {l.matricule && <span style={{ color: "var(--muted)", fontFamily: "var(--font-mono)", marginLeft: 6 }}>{l.matricule}</span>}
                      <div>
                        <button
                          type="button"
                          onClick={() => setLinesFor({ employeeId: l.employee_id, name: l.employee_name })}
                          title="Ajouter des lignes libres au bulletin (gains ou retenues)"
                          style={{ marginTop: 2, border: "1px solid var(--line)", background: "#fff", borderRadius: 6, padding: "1px 7px", fontSize: 11, cursor: "pointer", color: "var(--muted)" }}
                        >
                          ＋ lignes{(l.extra_lines?.length ?? 0) > 0 ? ` (${l.extra_lines!.length})` : ""}
                        </button>
                      </div>
                    </td>
                    {COLS.map((c) => {
                      // Les primes sont gérées par le module « Primes du mois »
                      // (source unique) : la colonne est en lecture seule ici, elle
                      // affiche le total des primes validées reporté sur la ligne.
                      const primesReadOnly = c.key === "primes";
                      return (
                        <td key={c.key} style={{ padding: "2px 4px" }}>
                          <input
                            type="number"
                            min={0}
                            step={100}
                            disabled={!editable || primesReadOnly}
                            readOnly={primesReadOnly}
                            title={primesReadOnly ? "Total des primes validées du mois — géré dans la rubrique « Primes du mois »." : undefined}
                            value={draft[l.employee_id]?.[c.key] ?? 0}
                            onChange={(e) => !primesReadOnly && setCell(l.employee_id, c.key, e.target.value)}
                            onBlur={() => !primesReadOnly && saveRow(l)}
                            style={{ width: 84, padding: "4px 6px", textAlign: "right", fontFamily: "var(--font-mono, monospace)", border: "1px solid var(--line)", borderRadius: 5, background: editable && !primesReadOnly ? "#fff" : "#f4f5f8" }}
                          />
                        </td>
                      );
                    })}
                    <td style={{ padding: "4px 8px", textAlign: "right", fontFamily: "var(--font-mono, monospace)", fontWeight: 700, color: "var(--eclosion, #d9b21a)", whiteSpace: "nowrap" }}>{fcfa(l.net_a_payer)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableScroll>
          <p style={{ fontSize: 11.5, color: "var(--muted)", marginTop: 8 }}>
            {locked
              ? "Mois validé : imprimez les bulletins (un PDF, un bulletin par page). Le DG peut rouvrir le mois pour corriger."
              : submitted
                ? "Paie soumise au Directeur général : en attente de sa décision. Le DG valide (verrouillage) ou retourne au RH avec un motif."
                : "Quand la saisie est terminée, le RH soumet la paie au Directeur général, qui la valide (obligatoire avant impression des bulletins)."}
          </p>
        </>
      )}

      {message && <div style={{ background: "var(--gold-soft, #f6efdc)", color: "var(--ink)", borderRadius: 8, padding: "8px 12px", fontSize: 13, marginTop: 12 }}>{message}</div>}
      {error && <div style={{ background: "#f8e3df", color: "var(--danger, #C24B3A)", borderRadius: 8, padding: "8px 12px", fontSize: 13, marginTop: 12 }}>{error}</div>}

      {/* Éditeur de LIGNES LIBRES du bulletin : le RH ajoute autant de lignes que
          nécessaire (gain imposable ou retenue nette), rien n'est codé en dur. */}
      {linesFor && (
        <Modal
          title={`Lignes libres du bulletin — ${linesFor.name}`}
          onClose={() => setLinesFor(null)}
          footer={
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
              <Button variant="view" size="sm" type="button" onClick={() => setLinesFor(null)}>Annuler</Button>
              <Button variant="add" size="sm" type="button" disabled={busy} onClick={saveLines}>Enregistrer</Button>
            </div>
          }
        >
          <p style={{ margin: "0 0 8px", fontSize: 12.5, color: "var(--muted)" }}>
            Ajoutez des lignes personnalisées (indemnité, prime exceptionnelle, retenue particulière…). Un
            <b> gain</b> est imposable (ajouté au brut) ; une <b>retenue</b> est nette (retirée du net à payer).
            {activeRubriques.length > 0 && <> Rattachez une <b>rubrique en vigueur</b> pour appliquer automatiquement son traitement fiscal/CNPS (une indemnité exonérée n'entre alors ni dans l'IRPP ni dans la CNPS). Pour un <b>avantage en nature</b> (logement, véhicule…), le montant est <b>évalué au barème</b> (% du salaire brut taxable) — inutile de le calculer à la main.</>}
            {" "}Le net se recalcule à l'enregistrement.
          </p>
          {(extraDraft[linesFor.employeeId] ?? []).length === 0 && (
            <p style={{ fontSize: 12.5, color: "var(--muted)" }}>Aucune ligne libre. Cliquez sur « + Ajouter une ligne ».</p>
          )}
          {(extraDraft[linesFor.employeeId] ?? []).map((e, i) => {
            const rub = e.element_code ? activeRubriques.find((r) => r.code === e.element_code) : undefined;
            const isAN = rub?.category === "avantage_nature"; // évaluation au barème
            const anPct = isAN && e.bareme_type ? anBaremePct(e.bareme_type) : null;
            return (
            <div key={i} style={{ marginBottom: 8 }}>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 110px 120px 32px", gap: 6, alignItems: "center" }}>
                <input placeholder="Libellé (ex. Indemnité transport)" value={e.label} onChange={(ev) => setExtra(linesFor.employeeId, i, { label: ev.target.value })} />
                <select value={e.kind} onChange={(ev) => setExtra(linesFor.employeeId, i, { kind: ev.target.value as "gain" | "retenue" })} disabled={isAN}>
                  <option value="gain">Gain</option>
                  <option value="retenue">Retenue</option>
                </select>
                {isAN ? (
                  <input value="au barème" disabled title="Montant évalué automatiquement au barème (voir ci-dessous)" style={{ textAlign: "right", color: "var(--muted)", fontStyle: "italic" }} />
                ) : (
                  <input type="number" min={0} step={100} value={e.amount} onChange={(ev) => setExtra(linesFor.employeeId, i, { amount: Math.max(Number(ev.target.value) || 0, 0) })} style={{ fontFamily: "var(--font-mono, monospace)", textAlign: "right" }} />
                )}
                <button type="button" onClick={() => removeExtra(linesFor.employeeId, i)} title="Supprimer la ligne" style={{ border: "1px solid var(--line)", background: "#fff", borderRadius: 6, cursor: "pointer", color: "var(--danger, #C24B3A)" }}>✕</button>
              </div>
              {activeRubriques.length > 0 && (
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 4, flexWrap: "wrap" }}>
                  <label style={{ fontSize: 11.5, color: "var(--muted)" }}>Rubrique&nbsp;:</label>
                  <select
                    value={e.element_code ?? ""}
                    onChange={(ev) => {
                      const code = ev.target.value || undefined;
                      const picked = code ? activeRubriques.find((r) => r.code === code) : undefined;
                      const nowAN = picked?.category === "avantage_nature";
                      // À la sélection d'une rubrique, on pré-remplit le libellé s'il est vide.
                      // Un avantage en nature démarre au barème « logement » par défaut ;
                      // changer de rubrique non-AN efface le barème.
                      setExtra(linesFor.employeeId, i, {
                        element_code: code,
                        ...(picked && !e.label.trim() ? { label: picked.label } : {}),
                        ...(nowAN ? { bareme_type: e.bareme_type ?? "logement", quantity: e.quantity ?? 1, kind: "gain" as const } : { bareme_type: undefined, quantity: undefined }),
                      });
                    }}
                    style={{ fontSize: 12 }}
                  >
                    <option value="">— Ligne libre (imposable) —</option>
                    {activeRubriques.map((r) => (
                      <option key={r.code} value={r.code}>{r.label}</option>
                    ))}
                  </select>
                  {rub && (
                    <span style={{ fontSize: 11, color: "var(--muted)" }}>
                      {rub.fiscal_label} · {rub.cnps_label}
                    </span>
                  )}
                </div>
              )}
              {isAN && (
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 4, flexWrap: "wrap", paddingLeft: 12 }}>
                  <label style={{ fontSize: 11.5, color: "var(--muted)" }}>Avantage&nbsp;:</label>
                  <select value={e.bareme_type ?? "logement"} onChange={(ev) => setExtra(linesFor.employeeId, i, { bareme_type: ev.target.value as BaremeType })} style={{ fontSize: 12 }}>
                    {AN_BAREME.map((b) => <option key={b.value} value={b.value}>{b.label}{b.parUnite ? ` (${b.parUnite})` : ""}</option>)}
                  </select>
                  <label style={{ fontSize: 11.5, color: "var(--muted)" }}>Nombre&nbsp;:</label>
                  <input type="number" min={1} step={1} value={e.quantity ?? 1} onChange={(ev) => setExtra(linesFor.employeeId, i, { quantity: Math.max(Math.floor(Number(ev.target.value) || 1), 1) })} style={{ width: 56, fontFamily: "var(--font-mono, monospace)", textAlign: "right" }} />
                  {anPct != null && (
                    <span style={{ fontSize: 11, color: "var(--muted)" }}>
                      {(anPct * 100).toLocaleString("fr-FR", { maximumFractionDigits: 2 })} % du brut taxable × {e.quantity ?? 1} — évalué à l'enregistrement
                    </span>
                  )}
                </div>
              )}
            </div>
            );
          })}
          <Button variant="edit" size="sm" type="button" onClick={() => addExtra(linesFor.employeeId)}>+ Ajouter une ligne</Button>
        </Modal>
      )}

      {/* Demande de réouverture exceptionnelle (ch. 23) — formulaire RH. */}
      {reopenOpen && (
        <Modal
          title={`Demande de réouverture — ${period}`}
          onClose={() => setReopenOpen(false)}
          footer={
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
              <Button variant="view" size="sm" type="button" onClick={() => setReopenOpen(false)}>Annuler</Button>
              <Button variant="add" size="sm" type="button" disabled={busy} onClick={submitReopenRequest}>Transmettre au DG</Button>
            </div>
          }
        >
          <p style={{ margin: "0 0 8px", fontSize: 12.5, color: "var(--muted)" }}>
            La paie de {period} est validée et verrouillée. Décrivez la correction nécessaire : le Directeur général
            autorisera (ou non) la réouverture. Une fois autorisée, le mois repasse en brouillon et refait le circuit.
          </p>
          <Field label="Salarié concerné (facultatif)">
            <select value={reopenForm.employeeId} onChange={(e) => setReopenForm({ ...reopenForm, employeeId: e.target.value })}>
              <option value="">— tout le mois / non précisé —</option>
              {(month?.lines ?? []).map((l) => <option key={l.employee_id} value={l.employee_id}>{l.employee_name}</option>)}
            </select>
          </Field>
          <Field label="Élément concerné *"><input value={reopenForm.element} onChange={(e) => setReopenForm({ ...reopenForm, element: e.target.value })} placeholder="ex. Salaire de base, Prime, Retenue…" /></Field>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            <Field label="Ancienne valeur (facultatif)"><input value={reopenForm.oldValue} onChange={(e) => setReopenForm({ ...reopenForm, oldValue: e.target.value })} /></Field>
            <Field label="Correction demandée *"><input value={reopenForm.correction} onChange={(e) => setReopenForm({ ...reopenForm, correction: e.target.value })} /></Field>
          </div>
          <Field label="Motif *"><input value={reopenForm.reason} onChange={(e) => setReopenForm({ ...reopenForm, reason: e.target.value })} placeholder="ex. Erreur de saisie du salaire de base" /></Field>
        </Modal>
      )}
    </Card>
  );
}
