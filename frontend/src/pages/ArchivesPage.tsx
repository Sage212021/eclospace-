import { useEffect, useMemo, useState } from "react";
import { listArchives, type ArchiveItem } from "../api/client";

// Archivage hiérarchique (spéc. fonctionnelle §7) : les ouvrages sont classés
// en arborescence selon des axes choisis (année/mois/jour, collection, domaine,
// auteur). L'ordre des axes est sélectionnable ; l'arbre est reconstruit côté
// client à partir de la projection renvoyée par /api/v1/archives.

type Dimension = "year" | "month" | "day" | "collection" | "genre" | "author";

const MONTHS = ["janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août", "septembre", "octobre", "novembre", "décembre"];

const HIERARCHIES: { key: string; label: string; dims: Dimension[] }[] = [
  { key: "year_month", label: "Année › Mois", dims: ["year", "month"] },
  { key: "year_month_day", label: "Année › Mois › Jour", dims: ["year", "month", "day"] },
  { key: "collection_year", label: "Collection › Année", dims: ["collection", "year"] },
  { key: "genre_year", label: "Domaine › Année", dims: ["genre", "year"] },
  { key: "author", label: "Auteur", dims: ["author"] },
];

function dimValue(item: ArchiveItem, dim: Dimension): string {
  const d = item.publicationDate ? new Date(item.publicationDate) : null;
  switch (dim) {
    case "year":
      return d ? String(d.getFullYear()) : "Date inconnue";
    case "month":
      return d ? `${String(d.getMonth() + 1).padStart(2, "0")} — ${MONTHS[d.getMonth()]}` : "Mois inconnu";
    case "day":
      return d ? String(d.getDate()).padStart(2, "0") : "Jour inconnu";
    case "collection":
      return item.collection ?? "Sans collection";
    case "genre":
      return item.genre ?? "Sans domaine";
    case "author":
      return item.author ?? "Auteur inconnu";
  }
}

interface TreeNode {
  label: string;
  count: number;
  children: Map<string, TreeNode>;
  items: ArchiveItem[];
}

function buildTree(items: ArchiveItem[], dims: Dimension[]): TreeNode {
  const root: TreeNode = { label: "", count: 0, children: new Map(), items: [] };
  for (const item of items) {
    let node = root;
    node.count++;
    for (const dim of dims) {
      const key = dimValue(item, dim);
      if (!node.children.has(key)) node.children.set(key, { label: key, count: 0, children: new Map(), items: [] });
      node = node.children.get(key)!;
      node.count++;
    }
    node.items.push(item);
  }
  return root;
}

export function ArchivesPage({ onOpenManuscript }: { onOpenManuscript: (id: string) => void }) {
  const [items, setItems] = useState<ArchiveItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [hierarchyKey, setHierarchyKey] = useState(HIERARCHIES[0].key);

  useEffect(() => {
    listArchives()
      .then(setItems)
      .catch((e) => setError(e instanceof Error ? e.message : "Échec du chargement des archives."));
  }, []);

  const dims = HIERARCHIES.find((h) => h.key === hierarchyKey)!.dims;
  const tree = useMemo(() => buildTree(items, dims), [items, dims]);

  return (
    <div style={{ padding: 32, maxWidth: 900 }}>
      <h1 style={{ fontFamily: "var(--font-title)", fontSize: 20, margin: 0 }}>Archives</h1>
      <p style={{ color: "var(--muted)", fontSize: 13, marginTop: 6 }}>
        Classement hiérarchique de tous les ouvrages ({items.length}). Dépliez les niveaux pour parcourir le fonds ; cliquez un
        ouvrage pour ouvrir sa fiche.
      </p>

      <div style={{ display: "flex", alignItems: "center", gap: 8, margin: "12px 0" }}>
        <span style={{ fontSize: 12, color: "var(--muted)" }}>Organiser par</span>
        <select
          value={hierarchyKey}
          onChange={(e) => setHierarchyKey(e.target.value)}
          style={{ padding: "6px 8px", fontSize: 13, border: "1px solid var(--line)", borderRadius: 6, background: "#fff" }}
        >
          {HIERARCHIES.map((h) => (
            <option key={h.key} value={h.key}>
              {h.label}
            </option>
          ))}
        </select>
      </div>

      {error && (
        <div style={{ background: "var(--alert-soft)", color: "var(--alert)", borderRadius: 6, padding: "8px 12px", fontSize: 13 }}>{error}</div>
      )}

      <div style={{ background: "var(--card)", border: "1px solid var(--line)", borderRadius: 10, padding: 12, marginTop: 8 }}>
        {items.length === 0 ? (
          <p style={{ fontSize: 13, color: "var(--muted)", margin: 8 }}>Aucun ouvrage à archiver pour le moment.</p>
        ) : (
          [...tree.children.entries()]
            .sort((a, b) => a[0].localeCompare(b[0], "fr", { numeric: true }))
            .reverse()
            .map(([key, node]) => <TreeBranch key={key} node={node} depth={0} onOpenManuscript={onOpenManuscript} />)
        )}
      </div>
    </div>
  );
}

function TreeBranch({ node, depth, onOpenManuscript }: { node: TreeNode; depth: number; onOpenManuscript: (id: string) => void }) {
  const [open, setOpen] = useState(depth === 0 ? false : true);
  const hasChildren = node.children.size > 0;
  const sortedChildren = [...node.children.entries()].sort((a, b) => a[0].localeCompare(b[0], "fr", { numeric: true })).reverse();

  return (
    <div style={{ marginLeft: depth === 0 ? 0 : 16 }}>
      <button
        onClick={() => setOpen((v) => !v)}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          width: "100%",
          textAlign: "left",
          background: "none",
          border: "none",
          cursor: "pointer",
          padding: "6px 4px",
          fontSize: 13,
          color: "var(--ink)",
        }}
      >
        <span style={{ width: 12, color: "var(--muted)", transform: open ? "rotate(90deg)" : "none", transition: "transform 120ms" }}>▶</span>
        <span style={{ fontWeight: 600 }}>{node.label}</span>
        <span
          style={{ marginLeft: 4, background: "var(--eclosion-soft)", color: "var(--eclosion)", borderRadius: 999, padding: "0 8px", fontSize: 11 }}
        >
          {node.count}
        </span>
      </button>

      {open && (
        <div style={{ borderLeft: "1px solid var(--line)", marginLeft: 6 }}>
          {hasChildren
            ? sortedChildren.map(([key, child]) => (
                <TreeBranch key={key} node={child} depth={depth + 1} onOpenManuscript={onOpenManuscript} />
              ))
            : node.items.map((item) => (
                <button
                  key={item.id}
                  onClick={() => onOpenManuscript(item.id)}
                  style={{
                    display: "flex",
                    alignItems: "baseline",
                    gap: 8,
                    width: "100%",
                    textAlign: "left",
                    background: "none",
                    border: "none",
                    cursor: "pointer",
                    padding: "5px 4px 5px 32px",
                    fontSize: 13,
                  }}
                  className="linklike"
                >
                  <span style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--muted)" }}>{item.manuscriptNumber}</span>
                  <span>{item.title}</span>
                  {item.author && <span style={{ color: "var(--muted)", fontSize: 12 }}>· {item.author}</span>}
                </button>
              ))}
        </div>
      )}
    </div>
  );
}
