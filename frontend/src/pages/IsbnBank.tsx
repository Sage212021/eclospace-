import { useEffect, useState } from "react";
import { getIsbnBank, cancelIsbn, importIsbnBank, type IsbnBankItem, type IsbnBankResponse, type IsbnBankStatus, type IsbnFormat, type IsbnImportRow, type IsbnImportResult } from "../api/client";
import { useConfirm } from "../components/ConfirmProvider";

// Banque des ISBN (Lot 1) — source centrale de référence des ISBN d'Éclosion :
// tous les ISBN enregistrés (ceux du catalogue inclus), classés par statut, avec
// tableau de bord, recherche (numéro / titre / auteur) et filtres. Un ISBN n'est
// jamais supprimé ; on peut « annuler » un numéro disponible erroné/retiré.

const STATUS_LABEL: Record<IsbnBankStatus, string> = { disponible: "Disponible", attribue: "Attribué", annule: "Annulé" };
const STATUS_DOT: Record<IsbnBankStatus, string> = { disponible: "#B87400", attribue: "#2F7D4A", annule: "#B23A2E" };
const FORMATS: { value: IsbnFormat; label: string }[] = [
  { value: "print", label: "Imprimé" },
  { value: "epub", label: "ePub" },
  { value: "pdf", label: "PDF" },
  { value: "audio", label: "Audio" },
];

