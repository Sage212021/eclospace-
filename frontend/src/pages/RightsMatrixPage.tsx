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
    <div style={{ padding: 32, maxWidth: 1040 }}>
      <h1 style={{ fontFamily: "var(--font-title)", fontSize: 20, margin: 0 }}>Droits & pôles</h1>
      <p style={{ color: "var(--muted)", fontSize: 13, marginTop: 6 }}>
        Ajustez les droits de chaque profil (rôle) par module, et gérez les pôles de la maison. Toute modification est
        appliquée immédiatement et journalisée.
      </p>

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
    <div style={{ background: "var(--card)", border: "1px solid var(--line)", borderRadius: 10, padding: 18, marginTop: 16 }}>
      <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 4 }}>Réglage groupé par pôle</div>
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
        <button
          onClick={() => apply(true)}
          disabled={busy}
          style={{ background: "var(--eclosion)", color: "#fff", border: "none", borderRadius: 6, padding: "6px 12px", fontSize: 13, fontWeight: 600, cursor: busy ? "default" : "pointer", opacity: busy ? 0.6 : 1 }}
        >
          Accorder à tout le pôle
        </button>
        <button
          onClick={() => apply(false)}
          disabled={busy}
          style={{ background: "#fff", color: "var(--alert)", border: "1px solid var(--alert)", borderRadius: 6, padding: "6px 12px", fontSize: 13, cursor: busy ? "default" : "pointer", opacity: busy ? 0.6 : 1 }}
        >
          Retirer à tout le pôle
        </button>
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
    <div style={{ background: "var(--card)", border: "1px solid var(--line)", borderRadius: 10, padding: 18, marginTop: 16 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12, flexWrap: "wrap" }}>
        <span style={{ fontSize: 13, fontWeight: 600 }}>Droits du profil</span>
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

      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
          <thead>
            <tr style={{ color: "var(--muted)", fontSize: 11, textTransform: "uppercase" }}>
              <th style={{ textAlign: "left", padding: "6px 8px" }}>Module</th>
              {availableActions.map((a) => (
                <th key={a.key} style={{ padding: "6px 8px" }}>
                  {a.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {modules.map((module) => (
              <tr key={module}>
                <td style={{ ...cell, textAlign: "left", fontWeight: 600 }}>{module}</td>
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

  async function handleRemove(dept: Department) {
    if (!window.confirm(`Retirer le pôle « ${dept.name} » ?`)) return;
    onError(null);
    onMessage(null);
    try {
      await deleteDepartment(dept.id);
      onMessage(`Pôle « ${dept.name} » retiré.`);
      await refresh();
    } catch (err) {
      onError(err instanceof Error ? err.message : "Échec du retrait du pôle.");
    }
  }

  return (
    <div style={{ background: "var(--card)", border: "1px solid var(--line)", borderRadius: 10, padding: 18, marginTop: 16, maxWidth: 520 }}>
      <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 10 }}>
        Pôles <span style={{ color: "var(--muted)", fontWeight: 400 }}>({departments.length})</span>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        {departments.map((d) => (
          <div key={d.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", borderBottom: "1px solid var(--line)", padding: "4px 0" }}>
            <span style={{ fontSize: 13 }}>
              {d.name} <span style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--muted)" }}>{d.code}</span>
            </span>
            {canManage && (
              <button
                onClick={() => handleRemove(d)}
                title="Retirer"
                style={{ border: "none", background: "transparent", color: "var(--alert)", cursor: "pointer", fontSize: 16, lineHeight: 1, padding: "0 4px" }}
              >
                ×
              </button>
            )}
          </div>
        ))}
      </div>
      {canManage && (
        <form onSubmit={handleCreate} style={{ display: "flex", gap: 6, marginTop: 12 }}>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Nouveau pôle…"
            style={{ flex: 1, padding: "6px 8px", fontSize: 13, border: "1px solid var(--line)", borderRadius: 6 }}
          />
          <button
            type="submit"
            disabled={submitting || !name.trim()}
            style={{ background: "var(--eclosion)", color: "#fff", border: "none", borderRadius: 6, padding: "6px 12px", fontSize: 13, fontWeight: 600, cursor: submitting || !name.trim() ? "default" : "pointer", opacity: submitting || !name.trim() ? 0.6 : 1 }}
          >
            Ajouter
          </button>
        </form>
      )}
    </div>
  );
}
