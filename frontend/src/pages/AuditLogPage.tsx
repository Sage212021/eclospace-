import { useEffect, useState } from "react";
import { listAuditLog, type AuditEntry } from "../api/client";

// Libellés lisibles des actions journalisées (enum AuditAction côté back).
const ACTION_LABELS: Record<string, string> = {
  create: "Création",
  update: "Modification",
  status_change: "Changement de statut",
  validate: "Validation",
  login: "Connexion",
  view_sensitive: "Consultation sensible",
  export: "Export",
};

const PAGE_SIZE = 50;

export function AuditLogPage() {
  const [entries, setEntries] = useState<AuditEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [actionFilter, setActionFilter] = useState("");
  const [entityFilter, setEntityFilter] = useState("");
  const [error, setError] = useState<string | null>(null);

  const refresh = async (nextOffset = offset) => {
    try {
      const result = await listAuditLog({
        limit: PAGE_SIZE,
        offset: nextOffset,
        action: actionFilter || undefined,
        entity_type: entityFilter || undefined,
      });
      setEntries(result.entries);
      setTotal(result.total);
      setOffset(result.offset);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Échec du chargement du journal.");
    }
  };

  useEffect(() => {
    refresh(0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [actionFilter, entityFilter]);

  const from = total === 0 ? 0 : offset + 1;
  const to = Math.min(offset + PAGE_SIZE, total);

  return (
    <div style={{ padding: 32, maxWidth: 1040 }}>
      <h1 style={{ fontFamily: "var(--font-title)", fontSize: 20, margin: 0 }}>Journal d'activité</h1>
      <p style={{ color: "var(--muted)", fontSize: 13, marginTop: 6 }}>
        Registre inviolable de toutes les opérations (append-only) : qui a fait quoi, quand.
      </p>

      {error && (
        <div style={{ background: "var(--alert-soft)", color: "var(--alert)", borderRadius: 6, padding: "8px 12px", fontSize: 13, marginTop: 12 }}>
          {error}
        </div>
      )}

      <div style={{ display: "flex", gap: 10, marginTop: 16, flexWrap: "wrap", alignItems: "center" }}>
        <select value={actionFilter} onChange={(e) => setActionFilter(e.target.value)} style={selectStyle}>
          <option value="">Toutes les actions</option>
          {Object.entries(ACTION_LABELS).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
        <input
          type="text"
          value={entityFilter}
          onChange={(e) => setEntityFilter(e.target.value)}
          placeholder="Type d'entité (ex. setting, contract…)"
          style={{ ...selectStyle, width: 260 }}
        />
      </div>

      <div style={{ background: "var(--card)", border: "1px solid var(--line)", borderRadius: 10, padding: 18, marginTop: 16 }}>
        <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 8 }}>
          {total === 0 ? "Aucune entrée." : `${from}–${to} sur ${total.toLocaleString("fr-FR")} entrées`}
        </div>

        {entries.length > 0 && (
          <div style={{ overflowX: "auto", borderRadius: 10, border: "1px solid var(--line)" }}>
            <table className="ecl-table">
              <thead>
                <tr>
                  {["Date et heure", "Utilisateur", "Action", "Type", "Référence"].map((h) => (
                    <th key={h}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {entries.map((entry) => (
                  <tr key={entry.id}>
                    <td className="mono" style={{ whiteSpace: "nowrap" }}>
                      {new Date(entry.occurredAt).toLocaleString("fr-FR")}
                    </td>
                    <td>{entry.username ?? "—"}</td>
                    <td>{ACTION_LABELS[entry.action] ?? entry.action}</td>
                    <td>{entry.entityType}</td>
                    <td className="mono" style={{ fontSize: 11, color: "var(--muted)" }}>{entry.entityId}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {total > PAGE_SIZE && (
          <div style={{ display: "flex", gap: 8, marginTop: 12, justifyContent: "flex-end" }}>
            <button onClick={() => refresh(Math.max(0, offset - PAGE_SIZE))} disabled={offset === 0} style={pagerStyle(offset === 0)}>
              Précédent
            </button>
            <button onClick={() => refresh(offset + PAGE_SIZE)} disabled={to >= total} style={pagerStyle(to >= total)}>
              Suivant
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

const selectStyle: React.CSSProperties = {
  padding: 8,
  fontSize: 13,
  border: "1px solid var(--line)",
  borderRadius: 6,
  background: "#fff",
};

function pagerStyle(disabled: boolean): React.CSSProperties {
  return {
    background: "#fff",
    border: "1px solid var(--line)",
    borderRadius: 6,
    padding: "6px 12px",
    fontSize: 12,
    cursor: disabled ? "default" : "pointer",
    opacity: disabled ? 0.5 : 1,
  };
}
