import { useEffect, useState } from "react";
import { getRevenueByFamily, type RevenueByFamily } from "../api/client";
import { Card } from "./Card";
import { IconFinance } from "./icons";
import { useI18n } from "../i18n";

// Montant à chasse fixe, séparateurs de milliers + devise (guide de style).
function money(value: number): string {
  return `${new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 0 }).format(Math.round(value))} XAF`;
}
function Money({ value, color }: { value: number; color?: string }) {
  return <span style={{ fontFamily: "var(--font-mono)", color }}>{money(value)}</span>;
}

// Bloc « chiffre d'affaires » mis en avant (total facturé HT/TTC, encaissé, créances).
function CaTotal({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div style={{ flex: "1 1 150px", minWidth: 150, border: "1px solid var(--line)", borderRadius: 8, padding: "10px 14px" }}>
      <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 4 }}>{label}</div>
      <div style={{ fontSize: 19, fontWeight: 700, fontFamily: "var(--font-mono)", color }}>{money(value)}</div>
    </div>
  );
}

// Chiffre d'affaires ventilé par famille (facturé HT & TTC, encaissé, créances +
// total). Se charge lui-même ; réutilisé sur la page Finance et le tableau de
// bord de la Direction. La donnée est réservée (finance ou direction) côté API :
// si l'accès est refusé, le bloc ne s'affiche pas.
export function RevenueByFamilyCard() {
  const { t } = useI18n();
  const [data, setData] = useState<RevenueByFamily | null>(null);

  useEffect(() => {
    getRevenueByFamily().then(setData).catch(() => setData(null));
  }, []);

  if (!data) return null;

  return (
    <Card
      title={t("fin.ca_families", "Chiffre d'affaires par famille")}
      icon={<IconFinance />}
      subtitle={t("fin.ca_families_sub", "Facturé (HT et TTC), encaissé et créances (vente à crédit). Facturé TTC = encaissé + créances.")}
    >
      <div style={{ display: "flex", flexWrap: "wrap", gap: 12, marginBottom: 16 }}>
        <CaTotal label={t("fin.ca_total_facture_ht", "CA total facturé (HT)")} value={data.total.factureHt} color="var(--ink)" />
        <CaTotal label={t("fin.ca_total_facture", "CA total facturé (TTC)")} value={data.total.facture} color="var(--ink)" />
        <CaTotal label={t("fin.ca_total_encaisse", "Encaissé (TTC)")} value={data.total.encaisse} color="var(--eclosion)" />
        <CaTotal label={t("fin.ca_total_creances", "Créances (à encaisser)")} value={data.total.creances} color="var(--amber)" />
      </div>
      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13.5 }}>
          <thead>
            <tr style={{ textAlign: "left", color: "var(--muted)", borderBottom: "1px solid var(--line)" }}>
              <th style={{ padding: "6px 8px" }}>{t("fin.ca_family", "Famille")}</th>
              <th style={{ padding: "6px 8px", textAlign: "right" }}>{t("fin.ca_facture_ht", "Facturé HT")}</th>
              <th style={{ padding: "6px 8px", textAlign: "right" }}>{t("fin.ca_facture", "Facturé TTC")}</th>
              <th style={{ padding: "6px 8px", textAlign: "right" }}>{t("fin.ca_encaisse", "Encaissé")}</th>
              <th style={{ padding: "6px 8px", textAlign: "right" }}>{t("fin.ca_creances", "Créances")}</th>
            </tr>
          </thead>
          <tbody>
            {data.families.map((f) => (
              <tr key={f.key} style={{ borderBottom: "1px solid var(--line)" }}>
                <td style={{ padding: "8px" }}>{f.label}</td>
                <td style={{ padding: "8px", textAlign: "right", fontFamily: "var(--font-mono)", color: "var(--muted)" }}><Money value={f.factureHt} /></td>
                <td style={{ padding: "8px", textAlign: "right", fontFamily: "var(--font-mono)" }}><Money value={f.facture} /></td>
                <td style={{ padding: "8px", textAlign: "right", fontFamily: "var(--font-mono)", color: "var(--eclosion)" }}><Money value={f.encaisse} /></td>
                <td style={{ padding: "8px", textAlign: "right", fontFamily: "var(--font-mono)", color: f.creances > 0 ? "var(--amber)" : "var(--muted)" }}><Money value={f.creances} /></td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr style={{ fontWeight: 700, borderTop: "2px solid var(--line)" }}>
              <td style={{ padding: "8px" }}>{t("fin.ca_total", "Total")}</td>
              <td style={{ padding: "8px", textAlign: "right", fontFamily: "var(--font-mono)", color: "var(--muted)" }}><Money value={data.total.factureHt} /></td>
              <td style={{ padding: "8px", textAlign: "right", fontFamily: "var(--font-mono)" }}><Money value={data.total.facture} /></td>
              <td style={{ padding: "8px", textAlign: "right", fontFamily: "var(--font-mono)", color: "var(--eclosion)" }}><Money value={data.total.encaisse} /></td>
              <td style={{ padding: "8px", textAlign: "right", fontFamily: "var(--font-mono)", color: data.total.creances > 0 ? "var(--amber)" : "var(--muted)" }}><Money value={data.total.creances} /></td>
            </tr>
          </tfoot>
        </table>
      </div>
    </Card>
  );
}
