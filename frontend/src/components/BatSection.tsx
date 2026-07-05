import { useEffect, useState } from "react";
import {
  addBatAnomaly,
  listBatRecords,
  openBat,
  signBat,
  toggleChecklistItem,
  updateBatStatus,
  type BatRecord,
} from "../api/client";

interface BatSectionProps {
  manuscriptId: string;
  canManage: boolean;
  canValidate: boolean;
}

const STATUS_LABELS: Record<BatRecord["status"], string> = {
  in_control: "En contrôle",
  corrections_requested: "Corrections demandées",
  awaiting_signature: "En attente de signature",
  signed: "Signé",
  cancelled: "Annulé",
};

// BAT (Bon à tirer) et contrôle qualité (Ch. 14) : liste de contrôle,
// anomalies, signature électronique verrouillant les fichiers approuvés.
export function BatSection({ manuscriptId, canManage, canValidate }: BatSectionProps) {
  const [records, setRecords] = useState<BatRecord[]>([]);
  const [error, setError] = useState<string | null>(null);

  const refresh = () => listBatRecords(manuscriptId).then(setRecords).catch((e) => setError(e.message));

  useEffect(() => {
    refresh();
  }, [manuscriptId]);

  async function handleOpen() {
    const interiorId = window.prompt("ID de la version du fichier intérieur (PDF)");
    const coverId = window.prompt("ID de la version du fichier de couverture");
    if (!interiorId || !coverId) return;
    try {
      await openBat(manuscriptId, interiorId, coverId);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Échec de l'ouverture du dossier de BAT.");
    }
  }

  const current = records[0];

  return (
    <div style={{ background: "var(--card)", border: "1px solid var(--line)", borderRadius: 10, padding: 18, marginTop: 16 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
        <div style={{ fontSize: 13, fontWeight: 600 }}>BAT et contrôle qualité</div>
        {canManage && !current && (
          <button onClick={handleOpen} style={secondaryButtonStyle}>
            Ouvrir le dossier de BAT
          </button>
        )}
      </div>
      {error && <p style={{ color: "var(--alert)", fontSize: 12 }}>{error}</p>}
      {!current && <p style={{ color: "var(--muted)", fontSize: 13 }}>Aucun cycle de BAT ouvert.</p>}

      {current && (
        <BatCycle
          bat={current}
          canManage={canManage}
          canValidate={canValidate}
          onChanged={refresh}
          onError={setError}
        />
      )}
    </div>
  );
}

function BatCycle({
  bat,
  canManage,
  canValidate,
  onChanged,
  onError,
}: {
  bat: BatRecord;
  canManage: boolean;
  canValidate: boolean;
  onChanged: () => void;
  onError: (m: string) => void;
}) {
  const locked = bat.status === "signed";

  async function handleToggle(itemId: string, checked: boolean) {
    try {
      await toggleChecklistItem(itemId, checked);
      onChanged();
    } catch (err) {
      onError(err instanceof Error ? err.message : "Échec de la mise à jour.");
    }
  }

  async function handleAddAnomaly() {
    const description = window.prompt("Description de l'anomalie");
    if (!description) return;
    const severity = (window.prompt("Gravité (minor, major, blocking)", "minor") ?? "minor") as "minor" | "major" | "blocking";
    try {
      await addBatAnomaly(bat.id, description, severity);
      onChanged();
    } catch (err) {
      onError(err instanceof Error ? err.message : "Échec de l'ajout de l'anomalie.");
    }
  }

  async function handleReturnForCorrection() {
    try {
      await updateBatStatus(bat.id, "corrections_requested");
      onChanged();
    } catch (err) {
      onError(err instanceof Error ? err.message : "Échec de la transition.");
    }
  }

  async function handleReadyForSignature() {
    try {
      await updateBatStatus(bat.id, "awaiting_signature");
      onChanged();
    } catch (err) {
      onError(err instanceof Error ? err.message : "Échec de la transition.");
    }
  }

  async function handleSign() {
    try {
      await signBat(bat.id);
      onChanged();
    } catch (err) {
      onError(err instanceof Error ? err.message : "Échec de la signature.");
    }
  }

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
        <span style={{ fontSize: 13, fontWeight: 600 }}>Cycle {bat.cycleNumber}</span>
        <span style={{ background: locked ? "var(--eclosion-soft)" : "var(--alert-soft)", color: locked ? "var(--eclosion)" : "var(--alert)", borderRadius: 999, padding: "2px 10px", fontSize: 11 }}>
          {STATUS_LABELS[bat.status]}
        </span>
      </div>

      {bat.checklist?.items.map((item) => (
        <label key={item.id} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, padding: "4px 0" }}>
          <input
            type="checkbox"
            checked={!!item.checkedAt}
            disabled={!canManage || locked}
            onChange={(e) => handleToggle(item.id, e.target.checked)}
          />
          {item.label}
          {item.isBlocking && <span style={{ fontSize: 10, color: "var(--alert)" }}>bloquant</span>}
        </label>
      ))}

      <div style={{ fontSize: 12, fontWeight: 600, marginTop: 12 }}>Anomalies</div>
      {bat.anomalies.length === 0 && <p style={{ color: "var(--muted)", fontSize: 13 }}>Aucune anomalie signalée.</p>}
      {bat.anomalies.map((anomaly) => (
        <div key={anomaly.id} style={{ fontSize: 13, padding: "4px 0" }}>
          [{anomaly.severity}] {anomaly.description} {anomaly.resolvedAt ? "— résolue" : ""}
        </div>
      ))}

      {canManage && !locked && (
        <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
          <button onClick={handleAddAnomaly} style={secondaryButtonStyle}>
            + Signaler une anomalie
          </button>
          {bat.status === "in_control" && (
            <>
              <button onClick={handleReturnForCorrection} style={secondaryButtonStyle}>
                Renvoyer en correction
              </button>
              <button onClick={handleReadyForSignature} style={secondaryButtonStyle}>
                Prêt pour signature
              </button>
            </>
          )}
        </div>
      )}

      {canValidate && bat.status === "awaiting_signature" && (
        <button onClick={handleSign} style={{ ...secondaryButtonStyle, marginTop: 10, background: "var(--eclosion)", color: "#fff", border: "none" }}>
          Signer le BAT
        </button>
      )}
    </div>
  );
}

const secondaryButtonStyle: React.CSSProperties = {
  background: "#fff",
  border: "1px solid var(--line)",
  borderRadius: 6,
  padding: "6px 12px",
  fontSize: 12,
  cursor: "pointer",
};
