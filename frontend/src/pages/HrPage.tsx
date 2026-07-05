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
}

// Ch. 19 : Ressources humaines — dossier collaborateur, cycle de vie du
// compte, absences, revue des accès (couche transverse du Lot 6).
export function HrPage({ canManage, canAdminister, canValidateAbsence, canManageUsers, canReadConfidential, canWriteConfidential }: HrPageProps) {
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [absences, setAbsences] = useState<Absence[]>([]);
  const [anomalies, setAnomalies] = useState<AccessAnomaly[]>([]);
  const [reviews, setReviews] = useState<AccessReview[]>([]);
  const [selectedReviewId, setSelectedReviewId] = useState("");
  const [reviewItems, setReviewItems] = useState<AccessReviewItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

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

  async function handleCreateEmployee() {
    const firstName = window.prompt("Prénom");
    if (!firstName) return;
    const lastName = window.prompt("Nom");
    if (!lastName) return;
    const position = window.prompt("Poste (laisser vide si non applicable)", "") || undefined;
    const departmentId = window.prompt("ID département (laisser vide si non applicable)", "") || undefined;
    try {
      await createEmployee({ first_name: firstName, last_name: lastName, position, department_id: departmentId });
      setMessage("Dossier collaborateur créé.");
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Échec de la création du dossier.");
    }
  }

  async function handleMobility(employee: Employee) {
    const position = window.prompt("Nouveau poste", employee.position ?? "");
    if (position === null) return;
    try {
      await updateEmployee(employee.id, { position });
      setMessage("Mobilité enregistrée.");
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Échec de la mise à jour.");
    }
  }

  async function handleDeparture(employee: Employee) {
    const date = window.prompt("Date de départ (AAAA-MM-JJ)", new Date().toISOString().slice(0, 10));
    if (!date) return;
    try {
      await setEmployeeDeparture(employee.id, new Date(date).toISOString());
      setMessage("Date de départ enregistrée.");
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Échec de l'enregistrement du départ.");
    }
  }

  async function handleSuspend(employee: Employee) {
    try {
      await suspendEmployee(employee.id);
      setMessage("Compte suspendu.");
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Échec de la suspension.");
    }
  }

  async function handleReinstate(employee: Employee) {
    try {
      await reinstateEmployee(employee.id);
      setMessage("Compte réactivé.");
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Échec de la réactivation.");
    }
  }

  async function handleViewConfidential(employee: Employee) {
    try {
      const confidential = await getEmployeeConfidential(employee.id);
      window.alert(`Salaire de base : ${confidential.baseSalary ?? "non renseigné"}\nNotes : ${confidential.notes ?? "—"}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Échec de la consultation.");
    }
  }

  async function handleEditConfidential(employee: Employee) {
    const baseSalary = window.prompt("Salaire de base");
    if (baseSalary === null) return;
    try {
      await updateEmployeeConfidential(employee.id, { base_salary: baseSalary ? Number(baseSalary) : undefined });
      setMessage("Données confidentielles mises à jour.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Échec de la mise à jour.");
    }
  }

  async function handleGrantRole(employee: Employee) {
    if (!employee.user) {
      setError("Ce dossier n'a pas de compte utilisateur associé.");
      return;
    }
    const roleCode = window.prompt("Code du rôle à attribuer");
    if (!roleCode) return;
    const justification = window.prompt("Justification");
    if (!justification) return;
    try {
      await grantRole(employee.user.id, roleCode, justification);
      setMessage("Rôle attribué.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Échec de l'attribution du rôle.");
    }
  }

  async function handleCreateAbsence() {
    const employeeId = window.prompt("ID du collaborateur");
    if (!employeeId) return;
    const type = (window.prompt("Type (conge, maladie, mission, teletravail)", "conge") ?? "conge") as AbsenceType;
    const fromDate = window.prompt("Du (AAAA-MM-JJ)");
    const toDate = window.prompt("Au (AAAA-MM-JJ)");
    if (!fromDate || !toDate) return;
    try {
      await createAbsence({
        employee_id: employeeId,
        type,
        from_date: new Date(fromDate).toISOString(),
        to_date: new Date(toDate).toISOString(),
      });
      setMessage("Demande d'absence enregistrée.");
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Échec de l'enregistrement.");
    }
  }

  async function handleDecideAbsence(absence: Absence, decision: "validee" | "refusee") {
    try {
      await decideAbsence(absence.id, decision);
      setMessage(decision === "validee" ? "Absence validée." : "Absence refusée.");
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Échec de la décision.");
    }
  }

  async function handleCreateReview() {
    const label = window.prompt("Libellé de la campagne de revue des accès");
    if (!label) return;
    try {
      await createAccessReview(label);
      setMessage("Campagne de revue lancée.");
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Échec du lancement de la campagne.");
    }
  }

  async function handleDecideReviewItem(item: AccessReviewItem, decision: "confirme" | "anomalie_signalee") {
    try {
      await decideAccessReviewItem(item.id, decision);
      setMessage("Décision enregistrée.");
      setReviewItems(await listAccessReviewItems(selectedReviewId));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Échec de l'enregistrement.");
    }
  }

  return (
    <div style={{ padding: 32, maxWidth: 1040 }}>
      <h1 style={{ fontFamily: "var(--font-title)", fontSize: 20, margin: 0 }}>Ressources humaines</h1>
      {error && (
        <div style={{ background: "var(--alert-soft)", color: "var(--alert)", borderRadius: 6, padding: "8px 12px", fontSize: 13, marginTop: 12 }}>
          {error}
        </div>
      )}
      {message && (
        <div style={{ background: "var(--eclosion-soft)", color: "var(--eclosion)", borderRadius: 6, padding: "8px 12px", fontSize: 13, marginTop: 12 }}>
          {message}
        </div>
      )}

      <div style={{ background: "var(--card)", border: "1px solid var(--line)", borderRadius: 10, padding: 18, marginTop: 20 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
          <div style={{ fontSize: 13, fontWeight: 600 }}>Dossiers collaborateurs (Ch. 19 §19.2)</div>
          {canManage && (
            <button onClick={handleCreateEmployee} style={secondaryButtonStyle}>
              + Collaborateur
            </button>
          )}
        </div>
        {employees.length === 0 && <p style={{ color: "var(--muted)", fontSize: 13 }}>Aucun collaborateur.</p>}
        {employees.map((employee) => (
          <div key={employee.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", borderTop: "1px solid var(--line)", padding: "6px 0", fontSize: 13 }}>
            <span>
              {employee.firstName} {employee.lastName} — {STATUS_LABELS[employee.status]}
              {employee.position ? ` — ${employee.position}` : ""}
              {employee.department ? ` — ${employee.department.name}` : ""}
              {employee.departureDate && <span style={{ color: "var(--late, #C4661F)" }}> — départ : {employee.departureDate.slice(0, 10)}</span>}
              {" — solde congés : "}
              <span style={{ fontFamily: "var(--font-mono, monospace)" }}>{employee.leaveBalanceDays}</span>
            </span>
            <div style={{ display: "flex", gap: 6 }}>
              {canManage && (
                <button onClick={() => handleMobility(employee)} style={secondaryButtonStyle}>
                  Mobilité
                </button>
              )}
              {canAdminister && !employee.departureDate && (
                <button onClick={() => handleDeparture(employee)} style={secondaryButtonStyle}>
                  Départ
                </button>
              )}
              {canAdminister && employee.user?.status === "active" && (
                <button onClick={() => handleSuspend(employee)} style={secondaryButtonStyle}>
                  Suspendre
                </button>
              )}
              {canAdminister && employee.user?.status === "suspended" && (
                <button onClick={() => handleReinstate(employee)} style={secondaryButtonStyle}>
                  Réactiver
                </button>
              )}
              {canReadConfidential && (
                <button onClick={() => handleViewConfidential(employee)} style={secondaryButtonStyle}>
                  Confidentiel
                </button>
              )}
              {canWriteConfidential && (
                <button onClick={() => handleEditConfidential(employee)} style={secondaryButtonStyle}>
                  Modifier confidentiel
                </button>
              )}
              {canManageUsers && (
                <button onClick={() => handleGrantRole(employee)} style={secondaryButtonStyle}>
                  Attribuer un rôle
                </button>
              )}
            </div>
          </div>
        ))}
      </div>

      <div style={{ background: "var(--card)", border: "1px solid var(--line)", borderRadius: 10, padding: 18, marginTop: 20 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
          <div style={{ fontSize: 13, fontWeight: 600 }}>Absences (Ch. 19 §19.5)</div>
          {canManage && (
            <button onClick={handleCreateAbsence} style={secondaryButtonStyle}>
              + Demande
            </button>
          )}
        </div>
        {absences.length === 0 && <p style={{ color: "var(--muted)", fontSize: 13 }}>Aucune demande.</p>}
        {absences.map((absence) => (
          <div key={absence.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", borderTop: "1px solid var(--line)", padding: "6px 0", fontSize: 13 }}>
            <span>
              {ABSENCE_TYPE_LABELS[absence.type]} — {absence.fromDate.slice(0, 10)} au {absence.toDate.slice(0, 10)} — {ABSENCE_STATUS_LABELS[absence.status]}
            </span>
            {canValidateAbsence && absence.status === "en_attente" && (
              <div style={{ display: "flex", gap: 6 }}>
                <button onClick={() => handleDecideAbsence(absence, "validee")} style={secondaryButtonStyle}>
                  Valider
                </button>
                <button onClick={() => handleDecideAbsence(absence, "refusee")} style={secondaryButtonStyle}>
                  Refuser
                </button>
              </div>
            )}
          </div>
        ))}
      </div>

      {canManage && (
        <div style={{ background: "var(--card)", border: "1px solid var(--line)", borderRadius: 10, padding: 18, marginTop: 20 }}>
          <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 10 }}>Anomalies d'accès (Ch. 19 §19.4)</div>
          {anomalies.length === 0 && <p style={{ color: "var(--muted)", fontSize: 13 }}>Aucune anomalie détectée.</p>}
          {anomalies.map((anomaly, i) => (
            <div key={i} style={{ borderTop: "1px solid var(--line)", padding: "6px 0", fontSize: 13, color: "var(--late, #C4661F)" }}>
              {anomaly.username} — {anomaly.detail}
            </div>
          ))}
        </div>
      )}

      {canManage && (
        <div style={{ background: "var(--card)", border: "1px solid var(--line)", borderRadius: 10, padding: 18, marginTop: 20 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
            <div style={{ fontSize: 13, fontWeight: 600 }}>Revue périodique des habilitations (Ch. 19 §19.4)</div>
            {canAdminister && (
              <button onClick={handleCreateReview} style={secondaryButtonStyle}>
                + Lancer une campagne
              </button>
            )}
          </div>
          <label style={{ fontSize: 12 }}>
            Campagne
            <select value={selectedReviewId} onChange={(e) => setSelectedReviewId(e.target.value)} style={inputStyle}>
              <option value="">— sélectionner —</option>
              {reviews.map((review) => (
                <option key={review.id} value={review.id}>
                  {review.label}
                </option>
              ))}
            </select>
          </label>
          {reviewItems.map((item) => (
            <div key={item.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", borderTop: "1px solid var(--line)", padding: "6px 0", fontSize: 13 }}>
              <span>
                {item.employee.firstName} {item.employee.lastName} — réviseur : {item.reviewer.firstName} {item.reviewer.lastName}
                {item.decision && ` — ${item.decision === "confirme" ? "Confirmé" : "Anomalie signalée"}`}
              </span>
              {!item.decision && (
                <div style={{ display: "flex", gap: 6 }}>
                  <button onClick={() => handleDecideReviewItem(item, "confirme")} style={secondaryButtonStyle}>
                    Confirmer
                  </button>
                  <button onClick={() => handleDecideReviewItem(item, "anomalie_signalee")} style={secondaryButtonStyle}>
                    Signaler
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

const inputStyle: React.CSSProperties = { display: "block", width: "100%", padding: 6, marginTop: 4, fontSize: 13 };
const secondaryButtonStyle: React.CSSProperties = {
  background: "#fff",
  border: "1px solid var(--line)",
  borderRadius: 6,
  padding: "6px 12px",
  fontSize: 12,
  cursor: "pointer",
};
