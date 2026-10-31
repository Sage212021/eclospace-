import { useEffect, useState } from "react";
import { getTitleDuplicates, type TitleTwin } from "../api/client";

// Bandeau d'alerte « doublon possible » sur la fiche d'un ouvrage : signale
// qu'un ou plusieurs autres manuscrits portent le MÊME titre (accents, casse et
// ponctuation ignorés). C'est un simple signalement — rien n'est bloqué ni
// supprimé ; le nettoyage se fait via « Manuscrits → Doublons potentiels ».
// Masqué quand il n'y a aucun doublon (aucune gêne sinon).
export function DuplicateTitleBanner({ manuscriptId, onOpenManuscript }: { manuscriptId: string; onOpenManuscript?: (id: string) => void }) {
  const [twins, setTwins] = useState<TitleTwin[]>([]);

  useEffect(() => {
    let alive = true;
    getTitleDuplicates(manuscriptId).then((t) => { if (alive) setTwins(t); }).catch(() => { if (alive) setTwins([]); });
    return () => { alive = false; };
  }, [manuscriptId]);

  if (twins.length === 0) return null;

  return (
    <div
      style={{
        border: "1px solid var(--eclosion-retard, #B87400)",
        background: "var(--amber-soft, #FBEEDA)",
        color: "var(--eclosion-retard, #B87400)",
        borderRadius: 10,
        padding: "10px 14px",
        marginBottom: 12,
        fontSize: 13,
        lineHeight: 1.6,
      }}
    >
      <strong>⚠️ Doublon possible.</strong>{" "}
      {twins.length === 1 ? "Un autre ouvrage porte le même titre" : `${twins.length} autres ouvrages portent le même titre`} (accents, casse et ponctuation ignorés) :
      <ul style={{ margin: "6px 0 4px", paddingLeft: 18 }}>
        {twins.map((t) => (
          <li key={t.id} style={{ marginBottom: 2 }}>
            <span style={{ fontFamily: "var(--font-mono)" }}>{t.manuscript_number}</span> — « {t.title} »{t.stage ? ` · ${t.stage}` : ""}
            {onOpenManuscript && (
              <button
                type="button"
                onClick={() => onOpenManuscript(t.id)}
                style={{ marginLeft: 8, background: "none", border: "1px solid currentColor", color: "inherit", borderRadius: 6, padding: "1px 8px", fontSize: 12, fontWeight: 700, cursor: "pointer" }}
              >
                Ouvrir
              </button>
            )}
          </li>
        ))}
      </ul>
      Gardez la fiche porteuse (celle qui a la correction et les pièces) et retirez le doublon accidentel via <strong>Manuscrits → Doublons potentiels</strong>.
    </div>
  );
}
