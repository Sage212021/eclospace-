import { Fragment, useEffect, useMemo, useState } from "react";
import { getCommissions, setCommissionRate as apiSetRate, type CommissionResult, type CommissionGranularity } from "../api/client";
import { Card } from "../components/Card";
import { DocPrintMenu } from "../components/DocPrintMenu";
import { printCommissionStatement } from "../lib/print";
import { useI18n } from "../i18n";

// Commissions commerciales : 10 % (paramétrable par la DAF) du montant vendu,
// par commercial, avec rapports semaine / mois / semestre / année.

const money = (n: number) => new Intl.NumberFormat("fr-FR", { style: "currency", currency: "XAF", maximumFractionDigits: 0 }).format(n);
function isoDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function frDate(iso: string): string {
  const [y, m, day] = iso.split("-");
  return y && m && day ? `${day}/${m}/${y}` : iso;
}

const GRANULARITIES: { key: CommissionGranularity; label: string }[] = [
  { key: "week", label: "Semaine" },
  { key: "month", label: "Mois" },
  { key: "semester", label: "Semestre" },
  { key: "year", label: "Année" },
];

export function CommissionsPage({ canSetRate }: { canSetRate: boolean }) {
  const { t } = useI18n();
  const today = useMemo(() => new Date(), []);
  const [from, setFrom] = useState(isoDate(new Date(today.getFullYear(), 0, 1)));
  const [to, setTo] = useState(isoDate(today));
  const [granularity, setGranularity] = useState<CommissionGranularity>("month");
  const [data, setData] = useState<CommissionResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [rateDraft, setRateDraft] = useState("");
  const [openAgents, setOpenAgents] = useState<Set<string>>(new Set());
  const toggleAgent = (k: string) =>
    setOpenAgents((prev) => {
      const next = new Set(prev);
      next.has(k) ? next.delete(k) : next.add(k);
      return next;
    });

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const d = await getCommissions({ from: from || undefined, to: to ? `${to}T23:59:59.999Z` : undefined, granularity });
      setData(d);
      setRateDraft(String(Math.round(d.rate * 1000) / 10)); // en %
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

  async function saveRate() {
    const pct = Number(rateDraft.replace(",", "."));
    if (!Number.isFinite(pct) || pct <= 0 || pct > 100) {
      setError(t("comm.err_rate", "Le taux doit être compris entre 0 et 100 %."));
      return;
    }
    setError(null);
    setMessage(null);
    try {
      await apiSetRate(pct / 100);
      setMessage(t("comm.saved", "Taux de commission enregistré."));
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Enregistrement impossible.");
    }
  }

  return (
    <Card
      title={t("comm.title", "Commissions commerciales")}
      subtitle={t("comm.subtitle", "Commission par commercial sur le montant vendu — par semaine, mois, semestre ou année.")}
    >
      {/* Filtres */}
      <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "flex-end", marginBottom: 12 }}>
        <label style={{ fontSize: 12, color: "var(--muted)" }}>{t("comm.from", "Du")}<input type="date" value={from} onChange={(e) => setFrom(e.target.value)} style={inp} /></label>
        <label style={{ fontSize: 12, color: "var(--muted)" }}>{t("comm.to", "Au")}<input type="date" value={to} onChange={(e) => setTo(e.target.value)} style={inp} /></label>
        <div style={{ display: "inline-flex", border: "1px solid var(--line)", borderRadius: 8, overflow: "hidden" }}>
          {GRANULARITIES.map((g) => (
            <button key={g.key} onClick={() => setGranularity(g.key)} style={{ border: "none", padding: "8px 12px", fontSize: 13, fontWeight: 600, cursor: "pointer", background: granularity === g.key ? "var(--eclosion, #C89A1B)" : "transparent", color: granularity === g.key ? "#fff" : "var(--muted)" }}>
              {g.label}
            </button>
          ))}
        </div>
        <button onClick={load} disabled={loading} style={{ ...inp, cursor: "pointer", background: "var(--eclosion-soft)", border: "1px solid var(--eclosion)", color: "var(--eclosion-dark)", fontWeight: 700 }}>
          {loading ? t("common.loading", "Chargement…") : t("comm.refresh", "Actualiser")}
        </button>
      </div>

      {error && <div style={{ background: "var(--alert-soft)", color: "var(--alert)", borderRadius: 8, padding: "9px 13px", fontSize: 13, marginBottom: 12 }}>{error}</div>}
      {message && <div style={{ background: "var(--eclosion-soft)", color: "var(--eclosion-dark)", borderRadius: 8, padding: "9px 13px", fontSize: 13, marginBottom: 12 }}>{message}</div>}

      {data && (
        <>
          {/* Taux + totaux */}
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "center", marginBottom: 16 }}>
            <div style={{ background: "var(--eclosion-soft)", border: "1px solid var(--eclosion)", borderRadius: 10, padding: "10px 14px" }}>
              <div style={{ fontSize: 11, color: "var(--eclosion-dark)", textTransform: "uppercase", letterSpacing: 0.4 }}>{t("comm.rate", "Taux appliqué")}</div>
              {canSetRate ? (
                <div style={{ display: "flex", gap: 6, alignItems: "center", marginTop: 4 }}>
                  <input value={rateDraft} onChange={(e) => setRateDraft(e.target.value)} style={{ width: 56, padding: "4px 6px", border: "1px solid var(--line)", borderRadius: 6, fontFamily: "var(--font-mono)", fontSize: 15, textAlign: "right" }} /> %
                  <button onClick={saveRate} style={{ marginLeft: 6, padding: "5px 10px", border: "1px solid var(--eclosion)", background: "var(--eclosion)", color: "#fff", borderRadius: 6, fontSize: 12, fontWeight: 700, cursor: "pointer" }}>{t("comm.save", "Enregistrer")}</button>
                </div>
              ) : (
                <div style={{ fontSize: 20, fontWeight: 700, fontFamily: "var(--font-mono)", color: "var(--eclosion-dark)", marginTop: 3 }}>{Math.round(data.rate * 1000) / 10} %</div>
              )}
            </div>
            <Stat label={t("comm.units_total", "Exemplaires vendus (total)")} value={new Intl.NumberFormat("fr-FR").format(data.totals.units)} />
            <Stat label={t("comm.sold", "Montant vendu (total)")} value={money(data.totals.amount)} />
            <Stat label={t("comm.commission_total", "Commission due (total)")} value={money(data.totals.commission)} accent />
          </div>

          {/* Par commercial — chaque ligne se déplie pour montrer le détail par
              ouvrage (ce qui justifie le total du commercial). */}
          <div style={{ fontSize: 13, fontWeight: 700, color: "var(--eclosion-dark)", margin: "6px 0 4px" }}>{t("comm.by_agent", "Par commercial")}</div>
          <div style={{ fontSize: 11.5, color: "var(--muted)", marginBottom: 8 }}>{t("comm.hint", "Cliquez sur un commercial pour voir le détail par ouvrage.")}</div>
          <div style={{ overflowX: "auto" }}>
            <table style={tbl}>
              <thead><tr>
                <th style={th}>{t("comm.agent", "Commercial")}</th>
                <th style={thNum}>{t("comm.units", "Exempl. vendus")}</th>
                <th style={thNum}>{t("comm.amount", "Montant vendu")}</th>
                <th style={thNum}>{t("comm.commission", "Commission")}</th>
              </tr></thead>
              <tbody>
                {data.by_agent.length === 0 && <tr><td colSpan={4} style={{ ...td, color: "var(--muted)", textAlign: "center" }}>{t("comm.empty", "Aucune vente sur cette période.")}</td></tr>}
                {data.by_agent.map((r) => {
                  const k = r.agent_id ?? "none";
                  const isOpen = openAgents.has(k);
                  return (
                    <Fragment key={k}>
                      <tr onClick={() => toggleAgent(k)} style={{ cursor: "pointer", background: isOpen ? "var(--eclosion-soft, #f6efd8)" : undefined }}>
                        <td style={td}>
                          <span aria-hidden style={{ display: "inline-block", width: 14, color: "var(--eclosion-dark)", transition: "transform .15s", transform: isOpen ? "rotate(90deg)" : "none" }}>▸</span>
                          <span style={{ fontWeight: 600 }}>{r.agent_name}</span>
                        </td>
                        <td style={tdNum}>{r.units}</td>
                        <td style={tdNum}>{money(r.amount)}</td>
                        <td style={{ ...tdNum, fontWeight: 700, color: "var(--eclosion-dark)" }}>{money(r.commission)}</td>
                      </tr>
                      {isOpen && (
                        <tr>
                          <td colSpan={4} style={{ padding: 0, borderBottom: "1px solid var(--line)" }}>
                            <div style={{ background: "var(--eclosion-soft, #f6efd8)", padding: "8px 10px 10px 26px" }}>
                              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, marginBottom: 4, flexWrap: "wrap" }}>
                                <div style={{ fontSize: 11, fontWeight: 700, color: "var(--eclosion-dark)", textTransform: "uppercase", letterSpacing: 0.4 }}>{t("comm.detail", "Détail par ouvrage")}</div>
                                <div onClick={(e) => e.stopPropagation()}>
                                  <DocPrintMenu label={t("comm.print", "Imprimer l'état / PDF")} onPrint={(o) => printCommissionStatement({
                                    agentName: r.agent_name,
                                    periodLabel: `${GRANULARITIES.find((g) => g.key === granularity)?.label ?? ""} — du ${frDate(from)} au ${frDate(to)}`,
                                    ratePct: Math.round(data.rate * 1000) / 10,
                                    books: r.books.map((bk) => ({ title: bk.title, units: bk.units, amount: bk.amount, commission: bk.commission })),
                                    totals: { units: r.units, amount: r.amount, commission: r.commission },
                                  }, o)} />
                                </div>
                              </div>
                              <table style={{ ...tbl, minWidth: 420 }}>
                                <thead><tr>
                                  <th style={thSub}>{t("comm.book", "Ouvrage")}</th>
                                  <th style={thSubNum}>{t("comm.units", "Exempl.")}</th>
                                  <th style={thSubNum}>{t("comm.amount", "Montant")}</th>
                                  <th style={thSubNum}>{t("comm.commission", "Commission")}</th>
                                </tr></thead>
                                <tbody>
                                  {r.books.map((bk) => (
                                    <tr key={bk.isbn_id}>
                                      <td style={tdSub}>{bk.title}</td>
                                      <td style={tdSubNum}>{bk.units}</td>
                                      <td style={tdSubNum}>{money(bk.amount)}</td>
                                      <td style={{ ...tdSubNum, fontWeight: 700, color: "var(--eclosion-dark)" }}>{money(bk.commission)}</td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </div>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Par période */}
          <div style={{ fontSize: 13, fontWeight: 700, color: "var(--eclosion-dark)", margin: "18px 0 8px" }}>{t("comm.by_period", "Par période")} ({GRANULARITIES.find((g) => g.key === granularity)?.label})</div>
          <div style={{ overflowX: "auto" }}>
            <table style={tbl}>
              <thead><tr>
                <th style={th}>{t("comm.period", "Période")}</th>
                <th style={thNum}>{t("comm.units", "Exempl.")}</th>
                <th style={thNum}>{t("comm.amount", "Montant")}</th>
                <th style={thNum}>{t("comm.commission", "Commission")}</th>
              </tr></thead>
              <tbody>
                {data.by_period.map((r) => (
                  <tr key={r.period}>
                    <td style={td}>{r.period}</td>
                    <td style={tdNum}>{r.units}</td>
                    <td style={tdNum}>{money(r.amount)}</td>
                    <td style={{ ...tdNum, fontWeight: 700, color: "var(--eclosion-dark)" }}>{money(r.commission)}</td>
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

const inp: React.CSSProperties = { display: "block", marginTop: 4, padding: "7px 10px", border: "1px solid var(--line)", borderRadius: 8, fontSize: 13 };
const tbl: React.CSSProperties = { width: "100%", borderCollapse: "collapse", fontSize: 13, minWidth: 460 };
const th: React.CSSProperties = { textAlign: "left", padding: "8px 10px", borderBottom: "2px solid var(--line)", color: "var(--muted)", fontSize: 12, fontWeight: 700 };
const thNum: React.CSSProperties = { ...th, textAlign: "right", fontFamily: "var(--font-mono)" };
const td: React.CSSProperties = { padding: "8px 10px", borderBottom: "1px solid var(--line)", color: "var(--ink)" };
const tdNum: React.CSSProperties = { ...td, textAlign: "right", fontFamily: "var(--font-mono)" };
const thSub: React.CSSProperties = { textAlign: "left", padding: "5px 8px", borderBottom: "1px solid var(--line)", color: "var(--muted)", fontSize: 11, fontWeight: 700 };
const thSubNum: React.CSSProperties = { ...thSub, textAlign: "right", fontFamily: "var(--font-mono)" };
const tdSub: React.CSSProperties = { padding: "5px 8px", borderBottom: "1px solid var(--line)", color: "var(--ink)", fontSize: 12.5 };
const tdSubNum: React.CSSProperties = { ...tdSub, textAlign: "right", fontFamily: "var(--font-mono)" };
