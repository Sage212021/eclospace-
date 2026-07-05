import type { EffectiveUser } from "../api/client";

interface DashboardProps {
  user: EffectiveUser;
}

// Lot 0 : pas encore de KPI métier (ceux-ci arrivent module par module,
// Ch. 5 §5.3). Cet écran confirme que la fondation (auth, rôles, permissions)
// fonctionne, en clair pour l'opérateur.
export function Dashboard({ user }: DashboardProps) {
  return (
    <div style={{ padding: 32, maxWidth: 640 }}>
      <h1 style={{ fontFamily: "var(--font-title)", fontSize: 22, marginBottom: 4 }}>
        Bienvenue, {user.username}
      </h1>
      <p style={{ color: "var(--muted)", marginTop: 0 }}>
        Lot 0 — Fondations. Les modules métier (manuscrits, contrats, stock...) arrivent lot par lot.
      </p>

      <Card title="Vos rôles">
        {user.roles.length === 0 ? (
          <p style={{ color: "var(--muted)", fontSize: 13 }}>Aucun rôle attribué.</p>
        ) : (
          <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13 }}>
            {user.roles.map((role) => (
              <li key={role}>{role}</li>
            ))}
          </ul>
        )}
      </Card>

      <Card title="Vos permissions effectives">
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
      </Card>
    </div>
  );
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div
      style={{
        background: "var(--card)",
        border: "1px solid var(--line)",
        borderRadius: 10,
        padding: 18,
        marginTop: 16,
      }}
    >
      <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 10 }}>{title}</div>
      {children}
    </div>
  );
}
