import { useEffect, useState } from "react";
import {
  createUser,
  deleteUser,
  grantRole,
  listRoles,
  listUsersWithRoles,
  resetUserPassword,
  revokeRole,
  updateUser,
  type RoleSummary,
  type UserWithRoles,
} from "../api/client";

interface UsersRolesPageProps {
  canAdminister: boolean;
}

// Gestion des comptes et de leurs habilitations (spéc. fonctionnelle §2, Ch. 2
// §2.4) : création, suspension/réactivation, suppression, réinitialisation du
// mot de passe, attribution/retrait de rôle (justifiés et tracés à l'audit).
export function UsersRolesPage({ canAdminister }: UsersRolesPageProps) {
  const [users, setUsers] = useState<UserWithRoles[]>([]);
  const [roles, setRoles] = useState<RoleSummary[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);

  const refresh = async () => {
    const [userList, roleList] = await Promise.all([listUsersWithRoles(), listRoles()]);
    setUsers(userList);
    setRoles(roleList);
  };

  useEffect(() => {
    refresh().catch((e) => setError(e instanceof Error ? e.message : "Échec du chargement."));
  }, []);

  async function handleToggleStatus(user: UserWithRoles) {
    const suspend = user.status === "active";
    if (!window.confirm(suspend ? `Suspendre le compte ${user.username} ?` : `Réactiver le compte ${user.username} ?`)) return;
    setError(null);
    setMessage(null);
    try {
      await updateUser(user.id, { status: suspend ? "suspended" : "active" });
      setMessage(suspend ? `Compte ${user.username} suspendu.` : `Compte ${user.username} réactivé.`);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Échec du changement de statut.");
    }
  }

  async function handleDelete(user: UserWithRoles) {
    if (!window.confirm(`Supprimer définitivement le compte ${user.username} ? Cette action est tracée et irréversible.`)) return;
    setError(null);
    setMessage(null);
    try {
      await deleteUser(user.id);
      setMessage(`Compte ${user.username} supprimé.`);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Échec de la suppression.");
    }
  }

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
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
        <h1 style={{ fontFamily: "var(--font-title)", fontSize: 20, margin: 0 }}>Utilisateurs & rôles</h1>
        {canAdminister && (
          <button
            onClick={() => setShowCreate((v) => !v)}
            style={{ background: "var(--eclosion)", color: "#fff", border: "none", borderRadius: 6, padding: "8px 14px", fontSize: 13, fontWeight: 600, cursor: "pointer" }}
          >
            {showCreate ? "Annuler" : "+ Nouveau compte"}
          </button>
        )}
      </div>
      <p style={{ color: "var(--muted)", fontSize: 13, marginTop: 6 }}>
        Comptes et habilitations : créez et gérez les comptes, attribuez ou retirez les rôles. Chaque changement est
        justifié et journalisé.
      </p>

      {showCreate && canAdminister && (
        <CreateAccountForm
          roles={roles}
          onCreated={(name) => {
            setShowCreate(false);
            setMessage(`Compte ${name} créé.`);
            refresh().catch(() => {});
          }}
          onError={setError}
        />
      )}

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
                <>
                  <button onClick={() => handleResetPassword(user)} title="Définir un nouveau mot de passe" style={ghostBtn}>
                    Réinitialiser le mot de passe
                  </button>
                  <button onClick={() => handleToggleStatus(user)} title={user.status === "active" ? "Suspendre" : "Réactiver"} style={ghostBtn}>
                    {user.status === "active" ? "Suspendre" : "Réactiver"}
                  </button>
                  <button onClick={() => handleDelete(user)} title="Supprimer ce compte" style={{ ...ghostBtn, color: "var(--alert)", borderColor: "var(--alert)" }}>
                    Supprimer
                  </button>
                </>
              )}
              <span
                style={{
                  fontSize: 11,
                  color: user.status === "active" ? "var(--eclosion)" : user.status === "suspended" ? "var(--amber)" : "var(--muted)",
                }}
              >
                {user.status === "active" ? "Actif" : user.status === "suspended" ? "Suspendu" : user.status}
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

const ghostBtn: React.CSSProperties = {
  border: "1px solid var(--line)",
  background: "#fff",
  color: "var(--ink)",
  borderRadius: 6,
  padding: "4px 10px",
  fontSize: 12,
  cursor: "pointer",
};

// Création d'un compte (spéc. fonctionnelle §2) : identifiant, e-mail, mot de
// passe conforme aux règles, et rôles initiaux facultatifs.
function CreateAccountForm({
  roles,
  onCreated,
  onError,
}: {
  roles: RoleSummary[];
  onCreated: (username: string) => void;
  onError: (m: string) => void;
}) {
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [roleCode, setRoleCode] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    onError("");
    setSubmitting(true);
    try {
      const created = await createUser({ username, email, password, role_codes: roleCode ? [roleCode] : [] });
      onCreated(created.username);
    } catch (err) {
      onError(err instanceof Error ? err.message : "Échec de la création du compte.");
    } finally {
      setSubmitting(false);
    }
  }

  const field: React.CSSProperties = { width: "100%", padding: "8px 10px", border: "1px solid var(--line)", borderRadius: 6, fontSize: 13 };

  return (
    <form onSubmit={handleSubmit} style={{ background: "var(--card)", border: "1px solid var(--line)", borderRadius: 10, padding: 18, marginTop: 16 }}>
      <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 10 }}>Nouveau compte</div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        <Labeled label="Identifiant">
          <input value={username} onChange={(e) => setUsername(e.target.value)} required minLength={3} style={field} />
        </Labeled>
        <Labeled label="E-mail">
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required style={field} />
        </Labeled>
        <Labeled label="Mot de passe (min. 8 car., une majuscule, un chiffre)">
          <input type="text" value={password} onChange={(e) => setPassword(e.target.value)} required style={field} />
        </Labeled>
        <Labeled label="Rôle initial (facultatif)">
          <select value={roleCode} onChange={(e) => setRoleCode(e.target.value)} style={field}>
            <option value="">Aucun rôle</option>
            {roles.map((r) => (
              <option key={r.id} value={r.code}>
                {r.label}
                {r.department ? ` — ${r.department}` : ""}
              </option>
            ))}
          </select>
        </Labeled>
      </div>
      <button
        type="submit"
        disabled={submitting}
        style={{ marginTop: 14, background: "var(--eclosion)", color: "#fff", border: "none", borderRadius: 6, padding: "8px 16px", fontSize: 13, fontWeight: 600, cursor: submitting ? "default" : "pointer", opacity: submitting ? 0.6 : 1 }}
      >
        Créer le compte
      </button>
    </form>
  );
}

function Labeled({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label style={{ fontSize: 12, color: "var(--muted)" }}>
      <span style={{ display: "block", marginBottom: 4 }}>{label}</span>
      {children}
    </label>
  );
}
