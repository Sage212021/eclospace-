import { useEffect, useMemo, useState } from "react";
import { getCatalogue, type CatalogueItem } from "../api/client";

// Liste de travail « couvertures manquantes » (demande opérateur) : recense tous
// les ouvrages du catalogue SANS couverture, groupés par catégorie, et l'exporte
// en CSV. But : savoir exactement quelles couvertures aller récupérer sur le site
// public d'Éclosion, puis les déposer en une fois via « Ajouter les couvertures
// en masse ». Lecture seule : ne modifie rien.

function toCsv(rows: string[][]): string {
  const esc = (v: string) => `"${(v ?? "").replace(/"/g, '""')}"`;
  const body = rows.map((r) => r.map(esc).join(";")).join("\r\n");
  return `﻿${body}`; // BOM : les accents s'affichent correctement dans Excel.
}

function download(name: string, content: string) {
  const blob = new Blob([content], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

export function MissingCoversWorklist({ reloadToken }: { reloadToken?: number }) {
  const [items, setItems] = useState<CatalogueItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    getCatalogue({})
      .then((r) => { if (alive) setItems(r.items); })
      .catch(() => { if (alive) setItems([]); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [reloadToken]);

  const missing = useMemo(() => items.filter((i) => !i.hasCover), [items]);

  // Regroupe par catégorie (genre), « Sans catégorie » en dernier.
  const byCategory = useMemo(() => {
    const map = new Map<string, CatalogueItem[]>();
    for (const it of missing) {
      const key = it.genre?.label ?? "Sans catégorie";
      const arr = map.get(key) ?? [];
      arr.push(it);
      map.set(key, arr);
    }
    return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [missing]);

  function exportCsv() {
    const rows: string[][] = [["Titre", "Auteur(s)", "Catégorie", "Référence", "Année"]];
    for (const [cat, list] of byCategory) {
      for (const it of list) rows.push([it.title, it.authors.join(", "), cat, it.reference, it.year ? String(it.year) : ""]);
    }
    download(`couvertures-manquantes-${new Date().toISOString().slice(0, 10)}.csv`, toCsv(rows));
  }

  if (loading) return null;

  return (
    <div style={{ border: "1px solid var(--line)", borderRadius: 10, background: "var(--card)", padding: 12, marginBottom: 12 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <div style={{ fontSize: 13.5, fontWeight: 700 }}>
          🖼️ Couvertures manquantes <span style={{ color: missing.length ? "var(--eclosion-retard, #C4661F)" : "var(--positive, #2F7D4A)", fontWeight: 700 }}>({missing.length})</span>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          {missing.length > 0 && <button onClick={exportCsv} style={{ background: "var(--eclosion, #D9B21A)", color: "#0B0B0C", border: "none", borderRadius: 8, padding: "6px 13px", fontWeight: 700, fontSize: 12.5, cursor: "pointer" }}>⬇ Exporter la liste (CSV)</button>}
          <button onClick={() => setOpen((v) => !v)} style={{ background: "#fff", border: "1px solid var(--line)", borderRadius: 8, padding: "6px 12px", fontSize: 12.5, cursor: "pointer" }}>{open ? "Masquer ▴" : "Voir la liste ▾"}</button>
        </div>
      </div>
      <p style={{ color: "var(--muted)", fontSize: 11.5, margin: "6px 0 0", lineHeight: 1.45 }}>
        Ouvrages du catalogue sans couverture, par catégorie. Récupérez ces couvertures sur le site d'Éclosion, puis déposez-les en une fois via « Ajouter les couvertures en masse » (elles se rattachent par titre). Les couvertures existantes ne sont pas touchées.
      </p>
      {missing.length === 0 && <p style={{ color: "var(--positive, #2F7D4A)", fontSize: 12.5, margin: "8px 0 0" }}>Toutes les fiches ont une couverture. 🎉</p>}
      {open && missing.length > 0 && (
        <div style={{ marginTop: 10, display: "grid", gap: 10 }}>
          {byCategory.map(([cat, list]) => (
            <div key={cat}>
              <div style={{ fontSize: 12.5, fontWeight: 700, marginBottom: 4 }}>{cat} <span style={{ color: "var(--muted)", fontWeight: 600 }}>({list.length})</span></div>
              <div style={{ display: "grid", gap: 3 }}>
                {list.map((it) => (
                  <div key={it.id} style={{ fontSize: 12.5, display: "flex", gap: 8, justifyContent: "space-between", borderBottom: "1px solid var(--line)", padding: "3px 0" }}>
                    <span>{it.title}{it.authors.length ? <span style={{ color: "var(--muted)" }}> — {it.authors.join(", ")}</span> : null}</span>
                    <span style={{ color: "var(--muted)", fontFamily: "var(--font-mono)", fontSize: 11, flexShrink: 0 }}>{it.reference}</span>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
