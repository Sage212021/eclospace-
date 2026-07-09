// Tableau générique réutilisable : rend un tableau d'objets plats
// (une ligne = un objet) sous forme de vraie table lisible, avec en-têtes
// traduits et chiffres alignés en police à chasse fixe (guide de style §3 :
// « Chiffres en police à chasse fixe »). Utilisé par les rapports standards,
// les résultats d'analyse et les sous-tableaux du tableau de bord Direction.

// Libellés lisibles pour les colonnes rencontrées dans les rapports et
// indicateurs. Toute clé absente est mise en forme automatiquement
// (souligné → espace, première lettre en majuscule).
const COLUMN_LABELS: Record<string, string> = {
  // Répartition par statut / éditorial
  code: "Code",
  label: "Libellé",
  step_order: "Étape",
  count: "Nombre",
  genre: "Genre",
  accept: "Accepté",
  accept_minor: "Accepté (rés. mineures)",
  accept_major: "Accepté (rés. majeures)",
  rewrite: "Réécriture",
  new_expertise: "Nouvelle expertise",
  reject: "Refusé",
  // Production / délais
  status: "Statut",
  avg_duration_days: "Durée moyenne (j)",
  sample_size: "Échantillon",
  // Commercial
  channel: "Canal",
  units: "Unités",
  revenue: "Chiffre d'affaires",
  title: "Titre",
  // Marges
  total_cost: "Coût total",
  net_sales: "Ventes nettes",
  margin: "Marge",
  under_break_even: "Sous le seuil",
  // Charge RH
  department: "Département",
  employee_count: "Effectif",
  open_tasks: "Tâches ouvertes",
  late_tasks: "Tâches en retard",
};

function humanize(key: string): string {
  if (COLUMN_LABELS[key]) return COLUMN_LABELS[key];
  const spaced = key.replace(/_/g, " ");
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

function isNumeric(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function formatCell(value: unknown): { text: string; numeric: boolean } {
  if (value === null || value === undefined) return { text: "—", numeric: false };
  if (typeof value === "boolean") return { text: value ? "Oui" : "Non", numeric: false };
  if (isNumeric(value)) return { text: value.toLocaleString("fr-FR"), numeric: true };
  return { text: String(value), numeric: false };
}

interface DataTableProps {
  rows: Record<string, unknown>[];
  emptyLabel?: string;
}

export function DataTable({ rows, emptyLabel = "Aucune donnée." }: DataTableProps) {
  if (rows.length === 0) {
    return <p style={{ color: "var(--muted)", fontSize: 13, margin: "6px 0 0" }}>{emptyLabel}</p>;
  }

  // Colonnes = union ordonnée des clés rencontrées (première apparition).
  const columns: string[] = [];
  for (const row of rows) {
    for (const key of Object.keys(row)) {
      if (!columns.includes(key)) columns.push(key);
    }
  }

  return (
    <div style={{ overflowX: "auto", marginTop: 8, borderRadius: 10, border: "1px solid var(--line)" }}>
      <table className="ecl-table">
        <thead>
          <tr>
            {columns.map((col) => (
              <th key={col}>{humanize(col)}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={i}>
              {columns.map((col) => {
                const { text, numeric } = formatCell(row[col]);
                return (
                  <td key={col} className={numeric ? "num" : undefined} style={{ whiteSpace: "nowrap" }}>
                    {text}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
