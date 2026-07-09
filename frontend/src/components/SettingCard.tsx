// Carte de réglage (page Paramètres) harmonisée au design system : coins
// arrondis, ombre légère, clé technique reléguée en badge discret, valeur
// numérique formatée avec séparateur de milliers (format FR). Purement visuel :
// la logique de saisie et de sauvegarde reste dans la page Paramètres.

interface SettingCardProps {
  label: string;
  description: string;
  techKey: string;
  version: number;
  isNumber: boolean;
  // Valeur courante (enregistrée) — sert à l'affichage formaté.
  currentValue: unknown;
  draft: string;
  onDraftChange: (value: string) => void;
  canAdminister: boolean;
  dirty: boolean;
  onSave: () => void;
}

function formatNumber(value: number): string {
  // Séparateur de milliers façon FR (« 5 000 000 »). La valeur brute reste
  // celle éditée/enregistrée ; on ne formate qu'à l'affichage.
  return value.toLocaleString("fr-FR");
}

export function SettingCard({
  label,
  description,
  techKey,
  version,
  isNumber,
  currentValue,
  draft,
  onDraftChange,
  canAdminister,
  dirty,
  onSave,
}: SettingCardProps) {
  return (
    <div
      style={{
        background: "var(--card)",
        border: "1px solid var(--line)",
        borderRadius: 10,
        boxShadow: "0 1px 2px rgba(30, 36, 48, 0.05)",
        padding: "14px 16px",
        marginTop: 12,
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 10, flexWrap: "wrap" }}>
        <div style={{ minWidth: 0, flex: "1 1 240px" }}>
          <div style={{ fontSize: 14, fontWeight: 600, color: "var(--ink)" }}>{label}</div>
          <div style={{ fontSize: 12.5, color: "var(--muted)", marginTop: 3, lineHeight: 1.5 }}>{description}</div>
        </div>
        <span
          title="Identifiant technique du paramètre"
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: 10.5,
            color: "var(--muted)",
            background: "var(--paper)",
            border: "1px solid var(--line)",
            borderRadius: 999,
            padding: "2px 8px",
            maxWidth: "100%",
            wordBreak: "break-all",
            lineHeight: 1.5,
          }}
        >
          {techKey} · v{version}
        </span>
      </div>

      {isNumber ? (
        <div style={{ marginTop: 12 }}>
          <div style={{ fontFamily: "var(--font-mono)", fontSize: 20, fontWeight: 600, color: "var(--ink)", letterSpacing: 0.2 }}>
            {typeof currentValue === "number" ? formatNumber(currentValue) : String(currentValue)}
          </div>
          {canAdminister && (
            <div style={{ marginTop: 8, display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
              <input
                type="number"
                value={draft}
                onChange={(e) => onDraftChange(e.target.value)}
                aria-label={`Nouvelle valeur — ${label}`}
                style={{
                  padding: "7px 10px",
                  fontSize: 14,
                  fontFamily: "var(--font-mono)",
                  width: 160,
                  maxWidth: "100%",
                  border: "1px solid var(--line)",
                  borderRadius: 8,
                }}
              />
              {dirty && (
                <button onClick={onSave} style={saveButtonStyle}>
                  Enregistrer
                </button>
              )}
            </div>
          )}
        </div>
      ) : (
        <div style={{ marginTop: 10 }}>
          <textarea
            value={draft}
            onChange={(e) => onDraftChange(e.target.value)}
            disabled={!canAdminister}
            rows={4}
            aria-label={`Valeur (JSON) — ${label}`}
            style={{
              padding: 10,
              fontSize: 12,
              fontFamily: "var(--font-mono)",
              width: "100%",
              border: "1px solid var(--line)",
              borderRadius: 8,
              lineHeight: 1.5,
              resize: "vertical",
            }}
          />
          {canAdminister && dirty && (
            <div style={{ marginTop: 8 }}>
              <button onClick={onSave} style={saveButtonStyle}>
                Enregistrer
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

const saveButtonStyle: React.CSSProperties = {
  background: "var(--eclosion)",
  color: "#fff",
  border: "none",
  borderRadius: 8,
  padding: "7px 16px",
  fontSize: 13,
  fontWeight: 600,
  cursor: "pointer",
};
