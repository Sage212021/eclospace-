import { useEffect, useMemo, useState } from "react";
import { listIsbnRefs, listStockLocations, createStockMovement, matchStockInitial, type IsbnRef, type StockLocation, type StockMatchResult } from "../api/client";
import { Card } from "./Card";
import { Field } from "./Modal";
import { Button } from "./Button";
import { IconCommercial } from "./icons";

// Rapport d'inventaire (06/07/2026) pré-chargé pour gagner du temps : « titre
// quantité ». Le magasinier corrigera manuellement au besoin.
const REPORT_DEFAULT = `Literatures CM2 2609
Littératures CMI 661
Latina 2nd 1er Tle 32
Latina 6e et 5eme 93
Latina 4e et 3e 16
Informatique 6e 134
Je découvre ma langue Grecque 12
Rhapsodies 30
Rrhe gens 39
Journalisme culturel 21
Troisième manque 39
L'élève fatale 8
Afrique premier puissance 25
Pratique des fondamentaux du développement optimal de l'Afrique 17
L'ailleurs 16
Stances et poèmes 119
Marketing & communication politique et électorale 13
Libre 34
Les comptes du Cameroun 15
Vicky Edimo à voix basse 62
L'éveil démocratique 45
Afrique en larme 20
Amnésique 48
Nkode & Jobi 19
Ndjanga ne se moque pas 29
Mafeu a peur du monstre 32
J'apprends ma langue Bulu 230
J'apprends ma langue Fufulbe 214
J'apprends ma langue Douala 187`;

// Parse une ligne « Titre … quantité » : quantité = dernier nombre, hors
// parenthèses (« 15 (08 touchés) » → 15).
function parseReport(text: string): { label: string; quantity: number }[] {
  return text
    .split("\n")
    .map((raw) => raw.replace(/\(.*?\)/g, " ").trim())
    .filter(Boolean)
    .map((line) => {
      const m = line.match(/^(.*?)[\s.:;=–-]*?(\d[\d\s]*)$/);
      if (!m) return null;
      const label = m[1].trim();
      const quantity = parseInt(m[2].replace(/\s/g, ""), 10);
      if (!label || !Number.isFinite(quantity)) return null;
      return { label, quantity };
    })
    .filter((x): x is { label: string; quantity: number } => x !== null);
}

