import { useEffect, useState } from "react";
import { getBookLife, type BookLife } from "../api/client";
import { CollapsibleSection } from "./CollapsibleSection";

// « Vie du livre » (D-074) : tableau de bord d'EXPLOITATION d'un titre — de sa
// sortie à aujourd'hui. Consolide fabrication, stock, ventes, retours, prix et
// remises à l'auteur (données existantes). Lecture seule, dépliable à la demande.

const ECO_LABEL: Record<string, string> = {
  compte_editeur: "Compte d'éditeur",
  compte_auteur: "Compte d'auteur",
  compte_demi: "Compte à demi",
  autre: "Autre",
};

function fmt(n: number): string {
  return n.toLocaleString("fr-FR");
}

function dateFr(iso: string): string {
  const d = new Date(iso);
  return isNaN(d.getTime()) ? "" : d.toLocaleDateString("fr-FR", { day: "2-digit", month: "short", year: "numeric" });
}

const EVENT_ICON: Record<string, string> = {
  publication: "📖",
  print_run: "🖨",
  reception: "📦",
  stock_entry: "🏷",
  author_handover: "✍",
  first_sale: "🛒",
  royalty_statement: "📄",
  royalty_payment: "💰",
};

// Montant FCFA + équivalent euros (parité fixe 655,957).
function money(n: number, currency: string): string {
  const cur = currency === "XAF" ? "FCFA" : currency;
  const eur = (n / 655.957).toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return `${fmt(n)} ${cur} · ${eur} €`;
}

function Tile({ value, label, color }: { value: string | number; label: string; color?: string }) {
  return (
    <div style={{ background: "var(--paper, #FAF8F2)", border: "1px solid var(--line)", borderRadius: 10, padding: "10px 12px", minWidth: 110 }}>
      <div style={{ fontSize: 22, fontWeight: 800, fontFamily: "var(--font-mono, ui-monospace, monospace)", color: color ?? "var(--ink)", lineHeight: 1.1 }}>{value}</div>
      <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 3 }}>{label}</div>
    </div>
  );
}

function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ marginTop: 12 }}>
      <div style={{ fontSize: 11.5, fontWeight: 800, textTransform: "uppercase", letterSpacing: 0.4, color: "var(--eclosion-dark, #9a7a12)", marginBottom: 7 }}>{title}</div>
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>{children}</div>
    </div>
  );
}

export function BookLifeSection({ manuscriptId }: { manuscriptId: string }) {
  // Le corps n'est monté qu'à l'ouverture de la section (CollapsibleSection ne
  // rend ses enfants que lorsqu'elle est dépliée) : la requête ne part donc qu'à
  // la première ouverture de « Vie du livre ».
  return (
    <CollapsibleSection title="Vie du livre" storageKey={`fiche:book-life:${manuscriptId}`}>
      <BookLifeContent manuscriptId={manuscriptId} />
    </CollapsibleSection>
  );
}

