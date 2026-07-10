import { useEffect, useState } from "react";
import {
  createUser,
  deleteUser,
  grantRole,
  impersonateUser,
  listRoles,
  listUsersWithRoles,
  resetUserPassword,
  revokeRole,
  updateUser,
  type RoleSummary,
  type UserWithRoles,
} from "../api/client";
import { Button } from "../components/Button";
import { Modal, Field } from "../components/Modal";
import { EmailInput } from "../components/EmailInput";

interface UsersRolesPageProps {
  canAdminister: boolean;
}

type UModal =
  | { kind: "toggle-status"; user: UserWithRoles }
  | { kind: "impersonate"; user: UserWithRoles }
  | { kind: "delete"; user: UserWithRoles }
  | { kind: "reset-password"; user: UserWithRoles; password: string }
  | { kind: "grant"; user: UserWithRoles; roleCode: string; justification: string }
  | { kind: "revoke"; user: UserWithRoles; userRoleId: string; justification: string };

// Gestion des comptes et de leurs habilitations (spéc. fonctionnelle §2, Ch. 2
// §2.4) : création, suspension/réactivation, suppression, réinitialisation du
// mot de passe, attribution/retrait de rôle (justifiés et tracés à l'audit).
export function UsersRolesPage({ canAdminister }: UsersRolesPageProps) {
  const [users, setUsers] = useState<UserWithRoles[]>([]);
  const [roles, setRoles] = useState<RoleSummary[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [modal, setModal] = useState<UModal | null>(null);

  const refresh = async () => {
    const [userList, roleList] = await Promise.all([listUsersWithRoles(), listRoles()]);
    setUsers(userList);
    setRoles(roleList);
  };

  useEffect(() => {
    refresh().catch((e) => setError(e instanceof Error ? e.message : "Échec du chargement."));
  }, []);

  function fail(err: unknown, fallback: string) {
    setError(err instanceof Error ? err.message : fallback);
  }

  async function submitToggleStatus() {
    if (modal?.kind !== "toggle-status") return;
    const suspend = modal.user.status === "active";
    setError(null); setMessage(null);
    try {
      await updateUser(modal.user.id, { status: suspend ? "suspended" : "active" });
      setMessage(suspend ? `Compte ${modal.user.username} suspendu.` : `Compte ${modal.user.username} réactivé.`);
      setModal(null);
      await refresh();
    } catch (err) { fail(err, "Échec du changement de statut."); }
  }

  async function submitImpersonate() {
    if (modal?.kind !== "impersonate") return;
    try {
      await impersonateUser(modal.user.id);
      window.location.reload();
    } catch (err) { fail(err, "Échec de la connexion en tant que cet utilisateur."); }
  }

  async function submitDelete() {
    if (modal?.kind !== "delete") return;
    setError(null); setMessage(null);
    try {
      await deleteUser(modal.user.id);
      setMessage(`Compte ${modal.user.username} supprimé.`);
      setModal(null);
      await refresh();
    } catch (err) { fail(err, "Échec de la suppression."); }
  }

  async function submitReset() {
    if (modal?.kind !== "reset-password" || !modal.password) return;
    setError(null); setMessage(null);
    try {
      await resetUserPassword(modal.user.id, modal.password);
      setMessage(`Mot de passe réinitialisé pour ${modal.user.username}.`);
      setModal(null);
    } catch (err) { fail(err, "Échec de la réinitialisation."); }
  }

  async function submitGrant() {
    if (modal?.kind !== "grant" || !modal.roleCode || !modal.justification.trim()) return;
    setError(null);
    try {
      await grantRole(modal.user.id, modal.roleCode, modal.justification.trim());
      setMessage(`Rôle attribué à ${modal.user.username}.`);
      setModal(null);
      await refresh();
    } catch (err) { fail(err, "Échec de l'attribution."); }
  }

  async function submitRevoke() {
    if (modal?.kind !== "revoke" || !modal.justification.trim()) return;
    setError(null);
    try {
      await revokeRole(modal.userRoleId, modal.justification.trim());
      setMessage(`Rôle retiré à ${modal.user.username}.`);
      setModal(null);
      await refresh();
    } catch (err) { fail(err, "Échec du retrait."); }
  }

  return (
    <div className="ecl-page">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
        <h1 className="ecl-page__title" style={{ margin: 0 }}>Utilisateurs & rôles</h1>
        {canAdminister && (
          <Button variant={showCreate ? "view" : "add"} onClick={() => setShowCreate((v) => !v)}>
            {showCreate ? "Annuler" : "+ Nouveau compte"}
          </Button>
        )}
      </div>
      <p className="ecl-page__lead">Comptes et habilitations. Chaque changement est justifié et journalisé.</p>

      {showCreate && canAdminister && (
        <CreateAccountForm
          roles={roles}
          onCreated={(name) => { setShowCreate(false); setMessage(`Compte ${name} créé.`); refresh().catch(() => {}); }}
          onError={setError}
        />
      )}

      {error && <div style={bannerStyle("var(--alert-soft)", "var(--alert)")}>{error}</div>}
      {message && <div style={bannerStyle("var(--eclosion-soft)", "var(--eclosion)")}>{message}</div>}

      {users.map((user) => (
        <section key={user.id} className="ecl-card">
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", flexWrap: "wrap", gap: 8 }}>
            <div>
              <span style={{ fontSize: 14.5, fontWeight: 700, color: "var(--ink)" }}>{user.username}</span>
              <span style={{ fontSize: 12, color: "var(--muted)", marginLeft: 8 }}>{user.email}</span>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
              {canAdminister && (
                <>
                  <Button variant="view" size="sm" onClick={() => setModal({ kind: "reset-password", user, password: "" })}>Réinitialiser le mot de passe</Button>
                  <Button variant="edit" size="sm" onClick={() => setModal({ kind: "toggle-status", user })}>{user.status === "active" ? "Suspendre" : "Réactiver"}</Button>
                  {user.status === "active" && (
                    <Button variant="view" size="sm" onClick={() => setModal({ kind: "impersonate", user })}>Se connecter en tant que</Button>
                  )}
                  <Button variant="danger" size="sm" onClick={() => setModal({ kind: "delete", user })}>Supprimer</Button>
                </>
              )}
              <StatusChip status={user.status} />
            </div>
          </div>

          <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 12 }}>
            {user.roles.length === 0 && <span style={{ fontSize: 12, color: "var(--muted)" }}>Aucun rôle attribué.</span>}
            {user.roles.map((role) => (
              <span key={role.userRoleId} style={{ display: "inline-flex", alignItems: "center", gap: 6, background: "var(--eclosion-soft)", color: "var(--eclosion-dark)", borderRadius: 999, padding: "3px 8px 3px 11px", fontSize: 12, fontWeight: 600 }}>
                {role.label}
                {canAdminister && (
                  <button onClick={() => setModal({ kind: "revoke", user, userRoleId: role.userRoleId, justification: "" })} title="Retirer ce rôle" style={{ border: "none", background: "transparent", color: "var(--alert)", cursor: "pointer", fontSize: 15, lineHeight: 1, padding: 0 }}>×</button>
                )}
              </span>
            ))}
          </div>

          {canAdminister && (
            <div style={{ marginTop: 12 }}>
              <select
                defaultValue=""
                onChange={(e) => { if (e.target.value) { setModal({ kind: "grant", user, roleCode: e.target.value, justification: "" }); e.target.value = ""; } }}
                style={{ padding: "8px 10px", fontSize: 12.5, border: "1px solid var(--line)", borderRadius: 8, background: "var(--card)" }}
              >
                <option value="">+ Attribuer un rôle…</option>
                {roles.filter((r) => !user.roles.some((ur) => ur.code === r.code)).map((r) => (
                  <option key={r.id} value={r.code}>{r.label}{r.department ? ` — ${r.department}` : ""}</option>
                ))}
              </select>
            </div>
          )}
        </section>
      ))}

      {users.length === 0 && <p style={{ color: "var(--muted)", fontSize: 13, marginTop: 16 }}>Aucun utilisateur.</p>}

      {/* ── Fenêtres intégrées ─────────────────────────────────────────────── */}
      {modal?.kind === "toggle-status" && (
        <ConfirmModal
          title={modal.user.status === "active" ? "Suspendre le compte" : "Réactiver le compte"}
          onClose={() => setModal(null)}
          onConfirm={submitToggleStatus}
          confirmLabel={modal.user.status === "active" ? "Suspendre" : "Réactiver"}
          confirmVariant={modal.user.status === "active" ? "edit" : "add"}
        >
          {modal.user.status === "active" ? `Suspendre le compte ${modal.user.username} ? L'utilisateur ne pourra plus se connecter.` : `Réactiver le compte ${modal.user.username} ?`}
        </ConfirmModal>
      )}

      {modal?.kind === "impersonate" && (
        <ConfirmModal title="Se connecter en tant que" onClose={() => setModal(null)} onConfirm={submitImpersonate} confirmLabel="Continuer" confirmVariant="add">
          Se connecter en tant que <strong>{modal.user.username}</strong> ? Vous verrez l'application comme cet utilisateur ; un bandeau permettra de revenir à votre compte. L'opération est journalisée.
        </ConfirmModal>
      )}

      {modal?.kind === "delete" && (
        <ConfirmModal title="Supprimer le compte" onClose={() => setModal(null)} onConfirm={submitDelete} confirmLabel="Supprimer" confirmVariant="danger">
          Supprimer définitivement le compte <strong>{modal.user.username}</strong> ? Cette action est tracée et irréversible.
        </ConfirmModal>
      )}

      {modal?.kind === "reset-password" && (
        <Modal
          title="Réinitialiser le mot de passe"
          onClose={() => setModal(null)}
          footer={<><Button variant="view" size="sm" onClick={() => setModal(null)}>Annuler</Button><Button variant="add" size="sm" onClick={submitReset} disabled={!modal.password}>Réinitialiser</Button></>}
        >
          <p style={{ margin: 0, fontSize: 13, color: "var(--muted)" }}>Compte : <strong style={{ color: "var(--ink)" }}>{modal.user.username}</strong></p>
          <Field label="Nouveau mot de passe (min. 8 car., une majuscule, un chiffre)">
            <input type="text" value={modal.password} onChange={(e) => setModal({ ...modal, password: e.target.value })} autoFocus />
          </Field>
          <p style={{ margin: 0, fontSize: 12, color: "var(--muted)" }}>Communiquez-le à l'utilisateur, qui pourra le changer ensuite.</p>
        </Modal>
      )}

      {modal?.kind === "grant" && (
        <Modal
          title="Attribuer un rôle"
          onClose={() => setModal(null)}
          footer={<><Button variant="view" size="sm" onClick={() => setModal(null)}>Annuler</Button><Button variant="add" size="sm" onClick={submitGrant} disabled={!modal.justification.trim()}>Attribuer</Button></>}
        >
          <p style={{ margin: 0, fontSize: 13, color: "var(--muted)" }}>
            Rôle <strong style={{ color: "var(--ink)" }}>{roles.find((r) => r.code === modal.roleCode)?.label ?? modal.roleCode}</strong> à <strong style={{ color: "var(--ink)" }}>{modal.user.username}</strong>
          </p>
          <Field label="Justification"><input value={modal.justification} onChange={(e) => setModal({ ...modal, justification: e.target.value })} autoFocus /></Field>
        </Modal>
      )}

      {modal?.kind === "revoke" && (
        <Modal
          title="Retirer un rôle"
          onClose={() => setModal(null)}
          footer={<><Button variant="view" size="sm" onClick={() => setModal(null)}>Annuler</Button><Button variant="danger" size="sm" onClick={submitRevoke} disabled={!modal.justification.trim()}>Retirer</Button></>}
        >
          <p style={{ margin: 0, fontSize: 13, color: "var(--muted)" }}>Retrait d'un rôle à <strong style={{ color: "var(--ink)" }}>{modal.user.username}</strong></p>
          <Field label="Justification"><input value={modal.justification} onChange={(e) => setModal({ ...modal, justification: e.target.value })} autoFocus /></Field>
        </Modal>
      )}
    </div>
  );
}

