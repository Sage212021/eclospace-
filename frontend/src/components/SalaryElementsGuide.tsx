import { useEffect, useState } from "react";
import { getSalaryElements, updateSalaryElement, type SalaryElement, type SalaryElementsConfig } from "../api/client";
import { Card } from "./Card";

// Guide fiscal & CNPS des éléments de salaire (Niveau 1) — référentiel issu de
// la « Procédure fiscale de traitement des salaires » (CGI, Ordonnance CNPS…).
// Consultable par le RH ; statuts modifiables par l'administration paie.
export function SalaryElementsGuide({ canManage }: { canManage: boolean }) {
  const [cfg, setCfg] = useState<SalaryElementsConfig | null>(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open && !cfg) getSalaryElements(canManage).then(setCfg).catch(() => setError("Chargement du guide impossible."));
  }, [open, cfg, canManage]);

  async function patch(code: string, field: "fiscal_status" | "cnps_status", value: string) {
    setBusy(code);
    setError(null);
    try {
      await updateSalaryElement(code, { [field]: value });
      setCfg((c) => (c ? { ...c, elements: c.elements.map((e) => (e.code === code ? { ...e, [field]: value, ...(field === "fiscal_status" ? { fiscal_label: labelOf(c.fiscal_statuses, value) } : { cnps_label: labelOf(c.cnps_statuses, value) }) } : e)) } : c));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Mise à jour impossible.");
    } finally {
      setBusy(null);
    }
  }

  const byCat = groupByCategory(cfg?.elements ?? []);

  return (
    <Card title="Guide fiscal & CNPS des éléments de salaire" subtitle="Quel élément est taxable/exonéré (IRPP) et cotisable/non (CNPS). Référentiel légal, ajustable.">
      <button onClick={() => setOpen((o) => !o)} style={{ background: "none", border: "1px solid var(--line)", borderRadius: 6, padding: "6px 12px", fontSize: 12.5, cursor: "pointer", color: "var(--ink)" }}>
        {open ? "▾ Masquer" : "▸ Afficher"} le guide des éléments de salaire
      </button>
      {open && (
        <>
          <p style={{ fontSize: 12, color: "var(--muted)", lineHeight: 1.6, marginTop: 10 }}>
            Classification d'après la procédure fiscale officielle (CGI art. 30/31/33, Ordonnance CNPS 73/17…). Elle sert de
            repère au calcul de la base IRPP (salaire brut taxable) et de la base CNPS (salaire cotisable).
            {canManage && " Vous pouvez ajuster un statut ; le changement est tracé."} <strong>À faire valider par votre comptable/juriste</strong> (conformité sous la responsabilité de la maison).
          </p>
          {error && <div style={{ background: "var(--alert-soft)", color: "var(--alert)", borderRadius: 6, padding: "7px 11px", fontSize: 12.5, margin: "8px 0" }}>{error}</div>}
          {!cfg ? (
            <p style={{ color: "var(--muted)", fontSize: 13 }}>Chargement…</p>
          ) : (
            <div style={{ overflowX: "auto", marginTop: 8 }}>
              <table style={{ borderCollapse: "collapse", fontSize: 12.5, minWidth: 640, width: "100%" }}>
                <thead>
                  <tr style={{ color: "var(--muted)", textAlign: "left", fontSize: 11.5 }}>
                    <th style={{ padding: "5px 8px" }}>Élément</th>
                    <th style={{ padding: "5px 8px" }}>Fiscal (IRPP)</th>
                    <th style={{ padding: "5px 8px" }}>CNPS</th>
                    <th style={{ padding: "5px 8px" }}>Référence</th>
                  </tr>
                </thead>
                <tbody>
                  {byCat.map(([cat, items]) => (
                    <>
                      <tr key={cat}>
                        <td colSpan={4} style={{ padding: "8px 8px 3px", fontSize: 11.5, fontWeight: 700, color: "var(--eclosion-dark, #8A6A12)", textTransform: "uppercase", letterSpacing: 0.3 }}>{items[0].category_label}</td>
                      </tr>
                      {items.map((e) => (
                        <tr key={e.code} style={{ borderTop: "1px solid var(--line)", opacity: e.active ? 1 : 0.5 }}>
                          <td style={{ padding: "5px 8px" }}>{e.label}</td>
                          <td style={{ padding: "5px 8px" }}>
                            {canManage ? (
                              <select value={e.fiscal_status} disabled={busy === e.code} onChange={(ev) => patch(e.code, "fiscal_status", ev.target.value)} style={{ fontSize: 12 }}>
                                {cfg.fiscal_statuses.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
                              </select>
                            ) : (
                              <Chip label={e.fiscal_label} tone={e.fiscal_status === "taxable" ? "warn" : e.fiscal_status === "partiel" ? "muted" : "ok"} />
                            )}
                          </td>
                          <td style={{ padding: "5px 8px" }}>
                            {canManage ? (
                              <select value={e.cnps_status} disabled={busy === e.code} onChange={(ev) => patch(e.code, "cnps_status", ev.target.value)} style={{ fontSize: 12 }}>
                                {cfg.cnps_statuses.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
                              </select>
                            ) : (
                              <Chip label={e.cnps_label} tone={e.cnps_status === "cotisable" ? "warn" : e.cnps_status === "partiel" ? "muted" : "ok"} />
                            )}
                          </td>
                          <td style={{ padding: "5px 8px", color: "var(--muted)", fontSize: 11.5 }}>{e.legal_ref ?? "—"}</td>
                        </tr>
                      ))}
                    </>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </Card>
  );
}

function Chip({ label, tone }: { label: string; tone: "ok" | "warn" | "muted" }) {
  const c = tone === "ok" ? { bg: "var(--eclosion-soft)", fg: "var(--eclosion)" } : tone === "warn" ? { bg: "rgba(196,102,31,0.12)", fg: "#C4661F" } : { bg: "var(--paper)", fg: "var(--muted)" };
  return <span style={{ fontSize: 11.5, fontWeight: 600, background: c.bg, color: c.fg, border: "1px solid var(--line)", borderRadius: 999, padding: "2px 9px" }}>{label}</span>;
}

function labelOf(list: { value: string; label: string }[], value: string): string {
  return list.find((x) => x.value === value)?.label ?? value;
}

function groupByCategory(elements: SalaryElement[]): [string, SalaryElement[]][] {
  const map = new Map<string, SalaryElement[]>();
  for (const e of elements) {
    if (!map.has(e.category)) map.set(e.category, []);
    map.get(e.category)!.push(e);
  }
  return Array.from(map.entries());
}
