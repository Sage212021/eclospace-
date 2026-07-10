import { useEffect, useMemo, useState } from "react";
import {
  createDepartment,
  deleteDepartment,
  getRolePermissions,
  listDepartments,
  listPermissions,
  listRoles,
  setDepartmentPermission,
  setRolePermission,
  type Department,
  type PermissionRef,
  type RoleSummary,
} from "../api/client";
import { Button } from "../components/Button";
import { Modal } from "../components/Modal";

const ACTIONS: { key: string; label: string }[] = [
  { key: "consultation", label: "Consulter" },
  { key: "saisie", label: "Saisir" },
  { key: "validation", label: "Valider" },
  { key: "administration", label: "Administrer" },
];

// Matrice des droits éditable + gestion des pôles (spéc. fonctionnelle §3,
// décision A). L'administrateur ajuste, pour chaque rôle, les actions permises
// par module ; le rôle « Administrateur général » reste en lecture seule.
export function RightsMatrixPage({ canManage }: { canManage: boolean }) {
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  return (
    <div className="ecl-page">
      <h1 className="ecl-page__title">Droits & pôles</h1>
      <p className="ecl-page__lead">
        Ajustez les droits de chaque profil (rôle) par module, et gérez les pôles de la maison. Toute modification est
        appliquée immédiatement et journalisée.
      </p>

      {error && (
        <div style={{ background: "var(--alert-soft)", color: "var(--alert)", borderRadius: 8, padding: "9px 13px", fontSize: 13, marginTop: 12 }}>
          {error}
        </div>
      )}
      {message && (
        <div style={{ background: "var(--eclosion-soft)", color: "var(--eclosion)", borderRadius: 8, padding: "9px 13px", fontSize: 13, marginTop: 12 }}>
          {message}
        </div>
      )}

      <RightsMatrix canManage={canManage} onError={setError} onMessage={setMessage} />
      {canManage && <BulkPoleRights onError={setError} onMessage={setMessage} />}
      <DepartmentsPanel canManage={canManage} onError={setError} onMessage={setMessage} />
    </div>
  );
}

// Réglage groupé par pôle (spéc. fonctionnelle §3) : accorder ou retirer un
// droit à TOUS les rôles d'un pôle en une seule opération.
function BulkPoleRights({ onError, onMessage }: { onError: (m: string | null) => void; onMessage: (m: string | null) => void }) {
  const [departments, setDepartments] = useState<Department[]>([]);
  const [permissions, setPermissions] = useState<PermissionRef[]>([]);
  const [deptId, setDeptId] = useState("");
  const [module, setModule] = useState("");
  const [action, setAction] = useState("consultation");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    Promise.all([listDepartments(), listPermissions()])
      .then(([d, p]) => {
        setDepartments(d);
        setPermissions(p);
        if (d[0]) setDeptId(d[0].id);
        const mods = [...new Set(p.map((x) => x.module))].sort();
        if (mods[0]) setModule(mods[0]);
      })
      .catch((e) => onError(e instanceof Error ? e.message : "Échec du chargement."));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const modules = [...new Set(permissions.map((p) => p.module))].sort();
  const actionsForModule = ACTIONS.filter((a) => permissions.some((p) => p.module === module && p.action === a.key));

  async function apply(granted: boolean) {
    if (!deptId || !module) return;
    setBusy(true);
    onError(null);
    onMessage(null);
    try {
      const res = await setDepartmentPermission(deptId, module, action, granted);
      const dept = departments.find((d) => d.id === deptId);
      onMessage(`Droit ${granted ? "accordé" : "retiré"} pour ${res.roles_affected} rôle(s) du pôle « ${dept?.name ?? ""} ».`);
    } catch (err) {
      onError(err instanceof Error ? err.message : "Échec du réglage groupé.");
    } finally {
      setBusy(false);
    }
  }

  const field: React.CSSProperties = { padding: "6px 8px", fontSize: 13, border: "1px solid var(--line)", borderRadius: 6, background: "#fff" };

  return (
    <div className="ecl-card">
      <div className="ecl-card__title" style={{ marginBottom: 4 }}>Réglage groupé par pôle</div>
      <p style={{ fontSize: 12, color: "var(--muted)", margin: "0 0 12px" }}>
        Accordez ou retirez un droit à <strong>tous les rôles d'un pôle</strong> en une seule opération (le rôle
        Administrateur général n'est jamais affecté).
      </p>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
        <select value={deptId} onChange={(e) => setDeptId(e.target.value)} style={field}>
          {departments.map((d) => (
            <option key={d.id} value={d.id}>
              {d.name}
            </option>
          ))}
        </select>
        <select
          value={module}
          onChange={(e) => setModule(e.target.value)}
          style={field}
        >
          {modules.map((m) => (
            <option key={m} value={m}>
              {m}
            </option>
          ))}
        </select>
        <select value={action} onChange={(e) => setAction(e.target.value)} style={field}>
          {actionsForModule.map((a) => (
            <option key={a.key} value={a.key}>
              {a.label}
            </option>
          ))}
        </select>
        <Button variant="add" size="sm" onClick={() => apply(true)} disabled={busy}>
          Accorder à tout le pôle
        </Button>
        <Button variant="danger" size="sm" onClick={() => apply(false)} disabled={busy}>
          Retirer à tout le pôle
        </Button>
      </div>
    </div>
  );
}

