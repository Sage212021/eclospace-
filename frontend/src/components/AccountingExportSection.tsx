import { useEffect, useState } from "react";
import { createAccountingExport, listAccountingExports, type AccountingExport } from "../api/client";
import { Card } from "./Card";
import { Field } from "./Modal";
import { Button } from "./Button";
import { IconFinance } from "./icons";
import { useI18n } from "../i18n";

// Export comptable pour le cabinet externe (Ch. 18 §18.10-18.11, décision D-006 :
// la comptabilité est tenue à l'extérieur). Un mois = un fichier CSV normalisé
// (factures, encaissements, dépenses) avec comptes SYSCOHADA, prêt à importer
// dans Sage / Odoo / Excel. Contrôle d'exhaustivité : nombre de lignes + empreinte.

function currentPeriod(): string {
  const d = new Date();
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

function downloadCsv(name: string, csv: string) {
  // Le serveur renvoie déjà le CSV mis en forme ; on ajoute un BOM pour que les
  // accents s'affichent correctement à l'ouverture dans Excel.
  const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

export function AccountingExportSection({ canAdminister }: { canAdminister: boolean }) {
  const { t, lang } = useI18n();
  const [period, setPeriod] = useState(currentPeriod());
  const [history, setHistory] = useState<AccountingExport[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  async function loadHistory() {
    try {
      setHistory(await listAccountingExports());
    } catch {
      /* la liste reste vide si la lecture échoue — non bloquant */
    }
  }

  useEffect(() => {
    loadHistory();
  }, []);

  async function generate() {
    if (!/^\d{4}-\d{2}$/.test(period)) {
      setError(t("acc.err_period", "Indiquez la période au format AAAA-MM (ex. 2026-07)."));
      return;
    }
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const result = await createAccountingExport(period);
      downloadCsv(`export-comptable_${period}.csv`, result.csv);
      setMessage(
        t(
          "acc.done",
          `Export du ${period} généré : ${result.lineCount} écriture(s). Fichier téléchargé. Empreinte de contrôle : ${result.checksum.slice(0, 12)}…`,
        ),
      );
      await loadHistory();
    } catch (e) {
      setError(e instanceof Error ? e.message : t("acc.err", "Génération impossible."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card
      title={t("acc.title", "Export comptable")}
      icon={<IconFinance />}
      subtitle={t("acc.sub", "Un mois d'écritures (factures, encaissements, dépenses) en un fichier pour le cabinet comptable.")}
    >
      {error && <div style={banner("var(--alert-soft)", "var(--alert)")}>{error}</div>}
      {message && <div style={banner("var(--eclosion-soft)", "var(--eclosion-dark)")}>{message}</div>}

      {!canAdminister ? (
        <p style={{ fontSize: 13, color: "var(--muted)" }}>
          {t("acc.no_right", "La génération de l'export comptable est réservée à la direction financière.")}
        </p>
      ) : (
        <>
          <div style={{ display: "flex", gap: 12, alignItems: "flex-end", flexWrap: "wrap" }}>
            <Field label={t("acc.period", "Période (AAAA-MM)")}>
              <input value={period} onChange={(e) => setPeriod(e.target.value)} placeholder="2026-07" style={{ fontFamily: "var(--font-mono, monospace)" }} />
            </Field>
            <Button variant="export" size="sm" type="button" disabled={busy} onClick={generate}>
              {busy ? t("acc.generating", "Génération…") : t("acc.generate", "Générer et télécharger (CSV)")}
            </Button>
          </div>

          <p style={{ fontSize: 12, color: "var(--muted)", marginTop: 10, lineHeight: 1.6 }}>
            {t(
              "acc.note",
              "Le fichier CSV s'ouvre dans Excel ou s'importe dans Sage / Odoo. ⚠️ Les numéros de compte suivent le plan SYSCOHADA à titre indicatif et doivent être validés par votre comptable avant tout dépôt fiscal.",
            )}
          </p>

          {history.length > 0 && (
            <>
              <div style={{ fontSize: 13, fontWeight: 700, color: "var(--eclosion-dark)", margin: "16px 0 6px" }}>
                {t("acc.history", "Exports déjà générés")}
              </div>
              <div style={{ overflowX: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                  <thead>
                    <tr>
                      <th style={th}>{t("acc.h_period", "Période")}</th>
                      <th style={thNum}>{t("acc.h_lines", "Écritures")}</th>
                      <th style={th}>{t("acc.h_date", "Généré le")}</th>
                      <th style={th}>{t("acc.h_checksum", "Empreinte")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {history.map((x) => (
                      <tr key={x.id}>
                        <td style={{ ...td, fontFamily: "var(--font-mono)" }}>{x.periodKey}</td>
                        <td style={tdNum}>{x.lineCount}</td>
                        <td style={td}>{new Date(x.createdAt).toLocaleString(lang === "en" ? "en-GB" : "fr-FR")}</td>
                        <td style={{ ...td, fontFamily: "var(--font-mono)", color: "var(--muted)" }}>{x.checksum.slice(0, 12)}…</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </>
      )}
    </Card>
  );
}

function banner(bg: string, fg: string): React.CSSProperties {
  return { background: bg, color: fg, borderRadius: 8, padding: "9px 13px", fontSize: 13, marginBottom: 12 };
}
const th: React.CSSProperties = { textAlign: "left", padding: "8px 10px", borderBottom: "2px solid var(--line)", color: "var(--muted)", fontSize: 12, fontWeight: 700 };
const thNum: React.CSSProperties = { ...th, textAlign: "right", fontFamily: "var(--font-mono)" };
const td: React.CSSProperties = { padding: "8px 10px", borderBottom: "1px solid var(--line)", color: "var(--ink)" };
const tdNum: React.CSSProperties = { ...td, textAlign: "right", fontFamily: "var(--font-mono)" };
