import { useEffect, useState } from "react";
import { listExpenses, validateExpense, type Expense } from "../api/client";
import { Card } from "./Card";
import { IconFinance } from "./icons";

// Contre-validation des DÉPENSES par le DG (palier 2, D-032/D-046) — présentée
// ICI, sur la page Direction générale (cockpit du DG), et pas seulement noyée
// dans la page Finance. À NE PAS confondre avec « Factures à valider
// (au-dessus du seuil) », qui autorise l'émission d'une facture : ici il s'agit
// des DÉPENSES engagées, validées par la DAF, que le DG doit contre-valider.
// Composant autonome (chargement + action propres), affichable même à vide.

const CATEGORY_LABELS: Record<string, string> = {
  impression: "Impression",
  prestation: "Prestation",
  fourniture: "Fourniture",
  transport: "Transport",
  loyer: "Loyer",
  salaire: "Salaire",
  marketing: "Marketing / communication",
  droits: "Droits",
  autre: "Autre",
};
const fmt = new Intl.NumberFormat("fr-FR", { style: "currency", currency: "XAF", maximumFractionDigits: 0 });

export function ExpensesToCounterValidate({ canCounterValidate, showWhenEmpty = false }: { canCounterValidate: boolean; showWhenEmpty?: boolean }) {
  const [items, setItems] = useState<Expense[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);

  function reload() {
    listExpenses()
      .then((r) => { setItems(r.filter((e) => e.status === "en_attente_dg")); setLoaded(true); })
      .catch(() => setLoaded(true));
  }
  useEffect(() => { reload(); }, []);

  async function counterValidate(exp: Expense) {
    setError(null);
    setMessage(null);
    try {
      await validateExpense(exp.id);
      setMessage(`Dépense de ${fmt.format(Number(exp.amount))} contre-validée.`);
      reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Contre-validation impossible.");
    }
  }

  if (!loaded && items.length === 0) return null;
  if (items.length === 0 && !showWhenEmpty) return null;

  return (
    <Card
      title={`Dépenses à contre-valider (Direction générale)${items.length ? ` — ${items.length}` : ""}`}
      icon={<IconFinance />}
      subtitle="Dépenses déjà validées par la DAF, en attente de VOTRE contre-validation (≠ « Factures à valider »)."
    >
      {error && <div style={{ background: "var(--alert-soft)", color: "var(--alert)", borderRadius: 8, padding: "8px 12px", fontSize: 13, marginBottom: 10 }}>{error}</div>}
      {message && <div style={{ background: "var(--eclosion-soft)", color: "var(--eclosion-dark)", borderRadius: 8, padding: "8px 12px", fontSize: 13, marginBottom: 10 }}>{message}</div>}
      {items.length === 0 ? (
        <p style={{ fontSize: 13.5, color: "var(--muted)", margin: 0 }}>Aucune dépense en attente de contre-validation.</p>
      ) : (
        <div style={{ display: "grid", gap: 8 }}>
          {items.map((exp) => (
            <div key={exp.id} style={row}>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontWeight: 600, color: "var(--ink)", fontSize: 14 }}>
                  {CATEGORY_LABELS[exp.category] ?? exp.category} · <span style={{ fontFamily: "var(--font-mono)" }}>{fmt.format(Number(exp.amount))}</span>
                </div>
                <div style={{ fontSize: 12.5, color: "var(--muted)", marginTop: 2 }}>
                  {exp.expenseDate?.slice(0, 10)}{exp.supplier ? ` · ${exp.supplier}` : ""}
                </div>
                {exp.description && <div style={{ fontSize: 12.5, color: "var(--muted)", marginTop: 2 }}>{exp.description}</div>}
              </div>
              <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
                {canCounterValidate ? (
                  <button onClick={() => counterValidate(exp)} style={btnGold}>Valider (DG)</button>
                ) : (
                  <span style={{ fontSize: 12, color: "var(--muted)", alignSelf: "center" }}>Réservé à la Direction générale</span>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

const row: React.CSSProperties = { display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, border: "1px solid var(--line)", borderLeft: "3px solid var(--eclosion, #D9B21A)", borderRadius: 8, padding: "9px 13px" };
const btnGold: React.CSSProperties = { border: "1px solid var(--eclosion, #D9B21A)", background: "var(--eclosion, #D9B21A)", color: "#0B0B0C", borderRadius: 8, padding: "8px 13px", fontWeight: 700, fontSize: 13, cursor: "pointer", flexShrink: 0 };