function ConfirmModal({ title, children, onClose, onConfirm, confirmLabel, confirmVariant }: { title: string; children: React.ReactNode; onClose: () => void; onConfirm: () => void; confirmLabel: string; confirmVariant: "add" | "edit" | "danger" }) {
  return (
    <Modal title={title} onClose={onClose} footer={<><Button variant="view" size="sm" onClick={onClose}>Annuler</Button><Button variant={confirmVariant} size="sm" onClick={onConfirm}>{confirmLabel}</Button></>}>
      <p style={{ margin: 0, fontSize: 13, lineHeight: 1.5 }}>{children}</p>
    </Modal>
  );
}

function StatusChip({ status }: { status: string }) {
  const map: Record<string, { label: string; color: string }> = {
    active: { label: "Actif", color: "var(--success)" },
    suspended: { label: "Suspendu", color: "var(--amber)" },
  };
  const s = map[status] ?? { label: status, color: "var(--muted)" };
  return <span style={{ fontSize: 11, fontWeight: 700, color: s.color, border: `1px solid ${s.color}`, borderRadius: 999, padding: "1px 9px" }}>{s.label}</span>;
}

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

  return (
    <section className="ecl-card">
      <div className="ecl-card__title" style={{ marginBottom: 14 }}>Nouveau compte</div>
      <form onSubmit={handleSubmit}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 12 }}>
          <Field label="Identifiant"><input value={username} onChange={(e) => setUsername(e.target.value)} required minLength={3} /></Field>
          <Field label="E-mail"><EmailInput value={email} onChange={(e) => setEmail(e.target.value)} required /></Field>
          <Field label="Mot de passe (min. 8 car., une majuscule, un chiffre)"><input type="text" value={password} onChange={(e) => setPassword(e.target.value)} required /></Field>
          <Field label="Rôle initial (facultatif)">
            <select value={roleCode} onChange={(e) => setRoleCode(e.target.value)}>
              <option value="">Aucun rôle</option>
              {roles.map((r) => <option key={r.id} value={r.code}>{r.label}{r.department ? ` — ${r.department}` : ""}</option>)}
            </select>
          </Field>
        </div>
        <div style={{ marginTop: 14 }}>
          <Button variant="add" type="submit" disabled={submitting}>Créer le compte</Button>
        </div>
      </form>
    </section>
  );
}

function bannerStyle(bg: string, color: string): React.CSSProperties {
  return { background: bg, color, borderRadius: 8, padding: "9px 13px", fontSize: 13, marginTop: 12 };
}
