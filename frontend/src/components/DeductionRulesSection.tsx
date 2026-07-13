import { useEffect, useState } from "react";
import {
  createDeductionRule,
  listDeductionRules,
  type DeductionMethod,
  type DeductionRule,
} from "../api/client";
import { Card } from "./Card";
import { Field } from "./Modal";
import { Button } from "./Button";
import { IconAdmin } from "./icons";
import { useI18n } from "../i18n";

// RH → Paramètres → Règles de retenues (§21-22). Affiche la règle en vigueur
// et l'historique ; l'administrateur RH crée une nouvelle version (les
// anciennes sont conservées). Montants en FCFA.

const METHOD_LABELS: Record<DeductionMethod, string> = {
  prorata: "Prorata exact",
  round_half_hour: "Arrondi à la demi-heure supérieure",
  round_hour: "Arrondi à l'heure supérieure",
  custom: "Personnalisée (tarif à la minute)",
};

function fcfa(n: number | null): string {
  if (n == null) return "—";
  return `${n.toLocaleString("fr-FR")} FCFA`;
}

export function DeductionRulesSection({ canAdminister }: { canAdminister: boolean }) {
  const { t } = useI18n();
  const methodLabel = (m: DeductionMethod) => t("att.method." + m, METHOD_LABELS[m]);
  const [rules, setRules] = useState<DeductionRule[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({
    per_half_hour: "500",
    per_hour: "1000",
    daily_cap: "",
    monthly_cap: "",
    method: "prorata" as DeductionMethod,
    label: "",
  });

  async function refresh() {
    try {
      setRules(await listDeductionRules());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Chargement des règles impossible.");
    }
  }

  useEffect(() => {
    refresh();
  }, []);

  async function save() {
    try {
      await createDeductionRule({
        per_half_hour: Number(form.per_half_hour),
        per_hour: Number(form.per_hour),
        daily_cap: form.daily_cap ? Number(form.daily_cap) : undefined,
        monthly_cap: form.monthly_cap ? Number(form.monthly_cap) : undefined,
        method: form.method,
        label: form.label.trim() || undefined,
      });
      setShowForm(false);
      setMessage(t("att.msg.rule_saved", "Nouvelle règle enregistrée (les anciennes sont conservées)."));
      setError(null);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Enregistrement impossible.");
    }
  }

  const current = rules[0] ?? null;

  return (
    <Card
      title={t("att.rules", "Règles de retenues")}
      icon={<IconAdmin />}
      subtitle={t("att.rules_sub", "Barème appliqué aux retards, départs anticipés et absences injustifiées — versionné.")}
      action={canAdminister ? <Button variant="add" size="sm" onClick={() => setShowForm((s) => !s)}>{showForm ? t("att.close", "Fermer") : t("att.new_version", "Nouvelle version")}</Button> : undefined}
    >
      {current ? (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 22, marginBottom: 6 }}>
          <div><div style={{ fontSize: 12, color: "var(--muted)" }}>{t("att.half_hour", "Demi-heure")}</div><div style={{ fontFamily: "var(--font-mono, monospace)", fontSize: 16, fontWeight: 700 }}>{fcfa(current.per_half_hour)}</div></div>
          <div><div style={{ fontSize: 12, color: "var(--muted)" }}>{t("att.hour", "Heure")}</div><div style={{ fontFamily: "var(--font-mono, monospace)", fontSize: 16, fontWeight: 700 }}>{fcfa(current.per_hour)}</div></div>
          <div><div style={{ fontSize: 12, color: "var(--muted)" }}>{t("att.cap_day", "Plafond / jour")}</div><div style={{ fontFamily: "var(--font-mono, monospace)", fontSize: 16 }}>{fcfa(current.daily_cap)}</div></div>
          <div><div style={{ fontSize: 12, color: "var(--muted)" }}>{t("att.cap_month", "Plafond / mois")}</div><div style={{ fontFamily: "var(--font-mono, monospace)", fontSize: 16 }}>{fcfa(current.monthly_cap)}</div></div>
          <div><div style={{ fontSize: 12, color: "var(--muted)" }}>{t("att.method", "Méthode")}</div><div style={{ fontSize: 14, fontWeight: 600 }}>{methodLabel(current.method)}</div></div>
        </div>
      ) : (
        <p style={{ color: "var(--muted)", fontSize: 13, margin: 0 }}>{t("att.no_rule", "Aucune règle enregistrée.")}</p>
      )}

      {canAdminister && showForm && (
        <div style={{ marginTop: 12, borderTop: "1px solid var(--line)", paddingTop: 12 }}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 10 }}>
            <Field label={t("att.ded_half_hour_field", "Retenue / demi-heure (FCFA)")}><input type="number" min={0} value={form.per_half_hour} onChange={(e) => setForm({ ...form, per_half_hour: e.target.value })} /></Field>
            <Field label={t("att.ded_hour_field", "Retenue / heure (FCFA)")}><input type="number" min={0} value={form.per_hour} onChange={(e) => setForm({ ...form, per_hour: e.target.value })} /></Field>
            <Field label={t("att.cap_day_field", "Plafond / jour (FCFA, optionnel)")}><input type="number" min={0} value={form.daily_cap} onChange={(e) => setForm({ ...form, daily_cap: e.target.value })} /></Field>
            <Field label={t("att.cap_month_field", "Plafond / mois (FCFA, optionnel)")}><input type="number" min={0} value={form.monthly_cap} onChange={(e) => setForm({ ...form, monthly_cap: e.target.value })} /></Field>
            <Field label={t("att.method_field", "Méthode de calcul")}>
              <select value={form.method} onChange={(e) => setForm({ ...form, method: e.target.value as DeductionMethod })}>
                {Object.entries(METHOD_LABELS).map(([v, l]) => <option key={v} value={v}>{t("att.method." + v, l)}</option>)}
              </select>
            </Field>
            <Field label={t("att.label_opt", "Libellé (optionnel)")}><input value={form.label} onChange={(e) => setForm({ ...form, label: e.target.value })} placeholder={t("att.rule_ph", "Ex : Barème 2026")} /></Field>
          </div>
          <div style={{ marginTop: 10 }}>
            <Button variant="add" size="sm" type="button" onClick={save}>{t("att.save_version", "Enregistrer la version")}</Button>
          </div>
        </div>
      )}

      {rules.length > 1 && (
        <details style={{ marginTop: 12 }}>
          <summary style={{ cursor: "pointer", fontSize: 13, color: "var(--muted)" }}>{t("att.history", "Historique des versions")} ({rules.length})</summary>
          <ul style={{ margin: "8px 0 0", paddingLeft: 18, fontSize: 13 }}>
            {rules.map((r) => (
              <li key={r.id} style={{ opacity: r.active ? 1 : 0.6 }}>
                <span style={{ fontFamily: "var(--font-mono, monospace)" }}>{r.effective_from.slice(0, 10)}</span> — {fcfa(r.per_half_hour)}{t("att.per_half_h", "/demi-h")}, {fcfa(r.per_hour)}{t("att.per_h", "/h")} · {methodLabel(r.method)}{r.label ? ` · ${r.label}` : ""}{r.active ? "" : t("att.inactive", " (inactive)")}
              </li>
            ))}
          </ul>
        </details>
      )}

      {message && <div style={{ background: "var(--gold-soft, #f6efdc)", color: "var(--ink)", borderRadius: 8, padding: "8px 12px", fontSize: 13, marginTop: 12 }}>{message}</div>}
      {error && <div style={{ background: "#f8e3df", color: "var(--danger, #C24B3A)", borderRadius: 8, padding: "8px 12px", fontSize: 13, marginTop: 12 }}>{error}</div>}
    </Card>
  );
}
