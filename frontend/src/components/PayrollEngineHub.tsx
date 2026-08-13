import { useEffect, useState, type ReactNode } from "react";
import {
  getPayrollMonth,
  getPayrollJournal,
  getPayrollRateSet,
  getMonthlyAnomalies,
  listAuditLog,
  listPayrollFormulas,
  testPayrollFormula,
  updatePayrollFormula,
  type Employee,
  type PayrollMonth,
  type PayrollJournal,
  type PayrollRateSet,
  type PayrollAnomalies,
  type PayrollFormula,
  type AuditEntry,
} from "../api/client";
import { Card } from "./Card";
import { Button } from "./Button";
import { GuidanceNote } from "./GuidanceNote";
import { PayrollMonthlySection } from "./PayrollMonthlySection";
import { PayrollProfilesSection } from "./PayrollProfilesSection";
import { PayrollSettingsSection } from "./PayrollSettingsSection";
import { PayrollRegisterSection } from "./PayrollRegisterSection";

// MOTEUR DE PAIE & PARAMÉTRAGE (Lot 5) — accès UNIQUE regroupant toutes les
// rubriques de la paie en accordéon, comme le classeur moteur. Chaque rubrique
// fonctionne avec les données réelles du moteur (aucun écran fictif). Les
// rubriques « Déclarations » et « Contrôles & anomalies » arrivent au sous-lot 5b.

function fcfa(n: number): string {
  return `${Math.round(n).toLocaleString("fr-FR").replace(/\s/g, " ")} FCFA`;
}
function currentPeriod(): string {
  const d = new Date();
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}
const pct = (f: number) => `${(f * 100).toLocaleString("fr-FR", { maximumFractionDigits: 2 }).replace(/\s/g, " ")} %`;

const STATUS_LABEL: Record<string, string> = {
  brouillon: "● Brouillon (modifiable)",
  soumis_dg: "⏳ Soumis au DG",
  valide: "✓ Validé (verrouillé)",
};

