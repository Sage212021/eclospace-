import { useEffect, useMemo, useRef, useState } from "react";
import type { IsbnRef } from "../api/client";

// Recherche d'ouvrage à la saisie (demande opérateur) : au lieu d'une longue
// liste déroulante, on tape l'ISBN ou le début du titre et la liste se filtre.
// Filtrage côté écran sur les ISBN déjà chargés — instantané, sans requête.
export function IsbnCombobox({
  isbns,
  value,
  onChange,
  placeholder,
}: {
  isbns: IsbnRef[];
  value: string;
  onChange: (id: string) => void;
  placeholder?: string;
}) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [activeIdx, setActiveIdx] = useState(0);
  const wrapRef = useRef<HTMLDivElement>(null);

  // Affichage TITRE d'abord (demande opérateur) : on reconnaît l'ouvrage sans
  // devoir lire l'ISBN. L'ISBN (et l'auteur) restent en information secondaire.
  const labelOf = (i: IsbnRef) => `${i.manuscript?.title ?? "Sans titre"} · ${i.isbn13}`;
  const selected = useMemo(() => isbns.find((i) => i.id === value) ?? null, [isbns, value]);

  // Refléter le libellé de l'ouvrage sélectionné (y compris pré-rempli) quand la
  // liste n'est pas ouverte.
  useEffect(() => {
    if (!open) setQuery(selected ? labelOf(selected) : "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected, open]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const all = q && !(selected && labelOf(selected).toLowerCase() === q)
      ? isbns.filter((i) => i.isbn13.toLowerCase().includes(q) || (i.manuscript?.title ?? "").toLowerCase().includes(q) || (i.author ?? "").toLowerCase().includes(q))
      : isbns;
    return all.slice(0, 50);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isbns, query, selected]);

  useEffect(() => {
    function onDoc(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  function pick(i: IsbnRef) {
    onChange(i.id);
    setQuery(labelOf(i));
    setOpen(false);
  }

  return (
    <div ref={wrapRef} style={{ position: "relative" }}>
      <input
        type="text"
        value={query}
        placeholder={placeholder ?? "Tapez l'ISBN ou le début du titre…"}
        role="combobox"
        aria-expanded={open}
        aria-autocomplete="list"
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
          setActiveIdx(0);
          if (!e.target.value.trim()) onChange("");
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") { e.preventDefault(); setOpen(true); setActiveIdx((i) => Math.min(i + 1, filtered.length - 1)); }
          else if (e.key === "ArrowUp") { e.preventDefault(); setActiveIdx((i) => Math.max(i - 1, 0)); }
          else if (e.key === "Enter" && open && filtered[activeIdx]) { e.preventDefault(); pick(filtered[activeIdx]); }
          else if (e.key === "Escape") setOpen(false);
        }}
        style={{ width: "100%" }}
      />
      {open && (
        <ul
          style={{
            position: "absolute", zIndex: 30, top: "100%", left: 0, right: 0, maxHeight: 260, overflowY: "auto",
            margin: "3px 0 0", padding: 4, listStyle: "none",
            background: "var(--card)", border: "1px solid var(--line)", borderRadius: 8, boxShadow: "0 8px 24px rgba(16,25,46,.14)",
          }}
        >
          {filtered.length === 0 && (
            <li style={{ padding: "8px 10px", color: "var(--muted)", fontSize: 13 }}>Aucun ouvrage ne correspond.</li>
          )}
          {filtered.map((i, idx) => (
            <li
              key={i.id}
              onMouseDown={(e) => { e.preventDefault(); pick(i); }}
              onMouseEnter={() => setActiveIdx(idx)}
              style={{
                padding: "7px 10px", borderRadius: 6, cursor: "pointer", fontSize: 13,
                background: idx === activeIdx ? "var(--eclosion-soft)" : "transparent",
              }}
            >
              <div style={{ fontWeight: 600 }}>{i.manuscript?.title ?? "Sans titre"}</div>
              <div style={{ color: "var(--muted)", fontSize: 11.5 }}>
                <span style={{ fontFamily: "var(--font-mono)" }}>{i.isbn13}</span>
                {i.author ? ` · ${i.author}` : ""}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
