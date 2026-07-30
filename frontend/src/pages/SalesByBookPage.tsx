import { useEffect, useMemo, useState } from "react";
import { getSalesByBook, type SalesTrackingResult } from "../api/client";
import { Card } from "../components/Card";
import { GuidanceNote } from "../components/GuidanceNote";
import { useI18n } from "../i18n";

// Suivi des ventes par ouvrage : sorties du stock vs ventes réelles (montant
// encaissé) et écart (GAP), avec découpage semaine/mois. Pour la direction, la
// finance et le commercial.

const money = (n: number) => new Intl.NumberFormat("fr-FR", { style: "currency", currency: "XAF", maximumFractionDigits: 0 }).format(n);

function isoDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function SalesByBookPage() {
  const { t } = useI18n();
  const today = useMemo(() => new Date(), []);
  const [from, setFrom] = useState(isoDate(new Date(today.getFullYear(), 0, 1)));
  const [to, setTo] = useState(isoDate(today));
  const [granularity, setGranularity] = useState<"week" | "month">("month");
  const [data, setData] = useState<SalesTrackingResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      setData(await getSalesByBook({ from: from || undefined, to: to ? `${to}T23:59:59.999Z` : undefined, granularity }));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Chargement impossible.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [granularity]);

  const gapColor = (gap: number) => (gap > 0 ? "var(--amber, #c4661f)" : "var(--muted)");

  return (
    <Card
      title={t("sbb.title", "Suivi des ventes par ouvrage")}
      subtitle={t("sbb.subtitle", "Exemplaires sortis, ventes réelles et écart — par ouvrage, par semaine ou par mois.")}
    >
      <GuidanceNote title="Suivi des ventes par ouvrage">
        Comparez, pour chaque ouvrage, les exemplaires <strong>sortis du stock</strong> aux <strong>ventes réellement
        enregistrées</strong> : l'écart révèle les sorties non vendues (exemplaires gratuits, dépôt-vente non converti).
      </GuidanceNote>
      {/* Filtres */}
      <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "flex-end", marginBottom: 14 }}>
        <label style={{ fontSize: 12, color: "var(--muted)" }}>
          {t("sbb.from", "Du")}
          <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} style={inp} />
        </label>
        <label style={{ fontSize: 12, color: "var(--muted)" }}>
          {t("sbb.to", "Au")}
          <input type="date" value={to} onChange={(e) => setTo(e.target.value)} style={inp} />
        </label>
        <div style={{ display: "inline-flex", border: "1px solid var(--line)", borderRadius: 8, overflow: "hidden" }}>
          {(["month", "week"] as const).map((g) => (
            <button
              key={g}
              onClick={() => setGranularity(g)}
              style={{
                border: "none",
                padding: "8px 14px",
                fontSize: 13,
                fontWeight: 600,
                cursor: "pointer",
                background: granularity === g ? "var(--eclosion, #C89A1B)" : "transparent",
                color: granularity === g ? "#fff" : "var(--muted)",
              }}
            >
              {g === "month" ? t("sbb.month", "Par mois") : t("sbb.week", "Par semaine")}
            </button>
          ))}
        </div>
        <button onClick={load} disabled={loading} style={{ ...inp, cursor: "pointer", background: "var(--eclosion-soft)", border: "1px solid var(--eclosion)", color: "var(--eclosion-dark)", fontWeight: 700 }}>
          {loading ? t("common.loading", "Chargement…") : t("sbb.refresh", "Actualiser")}
        </button>
      </div>

      {error && <div style={{ background: "var(--alert-soft)", color: "var(--alert)", borderRadius: 8, padding: "9px 13px", fontSize: 13, marginBottom: 12 }}>{error}</div>}

      {data && (
        <>
          {/* Totaux */}
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 16 }}>
            <Stat label={t("sbb.units_out", "Exemplaires sortis")} value={String(data.totals.units_out)} />
            <Stat label={t("sbb.units_sold", "Exemplaires vendus")} value={String(data.totals.units_sold)} />
            <Stat label={t("sbb.amount", "Montant encaissé")} value={money(data.totals.amount)} accent />
            <Stat label={t("sbb.gap", "Écart (non vendus)")} value={String(data.totals.gap)} warn={data.totals.gap > 0} />
          </div>

          {/* Par ouvrage */}
          <div style={{ fontSize: 13, fontWeight: 700, color: "var(--eclosion-dark)", margin: "6px 0 8px" }}>{t("sbb.by_book", "Par ouvrage")}</div>
          <div style={{ overflowX: "auto" }}>
            <table style={tbl}>
              <thead>
                <tr>
                  <th style={th}>{t("sbb.book", "Ouvrage")}</th>
                  <th style={thNum}>{t("sbb.units_out", "Sortis")}</th>
                  <th style={thNum}>{t("sbb.units_sold", "Vendus")}</th>
                  <th style={thNum}>{t("sbb.amount", "Montant")}</th>
                  <th style={thNum}>{t("sbb.gap", "Écart")}</th>
                </tr>
              </thead>
              <tbody>
                {data.by_book.length === 0 && (
                  <tr><td colSpan={5} style={{ ...td, color: "var(--muted)", textAlign: "center" }}>{t("sbb.empty", "Aucun mouvement sur cette période.")}</td></tr>
                )}
                {data.by_book.map((r) => (
                  <tr key={r.key}>
                    <td style={td}>{r.label}</td>
                    <td style={tdNum}>{r.units_out}</td>
                    <td style={tdNum}>{r.units_sold}</td>
                    <td style={tdNum}>{money(r.amount)}</td>
                    <td style={{ ...tdNum, color: gapColor(r.gap), fontWeight: r.gap > 0 ? 700 : 400 }}>{r.gap}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Par période */}
          <div style={{ fontSize: 13, fontWeight: 700, color: "var(--eclosion-dark)", margin: "18px 0 8px" }}>
            {granularity === "month" ? t("sbb.by_month", "Par mois") : t("sbb.by_week", "Par semaine")}
          </div>
          <div style={{ overflowX: "auto" }}>
            <table style={tbl}>
              <thead>
                <tr>
                  <th style={th}>{t("sbb.period", "Période")}</th>
                  <th style={thNum}>{t("sbb.units_out", "Sortis")}</th>
                  <th style={thNum}>{t("sbb.units_sold", "Vendus")}</th>
                  <th style={thNum}>{t("sbb.amount", "Montant")}</th>
                  <th style={thNum}>{t("sbb.gap", "Écart")}</th>
                </tr>
              </thead>
              <tbody>
                {data.by_period.map((r) => (
                  <tr key={r.key}>
                    <td style={td}>{r.label}</td>
                    <td style={tdNum}>{r.units_out}</td>
                    <td style={tdNum}>{r.units_sold}</td>
                    <td style={tdNum}>{money(r.amount)}</td>
                    <td style={{ ...tdNum, color: gapColor(r.gap), fontWeight: r.gap > 0 ? 700 : 400 }}>{r.gap}</td>
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

function Stat({ label, value, accent, warn }: { label: string; value: string; accent?: boolean; warn?: boolean }) {
  return (
    <div style={{ flex: "1 1 140px", minWidth: 130, background: "var(--card)", border: "1px solid var(--line)", borderRadius: 10, padding: "10px 12px" }}>
      <div style={{ fontSize: 11, color: "var(--muted)", textTransform: "uppercase", letterSpacing: 0.4 }}>{label}</div>
      <div style={{ fontSize: 20, fontWeight: 700, fontFamily: "var(--font-mono)", marginTop: 3, color: warn ? "var(--amber, #c4661f)" : accent ? "var(--eclosion-dark)" : "var(--ink)" }}>{value}</div>
    </div>
  );
}

const inp: React.CSSProperties = { display: "block", marginTop: 4, padding: "7px 10px", border: "1px solid var(--line)", borderRadius: 8, fontSize: 13 };
const tbl: React.CSSProperties = { width: "100%", borderCollapse: "collapse", fontSize: 13, minWidth: 480 };
const th: React.CSSProperties = { textAlign: "left", padding: "8px 10px", borderBottom: "2px solid var(--line)", color: "var(--muted)", fontSize: 12, fontWeight: 700 };
const thNum: React.CSSProperties = { ...th, textAlign: "right", fontFamily: "var(--font-mono)" };
const td: React.CSSProperties = { padding: "8px 10px", borderBottom: "1px solid var(--line)", color: "var(--ink)" };
const tdNum: React.CSSProperties = { ...td, textAlign: "right", fontFamily: "var(--font-mono)" };
