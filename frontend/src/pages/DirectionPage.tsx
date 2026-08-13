import { useEffect, useState } from "react";
import {
  decideRecommendation,
  generateRecommendations,
  getDirectionDashboard,
  listAlerts,
  listRecommendations,
  searchGlobal,
  type Alert,
  type DirectionDashboard,
  type Manuscript,
  type Recommendation,
} from "../api/client";
import { DataTable } from "../components/DataTable";
import { BillingOrdersSection } from "../components/BillingOrdersSection";
import { InvoiceCancellationsToValidate } from "../components/InvoiceCancellationsToValidate";
import { EmittedInvoicesForCancellation } from "../components/EmittedInvoicesForCancellation";
import { RevenueByFamilyCard } from "../components/RevenueByFamilyCard";
import { AnnualSummarySection } from "../components/AnnualSummarySection";
import { Card } from "../components/Card";
import { GuidanceNote } from "../components/GuidanceNote";
import { Modal, Field } from "../components/Modal";
import { Button } from "../components/Button";
import { IconPilotage } from "../components/icons";

const PRIORITY_COLORS: Record<string, string> = {
  faible: "var(--muted)",
  moyenne: "var(--eclosion-dark)",
  elevee: "var(--amber)",
  critique: "var(--alert)",
};

interface DirectionPageProps {
  canTreatRecommendations: boolean;
  // Le DG peut initier une commande à facturer / proforma depuis sa rubrique.
  canInitiateOrder: boolean;
  // Le DG (ou l'administrateur général) valide les décisions de gouvernance
  // (annulation de facture) depuis sa propre page — permission pilotage:administration,
  // que la Finance ne détient pas (séparation des pouvoirs).
  canValidateCancellation: boolean;
  // Le DG (ou l'administrateur général) valide la paie mensuelle préparée par le
  // RH, depuis sa propre page (rôle DIR_GENERAL / ADMIN_GENERAL).
  canValidatePayrollDg: boolean;
}

// Ch. 5 : tableau de bord Direction générale consolidé, recherche globale,
// alertes automatiques et centre de pilotage intelligent (Ch. 5 §5.9).
import { useI18n } from "../i18n";
import { PayrollMonthlySection } from "../components/PayrollMonthlySection";