// ── Guide du RH : mode d'emploi pas à pas de la paie ────────────────────────
function GuideCard() {
  const step = (n: number, title: string, where: string, body: ReactNode) => (
    <li style={{ marginBottom: 10 }}>
      <div style={{ fontWeight: 700 }}>Étape {n} — {title} <span style={{ fontWeight: 400, color: "var(--muted)", fontSize: 12 }}>· {where}</span></div>
      <div style={{ fontSize: 13, marginTop: 2 }}>{body}</div>
    </li>
  );
  return (
    <Card title="Guide du RH — la paie pas à pas" icon={<span aria-hidden>📖</span>} subtitle="Mode d'emploi complet, du barème jusqu'à la clôture et aux corrections" collapsible>
      <GuidanceNote title="À lire une fois">
        Voici tout le circuit d'un mois de paie, dans l'ordre. Chaque étape indique la rubrique où la faire. Vous pouvez
        revenir à ce guide à tout moment.
      </GuidanceNote>
      <ol style={{ margin: "10px 0 0", paddingLeft: 20 }}>
        {step(0, "Vérifier le barème (une fois, ou quand la loi change)", "Paramètres",
          <>Contrôlez les taux (CNPS, IRPP, CFC…). Pour les modifier, cliquez « Nouvelle version du barème », indiquez la <b>date d'effet</b> et un <b>motif</b> : les paies déjà faites gardent leur ancien barème, la nouvelle version s'applique aux mois suivants.</>)}
        {step(1, "S'assurer que chaque salarié a une fiche paie", "Employés",
          <>Un salarié <b>sans fiche paie</b> n'apparaît pas dans la paie du mois — c'est ce que signalent les avertissements « Aucune fiche paie » dans « Contrôles et anomalies ». Créez/complétez la fiche (matricule, N° CNPS, NIU, salaire de base…). Le salaire de base saisi dans le dossier confidentiel fait foi.</>)}
        {step(2, "Préparer le mois", "Bulletins de paie",
          <>Choisissez le mois, puis « Préparer le mois de paie » : le système crée une ligne par salarié doté d'une fiche.</>)}
        {step(3, "Saisir les éléments variables de chacun", "Bulletins de paie",
          <>Primes, heures sup, retenue d'absence, retards, avances, prêts, sanctions. Le bouton <b>« ＋ lignes »</b> permet d'ajouter des lignes libres (un <b>gain</b> imposable ou une <b>retenue</b> nette). Le net se recalcule tout seul. Le mois reste <b>modifiable</b> tant qu'il n'est pas soumis.</>)}
        {step(4, "Contrôler les anomalies", "Contrôles et anomalies",
          <>Corrigez d'abord les anomalies <b style={{ color: "var(--danger, #C24B3A)" }}>bloquantes</b> (rouge : fiche manquante, salaire de base nul, net négatif). Les <b style={{ color: "var(--alert, #C4661F)" }}>avertissements</b> (orange) ne bloquent pas mais méritent vérification.</>)}
        {step(5, "Soumettre au Directeur général", "Bulletins de paie",
          <>Bouton « Soumettre au DG ». La grille se fige (en attente de validation). S'il reste une anomalie bloquante, la soumission est refusée avec le détail à corriger.</>)}
        {step(6, "Décision du DG", "Bulletins de paie",
          <>Le DG <b>valide</b> (le mois est verrouillé) <b>ou</b> le <b>retourne</b> avec un motif : il redevient modifiable, vous corrigez puis re-soumettez.</>)}
        {step(7, "Imprimer les bulletins", "Bulletins de paie / Employés",
          <>Une fois validé : « Imprimer tous les bulletins » (un PDF, un bulletin par page). Pour un seul salarié : rubrique « Employés ».</>)}
        {step(8, "Clôturer le mois", "Livre de paie",
          <>Vérifiez le livre de paie (tous les salariés du mois), puis clôturez : la période est <b>figée définitivement</b> dans le Journal de paie.</>)}
        {step(9, "Déclarations et journal", "Déclarations CNPS · Déclarations fiscales · Journal de paie",
          <>Récapitulatifs CNPS et fiscaux à transmettre (mêmes montants que les bulletins). Le journal conserve l'archive figée de chaque mois clôturé.</>)}
        {step(10, "Corriger APRÈS verrouillage (exceptionnel)", "Bulletins de paie",
          <>Erreur découverte après validation ? « Demander une réouverture » : précisez l'élément, l'ancienne valeur, la correction et le motif. Le DG autorise → le mois repasse en brouillon et refait le circuit (étapes 3 à 6).</>)}
      </ol>

      <div style={{ marginTop: 14, borderTop: "1px solid var(--line)", paddingTop: 10 }}>
        <div style={{ fontWeight: 700, marginBottom: 6 }}>Où se modifie chaque donnée du bulletin ?</div>
        <p style={{ fontSize: 12.5, color: "var(--muted)", margin: "0 0 6px" }}>
          Les données du bulletin sont réparties par nature. Le Responsable RH a accès à toutes ces modifications.
        </p>
        <div style={{ overflowX: "auto" }}>
          <table style={{ borderCollapse: "collapse", fontSize: 12.5, minWidth: 560 }}>
            <thead><tr style={{ color: "var(--muted)", textAlign: "left", fontSize: 11.5 }}>
              <th style={{ padding: "5px 8px" }}>Donnée</th><th style={{ padding: "5px 8px" }}>Où la modifier</th>
            </tr></thead>
            <tbody>
              {[
                ["Nom, prénom, poste, département, date d'embauche, date de naissance, situation familiale, nombre d'enfants, téléphone, congés", "Dossiers collaborateurs → bouton « Modifier la fiche »"],
                ["Salaire de base (confidentiel — celui qui fait foi)", "Dossiers collaborateurs → bouton « Modifier conf. »"],
                ["Matricule, N° CNPS, NIU, brut contractuel, catégorie, mode de paiement, N° de compte", "Moteur de paie → rubrique « Fiches paie & bulletin »"],
                ["Primes, heures sup, absences, retards, avances, prêts, sanctions, lignes libres, modifier une ligne (par MOIS)", "Moteur de paie → « Bulletins de paie » (grille + bouton « ＋ lignes »)"],
                ["Taux et formules de calcul (CNPS, IRPP, CFC…)", "Moteur de paie → « Paramètres » et « Paramètres et formules de calcul »"],
              ].map(([d, w], i) => (
                <tr key={i} style={{ borderTop: "1px solid var(--line)" }}>
                  <td style={{ padding: "5px 8px" }}>{d}</td>
                  <td style={{ padding: "5px 8px", color: "var(--muted)" }}>{w}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p style={{ fontSize: 12, color: "var(--muted)", marginTop: 6 }}>
          Les 3 premières lignes sont des données <b>permanentes</b> du salarié ; les éléments variables (4ᵉ ligne) se saisissent chaque mois sur la grille.
        </p>
      </div>
    </Card>
  );
}

// ── Accueil : point d'entrée + état du mois courant ─────────────────────────
function AccueilCard() {
  const [month, setMonth] = useState<PayrollMonth | null>(null);
  const period = currentPeriod();
  useEffect(() => {
    getPayrollMonth(period).then(setMonth).catch(() => setMonth(null));
  }, [period]);
  return (
    <Card title="Accueil" icon={<span aria-hidden>🏠</span>} subtitle="Point d'entrée du moteur de paie" collapsible defaultOpen>
      <p style={{ margin: "0 0 8px", fontSize: 13 }}>
        Ce centre regroupe tout le moteur de paie : paramètres, fiches, génération des bulletins, livre et journal de paie,
        déclarations et contrôles. Le circuit d'un mois de paie est :
      </p>
      <ol style={{ margin: "0 0 10px 18px", fontSize: 13, lineHeight: 1.6 }}>
        <li>Vérifier le <b>barème</b> (Paramètres) et les <b>fiches paie</b> (Employés).</li>
        <li><b>Préparer le mois</b> et saisir les éléments variables (Bulletins de paie).</li>
        <li><b>Soumettre au Directeur général</b>, qui valide (verrouillage) ou retourne pour correction.</li>
        <li>Imprimer les bulletins, puis <b>clôturer</b> vers le journal de paie.</li>
      </ol>
      <div style={{ fontSize: 13 }}>
        Mois courant <b style={{ fontFamily: "var(--font-mono)" }}>{period}</b> :{" "}
        {month?.exists ? (
          <span>{STATUS_LABEL[month.status ?? "brouillon"]} — {month.lines?.length ?? 0} salarié(s).</span>
        ) : (
          <span style={{ color: "var(--muted)" }}>non préparé (rubrique « Bulletins de paie » pour le préparer).</span>
        )}
      </div>
    </Card>
  );
}

// ── Tableau de bord : indicateurs du mois (données réelles) ─────────────────
function DashboardCard() {
  const [period, setPeriod] = useState(currentPeriod());
  const [month, setMonth] = useState<PayrollMonth | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    setErr(null);
    getPayrollMonth(period).then(setMonth).catch((e) => { setMonth(null); setErr(e instanceof Error ? e.message : "Chargement impossible."); });
  }, [period]);
  const t = month?.totals;
  const tile = (label: string, value: string) => (
    <div style={{ border: "1px solid var(--line)", borderRadius: 8, padding: "10px 12px", minWidth: 150 }}>
      <div style={{ fontSize: 11.5, color: "var(--muted)" }}>{label}</div>
      <div style={{ fontFamily: "var(--font-mono)", fontSize: 16, fontWeight: 700, color: "var(--ink)" }}>{value}</div>
    </div>
  );
  return (
    <Card title="Tableau de bord" icon={<span aria-hidden>📊</span>} subtitle="Indicateurs de la paie du mois" collapsible>
      <label style={{ fontSize: 13 }}>Mois : <input type="month" value={period} onChange={(e) => setPeriod(e.target.value)} style={{ fontFamily: "var(--font-mono)" }} /></label>
      {err && <p style={{ fontSize: 12.5, color: "var(--alert, #C4661F)" }}>{err}</p>}
      {month?.exists ? (
        <>
          <div style={{ margin: "10px 0" }}>{STATUS_LABEL[month.status ?? "brouillon"]}{month.validated_at ? ` — le ${month.validated_at.slice(0, 10)}` : ""}</div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
            {tile("Salariés", String(month.lines?.length ?? 0))}
            {tile("Masse brute", fcfa(t?.brut ?? 0))}
            {tile("Total net à payer", fcfa(t?.net ?? 0))}
            {tile("Coût employeur", fcfa(t?.cout ?? 0))}
          </div>
          {month.return_reason && month.status === "brouillon" && (
            <p style={{ fontSize: 12.5, color: "var(--alert, #C4661F)", marginTop: 8 }}>↩ Retourné par la Direction : {month.return_reason}</p>
          )}
        </>
      ) : (
        <p style={{ fontSize: 13, color: "var(--muted)", marginTop: 8 }}>Mois non préparé : rendez-vous dans « Bulletins de paie » pour le préparer.</p>
      )}
    </Card>
  );
}

// ── Journal de paie : instantané figé d'une période clôturée ────────────────
function JournalCard() {
  const [period, setPeriod] = useState(currentPeriod());
  const [journal, setJournal] = useState<PayrollJournal | null>(null);
  const [state, setState] = useState<"loading" | "ok" | "none">("loading");
  useEffect(() => {
    setState("loading");
    getPayrollJournal(period).then((j) => { setJournal(j); setState("ok"); }).catch(() => { setJournal(null); setState("none"); });
  }, [period]);
  return (
    <Card title="Journal de paie" icon={<span aria-hidden>📚</span>} subtitle="Périodes clôturées (figées, définitives)" collapsible>
      <label style={{ fontSize: 13 }}>Mois : <input type="month" value={period} onChange={(e) => setPeriod(e.target.value)} style={{ fontFamily: "var(--font-mono)" }} /></label>
      {state === "loading" && <p style={{ fontSize: 13, color: "var(--muted)" }}>Chargement…</p>}
      {state === "none" && <p style={{ fontSize: 13, color: "var(--muted)", marginTop: 8 }}>Période non clôturée : le journal est alimenté à la clôture du livre de paie (rubrique « Livre de paie »).</p>}
      {state === "ok" && journal && (
        <>
          <div style={{ fontSize: 13, margin: "8px 0" }}>
            Clôturé le <b>{new Date(journal.closed_at).toLocaleDateString("fr-FR")}</b> · {journal.employees} salarié(s) · Net total{" "}
            <b style={{ fontFamily: "var(--font-mono)" }}>{fcfa(journal.totals.net)}</b>
          </div>
          <div style={{ overflowX: "auto" }}>
            <table style={{ borderCollapse: "collapse", fontSize: 12, minWidth: 620 }}>
              <thead>
                <tr style={{ textAlign: "right", color: "var(--muted)", fontSize: 11 }}>
                  <th style={{ textAlign: "left", padding: "4px 8px" }}>Salarié</th>
                  <th style={{ padding: "4px 8px" }}>Brut</th>
                  <th style={{ padding: "4px 8px" }}>Retenues sal.</th>
                  <th style={{ padding: "4px 8px" }}>Net</th>
                  <th style={{ padding: "4px 8px" }}>Coût employeur</th>
                </tr>
              </thead>
              <tbody>
                {journal.lines.map((l) => (
                  <tr key={l.employee_id} style={{ borderTop: "1px solid var(--line)", fontFamily: "var(--font-mono)" }}>
                    <td style={{ textAlign: "left", padding: "4px 8px", fontFamily: "inherit" }}>{l.employee_name}</td>
                    <td style={{ textAlign: "right", padding: "4px 8px" }}>{fcfa(l.salaire_brut)}</td>
                    <td style={{ textAlign: "right", padding: "4px 8px" }}>{fcfa(l.total_retenues_salariales)}</td>
                    <td style={{ textAlign: "right", padding: "4px 8px", fontWeight: 700, color: "var(--eclosion, #C89A1B)" }}>{fcfa(l.net_a_payer)}</td>
                    <td style={{ textAlign: "right", padding: "4px 8px" }}>{fcfa(l.cout_employeur)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </Card>
  );
}

// ── Paramètres & formules de calcul (lecture) ───────────────────────────────
function FormulasCard() {
  const [rs, setRs] = useState<PayrollRateSet | null>(null);
  useEffect(() => {
    getPayrollRateSet(`${currentPeriod()}-01`).then(setRs).catch(() => setRs(null));
  }, []);
  const row = (name: string, formula: string, value: string) => (
    <tr style={{ borderTop: "1px solid var(--line)" }}>
      <td style={{ padding: "5px 8px", fontWeight: 600 }}>{name}</td>
      <td style={{ padding: "5px 8px", color: "var(--muted)" }}>{formula}</td>
      <td style={{ padding: "5px 8px", textAlign: "right", fontFamily: "var(--font-mono)" }}>{value}</td>
    </tr>
  );
  return (
    <Card title="Paramètres et formules de calcul" icon={<span aria-hidden>🧮</span>} subtitle="Règles du moteur (lecture) — modification dans « Modifier les formules de calcul »" collapsible>
      <GuidanceNote title="Règles de calcul du moteur">
        Ces formules sont celles réellement appliquées par le moteur. Les taux ci-dessous proviennent du barème en vigueur
        (modifiable dans « Paramètres »). Pour <b>changer une formule</b> (cotisations, salaire brut, prime d'ancienneté),
        rendez-vous dans la rubrique « Modifier les formules de calcul » ci-dessous.
      </GuidanceNote>
      {!rs && <p style={{ fontSize: 13, color: "var(--alert, #C4661F)" }}>Aucun barème en vigueur pour ce mois : renseignez-le dans « Paramètres ».</p>}
      {rs && (
        <div style={{ fontSize: 12.5, margin: "0 0 8px", color: "var(--muted)" }}>
          Période d'application : effet le <b style={{ fontFamily: "var(--font-mono)", color: "var(--ink)" }}>{rs.effective_from}</b> ·
          statut <b style={{ color: rs.active ? "var(--eclosion, #C89A1B)" : "var(--muted)" }}>{rs.active ? "actif" : "inactif"}</b>
          {rs.change_reason ? <> · motif : {rs.change_reason}</> : null}
          {rs.label ? <> · {rs.label}</> : null}
        </div>
      )}
      {rs && (
        <div style={{ overflowX: "auto" }}>
          <table style={{ borderCollapse: "collapse", fontSize: 12.5, minWidth: 560 }}>
            <thead><tr style={{ color: "var(--muted)", textAlign: "left", fontSize: 11.5 }}><th style={{ padding: "5px 8px" }}>Règle</th><th style={{ padding: "5px 8px" }}>Formule</th><th style={{ padding: "5px 8px", textAlign: "right" }}>Taux / valeur</th></tr></thead>
            <tbody>
              {row("Salaire brut", "base + compléments + prime ancienneté − retenue absence", "—")}
              {row("Assiette CNPS", "min(assiette fiscale × coefficient ; plafond)", `coef ${pct(rs.misc.coef_assiette)} · plaf. ${fcfa(rs.cnps.ceiling)}`)}
              {row("CNPS – PVID (sal./pat.)", "assiette CNPS × taux", `${pct(rs.cnps.vid_sal_pct)} / ${pct(rs.cnps.vid_pat_pct)}`)}
              {row("CNPS – Prestations familiales", "assiette CNPS × taux (patronal)", pct(rs.cnps.pf_pct))}
              {row("CNPS – Accidents du travail", "assiette CNPS × taux (patronal)", pct(rs.cnps.at_pct))}
              {row("CFC (sal./pat.)", "assiette fiscale × taux", `${pct(rs.fiscal.cfc_sal_pct)} / ${pct(rs.fiscal.cfc_pat_pct)}`)}
              {row("FNE", "assiette fiscale × taux (patronal)", pct(rs.fiscal.fne_pct))}
              {row("IRPP", "barème progressif annuel/part après abattements", `abat. ${pct(rs.fiscal.abat_pct)} + ${fcfa(rs.fiscal.abat_fixe)}`)}
              {row("CAC", "IRPP × taux", pct(rs.fiscal.cac_pct))}
              {row("Prime d'ancienneté (défaut)", "base × taux (si applicable)", pct(rs.misc.anc_def_pct))}
              {row("Net à payer", "brut − retenues salariales − retenues internes", "—")}
              {row("Coût employeur", "brut + charges patronales", "—")}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

// ── Modifier les formules de calcul (RH, avec motif) ────────────────────────
function FormulaEditorRow({ f, canManage, onSaved }: { f: PayrollFormula; canManage: boolean; onSaved: () => void }) {
  const [open, setOpen] = useState(false);
  const [expr, setExpr] = useState(f.expression);
  const [reason, setReason] = useState("");
  const [test, setTest] = useState<{ ok: boolean; default_result: number; result?: number; error?: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const changed = expr.trim() !== f.expression.trim();
  const canSave = canManage && changed && reason.trim().length >= 3 && test?.ok === true;

  const runTest = async () => {
    setMsg(null);
    try {
      const r = await testPayrollFormula(f.code, expr.trim());
      setTest(r);
    } catch {
      setTest({ ok: false, default_result: 0, error: "Impossible de tester la formule." });
    }
  };
  const save = async () => {
    if (!canSave) return;
    setBusy(true); setMsg(null);
    try {
      await updatePayrollFormula(f.code, { custom: true, expression: expr.trim(), change_reason: reason.trim() });
      setMsg("Formule enregistrée. Elle s'applique désormais à tous les bulletins.");
      setReason(""); setTest(null); setOpen(false);
      onSaved();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Échec de l'enregistrement.");
    } finally { setBusy(false); }
  };
  const reset = async () => {
    if (!canManage || reason.trim().length < 3) { setMsg("Indiquez d'abord un motif (au moins 3 caractères)."); return; }
    setBusy(true); setMsg(null);
    try {
      await updatePayrollFormula(f.code, { custom: false, change_reason: reason.trim() });
      setMsg("Formule réinitialisée au calcul par défaut.");
      setReason(""); setTest(null); setOpen(false);
      onSaved();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Échec de la réinitialisation.");
    } finally { setBusy(false); }
  };

  return (
    <div style={{ borderTop: "1px solid var(--line)", padding: "10px 0" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 10, flexWrap: "wrap" }}>
        <div style={{ fontWeight: 700 }}>
          {f.label}
          {f.custom
            ? <span style={{ marginLeft: 8, fontSize: 11, color: "var(--eclosion, #C89A1B)", fontWeight: 700 }}>● personnalisée</span>
            : <span style={{ marginLeft: 8, fontSize: 11, color: "var(--muted)" }}>par défaut</span>}
        </div>
        {canManage && (
          <Button variant="edit" size="sm" type="button" onClick={() => { setOpen((o) => !o); setExpr(f.expression); setReason(""); setTest(null); setMsg(null); }}>
            {open ? "Fermer" : "Modifier"}
          </Button>
        )}
      </div>
      <div style={{ fontSize: 12.5, color: "var(--muted)", marginTop: 2 }}>{f.description}</div>
      <div style={{ fontFamily: "var(--font-mono)", fontSize: 12.5, marginTop: 4 }}>{f.expression}</div>

      {open && (
        <div style={{ marginTop: 8, background: "var(--surface-2, #F0F2F6)", borderRadius: 8, padding: 10 }}>
          <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 4 }}>
            Variables disponibles : <span style={{ fontFamily: "var(--font-mono)" }}>{f.variables.join(", ")}</span> · fonctions : <span style={{ fontFamily: "var(--font-mono)" }}>min, max, round, floor, ceil, abs</span>
          </div>
          <textarea
            value={expr}
            onChange={(e) => { setExpr(e.target.value); setTest(null); }}
            rows={2}
            style={{ width: "100%", fontFamily: "var(--font-mono)", fontSize: 13, padding: 8, borderRadius: 6, border: "1px solid var(--line)", boxSizing: "border-box" }}
          />
          <div style={{ fontSize: 12, marginTop: 4 }}>
            Défaut : <span style={{ fontFamily: "var(--font-mono)", color: "var(--muted)" }}>{f.default_expression}</span>
          </div>
          <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 8, flexWrap: "wrap" }}>
            <Button variant="view" size="sm" type="button" onClick={runTest} disabled={!expr.trim()}>Tester</Button>
            {test && (test.ok
              ? <span style={{ fontSize: 12.5, fontFamily: "var(--font-mono)" }}>Sur un exemple : <b>{Math.round(test.default_result).toLocaleString("fr-FR")}</b> → <b style={{ color: "var(--eclosion, #C89A1B)" }}>{Math.round(test.result ?? 0).toLocaleString("fr-FR")}</b> FCFA</span>
              : <span style={{ fontSize: 12.5, color: "var(--critical, #C24B3A)" }}>{test.error}</span>)}
          </div>
          <label style={{ display: "block", fontSize: 12, marginTop: 8, fontWeight: 600 }}>
            Motif de la modification (obligatoire)
            <input
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="ex. : révision du taux CFC (loi de finances)"
              style={{ display: "block", width: "100%", marginTop: 3, padding: 7, borderRadius: 6, border: "1px solid var(--line)", boxSizing: "border-box", fontSize: 13 }}
            />
          </label>
          <div style={{ display: "flex", gap: 8, marginTop: 8, flexWrap: "wrap" }}>
            <Button variant="add" size="sm" type="button" onClick={save} disabled={!canSave || busy}>Enregistrer la formule</Button>
            {f.custom && <Button variant="subtle" size="sm" type="button" onClick={reset} disabled={busy}>Réinitialiser au défaut</Button>}
          </div>
          {!canSave && changed && (
            <div style={{ fontSize: 11.5, color: "var(--muted)", marginTop: 4 }}>
              Pour enregistrer : testez la formule (résultat valide) et saisissez un motif d'au moins 3 caractères.
            </div>
          )}
        </div>
      )}
      {msg && <div style={{ fontSize: 12.5, marginTop: 6, color: msg.startsWith("Échec") || msg.startsWith("Indiquez") ? "var(--critical, #C24B3A)" : "var(--eclosion, #C89A1B)" }}>{msg}</div>}
    </div>
  );
}

function FormulaEditorCard({ canManage }: { canManage: boolean }) {
  const [formulas, setFormulas] = useState<PayrollFormula[] | null>(null);
  const load = () => { listPayrollFormulas().then(setFormulas).catch(() => setFormulas([])); };
  useEffect(load, []);
  return (
    <Card title="Modifier les formules de calcul" icon={<span aria-hidden>🛠️</span>} subtitle="Formules des cotisations, du brut et de la prime d'ancienneté — modifiables avec motif" collapsible>
      <GuidanceNote title="Attention — ces formules pilotent les paies réelles">
        Une formule modifiée s'applique <b>à tous les bulletins</b> recalculés. Testez toujours avant d'enregistrer, et
        indiquez un <b>motif</b> (tracé dans l'historique). En cas de doute, laissez la formule « par défaut ». L'IRPP et la
        Taxe communale/RAV ne sont pas ici : ce sont des barèmes par tranches, réglés dans « Paramètres ».
      </GuidanceNote>
      {!canManage && <p style={{ fontSize: 13, color: "var(--muted)" }}>Vous pouvez consulter les formules ; leur modification requiert l'habilitation « administration de la paie ».</p>}
      {formulas == null && <p style={{ fontSize: 13, color: "var(--muted)" }}>Chargement…</p>}
      {formulas && formulas.length === 0 && <p style={{ fontSize: 13, color: "var(--muted)" }}>Aucune formule paramétrable.</p>}
      {formulas && formulas.map((f) => <FormulaEditorRow key={f.code} f={f} canManage={canManage} onSaved={load} />)}
    </Card>
  );
}

// ── Historique des modifications (journal d'audit, filtré paie) ─────────────
const AUDIT_LABEL: Record<string, string> = {
  create: "Création", update: "Modification", delete: "Suppression",
  status_change: "Changement d'état", validate: "Validation", export: "Export", view_sensitive: "Consultation sensible",
};
const ENTITY_LABEL: Record<string, string> = {
  payroll_monthly_run: "Mois de paie", payroll_employee_profile: "Fiche paie", payroll_rate_set: "Barème",
  payroll_closure: "Clôture", payslip: "Bulletin", payslip_email: "Envoi bulletin",
};
function HistoryCard() {
  const [rows, setRows] = useState<AuditEntry[]>([]);
  const [state, setState] = useState<"loading" | "ok">("loading");
  useEffect(() => {
    Promise.all([
      listAuditLog({ entity_type: "payroll_monthly_run", limit: 40 }),
      listAuditLog({ entity_type: "payroll_employee_profile", limit: 40 }),
      listAuditLog({ entity_type: "payroll_rate_set", limit: 20 }),
      listAuditLog({ entity_type: "payroll_closure", limit: 20 }),
    ])
      .then((lists) => {
        const merged = lists.flatMap((l) => l.entries).sort((a, b) => b.occurredAt.localeCompare(a.occurredAt)).slice(0, 60);
        setRows(merged);
        setState("ok");
      })
      .catch(() => setState("ok"));
  }, []);
  return (
    <Card title="Historique des modifications" icon={<span aria-hidden>🕑</span>} subtitle="Traçabilité des actions sur la paie (inviolable)" collapsible>
      {state === "loading" && <p style={{ fontSize: 13, color: "var(--muted)" }}>Chargement…</p>}
      {state === "ok" && rows.length === 0 && <p style={{ fontSize: 13, color: "var(--muted)" }}>Aucune action enregistrée pour l'instant.</p>}
      {rows.length > 0 && (
        <div style={{ overflowX: "auto" }}>
          <table style={{ borderCollapse: "collapse", fontSize: 12.5, minWidth: 560 }}>
            <thead><tr style={{ color: "var(--muted)", textAlign: "left", fontSize: 11.5 }}><th style={{ padding: "4px 8px" }}>Date</th><th style={{ padding: "4px 8px" }}>Objet</th><th style={{ padding: "4px 8px" }}>Action</th><th style={{ padding: "4px 8px" }}>Par</th></tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} style={{ borderTop: "1px solid var(--line)" }}>
                  <td style={{ padding: "4px 8px", fontFamily: "var(--font-mono)", whiteSpace: "nowrap" }}>{new Date(r.occurredAt).toLocaleString("fr-FR")}</td>
                  <td style={{ padding: "4px 8px" }}>{ENTITY_LABEL[r.entityType] ?? r.entityType}{r.entityId ? <span style={{ color: "var(--muted)" }}> · {r.entityId}</span> : null}</td>
                  <td style={{ padding: "4px 8px" }}>{AUDIT_LABEL[r.action] ?? r.action}</td>
                  <td style={{ padding: "4px 8px", color: "var(--muted)" }}>{r.username ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

// ── Contrôles et anomalies (§18) : bloquantes / signalées ───────────────────
function AnomaliesCard() {
  const [period, setPeriod] = useState(currentPeriod());
  const [data, setData] = useState<PayrollAnomalies | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    setErr(null);
    getMonthlyAnomalies(period).then(setData).catch((e) => { setData(null); setErr(e instanceof Error ? e.message : "Contrôle impossible."); });
  }, [period]);
  const list = (rows: PayrollAnomalies["blocking"], color: string) => (
    <ul style={{ margin: "4px 0 0 18px", fontSize: 12.5, color, lineHeight: 1.5 }}>
      {rows.map((a, i) => <li key={i}><b>{a.employee_name}</b> — {a.message}</li>)}
    </ul>
  );
  return (
    <Card title="Contrôles et anomalies" icon={<span aria-hidden>🚦</span>} subtitle="Vérification avant soumission au Directeur général" collapsible>
      <label style={{ fontSize: 13 }}>Mois : <input type="month" value={period} onChange={(e) => setPeriod(e.target.value)} style={{ fontFamily: "var(--font-mono)" }} /></label>
      {err && <p style={{ fontSize: 12.5, color: "var(--muted)", marginTop: 8 }}>{err}</p>}
      {data && (
        <div style={{ marginTop: 8 }}>
          {data.blocking.length === 0 && data.warnings.length === 0 && (
            <div style={{ background: "var(--eclosion-soft, #f3efdc)", color: "var(--ink)", borderRadius: 8, padding: "8px 12px", fontSize: 13 }}>✓ Aucune anomalie : la paie peut être soumise au Directeur général.</div>
          )}
          {data.blocking.length > 0 && (
            <div style={{ background: "#f8e3df", border: "1px solid var(--danger, #C24B3A)", borderRadius: 8, padding: "8px 12px" }}>
              <b style={{ color: "var(--danger, #C24B3A)" }}>⛔ {data.blocking.length} anomalie(s) bloquante(s) — la soumission est refusée :</b>
              {list(data.blocking, "var(--danger, #C24B3A)")}
            </div>
          )}
          {data.warnings.length > 0 && (
            <div style={{ marginTop: 8, background: "#fdeede", border: "1px solid var(--alert, #C4661F)", borderRadius: 8, padding: "8px 12px" }}>
              <b style={{ color: "var(--alert, #C4661F)" }}>⚠ {data.warnings.length} point(s) à vérifier (non bloquant) :</b>
              {list(data.warnings, "var(--alert, #C4661F)")}
            </div>
          )}
        </div>
      )}
    </Card>
  );
}

// ── Déclarations CNPS / fiscales : agrégées depuis la paie du mois ───────────
function DeclarationsCard({ kind }: { kind: "cnps" | "fiscal" }) {
  const [period, setPeriod] = useState(currentPeriod());
  const [month, setMonth] = useState<PayrollMonth | null>(null);
  const [state, setState] = useState<"loading" | "ok" | "none">("loading");
  useEffect(() => {
    setState("loading");
    getPayrollMonth(period).then((m) => { setMonth(m); setState(m.exists ? "ok" : "none"); }).catch(() => { setMonth(null); setState("none"); });
  }, [period]);
  const cols = kind === "cnps"
    ? [
        { k: "assiette_cnps", label: "Assiette CNPS" },
        { k: "pvid_salarie", label: "PVID salarié" },
        { k: "pvid_patronal", label: "PVID patronal" },
        { k: "prestations_familiales", label: "Prest. familiales" },
        { k: "accidents_travail", label: "Accidents travail" },
      ] as const
    : [
        { k: "irpp_cac", label: "IRPP + CAC" },
        { k: "cfc_salarie", label: "CFC salarié" },
        { k: "cfc_patronal", label: "CFC patronal" },
        { k: "taxe_communale", label: "Taxe communale" },
        { k: "rav", label: "RAV" },
        { k: "fne", label: "FNE" },
      ] as const;
  const rows = month?.lines ?? [];
  const total = (k: string) => rows.reduce((s, l) => s + ((l.payslip as unknown as Record<string, number>)[k] ?? 0), 0);
  const title = kind === "cnps" ? "Déclarations CNPS" : "Déclarations fiscales";
  const icon = kind === "cnps" ? "🏛️" : "🧾";
  return (
    <Card title={title} icon={<span aria-hidden>{icon}</span>} subtitle="Récapitulatif des cotisations du mois (même calcul que les bulletins)" collapsible>
      <label style={{ fontSize: 13 }}>Mois : <input type="month" value={period} onChange={(e) => setPeriod(e.target.value)} style={{ fontFamily: "var(--font-mono)" }} /></label>
      {state === "loading" && <p style={{ fontSize: 13, color: "var(--muted)" }}>Chargement…</p>}
      {state === "none" && <p style={{ fontSize: 13, color: "var(--muted)", marginTop: 8 }}>Mois non préparé : préparez-le dans « Bulletins de paie ».</p>}
      {state === "ok" && (
        <div style={{ overflowX: "auto", marginTop: 8 }}>
          <table style={{ borderCollapse: "collapse", fontSize: 12, minWidth: 640 }}>
            <thead>
              <tr style={{ color: "var(--muted)", fontSize: 11, textAlign: "right" }}>
                <th style={{ textAlign: "left", padding: "4px 8px" }}>Salarié</th>
                {cols.map((c) => <th key={c.k} style={{ padding: "4px 8px" }}>{c.label}</th>)}
              </tr>
            </thead>
            <tbody>
              {rows.map((l) => (
                <tr key={l.employee_id} style={{ borderTop: "1px solid var(--line)", fontFamily: "var(--font-mono)" }}>
                  <td style={{ textAlign: "left", padding: "4px 8px", fontFamily: "inherit" }}>{l.employee_name}</td>
                  {cols.map((c) => <td key={c.k} style={{ textAlign: "right", padding: "4px 8px" }}>{fcfa((l.payslip as unknown as Record<string, number>)[c.k] ?? 0)}</td>)}
                </tr>
              ))}
              <tr style={{ borderTop: "2px solid var(--line)", fontFamily: "var(--font-mono)", fontWeight: 700 }}>
                <td style={{ textAlign: "left", padding: "4px 8px", fontFamily: "inherit" }}>TOTAL</td>
                {cols.map((c) => <td key={c.k} style={{ textAlign: "right", padding: "4px 8px" }}>{fcfa(total(c.k))}</td>)}
              </tr>
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

// ── Retenues internes du mois : synthèse par salarié (données réelles) ──────
function InternesCard() {
  const [period, setPeriod] = useState(currentPeriod());
  const [month, setMonth] = useState<PayrollMonth | null>(null);
  const [state, setState] = useState<"loading" | "ok" | "none">("loading");
  useEffect(() => {
    setState("loading");
    getPayrollMonth(period).then((m) => { setMonth(m); setState(m.exists ? "ok" : "none"); }).catch(() => { setMonth(null); setState("none"); });
  }, [period]);
  const rows = (month?.lines ?? []).map((l) => {
    const e = l.elements;
    const libres = (l.extra_lines ?? []).filter((x) => x.kind === "retenue").reduce((s, x) => s + x.amount, 0);
    return { id: l.employee_id, name: l.employee_name, avance: e.avance, pret: e.pret, retard: e.retard, sanction: e.sanction, autres: e.autres, libres, total: l.payslip.total_retenues_internes };
  });
  const cols = [
    { k: "avance", label: "Avance" }, { k: "pret", label: "Prêt" }, { k: "retard", label: "Retard" },
    { k: "sanction", label: "Sanction" }, { k: "autres", label: "Autres" }, { k: "libres", label: "Lignes libres" },
  ] as const;
  const sum = (k: string) => rows.reduce((s, r) => s + ((r as unknown as Record<string, number>)[k] ?? 0), 0);
  const totalAll = rows.reduce((s, r) => s + r.total, 0);
  return (
    <Card title="Retenues internes" icon={<span aria-hidden>➖</span>} subtitle="Synthèse du mois par salarié (avances, prêts, retards, sanctions, lignes libres)" collapsible>
      <GuidanceNote title="Retenues internes du mois">
        Ces montants se saisissent par salarié dans « Bulletins de paie » (colonnes de la grille et bouton « ＋ lignes »).
        Cette vue en donne la synthèse. Les retenues internes viennent en déduction du net à payer.
      </GuidanceNote>
      <label style={{ fontSize: 13 }}>Mois : <input type="month" value={period} onChange={(e) => setPeriod(e.target.value)} style={{ fontFamily: "var(--font-mono)" }} /></label>
      {state === "loading" && <p style={{ fontSize: 13, color: "var(--muted)" }}>Chargement…</p>}
      {state === "none" && <p style={{ fontSize: 13, color: "var(--muted)", marginTop: 8 }}>Mois non préparé : préparez-le dans « Bulletins de paie ».</p>}
      {state === "ok" && (
        rows.every((r) => r.total === 0) ? (
          <p style={{ fontSize: 13, color: "var(--muted)", marginTop: 8 }}>Aucune retenue interne saisie pour ce mois.</p>
        ) : (
          <div style={{ overflowX: "auto", marginTop: 8 }}>
            <table style={{ borderCollapse: "collapse", fontSize: 12, minWidth: 680 }}>
              <thead>
                <tr style={{ color: "var(--muted)", fontSize: 11, textAlign: "right" }}>
                  <th style={{ textAlign: "left", padding: "4px 8px" }}>Salarié</th>
                  {cols.map((c) => <th key={c.k} style={{ padding: "4px 8px" }}>{c.label}</th>)}
                  <th style={{ padding: "4px 8px" }}>Total interne</th>
                </tr>
              </thead>
              <tbody>
                {rows.filter((r) => r.total > 0).map((r) => (
                  <tr key={r.id} style={{ borderTop: "1px solid var(--line)", fontFamily: "var(--font-mono)" }}>
                    <td style={{ textAlign: "left", padding: "4px 8px", fontFamily: "inherit" }}>{r.name}</td>
                    {cols.map((c) => <td key={c.k} style={{ textAlign: "right", padding: "4px 8px" }}>{fcfa((r as unknown as Record<string, number>)[c.k] ?? 0)}</td>)}
                    <td style={{ textAlign: "right", padding: "4px 8px", fontWeight: 700 }}>{fcfa(r.total)}</td>
                  </tr>
                ))}
                <tr style={{ borderTop: "2px solid var(--line)", fontFamily: "var(--font-mono)", fontWeight: 700 }}>
                  <td style={{ textAlign: "left", padding: "4px 8px", fontFamily: "inherit" }}>TOTAL</td>
                  {cols.map((c) => <td key={c.k} style={{ textAlign: "right", padding: "4px 8px" }}>{fcfa(sum(c.k))}</td>)}
                  <td style={{ textAlign: "right", padding: "4px 8px", color: "var(--eclosion, #C89A1B)" }}>{fcfa(totalAll)}</td>
                </tr>
              </tbody>
            </table>
          </div>
        )
      )}
    </Card>
  );
}

export function PayrollEngineHub({
  employees, canEditPayroll, canValidatePayrollDg, canManagePayroll, canClosePayroll,
}: {
  employees: Employee[];
  canEditPayroll: boolean;
  canValidatePayrollDg: boolean;
  canManagePayroll: boolean;
  canClosePayroll: boolean;
}) {
  return (
    <section style={{ marginTop: 8 }}>
      <h3 style={{ fontFamily: "var(--font-title)", fontSize: 18, margin: "0 0 8px", display: "flex", alignItems: "center", gap: 8 }}>
        <span aria-hidden>💶</span> Moteur de Paie &amp; Paramétrage
      </h3>
      <GuidanceNote title="Moteur de Paie & Paramétrage">
        Toutes les fonctions de la paie sont réunies ici, en une seule liste. Cliquez sur une rubrique pour l'ouvrir. Le moteur
        reste la source unique des montants : bulletins, livre et journal de paie utilisent tous le même calcul.
      </GuidanceNote>
      <div style={{ display: "grid", gap: 10 }}>
        <GuideCard />
        <AccueilCard />
        <DashboardCard />
        <PayrollSettingsSection canManage={canManagePayroll} collapsible />
        <PayrollProfilesSection employees={employees} canManage={canEditPayroll} collapsible />
        <InternesCard />
        <PayrollRegisterSection canClose={canClosePayroll} collapsible />
        <PayrollMonthlySection canManage={canEditPayroll} canValidateDg={canValidatePayrollDg} collapsible />
        <JournalCard />
        <DeclarationsCard kind="cnps" />
        <DeclarationsCard kind="fiscal" />
        <FormulasCard />
        <FormulaEditorCard canManage={canManagePayroll} />
        <HistoryCard />
        <AnomaliesCard />
      </div>
    </section>
  );
}
