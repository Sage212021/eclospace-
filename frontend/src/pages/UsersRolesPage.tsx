import { useEffect, useState } from "react";
import { grantRole, listRoles, listUsersWithRoles, resetUserPassword, revokeRole, type RoleSummary, type UserWithRoles } from "../api/client";

interface UsersRolesPageProps {
  canAdminister: boolean;
}

// Gestion des utilisateurs et de leurs habilitations (Ch. 2 §2.4). Consolide
// les endpoints existants : liste des comptes avec rôles actifs, référentiel
// des rôles, attribution et retrait (justification obligatoire, tracés à
// l'audit côté serveur). La création/désactivation de compte relève du dossier
// RH (Ch. 19), écran Ressources humaines.
export function UsersRolesPage({ canAdminister }: UsersRolesPageProps) {
  const [users, setUsers] = useState<UserWithRoles[]>([]);
  const [roles, setRoles] = useState<RoleSummary[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const refresh = async () => {
    const [userList, roleList] = await Promise.all([listUsersWithRoles(), listRoles()]);
    setUsers(userList);
    setRoles(roleList);
  };

  useEffect(() => {
    refresh().catch((e) => setError(e instanceof Error ? e.message : "Échec du chargement."));
  }, []);

  async function handleGrant(user: UserWithRoles, roleCode: string) {
    const justification = window.prompt(`Justification de l'attribution du rôle à ${user.username}`);
    if (!justification) return;
    setError(null);
    try {
      await grantRole(user.id, roleCode, justification);
      setMessage(`Rôle attribué à ${user.username}.`);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Échec de l'attribution.");
    }
  }

  async function handleResetPassword(user: UserWithRoles) {
    const newPassword = window.prompt(
      `Nouveau mot de passe pour ${user.username} (min. 8 caractères, une majuscule, un chiffre). ` +
        `Communiquez-le à l'utilisateur, qui pourra le changer ensuite.`,
    );
    if (!newPassword) return;
    setError(null);
    setMessage(null);
    try {
      await resetUserPassword(user.id, newPassword);
      setMessage(`Mot de passe réinitialisé pour ${user.username}.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Échec de la réinitialisation.");
    }
  }

  async function handleRevoke(user: UserWithRoles, userRoleId: string) {
    const justification = window.prompt(`Justification du retrait du rôle à ${user.username}`);
    if (!justification) return;
    setError(null);
    try {
      await revokeRole(userRoleId, justification);
      setMessage(`Rôle retiré à ${user.username}.`);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Échec du retrait.");
    }
  }

  return (
    <div style={{ padding: 32, maxWidth: 1040 }}>
      <h1 style={{ fontFamily: "var(--font-title)", fontSize: 20, margin: 0 }}>Utilisateurs & rôles</h1>
      <p style={{ color: "var(--muted)", fontSize: 13, marginTop: 6 }}>
        Comptes et habilitations. La création et la désactivation des comptes se font depuis les Ressources humaines ;
        ici, on attribue et retire les rôles (chaque changement est justifié et journalisé).
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

      {users.map((user) => (
        <div key={user.id} style={{ background: "var(--card)", border: "1px solid var(--line)", borderRadius: 10, padding: 18, marginTop: 16 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", flexWrap: "wrap", gap: 8 }}>
            <div>
              <span style={{ fontSize: 14, fontWeight: 600 }}>{user.username}</span>
              <span style={{ fontSize: 12, color: "var(--muted)", marginLeft: 8 }}>{user.email}</span>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
              {canAdminister && (
                <button
                  onClick={() => handleResetPassword(user)}
                  title="Définir un nouveau mot de passe pour ce compte"
                  style={{
                    border: "1px solid var(--line)",
                    background: "#fff",
                    color: "var(--ink)",
                    borderRadius: 6,
                    padding: "4px 10px",
                    fontSize: 12,
                    cursor: "pointer",
                  }}
                >
                  Réinitialiser le mot de passe
                </button>
              )}
              <span style={{ fontSize: 11, color: user.status === "active" ? "var(--eclosion)" : "var(--muted)" }}>
                {user.status === "active" ? "Actif" : user.status}
              </span>
            </div>
          </div>

          <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 10 }}>
            {user.roles.length === 0 && <span style={{ fontSize: 12, color: "var(--muted)" }}>Aucun rôle attribué.</span>}
            {user.roles.map((role) => (
              <span
                key={role.userRoleId}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 6,
                  background: "var(--eclosion-soft)",
                  color: "var(--eclosion)",
                  borderRadius: 999,
                  padding: "2px 6px 2px 10px",
                  fontSize: 12,
                }}
              >
                {role.label}
                {canAdminister && (
                  <button
                    onClick={() => handleRevoke(user, role.userRoleId)}
                    title="Retirer ce rôle"
                    style={{ border: "none", background: "transparent", color: "var(--alert)", cursor: "pointer", fontSize: 14, lineHeight: 1, padding: 0 }}
                  >
                    ×
                  </button>
                )}
              </span>
            ))}
          </div>

          {canAdminister && (
            <div style={{ marginTop: 10 }}>
              <select
                defaultValue=""
                onChange={(e) => {
                  if (e.target.value) {
                    handleGrant(user, e.target.value);
                    e.target.value = "";
                  }
                }}
                style={{ padding: 6, fontSize: 12, border: "1px solid var(--line)", borderRadius: 6, background: "#fff" }}
              >
                <option value="">+ Attribuer un rôle…</option>
                {roles
                  .filter((r) => !user.roles.some((ur) => ur.code === r.code))
                  .map((r) => (
                    <option key={r.id} value={r.code}>
                      {r.label}
                      {r.department ? ` — ${r.department}` : ""}
                    </option>
                  ))}
              </select>
            </div>
          )}
        </div>
      ))}

      {users.length === 0 && <p style={{ color: "var(--muted)", fontSize: 13 }}>Aucun utilisateur.</p>}
    </div>
  );
}