export function DirectionPage({ canTreatRecommendations, canInitiateOrder, canValidateCancellation, canValidatePayrollDg }: DirectionPageProps) {
  const { t, lang } = useI18n();
  const [dashboard, setDashboard] = useState<DirectionDashboard | null>(null);
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [recommendations, setRecommendations] = useState<Recommendation[]>([]);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Manuscript[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [decideFor, setDecideFor] = useState<{ recommendation: Recommendation; status: "treated" | "ignored" | "postponed"; comment: string } | null>(null);

  const refresh = async () => {
    const [dashboardData, alertList, recommendationList] = await Promise.all([
      getDirectionDashboard(),
      listAlerts(),
      listRecommendations({ status: "open" }),
    ]);
    setDashboard(dashboardData);
    setAlerts(alertList);
    setRecommendations(recommendationList);
  };

  useEffect(() => {
    refresh().catch((e) => setError(e.message));
  }, []);

  async function handleSearch(event: React.FormEvent) {
    event.preventDefault();
    if (!query.trim()) return;
    try {
      setResults(await searchGlobal(query));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Échec de la recherche.");
    }
  }

  async function handleGenerate() {
    try {
      const result = await generateRecommendations();
      setMessage(
        lang === "en"
          ? `${result.created} new recommendation(s) generated.`
          : `${result.created} nouvelle(s) recommandation(s) générée(s).`,
      );
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Échec de la génération.");
    }
  }

  async function submitDecision() {
    if (!decideFor) return;
    try {
      await decideRecommendation(decideFor.recommendation.id, decideFor.status, decideFor.comment || undefined);
      setMessage(t("dir.msg.reco_treated", "Recommandation traitée."));
      setDecideFor(null);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Échec du traitement.");
    }
  }

  const DECISION_LABELS = { treated: t("dir.treat", "Traiter"), postponed: t("dir.postpone", "Reporter"), ignored: t("dir.ignore", "Ignorer") } as const;

  return (
    <div className="ecl-page">
      <h1 className="ecl-page__title">{t("page.direction.title", "Direction générale")}</h1>
      <p className="ecl-page__lead">{t("page.direction.lead", "Vue consolidée, recherche globale, alertes et recommandations de pilotage.")}</p>

      <GuidanceNote title="Direction générale">
        Le poste de pilotage de la maison : tableau de bord consolidé (éditorial, production, commercial, financier),
        recherche globale, alertes et recommandations. Le DG peut aussi y initier une commande à facturer.
      </GuidanceNote>

      {error && <div style={bannerStyle("var(--alert-soft)", "var(--alert)")}>{error}</div>}
      {message && <div style={bannerStyle("var(--eclosion-soft)", "var(--eclosion)")}>{message}</div>}

      {/* Validation de la paie mensuelle par le DG, sur sa propre page : il choisit
          le mois, contrôle la grille préparée par le RH, puis « Valide le mois »
          (ou le retourne au RH). Sans quoi le DG ne voyait aucune fenêtre de
          validation de la paie. */}
      {canValidatePayrollDg && <PayrollMonthlySection canManage={false} canValidateDg collapsible defaultOpen={false} />}

      {/* Décision de gouvernance du DG : annulations de factures à valider —
          présentées ici, sur la page du DG, pas seulement côté Finance. */}
      {canValidateCancellation && <InvoiceCancellationsToValidate showWhenEmpty />}

      {/* Historique des factures émises + annulation directe (essai / erreur),
          réservé au DG / administrateur général — sur sa propre page (pilotage). */}
      {canValidateCancellation && <EmittedInvoicesForCancellation />}

      {/* Ch. 5 §5.1 — Tableau de bord consolidé */}
      <Card title={t("dir.dashboard", "Tableau de bord consolidé")} icon={<IconPilotage />} subtitle={t("dir.dashboard_sub", "Indicateurs clés par domaine.")}>
        {dashboard ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
            <DomainBlock title={t("dir.dom.editorial", "Éditorial")}>
              <TileRow>
                <StatTile label={t("dir.tile.manuscripts", "Manuscrits")} value={dashboard.editorial.total} />
                <StatTile label={t("dir.tile.active_statuses", "Statuts actifs")} value={dashboard.editorial.by_status.length} />
              </TileRow>
              <DataTable rows={dashboard.editorial.by_status.map(({ code: _code, ...rest }) => rest)} emptyLabel={t("dir.no_manuscript", "Aucun manuscrit.")} />
            </DomainBlock>

            <DomainBlock title={t("dir.dom.production", "Production")}>
              <TileRow>
                <StatTile label={t("dir.tile.projects_in_progress", "Projets en cours")} value={dashboard.production.projects_in_progress} />
                <StatTile label={t("dir.tile.tasks_done", "Tâches terminées")} value={dashboard.production.tasks_done} />
                <StatTile label={t("dir.tile.tasks_late", "Tâches en retard")} value={dashboard.production.tasks_late} tone={dashboard.production.tasks_late > 0 ? "late" : undefined} />
                <StatTile label={t("dir.tile.on_time_rate", "Respect des délais")} value={dashboard.production.on_time_rate_pct === null ? "—" : `${dashboard.production.on_time_rate_pct} %`} />
              </TileRow>
            </DomainBlock>

            <DomainBlock title={t("dir.dom.commercial", "Commercial")}>
              <TileRow>
                <StatTile label={t("dir.tile.units_sold", "Exemplaires vendus")} value={dashboard.commercial.units_sold} />
                <StatTile label={t("dir.tile.revenue", "Chiffre d'affaires")} value={dashboard.commercial.revenue_total} />
                <StatTile label={t("dir.tile.stock_outs", "Ruptures de stock")} value={dashboard.commercial.stock_outs} tone={dashboard.commercial.stock_outs > 0 ? "alert" : undefined} />
              </TileRow>
              <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 4 }}>{t("dir.best_sellers", "Meilleures ventes")}</div>
              <DataTable rows={dashboard.commercial.best_sellers} emptyLabel={t("dir.no_sale", "Aucune vente enregistrée.")} />
            </DomainBlock>

            <DomainBlock title={t("dir.dom.financial", "Financier")}>
              {dashboard.financial ? (
                <TileRow>
                  <StatTile label={t("dir.tile.production_cost", "Coût de production")} value={dashboard.financial.production_cost_total} />
                  <StatTile label={t("dir.tile.expenses_engaged", "Dépenses engagées")} value={dashboard.financial.expenses_engaged} />
                  <StatTile label={t("dir.tile.royalties_due", "Droits d'auteur dus")} value={dashboard.financial.royalties_due} />
                  <StatTile label={t("dir.tile.invoices_pending", "Factures en attente")} value={dashboard.financial.invoices_pending} />
                  <StatTile label={t("dir.tile.treasury", "Position de trésorerie")} value={dashboard.financial.treasury_position} tone={dashboard.financial.treasury_position < 0 ? "alert" : undefined} />
                </TileRow>
              ) : (
                <p style={{ color: "var(--muted)", fontSize: 13, margin: 0 }}>{t("dir.financial_restricted", "Réservé aux profils habilités (consultation financière).")}</p>
              )}
            </DomainBlock>
          </div>
        ) : (
          <p style={{ color: "var(--muted)", fontSize: 13 }}>{t("dir.loading", "Chargement…")}</p>
        )}
      </Card>

      {/* Chiffre d'affaires ventilé par famille (facturé HT/TTC, encaissé,
          créances). Visible par la Direction ; le composant se masque seul si
          l'API refuse l'accès. */}
      <RevenueByFamilyCard />

      {/* Bilan par année : chaque grand indicateur décliné par année (filtre
          d'année) + mouvement global. Ventes scolaires dissociées des ventes
          de livres simples. Réservé finance/direction (se masque si refus). */}
      <AnnualSummarySection />

      {/* Commandes à facturer : le DG peut initier une commande / proforma
          (ex. livre scolaire) depuis sa rubrique ; la Finance l'établit. */}
      {(canInitiateOrder || canValidateCancellation) && <BillingOrdersSection canCreate={canInitiateOrder} canInvoice={false} canValidateThreshold={canValidateCancellation} />}

      {/* Ch. 5 §5.4 — Recherche globale */}
      <Card title={t("dir.search", "Recherche globale")} icon={<IconPilotage />} subtitle={t("dir.search_sub", "Numéro, titre, contributeur, collection, ISBN.")}>
        <form onSubmit={handleSearch} style={{ display: "flex", gap: 10, alignItems: "flex-end" }}>
          <div className="ecl-field" style={{ flex: 1 }}>
            <input type="text" value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t("dir.search_ph", "Rechercher…")} />
          </div>
          <Button variant="view" size="sm" type="submit">{t("dir.search_btn", "Rechercher")}</Button>
        </form>
        {results.length > 0 && (
          <div className="ecl-list" style={{ marginTop: 12 }}>
            {results.map((manuscript) => (
              <div key={manuscript.id} className="ecl-row">
                <div className="ecl-row__main" style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                  <span className="ecl-row__title" style={{ fontFamily: "var(--font-mono)" }}>{manuscript.manuscriptNumber}</span>
                  <span className="ecl-row__desc" style={{ margin: 0 }}>{manuscript.title}</span>
                </div>
                <StatusChip label={manuscript.status.label} />
              </div>
            ))}
          </div>
        )}
      </Card>

      {/* Ch. 5 §5.6 — Alertes automatiques */}
      <Card title={t("dir.alerts", "Alertes automatiques")} icon={<IconPilotage />} subtitle={t("dir.alerts_sub", "Signaux nécessitant une attention.")}>
        {alerts.length === 0 ? (
          <Empty>{t("dir.no_alert", "Aucune alerte.")}</Empty>
        ) : (
          <div className="ecl-list">
            {alerts.map((alert, i) => (
              <div key={i} className="ecl-row">
                <span className="ecl-row__title" style={{ fontWeight: 500 }}>{alert.message}</span>
                <PriorityChip priority={alert.priority} />
              </div>
            ))}
          </div>
        )}
      </Card>

      {/* Ch. 5 §5.9 — Centre de pilotage intelligent */}
      <Card
        title={t("dir.pilot", "Centre de pilotage intelligent")}
        icon={<IconPilotage />}
        subtitle={t("dir.pilot_sub", "Recommandations générées à partir des indicateurs.")}
        action={<Button variant="add" size="sm" onClick={handleGenerate}>{t("dir.generate", "Générer")}</Button>}
      >
        {recommendations.length === 0 ? (
          <Empty>{t("dir.no_reco", "Aucune recommandation ouverte.")}</Empty>
        ) : (
          <div className="ecl-list">
            {recommendations.map((recommendation) => (
              <div key={recommendation.id} className="ecl-row" style={{ flexWrap: "wrap", gap: 8 }}>
                <div className="ecl-row__main" style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                  <PriorityChip priority={recommendation.priority} />
                  <span className="ecl-row__title" style={{ fontWeight: 500 }}>{recommendation.message}</span>
                </div>
                {canTreatRecommendations && (
                  <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
                    <Button variant="add" size="sm" onClick={() => setDecideFor({ recommendation, status: "treated", comment: "" })}>{t("dir.treat", "Traiter")}</Button>
                    <Button variant="view" size="sm" onClick={() => setDecideFor({ recommendation, status: "postponed", comment: "" })}>{t("dir.postpone", "Reporter")}</Button>
                    <Button variant="danger" size="sm" onClick={() => setDecideFor({ recommendation, status: "ignored", comment: "" })}>{t("dir.ignore", "Ignorer")}</Button>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </Card>

      {decideFor && (
        <Modal
          title={`${DECISION_LABELS[decideFor.status]} ${t("dir.decide_title", "la recommandation")}`}
          onClose={() => setDecideFor(null)}
          footer={
            <>
              <Button variant="view" size="sm" onClick={() => setDecideFor(null)}>{t("common.cancel", "Annuler")}</Button>
              <Button variant="add" size="sm" onClick={submitDecision}>{t("dir.confirm", "Confirmer")}</Button>
            </>
          }
        >
          <p style={{ margin: 0, fontSize: 13, color: "var(--muted)" }}>{decideFor.recommendation.message}</p>
          <Field label={t("dir.comment_optional", "Commentaire (optionnel)")}>
            <textarea rows={3} value={decideFor.comment} onChange={(e) => setDecideFor({ ...decideFor, comment: e.target.value })} autoFocus />
          </Field>
        </Modal>
      )}
    </div>
  );
}

function DomainBlock({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <div style={{ fontSize: 12, fontWeight: 700, color: "var(--eclosion-dark)", textTransform: "uppercase", letterSpacing: 0.4, marginBottom: 8 }}>{title}</div>
      {children}
    </div>
  );
}

function TileRow({ children }: { children: React.ReactNode }) {
  return <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>{children}</div>;
}

function StatTile({ label, value, tone }: { label: string; value: number | string; tone?: "late" | "alert" }) {
  const color = tone === "alert" ? "var(--alert)" : tone === "late" ? "var(--amber)" : "var(--ink)";
  const display = typeof value === "number" ? value.toLocaleString("fr-FR") : value;
  return (
    <div style={{ flex: "1 1 140px", minWidth: 140, border: "1px solid var(--line)", borderRadius: 10, padding: "12px 14px", background: "var(--paper)" }}>
      <div style={{ fontSize: 11, color: "var(--muted)", marginBottom: 4 }}>{label}</div>
      <div style={{ fontFamily: "var(--font-mono)", fontSize: 18, fontWeight: 700, color }}>{display}</div>
    </div>
  );
}

function PriorityChip({ priority }: { priority: string }) {
  const { t } = useI18n();
  const color = PRIORITY_COLORS[priority] ?? "var(--muted)";
  return (
    <span style={{ fontSize: 11, fontWeight: 700, color, border: `1px solid ${color}`, borderRadius: 999, padding: "1px 9px", whiteSpace: "nowrap", textTransform: "capitalize" }}>
      {t("prio." + priority, priority)}
    </span>
  );
}

function StatusChip({ label }: { label: string }) {
  return (
    <span style={{ fontSize: 11, fontWeight: 600, color: "var(--muted)", background: "var(--paper)", border: "1px solid var(--line)", borderRadius: 999, padding: "2px 9px", whiteSpace: "nowrap" }}>
      {label}
    </span>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <p style={{ color: "var(--muted)", fontSize: 13, margin: 0 }}>{children}</p>;
}

function bannerStyle(bg: string, color: string): React.CSSProperties {
  return { background: bg, color, borderRadius: 8, padding: "9px 13px", fontSize: 13, marginTop: 12 };
}
