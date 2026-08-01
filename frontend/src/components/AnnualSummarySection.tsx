import { useEffect, useState } from "react";
import { getAnnualSummary, type AnnualSummary } from "../api/client";
import { Card } from "./Card";
import { IconPilotage } from "./icons";
import { useI18n } from "../i18n";

// Montant à chasse fixe, séparateurs de milliers + devise (guide de style).
function money(value: number): string {
  return `${new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 0 }).format(Math.round(value))} XAF`;
}
function num(value: number): string {
  return new Intl.NumberFormat("fr-FR").format(value);
}

// Bilan par année : chaque grand indicateur décliné pour l'année choisie, plus
// le mouvement global (tendance annuelle + cumul tout-temps). Les ventes de
// livre SCOLAIRE (canal « commande à facturer ») sont dissociées des ventes de
// livre SIMPLE/général (sorties de stock). Donnée réservée (finance ou
// direction) côté API : si l'accès est refusé, le bloc ne s'affiche pas.
export function AnnualSummarySection() {
  const { t } = useI18n();
  const [data, setData] = useState<AnnualSummary | null>(null);
  const [year, setYear] = useState<number | undefined>(undefined);
  const [loading, setLoading] = useState(false);
  const [denied, setDenied] = useState(false);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    getAnnualSummary(year)
      .then((d) => { if (alive) { setData(d); setDenied(false); } })
      .catch(() => { if (alive) setDenied(true); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [year]);

  if (denied) return null;
  if (!data) {
    return (
      <Card title={t("annual.title", "Bilan par année")} icon={<IconPilotage />}>
        <p style={{ color: "var(--muted)", fontSize: 13, margin: 0 }}>{t("dir.loading", "Chargement…")}</p>
      </Card>
    );
  }

  const fam = (key: string) => data.ca.families.find((f) => f.key === key);
  const scolaire = fam("livre_scolaire");
  const general = fam("livre_general");
  const communication = fam("livre_general") && fam("communication");
  const g = data.global;
  const maxBar = Math.max(1, ...g.per_year.map((p) => p.ca_facture));

  return (
    <Card
      title={t("annual.title", "Bilan par année")}
      icon={<IconPilotage />}
      subtitle={t("annual.sub", "Chaque grand indicateur décliné par année, et le mouvement global de la maison.")}
      action={
        <select
          value={data.year}
          onChange={(e) => setYear(Number(e.target.value))}
          disabled={loading}
          style={{
            fontFamily: "var(--font-mono)", fontSize: 14, fontWeight: 700, color: "var(--eclosion-dark)",
            background: "var(--paper)", border: "1px solid var(--line)", borderRadius: 8, padding: "6px 10px", cursor: "pointer",
          }}
          aria-label={t("annual.year", "Année")}
        >
          {data.years.map((y) => <option key={y} value={y}>{y}</option>)}
        </select>
      }
    >
      {/* ── Chiffre d'affaires : le scolaire dissocié du général ── */}
      <SectionLabel>{t("annual.ca", "Chiffre d'affaires facturé")} · {data.year}</SectionLabel>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 12, marginBottom: 8 }}>
        <FamilyCard
          label={t("annual.ca_scolaire", "Livre scolaire")}
          tag={t("annual.tag_scolaire", "Manuels")}
          tagColor="var(--eclosion)"
          facture={scolaire?.facture ?? 0}
          encaisse={scolaire?.encaisse ?? 0}
          creances={scolaire?.creances ?? 0}
          accent="var(--eclosion)"
        />
        <FamilyCard
          label={t("annual.ca_general", "Livre simple / général")}
          tag={t("annual.tag_general", "Catalogue")}
          tagColor="var(--navy)"
          facture={general?.facture ?? 0}
          encaisse={general?.encaisse ?? 0}
          creances={general?.creances ?? 0}
          accent="var(--navy)"
        />
      </div>
      {/* Autres familles (communication, prestations) — repli discret. */}
      <div style={{ display: "flex", flexWrap: "wrap", gap: 10, marginBottom: 18 }}>
        {data.ca.families.filter((f) => f.key !== "livre_scolaire" && f.key !== "livre_general" && f.facture > 0).map((f) => (
          <div key={f.key} style={{ flex: "1 1 200px", minWidth: 180, border: "1px dashed var(--line)", borderRadius: 8, padding: "8px 12px" }}>
            <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 2 }}>{f.label}</div>
            <div style={{ fontFamily: "var(--font-mono)", fontSize: 15, fontWeight: 700 }}>{money(f.facture)}</div>
          </div>
        ))}
        {communication && data.ca.total.facture > 0 && (
          <div style={{ flex: "1 1 200px", minWidth: 180, border: "1px solid var(--eclosion)", borderRadius: 8, padding: "8px 12px", background: "var(--eclosion-soft)" }}>
            <div style={{ fontSize: 12, color: "var(--eclosion-dark)", marginBottom: 2 }}>{t("annual.ca_total", "Total facturé")} {data.year}</div>
            <div style={{ fontFamily: "var(--font-mono)", fontSize: 16, fontWeight: 800, color: "var(--eclosion-dark)" }}>{money(data.ca.total.facture)}</div>
          </div>
        )}
      </div>

      {/* ── Indicateurs annuels ── */}
      <SectionLabel>{t("annual.activity", "Activité")} · {data.year}</SectionLabel>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 12, marginBottom: 18 }}>
        <MetricTile label={t("annual.units_scolaire", "Exemplaires scolaires facturés")} value={num(data.exemplaires.scolaire)} accent="var(--eclosion)" />
        <MetricTile label={t("annual.units_simple", "Exemplaires simples vendus")} value={num(data.exemplaires.simple)} accent="var(--navy)" />
        <MetricTile label={t("annual.published", "Ouvrages parus")} value={num(data.ouvrages_parus)} accent="var(--navy)" />
        <MetricTile label={t("annual.royalties", "Droits d'auteur versés")} value={money(data.droits_verses)} accent="var(--amber)" mono />
      </div>

      {/* ── Mouvement global : tendance annuelle + cumul tout-temps ── */}
      <div style={{ borderTop: "1px solid var(--line)", paddingTop: 16, marginTop: 4 }}>
        <SectionLabel>{t("annual.global", "Mouvement global de la maison")}</SectionLabel>

        {/* Cumul tout-temps */}
        <div style={{ display: "flex", flexWrap: "wrap", gap: 12, marginBottom: 16 }}>
          <CumulTile label={t("annual.cumul_facture", "CA facturé (cumul)")} value={money(g.total.ca_facture)} color="var(--ink)" />
          <CumulTile label={t("annual.cumul_encaisse", "Encaissé (cumul)")} value={money(g.total.ca_encaisse)} color="var(--eclosion)" />
          <CumulTile label={t("annual.cumul_parus", "Ouvrages parus (cumul)")} value={num(g.total.ouvrages_parus)} color="var(--ink)" />
          <CumulTile label={t("annual.cumul_scolaire", "Exempl. scolaires (cumul)")} value={num(g.total.exemplaires_scolaire)} color="var(--eclosion)" />
          <CumulTile label={t("annual.cumul_simple", "Exempl. simples (cumul)")} value={num(g.total.exemplaires_simple)} color="var(--navy)" />
          <CumulTile label={t("annual.cumul_droits", "Droits versés (cumul)")} value={money(g.total.droits_verses)} color="var(--amber)" />
        </div>

        {/* Tendance annuelle du CA facturé (barres) */}
        <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 8 }}>{t("annual.trend", "Chiffre d'affaires facturé par année (part encaissée en foncé)")}</div>
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {g.per_year.map((p) => {
            const w = (p.ca_facture / maxBar) * 100;
            const encPct = p.ca_facture > 0 ? (p.ca_encaisse / p.ca_facture) * 100 : 0;
            const active = p.year === data.year;
            return (
              <button
                key={p.year}
                onClick={() => setYear(p.year)}
                title={`${t("annual.published", "Ouvrages parus")} : ${num(p.ouvrages_parus)}`}
                style={{
                  display: "grid", gridTemplateColumns: "56px 1fr auto", alignItems: "center", gap: 10,
                  background: active ? "var(--eclosion-soft)" : "transparent", border: "none", borderRadius: 8,
                  padding: "4px 8px", cursor: "pointer", textAlign: "left", width: "100%",
                }}
              >
                <span style={{ fontFamily: "var(--font-mono)", fontWeight: active ? 800 : 600, color: active ? "var(--eclosion-dark)" : "var(--ink)" }}>{p.year}</span>
                <span style={{ position: "relative", height: 18, background: "var(--paper)", border: "1px solid var(--line)", borderRadius: 5, overflow: "hidden" }}>
                  <span style={{ position: "absolute", inset: 0, width: `${w}%`, background: "var(--eclosion)", opacity: 0.28, borderRadius: 4 }} />
                  <span style={{ position: "absolute", inset: 0, width: `${w * encPct / 100}%`, background: "var(--eclosion)", borderRadius: 4 }} />
                </span>
                <span style={{ fontFamily: "var(--font-mono)", fontSize: 12.5, color: "var(--muted)", whiteSpace: "nowrap" }}>{money(p.ca_facture)}</span>
              </button>
            );
          })}
        </div>
      </div>
    </Card>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return <div style={{ fontSize: 12, fontWeight: 700, color: "var(--eclosion-dark)", textTransform: "uppercase", letterSpacing: 0.4, marginBottom: 8 }}>{children}</div>;
}