export function IsbnBank({ canManage, onOpenManuscript }: { canManage: boolean; onOpenManuscript?: (id: string) => void }) {
  const confirm = useConfirm();
  const [data, setData] = useState<IsbnBankResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [status, setStatus] = useState<IsbnBankStatus | "">("");
  const [format, setFormat] = useState<IsbnFormat | "">("");
  // Import CSV des anciens registres (admin).
  const [importOpen, setImportOpen] = useState(false);
  const [importBusy, setImportBusy] = useState(false);
  const [importResult, setImportResult] = useState<IsbnImportResult | null>(null);
  const [importError, setImportError] = useState<string | null>(null);

  function load() {
    getIsbnBank({ q: q.trim() || undefined, status: status || undefined, format: format || undefined })
      .then(setData)
      .catch((e) => setError(e instanceof Error ? e.message : "Chargement impossible."));
  }
  // Recherche/filtre : recharge (léger debounce sur la saisie).
  useEffect(() => {
    const t = setTimeout(load, 250);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, status, format]);

  async function annuler(it: IsbnBankItem) {
    const ok = await confirm({
      title: "Annuler cet ISBN ?",
      message: `Marquer l'ISBN ${it.isbn13} comme « Annulé / inutilisable » ?`,
      detail: "Il ne sera plus proposé à l'attribution, mais reste conservé dans la banque (jamais supprimé).",
      tone: "danger",
      confirmLabel: "Annuler l'ISBN",
    });
    if (!ok) return;
    try {
      await cancelIsbn(it.id);
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Annulation impossible.");
    }
  }

  async function onImportFile(file: File) {
    setImportBusy(true); setImportError(null); setImportResult(null);
    try {
      const rows = parseIsbnCsv(await file.text());
      if (rows.length === 0) { setImportError("Aucune ligne exploitable. Vérifiez l'en-tête (colonnes : isbn, titre, auteur, format, statut, date)."); return; }
      const res = await importIsbnBank(rows);
      setImportResult(res);
      load();
    } catch (e) {
      setImportError(e instanceof Error ? e.message : "Import impossible.");
    } finally {
      setImportBusy(false);
    }
  }

  const s = data?.summary;

  return (
    <section style={{ padding: "clamp(16px, 4vw, 32px)", maxWidth: 1000 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12, flexWrap: "wrap" }}>
        <div>
          <h1 style={{ fontFamily: "var(--font-title)", fontSize: 21, margin: "0 0 4px" }}>Banque des ISBN</h1>
          <p style={{ color: "var(--muted)", fontSize: 13, margin: "0 0 16px", lineHeight: 1.5, maxWidth: 620 }}>
            Source centrale des ISBN d'Éclosion : tous les numéros enregistrés, classés par statut. Recherchez par numéro, titre ou auteur.
          </p>
        </div>
        {canManage && (
          <button onClick={() => { setImportOpen((v) => !v); setImportResult(null); setImportError(null); }} style={{ background: "#fff", border: "1px solid var(--eclosion, #D9B21A)", color: "var(--eclosion-dark, #9a7a12)", borderRadius: 8, padding: "7px 13px", fontSize: 12.5, fontWeight: 700, cursor: "pointer", whiteSpace: "nowrap" }}>
            {importOpen ? "Fermer l'import" : "⬆ Importer des anciens ISBN (CSV)"}
          </button>
        )}
      </div>

      {canManage && importOpen && (
        <div style={{ border: "1px solid var(--eclosion, #D9B21A)", background: "var(--ivory, #FAF8F2)", borderRadius: 10, padding: 14, marginBottom: 16 }}>
          <div style={{ fontSize: 12.5, fontWeight: 700, marginBottom: 6 }}>Importer les anciens ISBN depuis un fichier CSV</div>
          <p style={{ fontSize: 12, color: "var(--muted)", margin: "0 0 10px", lineHeight: 1.5 }}>
            Le fichier doit avoir une 1ʳᵉ ligne d'en-tête. Colonnes reconnues (dans n'importe quel ordre, séparateur « ; » ou « , ») :
            {" "}<strong>isbn</strong>, <strong>titre</strong>, <strong>auteur</strong>, <strong>format</strong> (print/epub/pdf/audio), <strong>statut</strong> (disponible/attribué/annulé), <strong>date</strong> (AAAA-MM-JJ).
            Seul <strong>isbn</strong> est obligatoire. Les numéros déjà présents dans la banque sont ignorés (pas de doublon).
          </p>
          <input type="file" accept=".csv,text/csv,text/plain" disabled={importBusy}
            onChange={(e) => { const f = e.target.files?.[0]; if (f) onImportFile(f); e.target.value = ""; }}
            style={{ fontSize: 12.5 }} />
          {importBusy && <div style={{ fontSize: 12.5, color: "var(--muted)", marginTop: 8 }}>Import en cours…</div>}
          {importError && <div style={{ marginTop: 10, background: "var(--alert-soft)", color: "var(--alert)", borderRadius: 8, padding: "8px 11px", fontSize: 12.5 }}>⚠ {importError}</div>}
          {importResult && (
            <div style={{ marginTop: 10, background: "#e9f3ec", color: "#1f5c38", borderRadius: 8, padding: "9px 12px", fontSize: 12.5, lineHeight: 1.6 }}>
              ✓ Import terminé : <strong>{importResult.created}</strong> ISBN ajouté(s), <strong>{importResult.duplicates}</strong> doublon(s) ignoré(s){importResult.errors.length > 0 ? <>, <strong>{importResult.errors.length}</strong> erreur(s)</> : null}.
              {importResult.errors.length > 0 && (
                <ul style={{ margin: "6px 0 0", paddingLeft: 18, color: "var(--alert)" }}>
                  {importResult.errors.slice(0, 8).map((er, i) => <li key={i}>Ligne {er.line} ({er.isbn13 || "—"}) : {er.reason}</li>)}
                </ul>
              )}
            </div>
          )}
        </div>
      )}

      {error && <div style={{ background: "var(--alert-soft)", color: "var(--alert)", borderRadius: 8, padding: "9px 12px", fontSize: 13, marginBottom: 12 }}>{error}</div>}

      {/* Tableau de bord */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))", gap: 10, marginBottom: 16 }}>
        <Stat label="Total ISBN" value={s?.total} color="var(--ink)" />
        <Stat label="🟡 Disponibles" value={s?.disponible} color={STATUS_DOT.disponible} />
        <Stat label="🟢 Attribués" value={s?.attribue} color={STATUS_DOT.attribue} />
        <Stat label="🔴 Annulés" value={s?.annule} color={STATUS_DOT.annule} />
      </div>

      {/* Recherche + filtres */}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 12 }}>
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Rechercher : numéro ISBN, titre, auteur…"
          style={{ flex: 1, minWidth: 220, padding: "8px 11px", border: "1px solid var(--line)", borderRadius: 8, fontSize: 13 }}
        />
        <select value={status} onChange={(e) => setStatus(e.target.value as IsbnBankStatus | "")} style={selStyle}>
          <option value="">Tous les statuts</option>
          <option value="disponible">Disponible</option>
          <option value="attribue">Attribué</option>
          <option value="annule">Annulé</option>
        </select>
        <select value={format} onChange={(e) => setFormat(e.target.value as IsbnFormat | "")} style={selStyle}>
          <option value="">Tous les formats</option>
          {FORMATS.map((f) => <option key={f.value} value={f.value}>{f.label}</option>)}
        </select>
      </div>

      {/* Liste */}
      <div style={{ border: "1px solid var(--line)", borderRadius: 12, overflow: "hidden", background: "var(--card)" }}>
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13, minWidth: 720 }}>
            <thead>
              <tr style={{ background: "var(--ivory, #FAF8F2)", textAlign: "left", borderBottom: "2px solid var(--eclosion, #D9B21A)" }}>
                <Th>ISBN</Th><Th>Statut</Th><Th>Titre</Th><Th>Auteur</Th><Th>Format</Th><Th>Attribué le</Th><Th>Par</Th><Th></Th>
              </tr>
            </thead>
            <tbody>
              {data === null ? (
                <tr><td colSpan={8} style={tdMuted}>Chargement…</td></tr>
              ) : data.items.length === 0 ? (
                <tr><td colSpan={8} style={tdMuted}>Aucun ISBN ne correspond.</td></tr>
              ) : (
                data.items.map((it) => (
                  <tr key={it.id} style={{ borderTop: "1px solid var(--line)" }}>
                    <td style={{ ...td, fontFamily: "var(--font-mono)", whiteSpace: "nowrap" }}>{it.isbn13}</td>
                    <td style={td}>
                      <span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontWeight: 700, color: STATUS_DOT[it.bank_status] }}>
                        <span style={{ width: 8, height: 8, borderRadius: "50%", background: STATUS_DOT[it.bank_status] }} />
                        {STATUS_LABEL[it.bank_status]}
                      </span>
                    </td>
                    <td style={td}>
                      {it.manuscript_id && onOpenManuscript ? (
                        <button onClick={() => onOpenManuscript(it.manuscript_id!)} style={{ background: "none", border: "none", padding: 0, color: "var(--eclosion-dark, #9a7a12)", fontWeight: 600, cursor: "pointer", textAlign: "left" }}>
                          {it.title ?? "—"}
                        </button>
                      ) : (it.title ?? <span style={{ color: "var(--muted)" }}>—</span>)}
                      {it.observations && <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 2 }}>{it.observations}</div>}
                    </td>
                    <td style={td}>{it.author ?? <span style={{ color: "var(--muted)" }}>—</span>}</td>
                    <td style={td}>{FORMATS.find((f) => f.value === it.format)?.label ?? it.format}</td>
                    <td style={{ ...td, fontFamily: "var(--font-mono)", whiteSpace: "nowrap" }}>{it.assigned_at ? new Date(it.assigned_at).toLocaleDateString("fr-FR") : "—"}</td>
                    <td style={td}>{it.assigned_by ?? <span style={{ color: "var(--muted)" }}>—</span>}</td>
                    <td style={{ ...td, textAlign: "right" }}>
                      {canManage && it.bank_status === "disponible" && (
                        <button onClick={() => annuler(it)} title="Rendre inutilisable (conservé dans l'historique)" style={{ background: "#fff", color: "var(--alert, #B23A2E)", border: "1px solid var(--alert, #B23A2E)", borderRadius: 6, padding: "3px 9px", fontSize: 11.5, fontWeight: 700, cursor: "pointer", whiteSpace: "nowrap" }}>
                          Annuler
                        </button>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}

const selStyle: React.CSSProperties = { padding: "8px 10px", border: "1px solid var(--line)", borderRadius: 8, fontSize: 13 };
const th: React.CSSProperties = { padding: "10px 12px", fontSize: 11, fontWeight: 800, textTransform: "uppercase", letterSpacing: 0.3, color: "var(--muted)" };
const td: React.CSSProperties = { padding: "9px 12px", verticalAlign: "top" };
const tdMuted: React.CSSProperties = { padding: "18px 12px", textAlign: "center", color: "var(--muted)" };
function Th({ children }: { children?: React.ReactNode }) { return <th style={th}>{children}</th>; }
function Stat({ label, value, color }: { label: string; value?: number; color: string }) {
  return (
    <div style={{ border: "1px solid var(--line)", borderRadius: 10, padding: "12px 14px", background: "var(--card)" }}>
      <div style={{ fontSize: 11.5, color: "var(--muted)", marginBottom: 4 }}>{label}</div>
      <div style={{ fontFamily: "var(--font-mono)", fontSize: 22, fontWeight: 800, color }}>{value ?? "—"}</div>
    </div>
  );
}

// Lecture simple d'un CSV d'anciens ISBN (séparateur « ; » ou « , »), avec
// en-tête. Mappe des noms de colonnes tolérants (accents/casse) vers les champs.
function parseIsbnCsv(text: string): IsbnImportRow[] {
  const clean = text.replace(/^﻿/, "").replace(/\r\n?/g, "\n");
  const lines = clean.split("\n").filter((l) => l.trim().length > 0);
  if (lines.length < 2) return [];
  const delim = (lines[0].match(/;/g)?.length ?? 0) >= (lines[0].match(/,/g)?.length ?? 0) ? ";" : ",";
  const splitLine = (line: string): string[] => {
    const out: string[] = [];
    let cur = "", inQ = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (inQ) {
        if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; }
        else if (ch === '"') inQ = false;
        else cur += ch;
      } else if (ch === '"') inQ = true;
      else if (ch === delim) { out.push(cur); cur = ""; }
      else cur += ch;
    }
    out.push(cur);
    return out.map((c) => c.trim());
  };
  const norm = (h: string) => h.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]/g, "");
  const headers = splitLine(lines[0]).map(norm);
  const idx = (names: string[]) => headers.findIndex((h) => names.includes(h));
  const iIsbn = idx(["isbn", "isbn13", "numero", "numeroisbn", "num"]);
  const iTitle = idx(["titre", "title", "ouvrage"]);
  const iAuthor = idx(["auteur", "author", "auteurs"]);
  const iFormat = idx(["format", "support"]);
  const iStatus = idx(["statut", "status", "etat"]);
  const iDate = idx(["date", "dateattribution", "assignedat", "dateatt"]);
  if (iIsbn < 0) return [];

  const fmt = (v: string): IsbnImportRow["format"] => {
    const x = norm(v);
    return x.startsWith("epub") ? "epub" : x === "pdf" ? "pdf" : x === "audio" ? "audio" : "print";
  };
  const stat = (v: string): IsbnImportRow["status"] | undefined => {
    const x = norm(v);
    if (!x) return undefined;
    if (x.startsWith("dispo")) return "disponible";
    if (x.startsWith("annul") || x.startsWith("inutilis")) return "annule";
    if (x.startsWith("attribu") || x.startsWith("publi")) return "attribue";
    return undefined;
  };
  const rows: IsbnImportRow[] = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = splitLine(lines[i]);
    const isbn13 = (cols[iIsbn] ?? "").trim();
    if (!isbn13) continue;
    rows.push({
      isbn13,
      title: iTitle >= 0 ? cols[iTitle] || undefined : undefined,
      author: iAuthor >= 0 ? cols[iAuthor] || undefined : undefined,
      format: iFormat >= 0 && cols[iFormat] ? fmt(cols[iFormat]) : undefined,
      status: iStatus >= 0 && cols[iStatus] ? stat(cols[iStatus]) : undefined,
      assigned_at: iDate >= 0 ? cols[iDate] || undefined : undefined,
    });
  }
  return rows;
}
