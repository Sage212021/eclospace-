import { useEffect, useMemo, useState } from "react";
import { getSchoolRoyalties, getSchoolRoyaltyRate, setSchoolRoyaltyRate, type SchoolRoyaltyReport } from "../api/client";
import { Card } from "./Card";

// Droits d'auteur du LIVRE SCOLAIRE : taux maison (12 % par défaut, modulable
// par la DAF) et relevé segmenté par ouvrage — auteur, co-auteurs, ISBN, prix
// unitaire, quantité, assiette, taux, droits acquis (conformité réglementaire).

const money = (n: number) => new Intl.NumberFormat("fr-FR", { style: "currency", currency: "XAF", maximumFractionDigits: 0 }).format(n);
const pct = (r: number) => `${(r * 100).toLocaleString("fr-FR", { maximumFractionDigits: 2 })} %`;

export function SchoolRoyaltiesSection({ canConfigure = false }: { canConfigure?: boolean }) {
  const thisYear = useMemo(() => new Date().getFullYear(), []);
  const [year, setYear] = useState(thisYear);
  const [report, setReport] = useState<SchoolRoyaltyReport | null>(null);
  const [rate, setRate] = useState<number | null>(null);
  const [rateInput, setRateInput] = useState("");
  const [editingRate, setEditingRate] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const years = useMemo(() => Array.from({ length: 6 }, (_, i) => thisYear - i), [thisYear]);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      setReport(await getSchoolRoyalties({ year }));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Chargement impossible.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [year]);

  useEffect(() => {
    getSchoolRoyaltyRate()
      .then((r) => { setRate(r.rate); setRateInput(String(Math.round(r.rate * 10000) / 100)); })
      .catch(() => setRate(null));
  }, []);

  async function saveRate() {
    const v = Number(rateInput.replace(",", "."));
    if (!(v > 0 && v <= 100)) {
      setError("Le taux doit être un pourcentage entre 0 et 100 (ex. 12 pour 12 %).");
      return;
    }
    setError(null);
    setMessage(null);
    try {
      const r = await setSchoolRoyaltyRate(Math.round(v * 100) / 10000);
      setRate(r.rate);
      setRateInput(String(Math.round(r.rate * 10000) / 100));
      setEditingRate(false);
      setMessage("Taux maison mis à jour : il s'applique aux prochaines factures de livre scolaire.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Enregistrement impossible.");
    }
  }

  // Export CSV du relevé segmenté (conformité) : une ligne par ouvrage.
  function exportCsv() {
    if (!report) return;
    const header = ["Ouvrage", "Auteur", "Co-auteurs", "ISBN", "Prix unitaire HT", "Exemplaires", "Assiette HT", "Taux", "Droits acquis"];
    const rows = report.by_book.map((b) => [
      b.book_title,
      b.author_name ?? "",
      b.co_authors.join(" ; "),
      b.isbn_code ?? "",
      String(b.unit_price_ht),
      String(b.units),
      String(b.base),
      b.rate != null ? String(Math.round(b.rate * 10000) / 100) + "%" : "mixte",
      String(b.earned),
    ]);
    const esc = (s: string) => `"${s.replace(/"/g, '""')}"`;
    const csv = [header, ...rows].map((r) => r.map((c) => esc(String(c))).join(";")).join("\r\n");
    const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `droits_livre_scolaire_${year}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <Card
      title="Droits d'auteur — livre scolaire"
      subtitle="Taux maison 12 % par défaut (modulable). Relevé segmenté par ouvrage : auteur, co-auteurs, ISBN, prix unitaire — pour la conformité réglementaire."
    >
      {error && <div style={{ background: "var(--alert-soft)", color: "var(--alert)", borderRadius: 8, padding: "9px 13px", fontSize: 13, marginBottom: 12 }}>{error}</div>}
      {message && <div style={{ background: "var(--eclosion-soft)", color: "var(--eclosion-dark)", borderRadius: 8, padding: "9px 13px", fontSize: 13, marginBottom: 12 }}>{message}</div>}

      {/* Taux maison du livre scolaire (12 % par défaut) : réglable par la DAF. */}
      <div style={{ display: "flex", alignItems: "center", gap: 10, background: "var(--eclosion-soft)", border: "1px solid var(--eclosion)", borderRadius: 10, padding: "10px 14px", marginBottom: 14, flexWrap: "wrap" }}>
        <span style={{ fontSize: 13, fontWeight: 600, color: "var(--eclosion-dark)" }}>Taux maison des droits d'auteur (livre scolaire) :</span>
        {!editingRate ? (
          <>
            <span style={{ fontFamily: "var(--font-mono)", fontWeight: 700, fontSize: 15 }}>{rate != null ? pct(rate) : "…"}</span>
            {canConfigure && (
              <button onClick={() => setEditingRate(true)} style={btnGhost}>Modifier</button>
            )}
          </>
        ) : (
          <>
            <input value={rateInput} onChange={(e) => setRateInput(e.target.value)} inputMode="decimal" style={{ ...inp, width: 90 }} title="Pourcentage (ex. 12)" />
            <span style={{ fontSize: 13, color: "var(--muted)" }}>%</span>
            <button onClick={saveRate} style={btnPrimary}>Enregistrer</button>
            <button onClick={() => { setEditingRate(false); setRateInput(rate != null ? String(Math.round(rate * 10000) / 100) : ""); }} style={btnGhost}>Annuler</button>
          </>
        )}
        <span style={{ fontSize: 11.5, color: "var(--muted)" }}>
          {canConfigure ? "S'applique à chaque ouvrage scolaire, sauf taux précisé sur la ligne de commande." : "Réglage géré par la direction financière."}
        </span>
      </div>

      <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "flex-end", marginBottom: 12 }}>
        <label style={{ fontSize: 12, color: "var(--muted)" }}>
          Année
          <select value={year} onChange={(e) => setYear(Number(e.target.value))} style={{ ...inp, cursor: "pointer", display: "block", marginTop: 4 }}>
            {years.map((y) => <option key={y} value={y}>{y}</option>)}
          </select>
        </label>
        <button onClick={load} disabled={loading} style={{ ...inp, cursor: "pointer", background: "var(--eclosion-soft)", border: "1px solid var(--eclosion)", color: "var(--eclosion-dark)", fontWeight: 700 }}>
          {loading ? "Chargement…" : "Actualiser"}
        </button>
        {report && report.by_book.length > 0 && (
          <button onClick={exportCsv} style={{ ...inp, cursor: "pointer" }}>Exporter (CSV)</button>
        )}
      </div>

      {report && (
        <>
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "center", marginBottom: 14 }}>
            <Stat label="Ouvrages" value={String(report.by_book.length)} />
            <Stat label="Exemplaires" value={report.total.units.toLocaleString("fr-FR")} />
            <Stat label="Assiette totale HT" value={money(report.total.base)} />
            <Stat label="Droits acquis (total)" value={money(report.total.earned)} accent />
          </div>
          <div style={{ overflowX: "auto" }}>
            <table style={tbl}>
              <thead><tr>
                <th style={th}>Ouvrage</th>
                <th style={th}>Auteur / co-auteurs</th>
                <th style={th}>ISBN</th>
                <th style={thNum}>Prix unit. HT</th>
                <th style={thNum}>Exempl.</th>
                <th style={thNum}>Assiette</th>
                <th style={thNum}>Taux</th>
                <th style={thNum}>Droits acquis</th>
              </tr></thead>
              <tbody>
                {report.by_book.length === 0 && <tr><td colSpan={8} style={{ ...td, color: "var(--muted)", textAlign: "center" }}>Aucun droit de livre scolaire sur cette année.</td></tr>}
                {report.by_book.map((b, i) => (
                  <tr key={b.manuscript_id ?? b.isbn_code ?? b.book_title + i}>
                    <td style={td}>{b.book_title}</td>
                    <td style={td}>
                      <span style={{ fontWeight: 600 }}>{b.author_name ?? "—"}</span>
                      {b.co_authors.length > 0 && <div style={{ fontSize: 11.5, color: "var(--muted)" }}>{b.co_authors.join(", ")}</div>}
                    </td>
                    <td style={{ ...td, fontFamily: "var(--font-mono)", fontSize: 12 }}>{b.isbn_code ?? "—"}</td>
                    <td style={tdNum}>{money(b.unit_price_ht)}</td>
                    <td style={tdNum}>{b.units.toLocaleString("fr-FR")}</td>
                    <td style={tdNum}>{money(b.base)}</td>
                    <td style={tdNum}>{b.rate != null ? pct(b.rate) : <span style={{ color: "var(--muted)" }}>mixte</span>}</td>
                    <td style={{ ...tdNum, fontWeight: 700, color: "var(--eclosion-dark)" }}>{money(b.earned)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </Card>
  );
}

function Stat({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div style={{ background: "var(--card)", border: "1px solid var(--line)", borderRadius: 10, padding: "10px 14px" }}>
      <div style={{ fontSize: 11, color: "var(--muted)", textTransform: "uppercase", letterSpacing: 0.4 }}>{label}</div>
      <div style={{ fontSize: 20, fontWeight: 700, fontFamily: "var(--font-mono)", marginTop: 3, color: accent ? "var(--eclosion-dark)" : "var(--ink)" }}>{value}</div>
    </div>
  );
}

const inp: React.CSSProperties = { padding: "7px 10px", border: "1px solid var(--line)", borderRadius: 8, fontSize: 13 };
const tbl: React.CSSProperties = { width: "100%", borderCollapse: "collapse", fontSize: 13, minWidth: 720 };
const th: React.CSSProperties = { textAlign: "left", padding: "8px 10px", borderBottom: "2px solid var(--line)", color: "var(--muted)", fontSize: 12, fontWeight: 700 };
const thNum: React.CSSProperties = { ...th, textAlign: "right", fontFamily: "var(--font-mono)" };
const td: React.CSSProperties = { padding: "8px 10px", borderBottom: "1px solid var(--line)", color: "var(--ink)" };
const tdNum: React.CSSProperties = { ...td, textAlign: "right", fontFamily: "var(--font-mono)" };
const btnPrimary: React.CSSProperties = { border: "none", background: "var(--eclosion)", color: "#fff", borderRadius: 8, padding: "7px 12px", fontWeight: 700, fontSize: 13, cursor: "pointer" };
const btnGhost: React.CSSProperties = { border: "1px solid var(--line)", background: "#fff", color: "var(--ink)", borderRadius: 8, padding: "6px 11px", fontSize: 13, cursor: "pointer" };
