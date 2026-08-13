import { useEffect, useState } from "react";
import {
  createAbsence,
  createAccessReview,
  createEmployee,
  decideAbsence,
  decideAccessReviewItem,
  getEmployeeConfidential,
  grantRole,
  listAbsences,
  listAccessAnomalies,
  listAccessReviewItems,
  listAccessReviews,
  listDepartments,
  listEmployees,
  getContractAlerts,
  type ContractAlert,
  listRoles,
  reinstateEmployee,
  setEmployeeDeparture,
  suspendEmployee,
  updateEmployee,
  updateEmployeeConfidential,
  type AbsenceStatus,
  type AbsenceType,
  type AccessAnomaly,
  type AccessReview,
  type AccessReviewItem,
  type Absence,
  type Department,
  type Employee,
  type EmployeeStatus,
  type RoleSummary,
} from "../api/client";
import { Card } from "../components/Card";
import { StandardActionBar } from "../components/StandardActionBar";
import { OrgChart } from "../components/OrgChart";
import { RecruitmentSection } from "../components/RecruitmentSection";
import { FormationSection } from "../components/FormationSection";
import { ContractsModal } from "../components/ContractsModal";
import { EvaluationsModal } from "../components/EvaluationsModal";
import { printEmployeeFiche } from "../lib/print";
import { GuidanceNote } from "../components/GuidanceNote";
import { Modal, Field } from "../components/Modal";
import { Button } from "../components/Button";
import { IconAdmin } from "../components/icons";
import { ErpConnectionsSection } from "../components/ErpConnectionsSection";
import { ActivityClosureSection } from "../components/ActivityClosureSection";
import { useI18n } from "../i18n";
import { PayrollEngineHub } from "../components/PayrollEngineHub";

const STATUS_LABELS: Record<EmployeeStatus, string> = {
  salarie: "Salarié",
  prestataire_externe: "Prestataire externe",
  stagiaire: "Stagiaire",
  benevole: "Bénévole",
};

const ABSENCE_TYPE_LABELS: Record<AbsenceType, string> = {
  conge: "Congé",
  maladie: "Maladie",
  mission: "Mission",
  teletravail: "Télétravail",
};

const ABSENCE_STATUS_LABELS: Record<AbsenceStatus, string> = {
  en_attente: "En attente",
  validee: "Validée",
  refusee: "Refusée",
};

interface HrPageProps {
  canManage: boolean;
  canAdminister: boolean;
  canValidateAbsence: boolean;
  canManageUsers: boolean;
  canReadConfidential: boolean;
  canWriteConfidential: boolean;
  // Module « Présences » : administration des horaires/jours fériés (presences:administration).
  canAdministerPresence: boolean;
  // Module « Présences » : validation des anomalies (presences:validation).
  canValidatePresence: boolean;
  // Module « Présences » : accès au tableau de bord et rapports agrégés.
  canOverseePresence: boolean;
  // Module « Paie » (D-007) : consultation / administration des paramètres.
  canViewPayroll: boolean;
  canManagePayroll: boolean;
  // Saisie des fiches paie (paie:saisie).
  canEditPayroll: boolean;
  // Clôture d'une période de paie (paie:validation).
  canClosePayroll: boolean;
  // Validation définitive du mois de paie — réservée au Directeur général.
  canValidatePayrollDg: boolean;
}

type HrModal =
  | {
      kind: "employee";
      firstName: string;
      lastName: string;
      status: EmployeeStatus;
      position: string;
      departmentId: string;
      managerId: string;
      birthDate: string;
      hireDate: string;
      // Ouverture d'un compte de connexion à l'embauche (facultatif).
      createAccount: boolean;
      username: string;
      email: string;
      password: string;
      roleCode: string;
      // Régularisation d'un « compte actif sans dossier RH » : on rattache ce
      // dossier au compte déjà ouvert par l'administrateur au lieu d'en créer un.
      linkUserId?: string;
      linkUsername?: string;
    }
  | { kind: "mobility"; employee: Employee; firstName: string; lastName: string; position: string; departmentId: string; managerId: string; hireDate: string; birthDate: string; maritalStatus: string; childrenCount: string; phone: string; leaveTaken: string }
  | { kind: "departure"; employee: Employee; date: string }
  | { kind: "view-confidential"; employee: Employee; baseSalary: string; notes: string }
  | { kind: "edit-confidential"; employee: Employee; baseSalary: string }
  | { kind: "grant-role"; employee: Employee; roleCode: string; justification: string }
  | { kind: "absence"; employeeId: string; type: AbsenceType; from: string; to: string }
  | { kind: "review"; label: string };

