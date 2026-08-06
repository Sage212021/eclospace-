import type { Employee } from "../api/client";

// Organigramme (refonte RH — Étape 3). Reconstruit la hiérarchie à partir du
// lien manager ↔ subordonnés déjà présent sur chaque fiche employé — arbre
// indenté, léger et responsive, sans dépendance.
export function OrgChart({ employees }: { employees: Employee[] }) {
  const active = employees.filter((e) => !e.departureDate);
  const childrenOf = new Map<string, Employee[]>();
  for (const e of active) {
    const key = e.manager?.id ?? "__root__";
    (childrenOf.get(key) ?? childrenOf.set(key, []).get(key)!).push(e);
  }
  const sortByName = (a: Employee, b: Employee) => `${a.lastName}`.localeCompare(`${b.lastName}`);
  // Racines : sans manager, OU dont le manager est parti/inconnu (rattachées en haut).
  const managedIds = new Set(active.filter((e) => e.manager && active.some((m) => m.id === e.manager!.id)).map((e) => e.id));
  const roots = active.filter((e) => !managedIds.has(e.id)).sort(sortByName);

  if (active.length === 0) return <p style={{ color: "var(--muted)", fontSize: 14, margin: 0 }}>Aucun collaborateur actif.</p>;

  return <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>{roots.map((r) => <Node key={r.id} emp={r} childrenOf={childrenOf} sort={sortByName} depth={0} />)}</ul>;
}

function Node({ emp, childrenOf, sort, depth }: { emp: Employee; childrenOf: Map<string, Employee[]>; sort: (a: Employee, b: Employee) => number; depth: number }) {
  const kids = (childrenOf.get(emp.id) ?? []).filter((k) => k.id !== emp.id).sort(sort);
  return (
    <li style={{ margin: 0, padding: 0 }}>
      <div
        style={{
          display: "flex",
          alignItems: "baseline",
          gap: 8,
          flexWrap: "wrap",
          padding: "7px 10px",
          margin: "4px 0",
          marginLeft: depth * 22,
          background: depth === 0 ? "var(--eclosion-soft)" : "var(--card, #fff)",
          border: "1px solid var(--line)",
          borderLeft: `3px solid ${depth === 0 ? "var(--eclosion)" : "var(--line-strong, #CED4E0)"}`,
          borderRadius: 8,
        }}
      >
        <span style={{ fontWeight: 600, fontSize: 13.5 }}>{emp.firstName} {emp.lastName}</span>
        {emp.position && <span style={{ fontSize: 12.5, color: "var(--muted)" }}>· {emp.position}</span>}
        {emp.department?.name && <span style={{ fontSize: 11.5, color: "var(--muted)" }}>· {emp.department.name}</span>}
        {kids.length > 0 && <span style={{ marginLeft: "auto", fontSize: 11, color: "var(--muted)" }}>{kids.length} {kids.length > 1 ? "subordonnés" : "subordonné"}</span>}
      </div>
      {kids.length > 0 && <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>{kids.map((k) => <Node key={k.id} emp={k} childrenOf={childrenOf} sort={sort} depth={depth + 1} />)}</ul>}
    </li>
  );
}
