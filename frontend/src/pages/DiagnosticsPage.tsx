import type { EffectiveUser } from "../api/client";

interface DiagnosticsPageProps {
  user: EffectiveUser;
}

// Diagnostics système (Administration) — audit RBAC brut : rôles et permissions
// effectives de la session. Réservé à l'administrateur général (filtrage du
// menu et garde ci-dessous). Anciennement affiché en page d'accueil.
export function DiagnosticsPage({ user }: DiagnosticsPageProps) {
  const isAdmin = user.roles.includes("ADMIN_GENERAL");

  if (!isAdmin) {
    return (
      <div style={{ padding: 32, maxWidth: 640 }}>
        <h1 style={{ fontFamily: "var(--font-title)", fontSize: 20 }}>Diagnostics système</h1>
        <div style={{ background: "var(--alert-soft)", color: "var(--alert)", borderRadius: 6, padding: "8px 12px", fontSize: 13 }}>
          Réservé à l'administrateur général.
        </div>
      </div>
    );
  }

  return (
    <div style={{ padding: 32, maxWidth: 760 }}>
      <h1 style={{ fontFamily: "var(--font-title)", fontSize: 20, margin: 0 }}>Diagnostics système</h1>
      <p style={{ color: "var(--muted)", fontSize: 13, marginTop: 6 }}>
        Audit des droits d'accès (RBAC) de la session courante : rôles et permissions effectives résolues côté serveur.
      </p>

      <div style={{ background: "var(--card)", border: "1px solid var(--line)", borderRadius: 10, padding: 18, marginTop: 16 }}>
        <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 10 }}>Rôles</div>
        {user.roles.length === 0 ? (
          <p style={{ color: "var(--muted)", fontSize: 13, margin: 0 }}>Aucun rôle attribué.</p>
        ) : (
          <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13, fontFamily: "var(--font-mono)" }}>
            {user.roles.map((role) => (
              <li key={role}>{role}</li>
            ))}
          </ul>
        )}
      </div>

      <div style={{ background: "var(--card)", border: "1px solid var(--line)", borderRadius: 10, padding: 18, marginTop: 16 }}>
        <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 10 }}>
          Permissions effectives ({user.permissions.length})
        </div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
          {user.permissions.map((permission) => (
            <span
              key={permission}
              style={{
                background: "var(--eclosion-soft)",
                color: "var(--eclosion)",
                borderRadius: 999,
                padding: "2px 10px",
                fontSize: 11,
                fontFamily: "var(--font-mono)",
              }}
            >
              {permission}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}
