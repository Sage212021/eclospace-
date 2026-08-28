import { useEffect, useState } from "react";
import { getMyDossiers, type MyDossier } from "../api/client";

// « Mes dossiers à traiter » — l'équivalent de « Mes lectures », mais pour toute
// la chaîne de production : chacun retrouve d'un coup d'œil les manuscrits qui
// lui sont personnellement confiés à l'étape en cours (correction, mise en page,
// infographie…). N'affiche QUE les dossiers de l'utilisateur connecté.

function daysSince(iso: string): number {
  return Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 86400000));
}

export function MyDossiers({ onOpenManuscript, canOpen }: { onOpenManuscript: (id: string) => void; canOpen: boolean }) {
  const [rows, setRows] = useState<MyDossier[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getMyDossiers()
      .then(setRows)
      .catch((e) => setError(e instanceof Error ? e.message : "Chargement impossible."));
  }, []);

  return (
    <section style={{ maxWidth: 860 }}>
      <h1 style={{ fontSize: 20, marginBottom: 4 }}>Mes dossiers à traiter</h1>
      <p style={{ color: "var(--muted)", fontSize: 13, marginTop: 0 }}>
        Les manuscrits qui vous sont personnellement confiés à l'étape en cours. Une notification vous prévient à chaque nouvelle affectation.
      </p>

      {error && <div style={{ background: "var(--alert-soft)", color: "var(--alert)", borderRadius: 6, padding: "8px 12px", fontSize: 13, marginBottom: 12 }}>{error}</div>}

      {rows === null && !error && <p style={{ color: "var(--muted)", fontSize: 13 }}>Chargement…</p>}

      {rows !== null && rows.length === 0 && (
        <div style={{ background: "var(--card)", border: "1px solid var(--line)", borderRadius: 10, padding: 20, textAlign: "center", color: "var(--muted)", fontSize: 13.5 }}>
          Aucun dossier ne vous est confié pour l'instant. Quand un collègue vous transmettra un manuscrit pour une étape (correction, maquette, infographie…), il apparaîtra ici.
        </div>
      )}

      {rows !== null && rows.length > 0 && (
        <div style={{ display: "grid", gap: 10 }}>
          {rows.map((d) => {
            const days = daysSince(d.since);
            return (
              <div key={d.manuscript_id} style={{ background: "var(--card)", border: "1px solid var(--line)", borderRadius: 10, padding: "12px 14px", display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
                <div style={{ flex: 1, minWidth: 240 }}>
                  <div style={{ fontWeight: 600, fontSize: 14 }}>{d.title}</div>
                  <div style={{ fontSize: 12.5, color: "var(--muted)", marginTop: 2 }}>
                    <span style={{ fontFamily: "var(--font-mono)" }}>{d.manuscript_number}</span>
                    {" · "}
                    <span style={{ display: "inline-block", background: "var(--eclosion-soft)", color: "var(--eclosion-dark, #9a7a12)", borderRadius: 999, padding: "1px 9px", fontWeight: 600 }}>{d.step_label}</span>
                    {" · "}confié {days === 0 ? "aujourd'hui" : `il y a ${days} j`}
                  </div>
                </div>
                {canOpen ? (
                  <button
                    onClick={() => onOpenManuscript(d.manuscript_id)}
                    style={{ border: "1px solid var(--line)", background: "#fff", borderRadius: 8, padding: "7px 14px", fontWeight: 600, fontSize: 13, cursor: "pointer", color: "var(--eclosion-dark)" }}
                  >
                    Ouvrir la fiche
                  </button>
                ) : (
                  <span style={{ fontSize: 12, color: "var(--muted)" }}>À traiter dans votre module de travail</span>
                )}
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
