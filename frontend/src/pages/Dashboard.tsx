import type { EffectiveUser } from "../api/client";

interface DashboardProps {
  user: EffectiveUser;
}

// Page d'accueil : vue synthétique de la session (utilisateur, rôle, statut).
// L'audit RBAC détaillé (badges de permissions) a été déplacé dans l'écran
// « Diagnostics système » (Administration), réservé à l'administrateur général.
export function Dashboard({ user }: DashboardProps) {
  return (
    <div style={{ padding: 32, maxWidth: 640 }}>
      <h1 style={{ fontFamily: "var(--font-title)", fontSize: 22, marginBottom: 4 }}>Bienvenue, {user.username}</h1>
      <p style={{ color: "var(--muted)", marginTop: 0 }}>
        Sélectionnez un pôle dans le menu de gauche pour accéder à vos modules.
      </p>

      <div style={{ background: "var(--card)", border: "1px solid var(--line)", borderRadius: 10, padding: 20, marginTop: 16 }}>
        <Row label="Identifiant" value={user.username} mono />
        <Row label="Rôle" value={user.roles.length > 0 ? user.roles.map(roleLabel).join(", ") : "Aucun rôle attribué"} />
        <Row
          label="Statut"
          value={
            <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
              <span style={{ width: 9, height: 9, borderRadius: 999, background: "var(--eclosion)", display: "inline-block" }} />
              Connecté
            </span>
          }
        />
      </div>
    </div>
  );
}

// Libellés lisibles des rôles techniques les plus courants (l'écran
// Diagnostics affiche, lui, les codes exacts). Repli sur le code si inconnu.
const ROLE_LABELS: Record<string, string> = {
  ADMIN_GENERAL: "Administrateur général",
  DIR_GENERAL: "Directeur général",
  DIR_EDITORIALE: "Direction éditoriale",
  RESP_FINANCE: "Responsable administratif et financier",
  RESP_RH: "Responsable RH",
  RESP_COMMERCIAL: "Responsable commercial",
  RESP_IMPRESSION: "Responsable production/impression",
  RESP_INFOGRAPHIE: "Responsable infographie",
  MAGASINIER: "Magasinier",
  CORRECTEUR: "Correcteur",
  MEMBRE_COMITE_LECTURE: "Membre du comité de lecture",
  ASSISTANT_EDITORIAL: "Assistant éditorial",
};

function roleLabel(code: string): string {
  return ROLE_LABELS[code] ?? code;
}

function Row({ label, value, mono }: { label: string; value: React.ReactNode; mono?: boolean }) {
  return (
    <div style={{ display: "flex", padding: "8px 0", borderBottom: "1px solid var(--line)", fontSize: 14 }}>
      <div style={{ width: 140, color: "var(--muted)", fontSize: 13 }}>{label}</div>
      <div style={{ fontFamily: mono ? "var(--font-mono)" : undefined }}>{value}</div>
    </div>
  );
}
