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
  listEmployees,
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
  type Employee,
  type EmployeeStatus,
} from "../api/client";
import { Card } from "../components/Card";
import { Modal, Field } from "../components/Modal";
import { Button } from "../components/Button";
import { IconAdmin } from "../components/icons";
import { WorkScheduleSection } from "../components/WorkScheduleSection";
import { PresenceSummaryCard } from "../components/PresenceSummaryCard";
import { DeductionRulesSection } from "../components/DeductionRulesSection";
import { AnomaliesSection } from "../components/AnomaliesSection";
import { AttendanceReportSection } from "../components/AttendanceReportSection";

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
}

type HrModal =
  | { kind: "employee"; firstName: string; lastName: string; position: string; departmentId: string }
  | { kind: "mobility"; employee: Employee; position: string }
  | { kind: "departure"; employee: Employee; date: string }
  | { kind: "view-confidential"; employee: Employee; baseSalary: string; notes: string }
  | { kind: "edit-confidential"; employee: Employee; baseSalary: string }
  | { kind: "grant-role"; employee: Employee; roleCode: string; justification: string }
  | { kind: "absence"; employeeId: string; type: AbsenceType; from: string; to: string }
  | { kind: "review"; label: string };

// Ch. 19 : Ressources humaines — dossier collaborateur, cycle de vie du
// compte, absences, revue des accès (couche transverse du Lot 6).
export function HrPage({ canManage, canAdminister, canValidateAbsence, canManageUsers, canReadConfidential, canWriteConfidential, canAdministerPresence, canValidatePresence, canOverseePresence }: HrPageProps) {
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [absences, setAbsences] = useState<Absence[]>([]);
  const [anomalies, setAnomalies] = useState<AccessAnomaly[]>([]);
  const [reviews, setReviews] = useState<AccessReview[]>([]);
  const [selectedReviewId, setSelectedReviewId] = useState("");
  const [reviewItems, setReviewItems] = useState<AccessReviewItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [modal, setModal] = useState<HrModal | null>(null);

  const refresh = async () => {
    const [employeeList, absenceList] = await Promise.all([listEmployees(), listAbsences()]);
    setEmployees(employeeList);
    setAbsences(absenceList);
    if (canManage) {
      const [anomalyList, reviewList] = await Promise.all([listAccessAnomalies(), listAccessReviews()]);
      setAnomalies(anomalyList);
      setReviews(reviewList);
    }
  };

  useEffect(() => {
    refresh().catch((e) => setError(e.message));
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
    try {
      await createEmployee({ first_name: modal.firstName.trim(), last_name: modal.lastName.trim(), position: modal.position || undefined, department_id: modal.departmentId || undefined });
      setMessage("Dossier collaborateur créé.");
      setModal(null);
      await refresh();
    } catch (err) {
      fail(err, "Échec de la création du dossier.");
    }
  }

  async function submitMobility() {
    if (modal?.kind !== "mobility") return;
    try {
      await updateEmployee(modal.employee.id, { position: modal.position });
      setMessage("Mobilité enregistrée.");
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
      setMessage("Date de départ enregistrée.");
      setModal(null);
      await refresh();
    } catch (err) {
      fail(err, "Échec de l'enregistrement du départ.");
    }
  }

  async function openConfidential(employee: Employee) {
    try {
      const c = await getEmployeeConfidential(employee.id);
      setModal({ kind: "view-confidential", employee, baseSalary: c.baseSalary != null ? String(c.baseSalary) : "Non renseigné", notes: c.notes ?? "—" });
    } catch (err) {
      fail(err, "Échec de la consultation.");
    }
  }

  async function submitEditConfidential() {
    if (modal?.kind !== "edit-confidential") return;
    try {
      await updateEmployeeConfidential(modal.employee.id, { base_salary: modal.baseSalary ? Number(modal.baseSalary) : undefined });
      setMessage("Données confidentielles mises à jour.");
      setModal(null);
    } catch (err) {
      fail(err, "Échec de la mise à jour.");
    }
  }

  async function submitGrantRole() {
    if (modal?.kind !== "grant-role" || !modal.employee.user || !modal.roleCode.trim() || !modal.justification.trim()) return;
    try {
      await grantRole(modal.employee.user.id, modal.roleCode.trim(), modal.justification.trim());
      setMessage("Rôle attribué.");
      setModal(null);
    } catch (err) {
      fail(err, "Échec de l'attribution du rôle.");
    }
  }

  async function submitAbsence() {
    if (modal?.kind !== "absence" || !modal.employeeId || !modal.from || !modal.to) return;
    try {
      await createAbsence({ employee_id: modal.employeeId, type: modal.type, from_date: new Date(modal.from).toISOString(), to_date: new Date(modal.to).toISOString() });
      setMessage("Demande d'absence enregistrée.");
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
      setMessage("Campagne de revue lancée.");
      setModal(null);
      await refresh();
    } catch (err) {
      fail(err, "Échec du lancement de la campagne.");
    }
  }

  async function handleSuspend(employee: Employee) {
    try { await suspendEmployee(employee.id); setMessage("Compte suspendu."); await refresh(); } catch (err) { fail(err, "Échec de la suspension."); }
  }
  async function handleReinstate(employee: Employee) {
    try { await reinstateEmployee(employee.id); setMessage("Compte réactivé."); await refresh(); } catch (err) { fail(err, "Échec de la réactivation."); }
  }
  async function handleDecideAbsence(absence: Absence, decision: "validee" | "refusee") {
    try { await decideAbsence(absence.id, decision); setMessage(decision === "validee" ? "Absence validée." : "Absence refusée."); await refresh(); } catch (err) { fail(err, "Échec de la décision."); }
  }
  async function handleDecideReviewItem(item: AccessReviewItem, decision: "confirme" | "anomalie_signalee") {
    try { await decideAccessReviewItem(item.id, decision); setMessage("Décision enregistrée."); setReviewItems(await listAccessReviewItems(selectedReviewId)); } catch (err) { fail(err, "Échec de l'enregistrement."); }
  }

  return (
    <div className="ecl-page">
      <h1 className="ecl-page__title">Ressources humaines</h1>
      <p className="ecl-page__lead">Dossiers collaborateurs, absences et revue des habilitations.</p>

      {error && <div style={bannerStyle("var(--alert-soft)", "var(--alert)")}>{error}</div>}
      {message && <div style={bannerStyle("var(--eclosion-soft)", "var(--eclosion)")}>{message}</div>}

      {/* Évolution — Présences & Temps de travail : paramétrage des horaires (§9) */}
      <WorkScheduleSection canAdminister={canAdministerPresence} />

      {/* Évolution — Calcul de présence : synthèse du mois de l'utilisateur (§12-17) */}
      <PresenceSummaryCard />

      {/* Évolution — Règles de retenues paramétrables et versionnées (§21-22) */}
      <DeductionRulesSection canAdminister={canAdministerPresence} />

      {/* Évolution — File d'anomalies + justificatifs + validation (§19, §23-25) */}
      <AnomaliesSection canValidate={canValidatePresence} employees={employees} />

      {/* Évolution — Tableau de bord & rapports RH + exports (§32-33) */}
      {canOverseePresence && <AttendanceReportSection />}

      {/* Ch. 19 §19.2 — Dossiers collaborateurs */}
      <Card
        title="Dossiers collaborateurs"
        icon={<IconAdmin />}
        subtitle="Statut, poste, congés et cycle de vie du compte."
        action={canManage ? <Button variant="add" size="sm" onClick={() => setModal({ kind: "employee", firstName: "", lastName: "", position: "", departmentId: "" })}>+ Collaborateur</Button> : undefined}
      >
        {employees.length === 0 ? (
          <Empty>Aucun collaborateur.</Empty>
        ) : (
          <div className="ecl-list">
            {employees.map((employee) => (
              <div key={employee.id} className="ecl-row" style={{ flexWrap: "wrap", gap: 10 }}>
                <div className="ecl-row__main">
                  <div className="ecl-row__title" style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                    {employee.firstName} {employee.lastName}
                    <StatusChip label={STATUS_LABELS[employee.status]} />
                  </div>
                  <div className="ecl-row__desc">
                    {[employee.position, employee.department?.name].filter(Boolean).join(" · ")}
                    {employee.department || employee.position ? " · " : ""}
                    solde congés : <span style={{ fontFamily: "var(--font-mono)" }}>{employee.leaveBalanceDays}</span>
                    {employee.departureDate && <span style={{ color: "var(--amber)" }}> · départ : {employee.departureDate.slice(0, 10)}</span>}
                  </div>
                </div>
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                  {canManage && <Button variant="view" size="sm" onClick={() => setModal({ kind: "mobility", employee, position: employee.position ?? "" })}>Mobilité</Button>}
                  {canAdminister && !employee.departureDate && <Button variant="view" size="sm" onClick={() => setModal({ kind: "departure", employee, date: new Date().toISOString().slice(0, 10) })}>Départ</Button>}
                  {canAdminister && employee.user?.status === "active" && <Button variant="danger" size="sm" onClick={() => handleSuspend(employee)}>Suspendre</Button>}
                  {canAdminister && employee.user?.status === "suspended" && <Button variant="add" size="sm" onClick={() => handleReinstate(employee)}>Réactiver</Button>}
                  {canReadConfidential && <Button variant="view" size="sm" onClick={() => openConfidential(employee)}>Confidentiel</Button>}
                  {canWriteConfidential && <Button variant="edit" size="sm" onClick={() => setModal({ kind: "edit-confidential", employee, baseSalary: "" })}>Modifier conf.</Button>}
                  {canManageUsers && <Button variant="edit" size="sm" onClick={() => setModal({ kind: "grant-role", employee, roleCode: "", justification: "" })}>Attribuer un rôle</Button>}
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>

      {/* Ch. 19 §19.5 — Absences */}
      <Card
        title="Absences"
        icon={<IconAdmin />}
        subtitle="Congés, maladies, missions et télétravail."
        action={canManage ? <Button variant="add" size="sm" onClick={() => setModal({ kind: "absence", employeeId: employees[0]?.id ?? "", type: "conge", from: "", to: "" })}>+ Demande</Button> : undefined}
      >
        {absences.length === 0 ? (
          <Empty>Aucune demande.</Empty>
        ) : (
          <div className="ecl-list">
            {absences.map((absence) => (
              <div key={absence.id} className="ecl-row">
                <div className="ecl-row__main" style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                  <span className="ecl-row__title">{ABSENCE_TYPE_LABELS[absence.type]}</span>
                  <span className="ecl-row__desc" style={{ margin: 0 }}>{absence.fromDate.slice(0, 10)} → {absence.toDate.slice(0, 10)}</span>
                  <StatusChip label={ABSENCE_STATUS_LABELS[absence.status]} />
                </div>
                {canValidateAbsence && absence.status === "en_attente" && (
                  <div style={{ display: "flex", gap: 6 }}>
                    <Button variant="add" size="sm" onClick={() => handleDecideAbsence(absence, "validee")}>Valider</Button>
                    <Button variant="danger" size="sm" onClick={() => handleDecideAbsence(absence, "refusee")}>Refuser</Button>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </Card>

      {/* Ch. 19 §19.4 — Anomalies d'accès */}
      {canManage && (
        <Card title="Anomalies d'accès" icon={<IconAdmin />} subtitle="Écarts détectés entre comptes et habilitations.">
          {anomalies.length === 0 ? (
            <Empty>Aucune anomalie détectée.</Empty>
          ) : (
            <div className="ecl-list">
              {anomalies.map((anomaly, i) => (
                <div key={i} className="ecl-row">
                  <span className="ecl-row__title">{anomaly.username}</span>
                  <span style={{ color: "var(--amber)", fontSize: 12.5 }}>{anomaly.detail}</span>
                </div>
              ))}
            </div>
          )}
        </Card>
      )}

      {/* Ch. 19 §19.4 — Revue périodique des habilitations */}
      {canManage && (
        <Card
          title="Revue périodique des habilitations"
          icon={<IconAdmin />}
          subtitle="Campagnes de vérification des accès."
          action={canAdminister ? <Button variant="add" size="sm" onClick={() => setModal({ kind: "review", label: "" })}>+ Campagne</Button> : undefined}
        >
          <div className="ecl-field" style={{ maxWidth: 360 }}>
            <label>Campagne</label>
            <select value={selectedReviewId} onChange={(e) => setSelectedReviewId(e.target.value)}>
              <option value="">— sélectionner —</option>
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
                      Réviseur : {item.reviewer.firstName} {item.reviewer.lastName}
                      {item.decision && ` · ${item.decision === "confirme" ? "Confirmé" : "Anomalie signalée"}`}
                    </div>
                  </div>
                  {!item.decision && (
                    <div style={{ display: "flex", gap: 6 }}>
                      <Button variant="add" size="sm" onClick={() => handleDecideReviewItem(item, "confirme")}>Confirmer</Button>
                      <Button variant="danger" size="sm" onClick={() => handleDecideReviewItem(item, "anomalie_signalee")}>Signaler</Button>
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
        <Modal title="Nouveau dossier collaborateur" onClose={() => setModal(null)} footer={<ModalActions onCancel={() => setModal(null)} onConfirm={submitEmployee} confirmLabel="Créer" />}>
          <Field label="Prénom"><input value={modal.firstName} onChange={(e) => setModal({ ...modal, firstName: e.target.value })} autoFocus /></Field>
          <Field label="Nom"><input value={modal.lastName} onChange={(e) => setModal({ ...modal, lastName: e.target.value })} /></Field>
          <Field label="Poste (optionnel)"><input value={modal.position} onChange={(e) => setModal({ ...modal, position: e.target.value })} /></Field>
          <Field label="Identifiant du département (optionnel)"><input value={modal.departmentId} onChange={(e) => setModal({ ...modal, departmentId: e.target.value })} /></Field>
        </Modal>
      )}

      {modal?.kind === "mobility" && (
        <Modal title="Mobilité interne" onClose={() => setModal(null)} footer={<ModalActions onCancel={() => setModal(null)} onConfirm={submitMobility} confirmLabel="Enregistrer" />}>
          <p style={{ margin: 0, fontSize: 13, color: "var(--muted)" }}>{modal.employee.firstName} {modal.employee.lastName}</p>
          <Field label="Nouveau poste"><input value={modal.position} onChange={(e) => setModal({ ...modal, position: e.target.value })} autoFocus /></Field>
        </Modal>
      )}

      {modal?.kind === "departure" && (
        <Modal title="Enregistrer un départ" onClose={() => setModal(null)} footer={<ModalActions onCancel={() => setModal(null)} onConfirm={submitDeparture} confirmLabel="Enregistrer" />}>
          <p style={{ margin: 0, fontSize: 13, color: "var(--muted)" }}>{modal.employee.firstName} {modal.employee.lastName}</p>
          <Field label="Date de départ"><input type="date" value={modal.date} onChange={(e) => setModal({ ...modal, date: e.target.value })} /></Field>
        </Modal>
      )}

      {modal?.kind === "view-confidential" && (
        <Modal title="Données confidentielles" onClose={() => setModal(null)} footer={<Button variant="view" size="sm" onClick={() => setModal(null)}>Fermer</Button>}>
          <p style={{ margin: 0, fontSize: 13, color: "var(--muted)" }}>{modal.employee.firstName} {modal.employee.lastName}</p>
          <div><div style={{ fontSize: 12, color: "var(--muted)" }}>Salaire de base</div><div style={{ fontFamily: "var(--font-mono)", fontSize: 16, fontWeight: 700, color: "var(--ink)" }}>{modal.baseSalary}</div></div>
          <div><div style={{ fontSize: 12, color: "var(--muted)" }}>Notes</div><div style={{ fontSize: 13 }}>{modal.notes}</div></div>
        </Modal>
      )}

      {modal?.kind === "edit-confidential" && (
        <Modal title="Modifier les données confidentielles" onClose={() => setModal(null)} footer={<ModalActions onCancel={() => setModal(null)} onConfirm={submitEditConfidential} confirmLabel="Enregistrer" />}>
          <p style={{ margin: 0, fontSize: 13, color: "var(--muted)" }}>{modal.employee.firstName} {modal.employee.lastName}</p>
          <Field label="Salaire de base"><input type="number" min={0} value={modal.baseSalary} onChange={(e) => setModal({ ...modal, baseSalary: e.target.value })} autoFocus /></Field>
        </Modal>
      )}

      {modal?.kind === "grant-role" && (
        <Modal title="Attribuer un rôle" onClose={() => setModal(null)} footer={<ModalActions onCancel={() => setModal(null)} onConfirm={submitGrantRole} confirmLabel="Attribuer" />}>
          <p style={{ margin: 0, fontSize: 13, color: "var(--muted)" }}>{modal.employee.firstName} {modal.employee.lastName}</p>
          <Field label="Code du rôle"><input value={modal.roleCode} onChange={(e) => setModal({ ...modal, roleCode: e.target.value })} autoFocus /></Field>
          <Field label="Justification"><input value={modal.justification} onChange={(e) => setModal({ ...modal, justification: e.target.value })} /></Field>
        </Modal>
      )}

      {modal?.kind === "absence" && (
        <Modal title="Nouvelle demande d'absence" onClose={() => setModal(null)} footer={<ModalActions onCancel={() => setModal(null)} onConfirm={submitAbsence} confirmLabel="Enregistrer" />}>
          <Field label="Collaborateur">
            <select value={modal.employeeId} onChange={(e) => setModal({ ...modal, employeeId: e.target.value })}>
              {employees.map((emp) => <option key={emp.id} value={emp.id}>{emp.firstName} {emp.lastName}</option>)}
            </select>
          </Field>
          <Field label="Type">
            <select value={modal.type} onChange={(e) => setModal({ ...modal, type: e.target.value as AbsenceType })}>
              {Object.entries(ABSENCE_TYPE_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
          </Field>
          <Field label="Du"><input type="date" value={modal.from} onChange={(e) => setModal({ ...modal, from: e.target.value })} /></Field>
          <Field label="Au"><input type="date" value={modal.to} onChange={(e) => setModal({ ...modal, to: e.target.value })} /></Field>
        </Modal>
      )}

      {modal?.kind === "review" && (
        <Modal title="Lancer une campagne de revue" onClose={() => setModal(null)} footer={<ModalActions onCancel={() => setModal(null)} onConfirm={submitReview} confirmLabel="Lancer" />}>
          <Field label="Libellé de la campagne"><input value={modal.label} onChange={(e) => setModal({ ...modal, label: e.target.value })} autoFocus /></Field>
        </Modal>
      )}
    </div>
  );
}

function ModalActions({ onCancel, onConfirm, confirmLabel }: { onCancel: () => void; onConfirm: () => void; confirmLabel: string }) {
  return (
    <>
      <Button variant="view" size="sm" onClick={onCancel}>Annuler</Button>
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
