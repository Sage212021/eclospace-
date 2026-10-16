import { useEffect, useState } from "react";
import {
  addBatAnomaly,
  listBatRecords,
  openBat,
  signBat,
  toggleChecklistItem,
  updateBatStatus,
  updateBatFiles,
  listStepAttachments,
  uploadBatSignedScan,
  batSignedScanUrl,
  type BatRecord,
  type StepAttachment,
} from "../api/client";
import { CollapsibleSection } from "./CollapsibleSection";

interface BatSectionProps {
  manuscriptId: string;
  canManage: boolean;
  canValidate: boolean;
}

// Libellés des ÉTATS du bon à tirer (statut du document, pas une personne).
const STATUS_LABELS: Record<BatRecord["status"], string> = {
  in_control: "Étape 1/3 — Vérification en cours",
  corrections_requested: "Renvoyé en correction",
  awaiting_signature: "Étape 2/3 — En attente de signature",
  signed: "Étape 3/3 — Signé (bon pour impression)",
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
    <CollapsibleSection title="BAT Final et contrôle qualité" subtitle="Déposez ici le fichier final (intérieur + couverture), cochez la liste de contrôle, puis le scan signé et la signature — c'est ce qui débloque la validation du BAT." storageKey="fiche:bat" id="bat-final" defaultOpen>
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
          attachments={attachments}
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
  attachments,
  canManage,
  canValidate,
  onChanged,
  onError,
}: {
  bat: BatRecord;
  attachments: StepAttachment[];
  canManage: boolean;
  canValidate: boolean;
  onChanged: () => void;
  onError: (m: string) => void;
}) {
  const locked = bat.status === "signed";
  const hasScan = !!bat.signedScanVersionId;
  const [confirmSigned, setConfirmSigned] = useState(false);
  const [uploadingScan, setUploadingScan] = useState(false);
  // Correction des fichiers (intérieur / couverture) en cas d'erreur de sélection.
  const [editingFiles, setEditingFiles] = useState(false);
  const [newInteriorId, setNewInteriorId] = useState("");
  const [newCoverId, setNewCoverId] = useState("");
  const [savingFiles, setSavingFiles] = useState(false);

  const fileName = (versionId?: string | null) => {
    if (!versionId) return "non défini";
    const a = attachments.find((x) => x.version_id === versionId);
    return a ? a.title : "fichier déposé";
  };
  const fileLabel = (a: StepAttachment) => `${a.title}${a.file_size ? ` · ${(a.file_size / 1_000_000).toFixed(1)} Mo` : ""}`;

  function startEditFiles() {
    setNewInteriorId(bat.interiorVersionId ?? "");
    setNewCoverId(bat.coverVersionId ?? "");
    setEditingFiles(true);
  }

  async function handleSaveFiles() {
    const files: { interiorVersionId?: string; coverVersionId?: string } = {};
    if (newInteriorId && newInteriorId !== bat.interiorVersionId) files.interiorVersionId = newInteriorId;
    if (newCoverId && newCoverId !== bat.coverVersionId) files.coverVersionId = newCoverId;
    if (!files.interiorVersionId && !files.coverVersionId) { setEditingFiles(false); return; }
    setSavingFiles(true);
    try {
      await updateBatFiles(bat.id, files);
      setEditingFiles(false);
      onChanged();
    } catch (err) {
      onError(err instanceof Error ? err.message : "Échec de la correction des fichiers.");
    } finally {
      setSavingFiles(false);
    }
  }

  async function handleUploadScan(file: File | null) {
    if (!file) return;
    setUploadingScan(true);
    try {
      await uploadBatSignedScan(bat.id, file);
      onChanged();
    } catch (err) {
      onError(err instanceof Error ? err.message : "Dépôt du scan impossible.");
    } finally {
      setUploadingScan(false);
    }
  }

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

      {/* Fichiers du bon à tirer — corrigeables tant que le BAT n'est pas signé
          (en cas de fichier sélectionné par erreur). */}
      <div style={{ border: "1px solid var(--line)", borderRadius: 8, padding: 10, marginBottom: 12, background: "var(--ivory, #FAF8F2)" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <div style={{ fontSize: 12.5, fontWeight: 600 }}>Fichiers du bon à tirer</div>
          {canManage && !locked && !editingFiles && (
            <button onClick={startEditFiles} style={secondaryButtonStyle}>Corriger les fichiers</button>
          )}
        </div>
        {!editingFiles ? (
          <div style={{ fontSize: 12.5, color: "var(--muted)", marginTop: 6, lineHeight: 1.6 }}>
            <div>📄 <b>Intérieur</b> : {fileName(bat.interiorVersionId)}</div>
            <div>🖼️ <b>Couverture</b> : {fileName(bat.coverVersionId)}</div>
          </div>
        ) : (
          <div style={{ display: "grid", gap: 10, marginTop: 8 }}>
            <div style={{ fontSize: 12, color: "var(--muted)" }}>
              Choisissez le bon fichier parmi ceux déposés dans « Documents de l'étape ». Possible tant que le BAT n'est pas signé.
            </div>
            <label style={{ fontSize: 12.5 }}>
              <span style={{ display: "block", color: "var(--muted)", marginBottom: 3 }}>Fichier intérieur (texte)</span>
              <select value={newInteriorId} onChange={(e) => setNewInteriorId(e.target.value)} style={{ width: "100%" }}>
                <option value="">— Choisir —</option>
                {attachments.map((a) => <option key={a.version_id!} value={a.version_id!}>{fileLabel(a)}</option>)}
              </select>
            </label>
            <label style={{ fontSize: 12.5 }}>
              <span style={{ display: "block", color: "var(--muted)", marginBottom: 3 }}>Fichier couverture</span>
              <select value={newCoverId} onChange={(e) => setNewCoverId(e.target.value)} style={{ width: "100%" }}>
                <option value="">— Choisir —</option>
                {attachments.map((a) => <option key={a.version_id!} value={a.version_id!}>{fileLabel(a)}</option>)}
              </select>
            </label>
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
              <button onClick={() => setEditingFiles(false)} style={secondaryButtonStyle}>Annuler</button>
              <button onClick={handleSaveFiles} disabled={savingFiles} style={{ ...secondaryButtonStyle, background: "var(--eclosion)", color: "#fff", border: "none", opacity: savingFiles ? 0.6 : 1 }}>
                {savingFiles ? "Enregistrement…" : "Enregistrer les fichiers"}
              </button>
            </div>
          </div>
        )}
      </div>

      <div style={{ fontSize: 11.5, color: "var(--muted)", margin: "4px 0 8px" }}>
        Cochez chaque point vérifié. « Obligatoire » = point indispensable (à cocher avant de passer en signature). Une case cochée (✓) est satisfaite.
      </div>
      {bat.checklist?.items.map((item) => {
        const done = !!item.checkedAt;
        return (
          <label key={item.id} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, padding: "4px 0" }}>
            <input
              type="checkbox"
              checked={done}
              disabled={!canManage || locked}
              onChange={(e) => handleToggle(item.id, e.target.checked)}
            />
            <span style={{ flex: 1 }}>{item.label}</span>
            {item.isBlocking && (
              done
                ? <span style={{ fontSize: 10.5, color: "#2F7D4A", fontWeight: 600, whiteSpace: "nowrap" }}>✓ fait</span>
                : <span style={{ fontSize: 10, color: "var(--muted)", whiteSpace: "nowrap" }}>obligatoire</span>
            )}
          </label>
        );
      })}

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

      {(canManage || canValidate) && bat.status === "awaiting_signature" && (
        <div style={{ marginTop: 14, borderTop: "1px solid var(--line)", paddingTop: 12, display: "grid", gap: 8 }}>
          <div style={{ fontSize: 12.5, fontWeight: 700 }}>Signature de l'auteur (bon à tirer)</div>
          <div style={{ fontSize: 12, color: "var(--muted)", lineHeight: 1.5 }}>
            Déposez le <b>scan (ou photo) du BAT Final signé de la main de l'auteur</b>. La signature « bon pour impression » n'est possible qu'une fois ce document déposé.
          </div>
          {/* Dépôt du scan — par le service (bat:saisie = canManage). */}
          {canManage && !locked && (
            <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
              <label style={{ ...secondaryButtonStyle, display: "inline-block" }}>
                {hasScan ? "Remplacer le scan signé" : "Déposer le BAT signé par l'auteur"}
                <input type="file" accept="image/*,application/pdf" style={{ display: "none" }} disabled={uploadingScan}
                  onChange={(e) => { handleUploadScan(e.target.files?.[0] ?? null); e.currentTarget.value = ""; }} />
              </label>
              {uploadingScan && <span style={{ fontSize: 12, color: "var(--muted)" }}>Dépôt…</span>}
            </div>
          )}
          {hasScan ? (
            <div style={{ fontSize: 12.5, color: "#2F7D4A" }}>
              ✅ Scan du BAT signé déposé — <a href={batSignedScanUrl(bat.id)} target="_blank" rel="noreferrer" style={{ color: "var(--eclosion-dark, #9a7a12)", fontWeight: 600 }}>consulter</a>
            </div>
          ) : (
            <div style={{ fontSize: 12.5, color: "var(--alert)" }}>⬜ Aucun scan signé déposé pour l'instant.</div>
          )}
          {/* Case de confirmation : activée uniquement si le scan est déposé.
              Ouverte au profil qui prépare (canManage) comme au validateur. */}
          {(canManage || canValidate) && (
            <>
              <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, opacity: hasScan ? 1 : 0.5 }}>
                <input type="checkbox" disabled={!hasScan} checked={confirmSigned} onChange={(e) => setConfirmSigned(e.target.checked)} />
                Je confirme avoir reçu le BAT signé par l'auteur (document déposé ci-dessus).
              </label>
              <button
                onClick={handleSign}
                disabled={!hasScan || !confirmSigned}
                title={!hasScan ? "Déposez d'abord le scan du BAT signé par l'auteur." : !confirmSigned ? "Cochez la confirmation." : undefined}
                style={{ ...secondaryButtonStyle, marginTop: 2, background: "var(--eclosion)", color: "#fff", border: "none", cursor: !hasScan || !confirmSigned ? "not-allowed" : "pointer", opacity: !hasScan || !confirmSigned ? 0.55 : 1 }}
              >
                Signer le BAT Final (bon pour impression)
              </button>
            </>
          )}
        </div>
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
