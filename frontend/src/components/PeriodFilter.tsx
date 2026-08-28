import { useMemo } from "react";

// Filtre « par période » réutilisable (Année + Mois), pour classer/consulter les
// traitements d'un registre par mois et année (demande opérateur 28/08/2026).
// Filtrage côté écran, instantané. À poser au-dessus de n'importe quelle liste
// qui porte une date. Par défaut, on ouvre sur le MOIS EN COURS.

export type Period = { year: number | "all"; month: number | "all" }; // month : 0–11

const MONTHS = ["Janvier", "Février", "Mars", "Avril", "Mai", "Juin", "Juillet", "Août", "Septembre", "Octobre", "Novembre", "Décembre"];

export function currentPeriod(): Period {
  const d = new Date();
  return { year: d.getFullYear(), month: d.getMonth() };
}

// Un enregistrement appartient-il à la période choisie ? (sur sa date locale)
export function inPeriod(dateStr: string | Date | null | undefined, p: Period): boolean {
  if (p.year === "all" && p.month === "all") return true;
  if (!dateStr) return false;
  const d = new Date(dateStr);
  if (Number.isNaN(d.getTime())) return true;
  if (p.year !== "all" && d.getFullYear() !== p.year) return false;
  if (p.month !== "all" && d.getMonth() !== p.month) return false;
  return true;
}

const selectStyle: React.CSSProperties = { padding: "6px 9px", fontSize: 13, border: "1px solid var(--line)", borderRadius: 8, background: "var(--card)", color: "var(--ink)" };

export function PeriodFilter({ dates, value, onChange, resultCount, label }: {
  dates: (string | Date | null | undefined)[];
  value: Period;
  onChange: (p: Period) => void;
  resultCount?: number;
  label?: string;
}) {
  // Années réellement présentes dans les données (+ l'année en cours), décroissant.
  const years = useMemo(() => {
    const set = new Set<number>();
    for (const d of dates) {
      if (!d) continue;
      const y = new Date(d).getFullYear();
      if (!Number.isNaN(y)) set.add(y);
    }
    set.add(new Date().getFullYear());
    return [...set].sort((a, b) => b - a);
  }, [dates]);

  const filtered = value.month !== "all" || value.year !== "all";

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", margin: "0 0 12px" }}>
      <span style={{ fontSize: 12.5, color: "var(--muted)", fontWeight: 600 }}>{label ?? "Période"} :</span>
      <select
        value={String(value.month)}
        onChange={(e) => onChange({ ...value, month: e.target.value === "all" ? "all" : Number(e.target.value) })}
        style={selectStyle}
        aria-label="Mois"
      >
        <option value="all">Tous les mois</option>
        {MONTHS.map((m, i) => <option key={i} value={i}>{m}</option>)}
      </select>
      <select
        value={String(value.year)}
        onChange={(e) => onChange({ ...value, year: e.target.value === "all" ? "all" : Number(e.target.value) })}
        style={selectStyle}
        aria-label="Année"
      >
        <option value="all">Toutes les années</option>
        {years.map((y) => <option key={y} value={y}>{y}</option>)}
      </select>
      {filtered && (
        <button type="button" onClick={() => onChange({ year: "all", month: "all" })} style={{ padding: "5px 10px", fontSize: 12, border: "1px solid var(--line)", borderRadius: 8, background: "transparent", color: "var(--eclosion-dark)", cursor: "pointer", fontWeight: 600 }}>
          Tout afficher
        </button>
      )}
      {resultCount != null && (
        <span style={{ fontSize: 12, color: "var(--muted)", marginLeft: "auto" }}>{resultCount} résultat{resultCount > 1 ? "s" : ""}</span>
      )}
    </div>
  );
}