function BookLifeContent({ manuscriptId }: { manuscriptId: string }) {
  const [data, setData] = useState<BookLife | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    getBookLife(manuscriptId)
      .then((d) => { if (alive) { setData(d); setErr(null); } })
      .catch((e) => { if (alive) setErr(e instanceof Error ? e.message : "Chargement impossible."); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [manuscriptId]);

  return (
    <>
      <p style={{ fontSize: 12.5, color: "var(--muted)", margin: "0 0 4px" }}>
        Le parcours de l'ouvrage, de sa sortie à aujourd'hui : fabrication, tirages & réimpressions, stock, ventes, droits d'auteur et historique.
      </p>
      {loading && <div style={{ fontSize: 13, color: "var(--muted)" }}>Chargement…</div>}
      {err && <div style={{ background: "#F6E2DE", color: "#B23A2E", borderRadius: 8, padding: "9px 12px", fontSize: 12.5 }}>{err}</div>}
      {data && (
        <div>
          <div style={{ fontSize: 12.5, color: "var(--muted)", display: "flex", gap: 12, flexWrap: "wrap" }}>
            {data.isbn13 && <span>ISBN <b style={{ fontFamily: "var(--font-mono)", color: "var(--ink)" }}>{data.isbn13}</b></span>}
            {data.economic_model && <span>Modèle <b style={{ color: "var(--ink)" }}>{ECO_LABEL[data.economic_model] ?? data.economic_model}</b></span>}
            {data.price && <span>Prix <b style={{ color: "var(--ink)" }}>{money(data.price.amount, data.price.currency)}</b></span>}
          </div>

          <Group title="Fabrication">
            <Tile value={fmt(data.fabrication.print_runs)} label="tirage(s) / bon(s)" />
            <Tile value={fmt(data.fabrication.received)} label="exemplaires reçus" />
            <Tile value={fmt(data.fabrication.conform)} label="conformes" color="#2F7D4A" />
            <Tile value={fmt(data.fabrication.defective)} label="défectueux" color={data.fabrication.defective > 0 ? "#B23A2E" : undefined} />
            {data.fabrication.handed_to_author > 0 && <Tile value={fmt(data.fabrication.handed_to_author)} label="remis à l'auteur" />}
          </Group>

          <Group title="Stock">
            <Tile value={fmt(data.stock.vendable)} label="vendable" color="#2F7D4A" />
            <Tile value={fmt(data.stock.declasse)} label="déclassé" color={data.stock.declasse > 0 ? "#B87400" : undefined} />
            <Tile value={fmt(data.stock.total)} label="total en stock" />
          </Group>

          <Group title="Ventes & diffusion">
            <Tile value={fmt(data.sales.pos_quantity)} label="vendus (point de vente)" />
            <Tile value={fmt(data.sales.pos_revenue)} label="CA point de vente (FCFA)" color="#2F7D4A" />
            <Tile value={fmt(data.sales.delivered_quantity)} label="livrés (commandes)" />
            <Tile value={fmt(data.sales.returns_quantity)} label="retours" color={data.sales.returns_quantity > 0 ? "#B87400" : undefined} />
            {data.author_copies > 0 && <Tile value={fmt(data.author_copies)} label="exemplaires d'auteur" />}
          </Group>

          {data.reprints.length > 0 && (
            <div style={{ marginTop: 12 }}>
              <div style={{ fontSize: 11.5, fontWeight: 800, textTransform: "uppercase", letterSpacing: 0.4, color: "var(--eclosion-dark, #9a7a12)", marginBottom: 7 }}>Tirages & réimpressions</div>
              <div style={{ display: "grid", gap: 6 }}>
                {data.reprints.map((r) => (
                  <div key={r.po_number} style={{ border: "1px solid var(--line)", borderRadius: 8, padding: "7px 10px", display: "flex", gap: 10, alignItems: "baseline", flexWrap: "wrap", background: r.number === 1 ? "var(--paper, #FAF8F2)" : "#fff" }}>
                    <span style={{ fontSize: 13, fontWeight: 700, color: "var(--ink)", minWidth: 120 }}>{r.label}</span>
                    <span style={{ fontSize: 13, fontFamily: "var(--font-mono)", color: "var(--ink)" }}>{fmt(r.quantity)} ex.</span>
                    <span style={{ fontSize: 11.5, color: "var(--muted)" }}>{dateFr(r.date)}{r.printer ? ` · ${r.printer}` : ""} · bon {r.po_number}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          <Group title="Droits d'auteur">
            {data.royalties.has_contract ? (
              <>
                <Tile value={fmt(data.royalties.earned)} label="droits acquis (FCFA)" />
                <Tile value={fmt(data.royalties.paid)} label="versés (FCFA)" color="#2F7D4A" />
                <Tile value={fmt(data.royalties.balance_due)} label="reste dû (FCFA)" color={data.royalties.balance_due > 0 ? "#B87400" : "#2F7D4A"} />
                <Tile value={fmt(data.royalties.statements)} label="relevé(s)" />
              </>
            ) : (
              <p style={{ fontSize: 12.5, color: "var(--muted)", margin: 0 }}>Aucun contrat de droits rattaché à cet ouvrage (ex. compte d'auteur, ou contrat non encore enregistré).</p>
            )}
          </Group>

          {data.events.length > 0 && (
            <div style={{ marginTop: 14 }}>
              <div style={{ fontSize: 11.5, fontWeight: 800, textTransform: "uppercase", letterSpacing: 0.4, color: "var(--eclosion-dark, #9a7a12)", marginBottom: 7 }}>Historique</div>
              <div style={{ display: "grid", gap: 2, borderLeft: "2px solid var(--line)", paddingLeft: 12 }}>
                {data.events.map((e, i) => (
                  <div key={i} style={{ display: "flex", gap: 8, alignItems: "baseline", padding: "4px 0", fontSize: 12.5 }}>
                    <span style={{ width: 86, flexShrink: 0, color: "var(--muted)", fontFamily: "var(--font-mono)", fontSize: 11.5 }}>{dateFr(e.date)}</span>
                    <span style={{ flexShrink: 0 }}>{EVENT_ICON[e.type] ?? "•"}</span>
                    <span style={{ color: "var(--ink)" }}>
                      <b style={{ fontWeight: 600 }}>{e.label}</b>
                      {e.detail ? <span style={{ color: "var(--muted)" }}> — {e.detail}</span> : null}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          <p style={{ fontSize: 11, color: "var(--muted)", margin: "12px 0 0", fontStyle: "italic" }}>
            Données consolidées en temps réel à partir de la fabrication, du stock, des ventes et des droits d'auteur déjà enregistrés.
          </p>
        </div>
      )}
    </>
  );
}
