import { useEffect, useState } from "react";
import { getIsbnBank, cancelIsbn, type IsbnBankItem, type IsbnBankResponse, type IsbnBankStatus, type IsbnFormat } from "../api/client";
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

  const s = data?.summary;

  return (
    <section style={{ padding: "clamp(16px, 4vw, 32px)", maxWidth: 1000 }}>
      <h1 style={{ fontFamily: "var(--font-title)", fontSize: 21, margin: "0 0 4px" }}>Banque des ISBN</h1>
      <p style={{ color: "var(--muted)", fontSize: 13, margin: "0 0 16px", lineHeight: 1.5 }}>
        Source centrale des ISBN d'Éclosion : tous les numéros enregistrés, classés par statut. Recherchez par numéro, titre ou auteur.
      </p>

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
