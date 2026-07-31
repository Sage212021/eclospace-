import { useEffect, useState } from "react";
import { getSystemDiagnostic, type SystemDiagnostic } from "../api/client";

// Diagnostic de persistance des données, lisible par l'opérateur. Permet de
// VÉRIFIER concrètement qu'un enregistrement est bien conservé en base :
// enregistrez une donnée (dossier RH, rapport, facture…) puis « Rafraîchir » —
// le compteur correspondant doit augmenter. Si l'identifiant d'instance change à
// chaque rafraîchissement, plusieurs serveurs répondent sans base partagée
// (cause classique de « données enregistrées puis disparues »).

const REC_LABELS: { key: keyof SystemDiagnostic["records"]; label: string }[] = [
  { key: "users", label: "Comptes" },
  { key: "employees", label: "Dossiers RH" },
  { key: "weekly_reports", label: "Rapports" },
  { key: "invoices", label: "Factures" },
  { key: "billing_orders", label: "Commandes à facturer" },
  { key: "manuscripts", label: "Ouvrages" },
];

export function SystemDiagnosticCard() {
  const [diag, setDiag] = useState<SystemDiagnostic | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [checkedAt, setCheckedAt] = useState<string | null>(null);

  function load() {
    setLoading(true);
    setError(null);
    getSystemDiagnostic()
      .then((d) => { setDiag(d); setCheckedAt(new Date().toLocaleTimeString("fr-FR")); })
      .catch((e) => setError(e instanceof Error ? e.message : "Diagnostic indisponible."))
      .finally(() => setLoading(false));
  }
  useEffect(() => { load(); }, []);

  const ok = diag?.database.connected;

  return (
    <div style={{ border: "1px solid var(--line)", borderRadius: 12, padding: 16, marginTop: 16, background: "var(--card)" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <h2 style={{ fontFamily: "var(--font-title)", fontSize: 16, margin: 0 }}>Diagnostic de persistance des données</h2>
        <button onClick={load} disabled={loading} style={{ marginLeft: "auto", border: "1px solid var(--line)", background: "#fff", borderRadius: 8, padding: "6px 12px", fontSize: 13, cursor: "pointer" }}>
          {loading ? "Vérification…" : "Rafraîchir"}
        </button>
      </div>
      <p style={{ color: "var(--muted)", fontSize: 12.5, marginTop: 6 }}>
        Pour vérifier qu'un enregistrement est bien conservé : enregistrez une donnée, puis cliquez « Rafraîchir ». Le
        compteur correspondant doit augmenter. Si rien ne change, la donnée n'est pas persistée en base.
      </p>

      {error && <div style={{ background: "var(--alert-soft)", color: "var(--alert)", borderRadius: 8, padding: "8px 12px", fontSize: 13, marginTop: 8 }}>{error}</div>}

      {diag && (
        <>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 12 }}>
            <Badge ok={!!ok} label={ok ? "Base de données connectée" : "Base injoignable"} detail={ok ? `latence ${diag.database.latency_ms} ms` : undefined} />
            <Badge
              ok={diag.migrations.applied != null && diag.migrations.applied > 0}
              neutral={diag.migrations.applied == null}
              label={diag.migrations.applied == null ? "Migrations : indéterminé" : `Migrations appliquées : ${diag.migrations.applied}`}
              detail={diag.migrations.last ?? undefined}
            />
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))", gap: 10, marginTop: 12 }}>
            {REC_LABELS.map((r) => (
              <div key={r.key} style={{ border: "1px solid var(--line)", borderRadius: 10, padding: "10px 12px" }}>
                <div style={{ fontSize: 11.5, color: "var(--muted)", textTransform: "uppercase", letterSpacing: 0.4 }}>{r.label}</div>
                <div style={{ fontSize: 22, fontWeight: 700, fontFamily: "var(--font-mono)", marginTop: 2 }}>{diag.records[r.key] < 0 ? "—" : diag.records[r.key].toLocaleString("fr-FR")}</div>
              </div>
            ))}
          </div>

          <div style={{ fontSize: 11.5, color: "var(--muted)", marginTop: 12, display: "flex", gap: 14, flexWrap: "wrap" }}>
            <span>Serveur : <b style={{ fontFamily: "var(--font-mono)", color: "var(--ink)" }}>{diag.instance_id}</b> (actif depuis {formatUptime(diag.uptime_seconds)})</span>
            {diag.database.server_time && <span>Heure base : <span style={{ fontFamily: "var(--font-mono)" }}>{new Date(diag.database.server_time).toLocaleString("fr-FR")}</span></span>}
            {checkedAt && <span>Vérifié à {checkedAt}</span>}
          </div>
        </>
      )}
    </div>
  );
}

function Badge({ ok, neutral, label, detail }: { ok: boolean; neutral?: boolean; label: string; detail?: string }) {
  const color = neutral ? "var(--muted)" : ok ? "var(--eclosion-dark, #0a7c42)" : "var(--alert)";
  const bg = neutral ? "var(--line)" : ok ? "var(--eclosion-soft, #e6f4ec)" : "var(--alert-soft)";
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 6, background: bg, color, borderRadius: 999, padding: "5px 12px", fontSize: 12.5, fontWeight: 600 }}>
      {neutral ? "•" : ok ? "✓" : "✕"} {label}{detail ? ` · ${detail}` : ""}
    </span>
  );
}

function formatUptime(s: number): string {
  if (s < 60) return `${s} s`;
  if (s < 3600) return `${Math.floor(s / 60)} min`;
  if (s < 86400) return `${Math.floor(s / 3600)} h`;
  return `${Math.floor(s / 86400)} j`;
}
