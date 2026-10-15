import { useEffect, useState } from "react";
import {
  addBatAnomaly,
  listBatRecords,
  openBat,
  signBat,
  toggleChecklistItem,
  updateBatStatus,
  listStepAttachments,
  type BatRecord,
  type StepAttachment,
} from "../api/client";
import { CollapsibleSection } from "./CollapsibleSection";

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
  // Choix du FICHIER FINAL (intérieur + couverture) parmi les fichiers déjà
  // déposés dans « Documents de l'étape » — plus de saisie d'identifiant.
  const [attachments, setAttachments] = useState<StepAttachment[]>([]);
  const [showOpen, setShowOpen] = useState(false);
  const [interiorId, setInteriorId] = useState("");
  const [coverId, setCoverId] = useState("");
  const [opening, setOpening] = useState(false);

  const refresh = () => listBatRecords(manuscriptId).then(setRecords).catch((e) => setError(e.message));

  useEffect(() => {
    refresh();
    listStepAttachments(manuscriptId).then((a) => setAttachments(a.filter((x) => x.version_id))).catch(() => setAttachments([]));
  }, [manuscriptId]);

  async function handleOpen() {
    if (!interiorId || !coverId) { setError("Choisissez le fichier intérieur ET le fichier de couverture."); return; }
    setOpening(true);
    setError(null);
    try {
      await openBat(manuscriptId, interiorId, coverId);
      setShowOpen(false);
      setInteriorId("");
      setCoverId("");
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Échec de l'ouverture du dossier de BAT Final.");
    } finally {
      setOpening(false);
    }
  }

  const current = records[0];
  const fileLabel = (a: StepAttachment) => `${a.title}${a.file_size ? ` · ${(a.file_size / 1_000_000).toFixed(1)} Mo` : ""}`;

  return (
    <CollapsibleSection title="BAT Final et contrôle qualité" storageKey="fiche:bat">
      <div style={{ display: "flex", justifyContent: "flex-end", alignItems: "center", marginBottom: 10 }}>
        {canManage && !current && !showOpen && (
          <button onClick={() => { setShowOpen(true); setError(null); }} style={secondaryButtonStyle}>
            Déposer le fichier final (bon à tirer)
          </button>
        )}
      </div>
      {error && <p style={{ color: "var(--alert)", fontSize: 12 }}>{error}</p>}

      {canManage && !current && showOpen && (
        <div style={{ border: "1px solid var(--line)", borderRadius: 8, padding: 12, marginBottom: 12, display: "grid", gap: 10 }}>
          <div style={{ fontSize: 12.5, color: "var(--muted)", lineHeight: 1.5 }}>
            Le <b>fichier final prêt pour l'impression</b> se compose de l'<b>intérieur (texte)</b> et de la <b>couverture</b>.
            Choisissez-les parmi les fichiers déposés ci-dessus dans « Documents de l'étape » (déposez-les d'abord s'ils n'y sont pas).
          </div>
          {attachments.length === 0 ? (
            <p style={{ fontSize: 12.5, color: "var(--alert)" }}>Aucun fichier déposé. Déposez d'abord l'intérieur et la couverture dans « Documents de l'étape », puis revenez ici.</p>
          ) : (
            <>
              <label style={{ fontSize: 12.5 }}>
                <span style={{ display: "block", color: "var(--muted)", marginBottom: 3 }}>Fichier intérieur (texte)</span>
                <select value={interiorId} onChange={(e) => setInteriorId(e.target.value)} style={{ width: "100%" }}>
                  <option value="">— Choisir —</option>
                  {attachments.map((a) => <option key={a.version_id!} value={a.version_id!}>{fileLabel(a)}</option>)}
                </select>
              </label>
              <label style={{ fontSize: 12.5 }}>
                <span style={{ display: "block", color: "var(--muted)", marginBottom: 3 }}>Fichier couverture</span>
                <select value={coverId} onChange={(e) => setCoverId(e.target.value)} style={{ width: "100%" }}>
                  <option value="">— Choisir —</option>
                  {attachments.map((a) => <option key={a.version_id!} value={a.version_id!}>{fileLabel(a)}</option>)}
                </select>
              </label>
            </>
          )}
          <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
            <button onClick={() => { setShowOpen(false); setError(null); }} style={secondaryButtonStyle}>Annuler</button>
            <button onClick={handleOpen} disabled={opening || !interiorId || !coverId} style={{ ...secondaryButtonStyle, background: "var(--eclosion)", color: "#fff", border: "none", opacity: opening || !interiorId || !coverId ? 0.6 : 1 }}>
              {opening ? "Ouverture…" : "Ouvrir le bon à tirer"}
            </button>
          </div>
        </div>
      )}

      {!current && !showOpen && <p style={{ color: "var(--muted)", fontSize: 13 }}>Aucun bon à tirer ouvert. Déposez le fichier final (intérieur + couverture), cochez la liste de contrôle, puis signez : c'est ce qui autorise la validation du BAT Final.</p>}

      {current && (
        <BatCycle
          bat={current}
          canManage={canManage}
          canValidate={canValidate}
          onChanged={refresh}
          onError={setError}
        />
      )}
    </CollapsibleSection>
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
          Signer le BAT Final
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