function RightsMatrix({ canManage, onError, onMessage }: { canManage: boolean; onError: (m: string | null) => void; onMessage: (m: string | null) => void }) {
  const [roles, setRoles] = useState<RoleSummary[]>([]);
  const [permissions, setPermissions] = useState<PermissionRef[]>([]);
  const [roleId, setRoleId] = useState("");
  const [granted, setGranted] = useState<Set<string>>(new Set());
  const [editable, setEditable] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([listRoles(), listPermissions()])
      .then(([r, p]) => {
        setRoles(r);
        setPermissions(p);
        if (r[0]) setRoleId(r[0].id);
      })
      .catch((e) => onError(e instanceof Error ? e.message : "Échec du chargement."));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!roleId) return;
    getRolePermissions(roleId)
      .then((rp) => {
        setGranted(new Set(rp.permissions));
        setEditable(rp.editable);
      })
      .catch((e) => onError(e instanceof Error ? e.message : "Échec du chargement des droits."));
  }, [roleId, onError]);

  const modules = useMemo(() => [...new Set(permissions.map((p) => p.module))].sort(), [permissions]);
  const availableActions = useMemo(() => {
    const set = new Set(permissions.map((p) => p.action));
    return ACTIONS.filter((a) => set.has(a.key));
  }, [permissions]);

  async function toggle(module: string, action: string) {
    const key = `${module}:${action}`;
    const next = !granted.has(key);
    setBusy(key);
    onError(null);
    onMessage(null);
    try {
      await setRolePermission(roleId, module, action, next);
      setGranted((prev) => {
        const copy = new Set(prev);
        if (next) copy.add(key);
        else copy.delete(key);
        return copy;
      });
      onMessage(`Droit ${next ? "accordé" : "retiré"} : ${key}.`);
    } catch (err) {
      onError(err instanceof Error ? err.message : "Échec de la modification du droit.");
    } finally {
      setBusy(null);
    }
  }

  const cell: React.CSSProperties = { padding: "6px 8px", textAlign: "center", borderTop: "1px solid var(--line)" };

  return (
    <div className="ecl-card">
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12, flexWrap: "wrap" }}>
        <span className="ecl-card__title">Droits du profil</span>
        <select
          value={roleId}
          onChange={(e) => setRoleId(e.target.value)}
          style={{ padding: "6px 8px", fontSize: 13, border: "1px solid var(--line)", borderRadius: 6, background: "#fff" }}
        >
          {roles.map((r) => (
            <option key={r.id} value={r.id}>
              {r.label}
              {r.department ? ` — ${r.department}` : ""}
            </option>
          ))}
        </select>
        {!editable && (
          <span style={{ fontSize: 12, color: "var(--amber)" }}>Accès complet non modifiable (rôle de secours).</span>
        )}
      </div>

      <div style={{ overflowX: "auto", borderRadius: 10, border: "1px solid var(--line)" }}>
        <table className="ecl-table">
          <thead>
            <tr>
              <th>Module</th>
              {availableActions.map((a) => (
                <th key={a.key} style={{ textAlign: "center" }}>
                  {a.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {modules.map((module) => (
              <tr key={module}>
                <td style={{ fontWeight: 600 }}>{module}</td>
                {availableActions.map((a) => {
                  const key = `${module}:${a.key}`;
                  const has = granted.has(key);
                  const exists = permissions.some((p) => p.module === module && p.action === a.key);
                  return (
                    <td key={a.key} style={cell}>
                      {exists ? (
                        <input
                          type="checkbox"
                          checked={has}
                          disabled={!canManage || !editable || busy === key}
                          onChange={() => toggle(module, a.key)}
                          style={{ width: 16, height: 16, cursor: canManage && editable ? "pointer" : "default" }}
                        />
                      ) : (
                        <span style={{ color: "var(--line)" }}>—</span>
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function DepartmentsPanel({ canManage, onError, onMessage }: { canManage: boolean; onError: (m: string | null) => void; onMessage: (m: string | null) => void }) {
  const [departments, setDepartments] = useState<Department[]>([]);
  const [name, setName] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [confirmDept, setConfirmDept] = useState<Department | null>(null);

  const refresh = () => listDepartments().then(setDepartments).catch((e) => onError(e instanceof Error ? e.message : "Échec du chargement des pôles."));

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    onError(null);
    onMessage(null);
    setSubmitting(true);
    try {
      await createDepartment(name.trim());
      onMessage(`Pôle « ${name.trim()} » ajouté.`);
      setName("");
      await refresh();
    } catch (err) {
      onError(err instanceof Error ? err.message : "Échec de l'ajout du pôle.");
    } finally {
      setSubmitting(false);
    }
  }

  async function confirmRemove() {
    if (!confirmDept) return;
    onError(null);
    onMessage(null);
    try {
      await deleteDepartment(confirmDept.id);
      onMessage(`Pôle « ${confirmDept.name} » retiré.`);
      setConfirmDept(null);
      await refresh();
    } catch (err) {
      onError(err instanceof Error ? err.message : "Échec du retrait du pôle.");
    }
  }

  return (
    <div className="ecl-card" style={{ maxWidth: 520 }}>
      <div className="ecl-card__title" style={{ marginBottom: 12 }}>
        Pôles <span style={{ color: "var(--muted)", fontWeight: 400 }}>({departments.length})</span>
      </div>
      <div className="ecl-list">
        {departments.map((d) => (
          <div key={d.id} className="ecl-row" style={{ padding: "9px 12px" }}>
            <span className="ecl-row__main" style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span className="ecl-row__title" style={{ fontWeight: 500 }}>{d.name}</span>
              <span style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--muted)" }}>{d.code}</span>
            </span>
            {canManage && (
              <button
                onClick={() => setConfirmDept(d)}
                title="Retirer"
                style={{ border: "none", background: "transparent", color: "var(--alert)", cursor: "pointer", fontSize: 18, lineHeight: 1, padding: "0 4px" }}
              >
                ×
              </button>
            )}
          </div>
        ))}
      </div>
      {canManage && (
        <form onSubmit={handleCreate} style={{ display: "flex", gap: 8, marginTop: 12 }}>
          <div className="ecl-field" style={{ flex: 1 }}>
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Nouveau pôle…" />
          </div>
          <Button variant="add" size="sm" type="submit" disabled={submitting || !name.trim()}>Ajouter</Button>
        </form>
      )}

      {confirmDept && (
        <Modal
          title="Confirmer le retrait du pôle"
          onClose={() => setConfirmDept(null)}
          footer={
            <>
              <Button variant="view" size="sm" onClick={() => setConfirmDept(null)}>Annuler</Button>
              <Button variant="danger" size="sm" onClick={confirmRemove}>Retirer</Button>
            </>
          }
        >
          <p style={{ margin: 0, fontSize: 13 }}>Retirer le pôle « <strong>{confirmDept.name}</strong> » ?</p>
        </Modal>
      )}
    </div>
  );
}
