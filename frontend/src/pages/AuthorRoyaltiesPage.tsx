import { Fragment, useEffect, useMemo, useState } from "react";
import {
  getAuthorRoyalties,
  getRoyaltyWithholdingEnabled,
  setRoyaltyWithholdingEnabled,
  getRoyaltyYearEndStatus,
  generateRoyaltyYearEnd,
  type AuthorRoyaltyResult,
  type RoyaltyYearEndStatus,
} from "../api/client";
import { Card } from "../components/Card";
import { DocPrintMenu } from "../components/DocPrintMenu";
import { printAuthorRoyaltyStatement } from "../lib/print";
import { useI18n } from "../i18n";

// État annuel des droits d'auteur PAR AUTEUR : tous les ouvrages d'un auteur sur
// une année, avec le taux par livre, et un récapitulatif fiscal (versé brut,
// retenue à la source, net). Chaque auteur s'imprime en un état annuel PDF.

const money = (n: number) => new Intl.NumberFormat("fr-FR", { style: "currency", currency: "XAF", maximumFractionDigits: 0 }).format(n);
const pct = (r: number) => `${(r * 100).toLocaleString("fr-FR", { maximumFractionDigits: 2 })} %`;

export function AuthorRoyaltiesPage({ canConfigure = false, canGenerate = false }: { canConfigure?: boolean; canGenerate?: boolean }) {
  const { t } = useI18n();
  const thisYear = useMemo(() => new Date().getFullYear(), []);
  const [year, setYear] = useState(thisYear);
  const [data, setData] = useState<AuthorRoyaltyResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [withholding, setWithholding] = useState<boolean | null>(null);
  const [yearEnd, setYearEnd] = useState<RoyaltyYearEndStatus | null>(null);
  const [genBusy, setGenBusy] = useState(false);
  const [open, setOpen] = useState<Set<string>>(new Set());
  const toggle = (k: string) =>
    setOpen((prev) => {
      const next = new Set(prev);
      next.has(k) ? next.delete(k) : next.add(k);
      return next;
    });

  async function load() {
    setLoading(true);
    setError(null);
    try {
      setData(await getAuthorRoyalties({ year }));
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
    getRoyaltyWithholdingEnabled()
      .then((r) => setWithholding(r.enabled))
      .catch(() => setWithholding(null));
    loadYearEnd();
  }, []);

  function loadYearEnd() {
    getRoyaltyYearEndStatus()
      .then(setYearEnd)
      .catch(() => setYearEnd(null));
  }

  async function generateYearEnd() {
    if (!yearEnd) return;
    setGenBusy(true);
    setError(null);
    setMessage(null);
    try {
      const r = await generateRoyaltyYearEnd(yearEnd.year);
      setMessage(t("roy.gen_done", `États de ${r.year} générés : ${r.statements_created} relevé(s) créé(s).`));
      loadYearEnd();
      if (year === yearEnd.year) load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Génération impossible.");
    } finally {
      setGenBusy(false);
    }
  }

  async function toggleWithholding(next: boolean) {
    setError(null);
    setMessage(null);
    setWithholding(next); // retour visuel immédiat
    try {
      const r = await setRoyaltyWithholdingEnabled(next);
      setWithholding(r.enabled);
      setMessage(
        r.enabled
          ? t("roy.wh_on_msg", "Retenue à la source activée : elle s'applique désormais aux nouveaux paiements et documents.")
          : t("roy.wh_off_msg", "Retenue à la source désactivée : elle n'entre plus dans les nouveaux paiements et documents."),
      );
    } catch (e) {
      setWithholding(!next); // annule en cas d'échec
      setError(e instanceof Error ? e.message : "Enregistrement impossible.");
    }
  }

  const years = useMemo(() => Array.from({ length: 6 }, (_, i) => thisYear - i), [thisYear]);

  return (
    <Card
      title={t("roy.title", "États annuels de droits d'auteur")}
      subtitle={t("roy.subtitle", "Par auteur, tous ses ouvrages sur l'année, avec le taux par livre et le récapitulatif fiscal.")}
    >
      <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "flex-end", marginBottom: 12 }}>
        <label style={{ fontSize: 12, color: "var(--muted)" }}>
          {t("roy.year", "Année")}
          <select value={year} onChange={(e) => setYear(Number(e.target.value))} style={{ ...inp, cursor: "pointer" }}>
            {years.map((y) => (
              <option key={y} value={y}>{y}</option>
            ))}
          </select>
        </label>
        <button onClick={load} disabled={loading} style={{ ...inp, cursor: "pointer", background: "var(--eclosion-soft)", border: "1px solid var(--eclosion)", color: "var(--eclosion-dark)", fontWeight: 700 }}>
          {loading ? t("common.loading", "Chargement…") : t("roy.refresh", "Actualiser")}
        </button>
      </div>

      {error && <div style={{ background: "var(--alert-soft)", color: "var(--alert)", borderRadius: 8, padding: "9px 13px", fontSize: 13, marginBottom: 12 }}>{error}</div>}
      {message && <div style={{ background: "var(--eclosion-soft)", color: "var(--eclosion-dark)", borderRadius: 8, padding: "9px 13px", fontSize: 13, marginBottom: 12 }}>{message}</div>}

      {/* Réglage de la retenue à la source (DAF) : cochée, elle entre dans les
          paiements et documents ; décochée, elle n'y figure pas. */}
      {withholding !== null && (
        <div style={{ display: "flex", alignItems: "center", gap: 10, background: "var(--eclosion-soft)", border: "1px solid var(--eclosion)", borderRadius: 10, padding: "10px 14px", marginBottom: 14, flexWrap: "wrap" }}>
          <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: canConfigure ? "pointer" : "default", fontSize: 13, fontWeight: 600, color: "var(--eclosion-dark)" }}>
            <input type="checkbox" checked={withholding} disabled={!canConfigure} onChange={(e) => toggleWithholding(e.target.checked)} style={{ width: 17, height: 17, cursor: canConfigure ? "pointer" : "default" }} />
            {t("roy.wh_label", "Appliquer la retenue à la source sur les droits d'auteur")}
          </label>
          <span style={{ fontSize: 11.5, color: "var(--muted)" }}>
            {canConfigure
              ? t("roy.wh_hint", "Décochez si la réglementation ne l'exige pas : la retenue n'entrera plus dans les nouveaux documents.")
              : t("roy.wh_readonly", "Réglage géré par la direction financière.")}
          </span>
        </div>
      )}

      {/* Génération de fin d'année : échéance (dernier jour ouvrable), état de
          génération, et déclenchement manuel (habilités). La génération auto se
          fait « à la connexion » côté serveur. */}
      {yearEnd && (
        <div style={{ display: "flex", gap: 12, alignItems: "center", background: yearEnd.is_generated ? "var(--eclosion-soft)" : "#fff", border: `1px solid ${yearEnd.is_generated ? "var(--eclosion)" : "var(--line)"}`, borderRadius: 10, padding: "10px 14px", marginBottom: 14, flexWrap: "wrap" }}>
          <div style={{ flex: 1, minWidth: 260 }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: "var(--eclosion-dark)" }}>
              {t("roy.ye_title", "Génération de fin d'année")} — {yearEnd.year}
            </div>
            <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 2 }}>
              {yearEnd.is_generated
                ? t("roy.ye_done", `États générés le ${yearEnd.generated_at ? new Date(yearEnd.generated_at).toLocaleDateString("fr-FR") : ""} (${yearEnd.statements_created ?? 0} relevé(s)).`)
                : t("roy.ye_pending", `Génération prévue au dernier jour ouvrable (${new Date(yearEnd.closure_date).toLocaleDateString("fr-FR")}) — automatique à la connexion d'un responsable. ${yearEnd.days_until_closure > 0 ? `Dans ${yearEnd.days_until_closure} jour(s).` : "Échéance atteinte."}`)}
            </div>
          </div>
          {canGenerate && !yearEnd.is_generated && (
            <button onClick={generateYearEnd} disabled={genBusy} style={{ padding: "8px 14px", cursor: "pointer", background: "var(--eclosion)", border: "1px solid var(--eclosion)", color: "#fff", borderRadius: 8, fontSize: 13, fontWeight: 700 }}>
              {genBusy ? t("roy.ye_gen_busy", "Génération…") : t("roy.ye_gen", "Générer maintenant")}
            </button>
          )}
        </div>
      )}

      {data && (
        <>
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "center", marginBottom: 16 }}>
            <Stat label={t("roy.earned_total", "Droits acquis (total)")} value={money(data.totals.earned)} accent />
            <Stat label={t("roy.paid_gross_total", "Versé brut (total)")} value={money(data.totals.paid_gross)} />
            <Stat label={t("roy.tax_total", "Retenue à la source (total)")} value={money(data.totals.tax_withheld)} />
            <Stat label={t("roy.net_total", "Net versé (total)")} value={money(data.totals.paid_net)} />
            <Stat label={t("roy.remaining_total", "Reste à verser (total)")} value={money(data.totals.remaining)} />
          </div>

          <div style={{ fontSize: 11.5, color: "var(--muted)", marginBottom: 8 }}>{t("roy.hint", "Cliquez sur un auteur pour voir le détail par ouvrage, puis imprimez son état annuel.")}</div>
          <div style={{ overflowX: "auto" }}>
            <table style={tbl}>
              <thead><tr>
                <th style={th}>{t("roy.author", "Auteur")}</th>
                <th style={thNum}>{t("roy.books", "Ouvrages")}</th>
                <th style={thNum}>{t("roy.earned", "Droits acquis")}</th>
                <th style={thNum}>{t("roy.net", "Net versé")}</th>
              </tr></thead>
              <tbody>
                {data.by_author.length === 0 && <tr><td colSpan={4} style={{ ...td, color: "var(--muted)", textAlign: "center" }}>{t("roy.empty", "Aucun droit d'auteur sur cette année.")}</td></tr>}
                {data.by_author.map((r) => {
                  const isOpen = open.has(r.partner_id);
                  return (
                    <Fragment key={r.partner_id}>
                      <tr onClick={() => toggle(r.partner_id)} style={{ cursor: "pointer", background: isOpen ? "var(--eclosion-soft, #f6efd8)" : undefined }}>
                        <td style={td}>
                          <span aria-hidden style={{ display: "inline-block", width: 14, color: "var(--eclosion-dark)", transition: "transform .15s", transform: isOpen ? "rotate(90deg)" : "none" }}>▸</span>
                          <span style={{ fontWeight: 600 }}>{r.author_name}</span>
                        </td>
                        <td style={tdNum}>{r.books.length}</td>
                        <td style={{ ...tdNum, fontWeight: 700, color: "var(--eclosion-dark)" }}>{money(r.earned)}</td>
                        <td style={tdNum}>{money(r.paid_net)}</td>
                      </tr>
                      {isOpen && (
                        <tr>
                          <td colSpan={4} style={{ padding: 0, borderBottom: "1px solid var(--line)" }}>
                            <div style={{ background: "var(--eclosion-soft, #f6efd8)", padding: "8px 10px 12px 26px" }}>
                              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, marginBottom: 4, flexWrap: "wrap" }}>
                                <div style={{ fontSize: 11, fontWeight: 700, color: "var(--eclosion-dark)", textTransform: "uppercase", letterSpacing: 0.4 }}>{t("roy.detail", "Détail par ouvrage")}</div>
                                <div onClick={(e) => e.stopPropagation()}>
                                  <DocPrintMenu label={t("roy.print", "Imprimer l'état annuel / PDF")} onPrint={(o) => printAuthorRoyaltyStatement({
                                    authorName: r.author_name,
                                    year: data.year,
                                    books: r.books.map((b) => ({ title: b.title, contractNumber: b.contract_number, units: b.units, base: b.base, rate: b.rate, earned: b.earned })),
                                    earned: r.earned,
                                    paidGross: r.paid_gross,
                                    taxWithheld: r.tax_withheld,
                                    paidNet: r.paid_net,
                                    remaining: r.remaining,
                                  }, o)} />
                                </div>
                              </div>
                              <table style={{ ...tbl, minWidth: 460 }}>
                                <thead><tr>
                                  <th style={thSub}>{t("roy.book", "Ouvrage")}</th>
                                  <th style={thSubNum}>{t("roy.units", "Exempl.")}</th>
                                  <th style={thSubNum}>{t("roy.base", "Assiette")}</th>
                                  <th style={thSubNum}>{t("roy.rate", "Taux")}</th>
                                  <th style={thSubNum}>{t("roy.earned", "Droits acquis")}</th>
                                </tr></thead>
                                <tbody>
                                  {r.books.map((b) => (
                                    <tr key={b.contract_id}>
                                      <td style={tdSub}>{b.title} <span style={{ color: "var(--muted)", fontFamily: "var(--font-mono)" }}>({b.contract_number})</span></td>
                                      <td style={tdSubNum}>{b.units}</td>
                                      <td style={tdSubNum}>{money(b.base)}</td>
                                      <td style={tdSubNum}>{pct(b.rate)}</td>
                                      <td style={{ ...tdSubNum, fontWeight: 700, color: "var(--eclosion-dark)" }}>{money(b.earned)}</td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                              <div style={{ display: "flex", gap: 18, flexWrap: "wrap", marginTop: 8, fontSize: 12, color: "var(--muted)" }}>
                                <span>{t("roy.paid_gross", "Versé brut")} : <b style={{ fontFamily: "var(--font-mono)", color: "var(--ink)" }}>{money(r.paid_gross)}</b></span>
                                <span>{t("roy.tax", "Retenue à la source")} : <b style={{ fontFamily: "var(--font-mono)", color: "var(--ink)" }}>{money(r.tax_withheld)}</b></span>
                                <span>{t("roy.net", "Net versé")} : <b style={{ fontFamily: "var(--font-mono)", color: "var(--ink)" }}>{money(r.paid_net)}</b></span>
                                <span>{t("roy.remaining", "Reste à verser")} : <b style={{ fontFamily: "var(--font-mono)", color: "var(--eclosion-dark)" }}>{money(r.remaining)}</b></span>
                              </div>
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