// Ch. 19 : Ressources humaines — dossier collaborateur, cycle de vie du
// compte, absences, revue des accès (couche transverse du Lot 6).
export function HrPage({ canManage, canAdminister, canValidateAbsence, canManageUsers, canReadConfidential, canWriteConfidential, canAdministerPresence, canValidatePresence, canOverseePresence, canViewPayroll, canManagePayroll, canEditPayroll, canClosePayroll, canValidatePayrollDg }: HrPageProps) {
  const { t } = useI18n();
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [absences, setAbsences] = useState<Absence[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [roles, setRoles] = useState<RoleSummary[]>([]);
  const [anomalies, setAnomalies] = useState<AccessAnomaly[]>([]);
  const [reviews, setReviews] = useState<AccessReview[]>([]);
  const [selectedReviewId, setSelectedReviewId] = useState("");
  const [reviewItems, setReviewItems] = useState<AccessReviewItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [modal, setModal] = useState<HrModal | null>(null);
  const [contractAlerts, setContractAlerts] = useState<ContractAlert[]>([]);
  const [contractsFor, setContractsFor] = useState<Employee | null>(null);
  const [evalFor, setEvalFor] = useState<Employee | null>(null);

  const refresh = async () => {
    const [employeeList, absenceList] = await Promise.all([listEmployees(), listAbsences()]);
    setEmployees(employeeList);
    setAbsences(absenceList);
    getContractAlerts().then((r) => setContractAlerts(r.alerts)).catch(() => setContractAlerts([]));
    if (canManage) {
      const [anomalyList, reviewList] = await Promise.all([listAccessAnomalies(), listAccessReviews()]);
      setAnomalies(anomalyList);
      setReviews(reviewList);
    }
  };

  useEffect(() => {
    refresh().catch((e) => setError(e.message));
    // Référentiels pour les listes déroulantes de l'embauche (départements,
    // rôles). Au meilleur effort : une indisponibilité ne bloque pas la page.
    if (canManage) {
      listDepartments().then(setDepartments).catch(() => {});
      listRoles().then(setRoles).catch(() => {});
    }
  }, []);

  useEffect(() => {
    if (!selectedReviewId) {
      setReviewItems([]);
      return;
    }
    listAccessReviewItems(selectedReviewId).then(setReviewItems).catch((e) => setError(e.message));
  }, [selectedReviewId]);

  function fail(err: unknown, fallback: string) {
    setError(err instanceof Error ? err.message : fallback);
  }

  async function submitEmployee() {
    if (modal?.kind !== "employee" || !modal.firstName.trim() || !modal.lastName.trim()) return;
    if (modal.createAccount && (!modal.username.trim() || !modal.email.trim() || !modal.password || !modal.roleCode)) {
      setError("Pour ouvrir un compte : identifiant, e-mail, mot de passe et rôle sont requis.");
      return;
    }
    try {
      await createEmployee({
        first_name: modal.firstName.trim(),
        last_name: modal.lastName.trim(),
        status: modal.status,
        position: modal.position || undefined,
        department_id: modal.departmentId || undefined,
        manager_id: modal.managerId || undefined,
        hire_date: modal.hireDate ? new Date(modal.hireDate).toISOString() : undefined,
        birth_date: modal.birthDate ? new Date(modal.birthDate).toISOString() : undefined,
        account: modal.createAccount && !modal.linkUserId
          ? { username: modal.username.trim(), email: modal.email.trim(), password: modal.password, role_code: modal.roleCode }
          : undefined,
        link_user_id: modal.linkUserId,
      });
      setMessage(
        modal.linkUserId
          ? t("hr.msg.file_linked", "Dossier RH créé et rattaché au compte.")
          : modal.createAccount
            ? t("hr.msg.file_account_created", "Dossier et compte créés.")
            : t("hr.msg.file_created", "Dossier collaborateur créé."),
      );
      setModal(null);
      await refresh();
    } catch (err) {
      fail(err, "Échec de la création du dossier.");
    }
  }

  async function submitMobility() {
    if (modal?.kind !== "mobility") return;
    if (!modal.firstName.trim() || !modal.lastName.trim()) {
      setError("Le nom et le prénom sont obligatoires.");
      return;
    }
    try {
      await updateEmployee(modal.employee.id, {
        first_name: modal.firstName.trim(),
        last_name: modal.lastName.trim(),
        position: modal.position,
        department_id: modal.departmentId || null,
        manager_id: modal.managerId || null,
        hire_date: modal.hireDate ? new Date(modal.hireDate).toISOString() : null,
        birth_date: modal.birthDate ? new Date(modal.birthDate).toISOString() : null,
        marital_status: modal.maritalStatus.trim() || null,
        children_count: modal.childrenCount.trim() !== "" ? Math.max(Number(modal.childrenCount) || 0, 0) : null,
        phone: modal.phone.trim() || null,
        leave_taken_days: modal.leaveTaken.trim() !== "" ? Math.max(Number(modal.leaveTaken) || 0, 0) : null,
      });
      setMessage(t("hr.msg.file_updated", "Fiche du collaborateur mise à jour."));
      setModal(null);
      await refresh();
    } catch (err) {
      fail(err, "Échec de la mise à jour.");
    }
  }

  async function submitDeparture() {
    if (modal?.kind !== "departure" || !modal.date) return;
    try {
      await setEmployeeDeparture(modal.employee.id, new Date(modal.date).toISOString());
      setMessage(t("hr.msg.departure_saved", "Date de départ enregistrée."));
      setModal(null);
      await refresh();
    } catch (err) {
      fail(err, "Échec de l'enregistrement du départ.");
    }
  }

  async function openConfidential(employee: Employee) {
    try {
      const c = await getEmployeeConfidential(employee.id);
      setModal({ kind: "view-confidential", employee, baseSalary: c.baseSalary != null ? String(c.baseSalary) : t("hr.not_provided", "Non renseigné"), notes: c.notes ?? "—" });
    } catch (err) {
      fail(err, "Échec de la consultation.");
    }
  }

  async function submitEditConfidential() {
    if (modal?.kind !== "edit-confidential") return;
    try {
      await updateEmployeeConfidential(modal.employee.id, { base_salary: modal.baseSalary ? Number(modal.baseSalary) : undefined });
      setMessage(t("hr.msg.conf_updated", "Données confidentielles mises à jour."));
      setModal(null);
    } catch (err) {
      fail(err, "Échec de la mise à jour.");
    }
  }

  async function submitGrantRole() {
    if (modal?.kind !== "grant-role" || !modal.employee.user || !modal.roleCode.trim() || !modal.justification.trim()) return;
    try {
      await grantRole(modal.employee.user.id, modal.roleCode.trim(), modal.justification.trim());
      setMessage(t("hr.msg.role_granted", "Rôle attribué."));
      setModal(null);
    } catch (err) {
      fail(err, "Échec de l'attribution du rôle.");
    }
  }

  async function submitAbsence() {
    if (modal?.kind !== "absence" || !modal.employeeId || !modal.from || !modal.to) return;
    try {
      await createAbsence({ employee_id: modal.employeeId, type: modal.type, from_date: new Date(modal.from).toISOString(), to_date: new Date(modal.to).toISOString() });
      setMessage(t("hr.msg.absence_saved", "Demande d'absence enregistrée."));
      setModal(null);
      await refresh();
    } catch (err) {
      fail(err, "Échec de l'enregistrement.");
    }
  }

  async function submitReview() {
    if (modal?.kind !== "review" || !modal.label.trim()) return;
    try {
      await createAccessReview(modal.label.trim());
      setMessage(t("hr.msg.campaign_launched", "Campagne de revue lancée."));
      setModal(null);
      await refresh();
    } catch (err) {
      fail(err, "Échec du lancement de la campagne.");
    }
  }

  async function handleSuspend(employee: Employee) {
    try { await suspendEmployee(employee.id); setMessage(t("hr.msg.account_suspended", "Compte suspendu.")); await refresh(); } catch (err) { fail(err, "Échec de la suspension."); }
  }
  async function handleReinstate(employee: Employee) {
    try { await reinstateEmployee(employee.id); setMessage(t("hr.msg.account_reinstated", "Compte réactivé.")); await refresh(); } catch (err) { fail(err, "Échec de la réactivation."); }
  }
  async function handleDecideAbsence(absence: Absence, decision: "validee" | "refusee") {
    try { await decideAbsence(absence.id, decision); setMessage(decision === "validee" ? t("hr.msg.absence_approved", "Absence validée.") : t("hr.msg.absence_rejected", "Absence refusée.")); await refresh(); } catch (err) { fail(err, "Échec de la décision."); }
  }
  async function handleDecideReviewItem(item: AccessReviewItem, decision: "confirme" | "anomalie_signalee") {
    try { await decideAccessReviewItem(item.id, decision); setMessage(t("hr.msg.decision_saved", "Décision enregistrée.")); setReviewItems(await listAccessReviewItems(selectedReviewId)); } catch (err) { fail(err, "Échec de l'enregistrement."); }
  }

  return (
    <div className="ecl-page">
      <h1 className="ecl-page__title">{t("page.hr.title", "Ressources humaines")}</h1>
      <p className="ecl-page__lead">{t("page.hr.lead", "Dossiers collaborateurs, absences et revue des habilitations.")}</p>

      <GuidanceNote title="Ressources humaines">
        Dossiers des collaborateurs, absences et présences, et paie. Les onglets ci-dessous regroupent chaque domaine ;
        les informations confidentielles sont réservées aux profils habilités.
      </GuidanceNote>

      {error && <div style={bannerStyle("var(--alert-soft)", "var(--alert)")}>{error}</div>}
      {message && <div style={bannerStyle("var(--eclosion-soft)", "var(--eclosion)")}>{message}</div>}

      {/* Signalement de clôture d'activité mensuelle : échéance du jour de clôture
          (10 par défaut, paramétrable) et rappels automatiques aux responsables. */}
      <ActivityClosureSection canAdminister={canAdminister} />

      {/* Le module « Présences & Temps de travail » (pointage par connexion,
          tableau de bord de présence, règles de retenues, consolidation paie) a
          été RETIRÉ à la demande de l'opérateur (13/08/2026) : la connexion à
          l'ERP ne servait pas de véritable pointage. Seul subsiste le « Relevé
          des connexions ERP » ci-dessous, conservé comme simple témoin /
          outil d'arbitrage RH, sans aucun effet sur la paie. */}
      {canOverseePresence && <ErpConnectionsSection employees={employees} />}

      {/* Lot 5 — accès UNIQUE « Moteur de Paie & Paramétrage » : toutes les
          rubriques de la paie regroupées en accordéon (centre de contrôle). */}
      {canViewPayroll && (
        <PayrollEngineHub
          employees={employees}
          canEditPayroll={canEditPayroll}
          canValidatePayrollDg={canValidatePayrollDg}
          canManagePayroll={canManagePayroll}
          canClosePayroll={canClosePayroll}
        />
      )}

      {/* Ch. 19 §19.2 — Dossiers collaborateurs */}
      <Card
        title={t("hr.files", "Dossiers collaborateurs")}
        icon={<IconAdmin />}
        subtitle={t("hr.files_sub", "Statut, poste, congés et cycle de vie du compte.")}
        action={canManage ? <Button variant="add" size="sm" onClick={() => setModal({ kind: "employee", firstName: "", lastName: "", status: "salarie", position: "", departmentId: "", managerId: "", birthDate: "", hireDate: new Date().toISOString().slice(0, 10), createAccount: false, username: "", email: "", password: "", roleCode: "" })}>{t("hr.add_employee", "+ Collaborateur")}</Button> : undefined}
      >
        {employees.length === 0 ? (
          <Empty>{t("hr.no_employee", "Aucun collaborateur.")}</Empty>
        ) : (
          <div className="ecl-list">
            {employees.map((employee) => (
              <div key={employee.id} className="ecl-row" style={{ flexWrap: "wrap", gap: 10 }}>
                <div className="ecl-row__main">
                  <div className="ecl-row__title" style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                    {employee.firstName} {employee.lastName}
                    <StatusChip label={t("hr.st." + employee.status, STATUS_LABELS[employee.status])} />
                  </div>
                  <div className="ecl-row__desc">
                    {[employee.position, employee.department?.name].filter(Boolean).join(" · ")}
                    {employee.department || employee.position ? " · " : ""}
                    {t("hr.leave_balance", "solde congés :")} <span style={{ fontFamily: "var(--font-mono)" }}>{employee.leaveBalanceDays}</span>
                    {employee.departureDate && <span style={{ color: "var(--amber)" }}> · {t("hr.departure", "départ :")} {employee.departureDate.slice(0, 10)}</span>}
                  </div>
                </div>
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                  {/* Barre d'actions standard (refonte, Étape 1) : action générique
                      « Imprimer la fiche » ; les boutons métier restent à côté. */}
                  <StandardActionBar onPrint={() => printEmployeeFiche(employee)} />
                  <Button variant="view" size="sm" onClick={() => setContractsFor(employee)}>{t("hr.contracts", "Contrats")}</Button>
                  <Button variant="view" size="sm" onClick={() => setEvalFor(employee)}>{t("hr.evaluation", "Évaluation")}</Button>
                  {canManage && <Button variant="view" size="sm" onClick={() => setModal({ kind: "mobility", employee, firstName: employee.firstName, lastName: employee.lastName, position: employee.position ?? "", departmentId: employee.department?.id ?? "", managerId: employee.manager?.id ?? "", hireDate: employee.hireDate ? employee.hireDate.slice(0, 10) : "", birthDate: employee.birthDate ? employee.birthDate.slice(0, 10) : "", maritalStatus: employee.maritalStatus ?? "", childrenCount: employee.childrenCount != null ? String(employee.childrenCount) : "", phone: employee.phone ?? "", leaveTaken: employee.leaveTakenDays != null ? String(employee.leaveTakenDays) : "" })}>{t("hr.edit_file", "Modifier la fiche")}</Button>}
                  {canAdminister && !employee.departureDate && <Button variant="view" size="sm" onClick={() => setModal({ kind: "departure", employee, date: new Date().toISOString().slice(0, 10) })}>{t("hr.departure_btn", "Départ")}</Button>}
                  {canAdminister && employee.user?.status === "active" && <Button variant="danger" size="sm" onClick={() => handleSuspend(employee)}>{t("hr.suspend", "Suspendre")}</Button>}
                  {canAdminister && employee.user?.status === "suspended" && <Button variant="add" size="sm" onClick={() => handleReinstate(employee)}>{t("hr.reinstate", "Réactiver")}</Button>}
                  {canReadConfidential && <Button variant="view" size="sm" onClick={() => openConfidential(employee)}>{t("hr.confidential", "Confidentiel")}</Button>}
                  {canWriteConfidential && <Button variant="edit" size="sm" onClick={() => setModal({ kind: "edit-confidential", employee, baseSalary: "" })}>{t("hr.edit_conf", "Modifier conf.")}</Button>}
                  {canManageUsers && <Button variant="edit" size="sm" onClick={() => setModal({ kind: "grant-role", employee, roleCode: "", justification: "" })}>{t("hr.grant_role", "Attribuer un rôle")}</Button>}
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>

      {/* Alertes d'expiration des contrats de travail. */}
      {contractAlerts.length > 0 && (
        <Card title={t("hr.contract_alerts", "Alertes — contrats de travail")} icon={<IconAdmin />} subtitle={t("hr.contract_alerts_sub", "Contrats échus ou arrivant à échéance (60 jours).")}>
          <div className="ecl-list">
            {contractAlerts.map((a) => (
              <div key={a.contract_id} className="ecl-row" style={{ flexWrap: "wrap", gap: 8 }}>
                <div className="ecl-row__main">
                  <div className="ecl-row__title">{a.employee}{a.position ? ` · ${a.position}` : ""}</div>
                  <div className="ecl-row__desc">
                    {a.type.toUpperCase()} · {t("hr.ends_on", "échéance")} <span style={{ fontFamily: "var(--font-mono)" }}>{a.end_date.slice(0, 10)}</span>
                  </div>
                </div>
                <span style={{ fontSize: 11.5, fontWeight: 700, borderRadius: 6, padding: "3px 9px", whiteSpace: "nowrap", background: a.status === "expired" ? "#f8e3df" : "#F7E7DA", color: a.status === "expired" ? "var(--danger, #C24B3A)" : "#C4661F" }}>
                  {a.status === "expired" ? t("hr.expired", "Échu") : `${t("hr.in", "dans")} ${a.days_left} j`}
                </span>
              </div>
            ))}
          </div>
        </Card>
      )}

      {/* Recrutement (module amont RH) — postes à pourvoir & candidatures. */}
      {canManage && <RecruitmentSection canManage={canManage} canValidate={canValidateAbsence || canAdminister} departments={departments} />}

      {/* Formation (module amont RH) — demandes, sessions & suivi de participation. */}
      {canManage && <FormationSection canManage={canManage} canValidate={canValidateAbsence || canAdminister} employees={employees} />}

      {/* Organigramme — hiérarchie reconstruite depuis le lien manager ↔ subordonnés. */}
      {employees.length > 0 && (
        <Card title={t("hr.orgchart", "Organigramme")} icon={<IconAdmin />} subtitle={t("hr.orgchart_sub", "Hiérarchie des collaborateurs (d'après le responsable de chaque fiche).")}>
          <OrgChart employees={employees} />
        </Card>
      )}

      {contractsFor && (
        <ContractsModal
          employeeId={contractsFor.id}
          employeeName={`${contractsFor.firstName} ${contractsFor.lastName}`}
          canManage={canManage}
          onClose={() => { setContractsFor(null); refresh().catch(() => {}); }}
        />
      )}

      {evalFor && (
        <EvaluationsModal
          employeeId={evalFor.id}
          employeeName={`${evalFor.firstName} ${evalFor.lastName}`}
          canManage={canManage}
          onClose={() => setEvalFor(null)}
        />
      )}

      {/* Ch. 19 §19.5 — Absences */}
      <Card
        title={t("hr.absences", "Absences")}
        icon={<IconAdmin />}
        subtitle={t("hr.absences_sub", "Congés, maladies, missions et télétravail.")}
        action={canManage ? <Button variant="add" size="sm" onClick={() => setModal({ kind: "absence", employeeId: employees[0]?.id ?? "", type: "conge", from: "", to: "" })}>{t("hr.add_absence", "+ Demande")}</Button> : undefined}
      >
        {absences.length === 0 ? (
          <Empty>{t("hr.no_absence", "Aucune demande.")}</Empty>
        ) : (
          <div className="ecl-list">
            {absences.map((absence) => (
              <div key={absence.id} className="ecl-row">
                <div className="ecl-row__main" style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                  <span className="ecl-row__title">{t("hr.abs." + absence.type, ABSENCE_TYPE_LABELS[absence.type])}</span>
                  <span className="ecl-row__desc" style={{ margin: 0 }}>{absence.fromDate.slice(0, 10)} → {absence.toDate.slice(0, 10)}</span>
                  <StatusChip label={t("hr.absst." + absence.status, ABSENCE_STATUS_LABELS[absence.status])} />
                </div>
                {canValidateAbsence && absence.status === "en_attente" && (
                  <div style={{ display: "flex", gap: 6 }}>
                    <Button variant="add" size="sm" onClick={() => handleDecideAbsence(absence, "validee")}>{t("hr.validate", "Valider")}</Button>
                    <Button variant="danger" size="sm" onClick={() => handleDecideAbsence(absence, "refusee")}>{t("hr.refuse", "Refuser")}</Button>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </Card>

      {/* Ch. 19 §19.4 — Anomalies d'accès */}
      {canManage && (
        <Card title={t("hr.access_anomalies", "Anomalies d'accès")} icon={<IconAdmin />} subtitle={t("hr.access_anomalies_sub", "Écarts détectés entre comptes et habilitations.")}>
          <p style={{ fontSize: 12.5, color: "var(--muted)", margin: "0 0 10px" }}>
            {t("hr.access_anomalies_help", "« Compte actif sans dossier RH » : le compte a été ouvert par l'administrateur, mais aucune fiche collaborateur ne lui est encore rattachée (ni salaire, ni présences, ni paie). Cliquez sur « Créer le dossier RH » pour ouvrir une fiche déjà liée à ce compte — aucun nouveau mot de passe n'est créé.")}
          </p>
          {anomalies.length === 0 ? (
            <Empty>{t("hr.no_anomaly", "Aucune anomalie détectée.")}</Empty>
          ) : (
            <div className="ecl-list">
              {anomalies.map((anomaly, i) => (
                <div key={i} className="ecl-row">
                  <div className="ecl-row__main">
                    <span className="ecl-row__title">{anomaly.username}</span>
                    <span style={{ color: "var(--amber)", fontSize: 12.5 }}>{anomaly.detail}</span>
                  </div>
                  {anomaly.type === "compte_sans_dossier_rh" && canManage && (
                    <Button
                      variant="add"
                      size="sm"
                      onClick={() =>
                        setModal({
                          kind: "employee",
                          firstName: "",
                          lastName: "",
                          status: "salarie",
                          position: "",
                          departmentId: "",
                          managerId: "",
                          birthDate: "",
                          hireDate: new Date().toISOString().slice(0, 10),
                          createAccount: false,
                          username: "",
                          email: "",
                          password: "",
                          roleCode: "",
                          linkUserId: anomaly.user_id,
                          linkUsername: anomaly.username,
                        })
                      }
                    >
                      {t("hr.create_dossier", "Créer le dossier RH")}
                    </Button>
                  )}
                </div>
              ))}
            </div>
          )}
        </Card>
      )}

      {/* Ch. 19 §19.4 — Revue périodique des habilitations */}
      {canManage && (
        <Card
          title={t("hr.access_review", "Revue périodique des habilitations")}
          icon={<IconAdmin />}
          subtitle={t("hr.access_review_sub", "Campagnes de vérification des accès.")}
          action={canAdminister ? <Button variant="add" size="sm" onClick={() => setModal({ kind: "review", label: "" })}>{t("hr.add_campaign", "+ Campagne")}</Button> : undefined}
        >
          <div className="ecl-field" style={{ maxWidth: 360 }}>
            <label>{t("hr.campaign", "Campagne")}</label>
            <select value={selectedReviewId} onChange={(e) => setSelectedReviewId(e.target.value)}>
              <option value="">{t("hr.select", "— sélectionner —")}</option>
              {reviews.map((review) => <option key={review.id} value={review.id}>{review.label}</option>)}
            </select>
          </div>
          {reviewItems.length > 0 && (
            <div className="ecl-list" style={{ marginTop: 12 }}>
              {reviewItems.map((item) => (
                <div key={item.id} className="ecl-row">
                  <div className="ecl-row__main">
                    <div className="ecl-row__title">{item.employee.firstName} {item.employee.lastName}</div>
                    <div className="ecl-row__desc">
                      {t("hr.reviewer", "Réviseur :")} {item.reviewer.firstName} {item.reviewer.lastName}
                      {item.decision && ` · ${item.decision === "confirme" ? t("hr.confirmed", "Confirmé") : t("hr.anomaly_flagged", "Anomalie signalée")}`}
                    </div>
                  </div>
                  {!item.decision && (
                    <div style={{ display: "flex", gap: 6 }}>
                      <Button variant="add" size="sm" onClick={() => handleDecideReviewItem(item, "confirme")}>{t("hr.confirm", "Confirmer")}</Button>
                      <Button variant="danger" size="sm" onClick={() => handleDecideReviewItem(item, "anomalie_signalee")}>{t("hr.flag", "Signaler")}</Button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </Card>
      )}

      {/* ── Fenêtres intégrées ─────────────────────────────────────────────── */}
      {modal?.kind === "employee" && (
        <Modal title={modal.linkUserId ? t("hr.link_file_title", "Créer le dossier RH d'un compte existant") : t("hr.new_file_title", "Nouveau dossier collaborateur")} onClose={() => setModal(null)} footer={<ModalActions onCancel={() => setModal(null)} onConfirm={submitEmployee} confirmLabel={t("hr.create", "Créer")} />}>
          {modal.linkUserId && (
            <div style={{ background: "var(--eclosion-soft)", border: "1px solid var(--eclosion)", borderRadius: 8, padding: "8px 12px", fontSize: 12.5, marginBottom: 4 }}>
              {t("hr.link_note", "Ce dossier sera rattaché au compte")} <strong>{modal.linkUsername}</strong>{t("hr.link_note2", ", déjà ouvert par l'administrateur. Renseignez l'identité du collaborateur ; le compte et son mot de passe restent inchangés.")}
            </div>
          )}
          <Field label={t("hr.first_name", "Prénom")}><input value={modal.firstName} onChange={(e) => setModal({ ...modal, firstName: e.target.value })} autoFocus /></Field>
          <Field label={t("hr.last_name", "Nom")}><input value={modal.lastName} onChange={(e) => setModal({ ...modal, lastName: e.target.value })} /></Field>
          <Field label={t("hr.status", "Statut")}>
            <select value={modal.status} onChange={(e) => setModal({ ...modal, status: e.target.value as EmployeeStatus })}>
              {Object.entries(STATUS_LABELS).map(([value, label]) => <option key={value} value={value}>{t("hr.st." + value, label)}</option>)}
            </select>
          </Field>
          <Field label={t("hr.position_opt", "Poste (optionnel)")}><input value={modal.position} onChange={(e) => setModal({ ...modal, position: e.target.value })} /></Field>
          <Field label={t("hr.department_opt", "Département (optionnel)")}>
            <select value={modal.departmentId} onChange={(e) => setModal({ ...modal, departmentId: e.target.value })}>
              <option value="">{t("hr.no_department", "— aucun —")}</option>
              {departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
            </select>
          </Field>
          <Field label={t("hr.manager_opt", "Responsable (optionnel)")}>
            <select value={modal.managerId} onChange={(e) => setModal({ ...modal, managerId: e.target.value })}>
              <option value="">{t("hr.no_manager", "— aucun —")}</option>
              {employees.map((emp) => <option key={emp.id} value={emp.id}>{emp.firstName} {emp.lastName}</option>)}
            </select>
          </Field>
          <Field label={t("hr.hire_date_opt", "Date d'arrivée (optionnel)")}><input type="date" value={modal.hireDate} onChange={(e) => setModal({ ...modal, hireDate: e.target.value })} /></Field>
          <Field label={t("hr.birth_date_opt", "Date de naissance (optionnel)")}><input type="date" value={modal.birthDate} onChange={(e) => setModal({ ...modal, birthDate: e.target.value })} /></Field>

          {/* Ouverture du compte de connexion à l'embauche (Ch. 19 §19.3).
              Masquée en mode rattachement : le compte existe déjà. */}
          {!modal.linkUserId && (
          <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, marginTop: 6, cursor: "pointer" }}>
            <input type="checkbox" checked={modal.createAccount} onChange={(e) => setModal({ ...modal, createAccount: e.target.checked })} />
            {t("hr.create_account", "Ouvrir un compte de connexion Eclospace")}
          </label>
          )}
          {!modal.linkUserId && modal.createAccount && (
            <div style={{ border: "1px dashed var(--line)", borderRadius: 8, padding: 12, display: "grid", gap: 8, marginTop: 4 }}>
              <Field label={t("hr.username", "Identifiant")}><input value={modal.username} onChange={(e) => setModal({ ...modal, username: e.target.value })} autoCapitalize="off" autoCorrect="off" autoComplete="off" spellCheck={false} /></Field>
              <Field label={t("hr.email", "E-mail")}><input type="email" value={modal.email} onChange={(e) => setModal({ ...modal, email: e.target.value })} autoCapitalize="off" autoCorrect="off" autoComplete="off" spellCheck={false} /></Field>
              <Field label={t("hr.password", "Mot de passe (min. 8 car., une majuscule, un chiffre)")}><input type="text" value={modal.password} onChange={(e) => setModal({ ...modal, password: e.target.value })} autoCapitalize="off" autoCorrect="off" autoComplete="off" spellCheck={false} /></Field>
              <Field label={t("hr.role_poste", "Rôle du poste")}>
                <select value={modal.roleCode} onChange={(e) => setModal({ ...modal, roleCode: e.target.value })}>
                  <option value="">{t("hr.select_role", "— choisir un rôle —")}</option>
                  {roles.filter((r) => r.code !== "ADMIN_GENERAL").map((r) => <option key={r.id} value={r.code}>{r.label}{r.department ? ` — ${r.department}` : ""}</option>)}
                </select>
              </Field>
              <p style={{ fontSize: 11.5, color: "var(--muted)", margin: 0 }}>{t("hr.role_note", "Le rôle donne les accès du poste. Les rôles de gestion des comptes ne sont attribuables que par l'administration.")}</p>
            </div>
          )}
        </Modal>
      )}

      {modal?.kind === "mobility" && (
        <Modal title={t("hr.edit_file_title", "Modifier la fiche du collaborateur")} onClose={() => setModal(null)} footer={<ModalActions onCancel={() => setModal(null)} onConfirm={submitMobility} confirmLabel={t("hr.save", "Enregistrer")} />}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            <Field label={t("hr.first_name", "Prénom")}><input value={modal.firstName} onChange={(e) => setModal({ ...modal, firstName: e.target.value })} autoFocus /></Field>
            <Field label={t("hr.last_name", "Nom")}><input value={modal.lastName} onChange={(e) => setModal({ ...modal, lastName: e.target.value })} /></Field>
          </div>
          <Field label={t("hr.position", "Poste")}><input value={modal.position} onChange={(e) => setModal({ ...modal, position: e.target.value })} /></Field>
          <Field label={t("hr.department", "Département")}>
            <select value={modal.departmentId} onChange={(e) => setModal({ ...modal, departmentId: e.target.value })}>
              <option value="">{t("hr.no_department", "— aucun —")}</option>
              {departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
            </select>
          </Field>
          <Field label={t("hr.manager", "Responsable")}>
            <select value={modal.managerId} onChange={(e) => setModal({ ...modal, managerId: e.target.value })}>
              <option value="">{t("hr.no_manager", "— aucun —")}</option>
              {employees.filter((e) => e.id !== modal.employee.id).map((e) => <option key={e.id} value={e.id}>{e.firstName} {e.lastName}</option>)}
            </select>
          </Field>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            <Field label={t("hr.hire_date", "Date d'embauche")}><input type="date" value={modal.hireDate} onChange={(e) => setModal({ ...modal, hireDate: e.target.value })} /></Field>
            <Field label={t("hr.birth_date_opt", "Date de naissance (optionnel)")}><input type="date" value={modal.birthDate} onChange={(e) => setModal({ ...modal, birthDate: e.target.value })} /></Field>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            <Field label={t("hr.marital_status", "Situation familiale")}>
              <select value={modal.maritalStatus} onChange={(e) => setModal({ ...modal, maritalStatus: e.target.value })}>
                <option value="">{t("hr.not_specified", "— non précisé —")}</option>
                <option value="Célibataire">{t("hr.single", "Célibataire")}</option>
                <option value="Marié(e)">{t("hr.married", "Marié(e)")}</option>
                <option value="Divorcé(e)">{t("hr.divorced", "Divorcé(e)")}</option>
                <option value="Veuf(ve)">{t("hr.widowed", "Veuf(ve)")}</option>
              </select>
            </Field>
            <Field label={t("hr.children_count", "Nombre d'enfants")}><input type="number" min={0} max={30} value={modal.childrenCount} onChange={(e) => setModal({ ...modal, childrenCount: e.target.value })} /></Field>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            <Field label={t("hr.phone", "Téléphone")}><input value={modal.phone} onChange={(e) => setModal({ ...modal, phone: e.target.value })} /></Field>
            <Field label={t("hr.leave_taken", "Jours de congés pris (cumul)")}><input type="number" min={0} step={0.5} value={modal.leaveTaken} onChange={(e) => setModal({ ...modal, leaveTaken: e.target.value })} /></Field>
          </div>
        </Modal>
      )}

      {modal?.kind === "departure" && (
        <Modal title={t("hr.departure_title", "Enregistrer un départ")} onClose={() => setModal(null)} footer={<ModalActions onCancel={() => setModal(null)} onConfirm={submitDeparture} confirmLabel={t("hr.save", "Enregistrer")} />}>
          <p style={{ margin: 0, fontSize: 13, color: "var(--muted)" }}>{modal.employee.firstName} {modal.employee.lastName}</p>
          <Field label={t("hr.departure_date", "Date de départ")}><input type="date" value={modal.date} onChange={(e) => setModal({ ...modal, date: e.target.value })} /></Field>
        </Modal>
      )}

      {modal?.kind === "view-confidential" && (
        <Modal title={t("hr.confidential_title", "Données confidentielles")} onClose={() => setModal(null)} footer={<Button variant="view" size="sm" onClick={() => setModal(null)}>{t("hr.close", "Fermer")}</Button>}>
          <p style={{ margin: 0, fontSize: 13, color: "var(--muted)" }}>{modal.employee.firstName} {modal.employee.lastName}</p>
          <div><div style={{ fontSize: 12, color: "var(--muted)" }}>{t("hr.base_salary", "Salaire de base")}</div><div style={{ fontFamily: "var(--font-mono)", fontSize: 16, fontWeight: 700, color: "var(--ink)" }}>{modal.baseSalary}</div></div>
          <div><div style={{ fontSize: 12, color: "var(--muted)" }}>{t("hr.notes", "Notes")}</div><div style={{ fontSize: 13 }}>{modal.notes}</div></div>
        </Modal>
      )}

      {modal?.kind === "edit-confidential" && (
        <Modal title={t("hr.edit_conf_title", "Modifier les données confidentielles")} onClose={() => setModal(null)} footer={<ModalActions onCancel={() => setModal(null)} onConfirm={submitEditConfidential} confirmLabel={t("hr.save", "Enregistrer")} />}>
          <p style={{ margin: 0, fontSize: 13, color: "var(--muted)" }}>{modal.employee.firstName} {modal.employee.lastName}</p>
          <Field label={t("hr.base_salary", "Salaire de base")}><input type="number" min={0} value={modal.baseSalary} onChange={(e) => setModal({ ...modal, baseSalary: e.target.value })} autoFocus /></Field>
        </Modal>
      )}

      {modal?.kind === "grant-role" && (
        <Modal title={t("hr.grant_role_title", "Attribuer un rôle")} onClose={() => setModal(null)} footer={<ModalActions onCancel={() => setModal(null)} onConfirm={submitGrantRole} confirmLabel={t("hr.grant", "Attribuer")} />}>
          <p style={{ margin: 0, fontSize: 13, color: "var(--muted)" }}>{modal.employee.firstName} {modal.employee.lastName}</p>
          <Field label={t("hr.role", "Rôle")}>
            <select value={modal.roleCode} onChange={(e) => setModal({ ...modal, roleCode: e.target.value })} autoFocus>
              <option value="">{t("hr.select_role", "— choisir un rôle —")}</option>
              {roles.filter((r) => r.code !== "ADMIN_GENERAL").map((r) => <option key={r.id} value={r.code}>{r.label}{r.department ? ` — ${r.department}` : ""}</option>)}
            </select>
          </Field>
          <Field label={t("hr.justification", "Justification")}><input value={modal.justification} onChange={(e) => setModal({ ...modal, justification: e.target.value })} /></Field>
        </Modal>
      )}

      {modal?.kind === "absence" && (
        <Modal title={t("hr.new_absence_title", "Nouvelle demande d'absence")} onClose={() => setModal(null)} footer={<ModalActions onCancel={() => setModal(null)} onConfirm={submitAbsence} confirmLabel={t("hr.save", "Enregistrer")} />}>
          <Field label={t("hr.employee", "Collaborateur")}>
            <select value={modal.employeeId} onChange={(e) => setModal({ ...modal, employeeId: e.target.value })}>
              {employees.map((emp) => <option key={emp.id} value={emp.id}>{emp.firstName} {emp.lastName}</option>)}
            </select>
          </Field>
          <Field label={t("hr.type", "Type")}>
            <select value={modal.type} onChange={(e) => setModal({ ...modal, type: e.target.value as AbsenceType })}>
              {Object.entries(ABSENCE_TYPE_LABELS).map(([value, label]) => <option key={value} value={value}>{t("hr.abs." + value, label)}</option>)}
            </select>
          </Field>
          <Field label={t("hr.from", "Du")}><input type="date" value={modal.from} onChange={(e) => setModal({ ...modal, from: e.target.value })} /></Field>
          <Field label={t("hr.to", "Au")}><input type="date" value={modal.to} onChange={(e) => setModal({ ...modal, to: e.target.value })} /></Field>
        </Modal>
      )}

      {modal?.kind === "review" && (
        <Modal title={t("hr.review_title", "Lancer une campagne de revue")} onClose={() => setModal(null)} footer={<ModalActions onCancel={() => setModal(null)} onConfirm={submitReview} confirmLabel={t("hr.launch", "Lancer")} />}>
          <Field label={t("hr.campaign_label", "Libellé de la campagne")}><input value={modal.label} onChange={(e) => setModal({ ...modal, label: e.target.value })} autoFocus /></Field>
        </Modal>
      )}
    </div>
  );
}

function ModalActions({ onCancel, onConfirm, confirmLabel }: { onCancel: () => void; onConfirm: () => void; confirmLabel: string }) {
  const { t } = useI18n();
  return (
    <>
      <Button variant="view" size="sm" onClick={onCancel}>{t("hr.cancel", "Annuler")}</Button>
      <Button variant="add" size="sm" onClick={onConfirm}>{confirmLabel}</Button>
    </>
  );
}

function StatusChip({ label }: { label: string }) {
  return (
    <span style={{ fontSize: 11, fontWeight: 600, color: "var(--muted)", background: "var(--paper)", border: "1px solid var(--line)", borderRadius: 999, padding: "2px 9px", whiteSpace: "nowrap" }}>
      {label}
    </span>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <p style={{ color: "var(--muted)", fontSize: 13, margin: 0 }}>{children}</p>;
}

function bannerStyle(bg: string, color: string): React.CSSProperties {
  return { background: bg, color, borderRadius: 8, padding: "9px 13px", fontSize: 13, marginTop: 12 };
}