function FamilyCard({ label, tag, tagColor, facture, encaisse, creances, accent }: { label: string; tag: string; tagColor: string; facture: number; encaisse: number; creances: number; accent: string }) {
  const { t } = useI18n();
  return (
    <div style={{ flex: "1 1 260px", minWidth: 240, border: "1px solid var(--line)", borderRadius: 10, padding: "14px 16px", borderLeft: `4px solid ${accent}`, background: "var(--paper)" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8, gap: 8 }}>
        <span style={{ fontSize: 13.5, fontWeight: 700, color: "var(--ink)" }}>{label}</span>
        <span style={{ fontSize: 10.5, fontWeight: 700, color: tagColor, border: `1px solid ${tagColor}`, borderRadius: 999, padding: "1px 8px", whiteSpace: "nowrap" }}>{tag}</span>
      </div>
      <div style={{ fontFamily: "var(--font-mono)", fontSize: 22, fontWeight: 800, color: "var(--ink)", marginBottom: 6 }}>{money(facture)}</div>
      <div style={{ display: "flex", gap: 14, fontSize: 12 }}>
        <span style={{ color: "var(--muted)" }}>{t("annual.encaisse", "Encaissé")} <b style={{ fontFamily: "var(--font-mono)", color: "var(--eclosion)" }}>{money(encaisse)}</b></span>
        <span style={{ color: "var(--muted)" }}>{t("annual.creances", "Créances")} <b style={{ fontFamily: "var(--font-mono)", color: creances > 0 ? "var(--amber)" : "var(--muted)" }}>{money(creances)}</b></span>
      </div>
    </div>
  );
}

function MetricTile({ label, value, accent, mono }: { label: string; value: string; accent: string; mono?: boolean }) {
  return (
    <div style={{ flex: "1 1 160px", minWidth: 150, border: "1px solid var(--line)", borderRadius: 10, padding: "12px 14px", background: "var(--paper)", borderTop: `3px solid ${accent}` }}>
      <div style={{ fontSize: 11, color: "var(--muted)", marginBottom: 4 }}>{label}</div>
      <div style={{ fontFamily: "var(--font-mono)", fontSize: mono ? 17 : 20, fontWeight: 800, color: "var(--ink)" }}>{value}</div>
    </div>
  );
}

function CumulTile({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div style={{ flex: "1 1 150px", minWidth: 140, border: "1px solid var(--line)", borderRadius: 8, padding: "9px 12px" }}>
      <div style={{ fontSize: 11, color: "var(--muted)", marginBottom: 3 }}>{label}</div>
      <div style={{ fontFamily: "var(--font-mono)", fontSize: 15, fontWeight: 700, color }}>{value}</div>
    </div>
  );
}