// Chargement de l'inventaire initial (rapport de stock) : on choisit une zone,
// on saisit les quantités par ouvrage, puis on charge tout en une fois. Chaque
// ligne crée une régularisation de stock tracée. Idéal pour intégrer le fichier
// d'inventaire (titres + quantités) d'un coup.
export function StockInitialImportSection({ canManage, collapsible, defaultOpen }: { canManage: boolean; collapsible?: boolean; defaultOpen?: boolean }) {
  const [isbns, setIsbns] = useState<IsbnRef[]>([]);
  const [locations, setLocations] = useState<StockLocation[]>([]);
  const [locationId, setLocationId] = useState("");
  const [filter, setFilter] = useState("");
  const [qty, setQty] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [pasteOpen, setPasteOpen] = useState(false);
  const [pasteText, setPasteText] = useState(REPORT_DEFAULT);
  const [matchResults, setMatchResults] = useState<StockMatchResult[] | null>(null);
  const [matching, setMatching] = useState(false);

  useEffect(() => {
    Promise.all([listIsbnRefs("print"), listStockLocations()])
      .then(([refs, locs]) => {
        setIsbns(refs);
        setLocations(locs);
      })
      .catch((e) => setError(e instanceof Error ? e.message : "Chargement impossible."));
  }, []);

  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return isbns;
    return isbns.filter((i) => (i.manuscript?.title ?? "").toLowerCase().includes(q) || i.isbn13.includes(q));
  }, [isbns, filter]);

  const entries = Object.entries(qty).filter(([, v]) => Number(v) > 0);

  async function runMatch() {
    const lines = parseReport(pasteText);
    if (lines.length === 0) {
      setError("Aucune ligne « titre quantité » détectée dans le texte collé.");
      return;
    }
    setMatching(true);
    setError(null);
    try {
      const { results } = await matchStockInitial(lines);
      setMatchResults(results);
      // Pré-remplit la grille pour les ouvrages appariés (cumule si doublon).
      setQty((cur) => {
        const next = { ...cur };
        for (const r of results) {
          if (r.isbn_id) next[r.isbn_id] = String((Number(next[r.isbn_id]) || 0) + r.quantity);
        }
        return next;
      });
      const matched = results.filter((r) => r.isbn_id).length;
      setMessage(`Rapprochement : ${matched}/${results.length} ligne(s) appariée(s). Vérifiez, puis choisissez la zone et « Charger ».`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Rapprochement impossible.");
    } finally {
      setMatching(false);
    }
  }

  async function load() {
    if (!locationId) {
      setError("Choisissez d'abord la zone de stockage.");
      return;
    }
    if (entries.length === 0) {
      setError("Saisissez au moins une quantité.");
      return;
    }
    if (!window.confirm(`Charger le stock de ${entries.length} ouvrage(s) dans « ${locations.find((l) => l.id === locationId)?.label} » ?`)) return;
    setBusy(true);
    setError(null);
    let ok = 0;
    const failed: string[] = [];
    for (const [isbnId, v] of entries) {
      try {
        await createStockMovement({ type: "inventory_adjustment", isbn_id: isbnId, to_location_id: locationId, quantity: Math.round(Number(v)), reason: "Chargement inventaire initial" });
        ok += 1;
      } catch {
        failed.push(isbns.find((i) => i.id === isbnId)?.isbn13 ?? isbnId);
      }
    }
    setBusy(false);
    setQty({});
    setMessage(`${ok} ouvrage(s) chargé(s).${failed.length ? ` Échecs : ${failed.join(", ")}.` : ""}`);
    if (failed.length) setError(`Certaines lignes ont échoué : ${failed.join(", ")}.`);
  }

  if (!canManage) return null;

  return (
    <Card
      title="Chargement de l'inventaire initial"
      icon={<IconCommercial />}
      subtitle="Choisissez une zone, saisissez les quantités par ouvrage, puis chargez tout en une fois."
      collapsible={collapsible}
      defaultOpen={defaultOpen}
    >
      {error && <div style={{ background: "#f8e3df", color: "var(--danger, #C24B3A)", borderRadius: 8, padding: "8px 12px", fontSize: 13, marginBottom: 10 }}>{error}</div>}
      {message && <div style={{ background: "var(--eclosion-soft)", color: "var(--ink)", borderRadius: 8, padding: "8px 12px", fontSize: 13, marginBottom: 10 }}>{message}</div>}

      {/* Rapprochement automatique depuis le rapport d'inventaire */}
      <div style={{ border: "1px dashed var(--line)", borderRadius: 8, padding: 10, marginBottom: 12 }}>
        <button type="button" onClick={() => setPasteOpen((o) => !o)} style={{ background: "none", border: "none", cursor: "pointer", fontSize: 13, fontWeight: 600, color: "var(--eclosion-dark, #8A6A12)", padding: 0 }}>
          {pasteOpen ? "▾" : "▸"} Rapprochement automatique depuis le rapport (titre + quantité)
        </button>
        {pasteOpen && (
          <div style={{ marginTop: 8 }}>
            <p style={{ fontSize: 12, color: "var(--muted)", margin: "0 0 6px" }}>
              Une ligne par ouvrage : « Titre … quantité ». Le rapport est pré-rempli ; cliquez « Rapprocher » — les quantités se placent sur les ouvrages reconnus, les non-trouvés sont listés.
            </p>
            <textarea value={pasteText} onChange={(e) => setPasteText(e.target.value)} rows={8} style={{ width: "100%", fontFamily: "var(--font-mono)", fontSize: 12.5, padding: 8, border: "1px solid var(--line)", borderRadius: 6 }} />
            <div style={{ marginTop: 6 }}>
              <Button variant="edit" size="sm" type="button" disabled={matching} onClick={runMatch}>{matching ? "Rapprochement…" : "Rapprocher automatiquement"}</Button>
            </div>
            {matchResults && (
              <div style={{ marginTop: 8, maxHeight: 200, overflowY: "auto", fontSize: 12.5 }}>
                {matchResults.map((r, i) => (
                  <div key={i} style={{ display: "flex", justifyContent: "space-between", gap: 8, padding: "2px 0", borderTop: i ? "1px solid var(--line)" : undefined }}>
                    <span style={{ color: "var(--muted)" }}>{r.label} <strong style={{ fontFamily: "var(--font-mono)" }}>({r.quantity})</strong></span>
                    {r.isbn_id ? (
                      <span style={{ color: r.score >= 75 ? "var(--eclosion-dark, #8A6A12)" : "var(--alert, #C4661F)", textAlign: "right" }}>→ {r.matched_title} <span style={{ fontFamily: "var(--font-mono)" }}>({r.score}%)</span></span>
                    ) : (
                      <span style={{ color: "var(--danger, #C24B3A)" }}>non trouvé — à saisir manuellement</span>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      <div style={{ display: "flex", flexWrap: "wrap", gap: 10, alignItems: "flex-end", marginBottom: 10 }}>
        <Field label="Zone de stockage">
          <select value={locationId} onChange={(e) => setLocationId(e.target.value)}>
            <option value="">— choisir —</option>
            {locations.map((l) => <option key={l.id} value={l.id}>{l.label}</option>)}
          </select>
        </Field>
        <Field label="Rechercher un ouvrage">
          <input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Titre ou ISBN…" />
        </Field>
        <div style={{ fontSize: 12.5, color: "var(--muted)" }}>{entries.length} ligne(s) à charger</div>
        <Button variant="add" size="sm" type="button" disabled={busy || !locationId || entries.length === 0} onClick={load}>{busy ? "Chargement…" : "Charger le stock"}</Button>
      </div>

      {isbns.length === 0 ? (
        <p style={{ color: "var(--muted)", fontSize: 13, margin: 0 }}>Aucun ouvrage avec ISBN imprimé. Attribuez d'abord les ISBN.</p>
      ) : (
        <div style={{ maxHeight: 360, overflowY: "auto", border: "1px solid var(--line)", borderRadius: 8 }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
            <thead style={{ position: "sticky", top: 0, background: "var(--card, #fff)" }}>
              <tr style={{ textAlign: "left", color: "var(--muted)", fontSize: 12 }}>
                <th style={{ padding: "5px 8px" }}>Ouvrage</th>
                <th style={{ padding: "5px 8px" }}>ISBN</th>
                <th style={{ padding: "5px 8px", textAlign: "right" }}>Quantité</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((i) => (
                <tr key={i.id} style={{ borderTop: "1px solid var(--line)" }}>
                  <td style={{ padding: "4px 8px" }}>{i.manuscript?.title ?? "—"}</td>
                  <td style={{ padding: "4px 8px", fontFamily: "var(--font-mono)", color: "var(--muted)" }}>{i.isbn13}</td>
                  <td style={{ padding: "4px 8px", textAlign: "right" }}>
                    <input
                      type="number"
                      min={0}
                      value={qty[i.id] ?? ""}
                      onChange={(e) => setQty((q) => ({ ...q, [i.id]: e.target.value }))}
                      style={{ width: 90, padding: "3px 6px", textAlign: "right", fontFamily: "var(--font-mono)", border: "1px solid var(--line)", borderRadius: 5 }}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p style={{ fontSize: 11.5, color: "var(--muted)", marginTop: 8 }}>
        Astuce : sélectionnez une zone (ex. « Magasin — cartons »), saisissez les quantités du rapport en face de chaque ouvrage, puis « Charger le stock ». Répétez par zone.
      </p>
    </Card>
  );
}
