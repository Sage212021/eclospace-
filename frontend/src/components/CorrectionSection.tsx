import { useEffect, useState } from "react";
import {
  compareVersions,
  createDocument,
  listDocumentVersions,
  listDocuments,
  uploadDocumentVersion,
  type ComparisonReport,
  type DocumentSummary,
  type DocumentVersionSummary,
} from "../api/client";
import { CollapsibleSection } from "./CollapsibleSection";

interface CorrectionSectionProps {
  manuscriptId: string;
  canManage: boolean;
}

// Correction éditoriale et comparateur de versions (Ch. 10). Le comparateur
// est limité aux fichiers .docx en v1 (repli prévu par le plan de
// développement face au risque technique identifié) — le rapport est
// structuré (JSON), l'export PDF n'est pas encore implémenté.
export function CorrectionSection({ manuscriptId, canManage }: CorrectionSectionProps) {
  const [documents, setDocuments] = useState<DocumentSummary[]>([]);
  const [selectedDocId, setSelectedDocId] = useState<string | null>(null);
  const [versions, setVersions] = useState<DocumentVersionSummary[]>([]);
  const [leftId, setLeftId] = useState("");
  const [rightId, setRightId] = useState("");
  const [report, setReport] = useState<ComparisonReport | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refreshDocuments = () => listDocuments("manuscript", manuscriptId).then(setDocuments);

  useEffect(() => {
    refreshDocuments();
  }, [manuscriptId]);

  useEffect(() => {
    if (selectedDocId) listDocumentVersions(selectedDocId).then(setVersions);
  }, [selectedDocId]);

  async function handleCreateDocument(title: string) {
    const doc = await createDocument({ entity_type: "manuscript", entity_id: manuscriptId, category: "manuscrit", title });
    await refreshDocuments();
    setSelectedDocId(doc.id);
  }

  async function handleUpload(file: File) {
    if (!selectedDocId) return;
    setError(null);
    try {
      await uploadDocumentVersion(selectedDocId, file);
      listDocumentVersions(selectedDocId).then(setVersions);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Échec du dépôt.");
    }
  }

  async function handleCompare() {
    setError(null);
    setReport(null);
    try {
      const result = await compareVersions(leftId, rightId);
      setReport(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Échec de la comparaison.");
    }
  }

  return (
    <CollapsibleSection title="Correction et versions" storageKey="fiche:correction-versions">
      <label style={{ fontSize: 12, display: "block", marginBottom: 8 }}>
        Document
        <select value={selectedDocId ?? ""} onChange={(e) => setSelectedDocId(e.target.value || null)} style={inputStyle}>
          <option value="">— choisir —</option>
          {documents.map((d) => (
            <option key={d.id} value={d.id}>
              {d.title}
            </option>
          ))}
        </select>
      </label>

      {canManage && (
        <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
          <button
            onClick={() => {
              const title = window.prompt("Titre du document (ex. manuscrit corrigé)");
              if (title) handleCreateDocument(title);
            }}
            style={secondaryButtonStyle}
          >
            + Nouveau document
          </button>
          {selectedDocId && (
            <label style={{ ...secondaryButtonStyle, cursor: "pointer" }}>
              Déposer une version (.docx)
              <input
                type="file"
                accept=".docx"
                style={{ display: "none" }}
                onChange={(e) => e.target.files?.[0] && handleUpload(e.target.files[0])}
              />
            </label>
          )}
        </div>
      )}

      {selectedDocId && versions.length > 0 && (
        <div style={{ borderTop: "1px solid var(--line)", paddingTop: 10 }}>
          <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 6 }}>Comparateur de versions</div>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <select value={leftId} onChange={(e) => setLeftId(e.target.value)} style={inputStyle}>
              <option value="">Version A</option>
              {versions.map((v) => (
                <option key={v.id} value={v.id}>
                  v{v.versionNumber}
                </option>
              ))}
            </select>
            <span style={{ color: "var(--muted)" }}>↔</span>
            <select value={rightId} onChange={(e) => setRightId(e.target.value)} style={inputStyle}>
              <option value="">Version B</option>
              {versions.map((v) => (
                <option key={v.id} value={v.id}>
                  v{v.versionNumber}
                </option>
              ))}
            </select>
            <button onClick={handleCompare} disabled={!leftId || !rightId} style={secondaryButtonStyle}>
              Comparer
            </button>
          </div>
        </div>
      )}

      {error && <p style={{ color: "var(--alert)", fontSize: 12, marginTop: 8 }}>{error}</p>}

      {report && (
        <div style={{ marginTop: 14 }}>
          <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 8 }}>
            {report.additions} ajout(s), {report.deletions} suppression(s) entre v{report.left_version} et v{report.right_version}.
          </div>
          <div style={{ fontFamily: "var(--font-mono)", fontSize: 12, lineHeight: 1.6, maxHeight: 280, overflowY: "auto", border: "1px solid var(--line)", borderRadius: 6, padding: 10 }}>
            {report.changes.map((change, index) => (
              <span
                key={index}
                style={{
                  background: change.type === "added" ? "#e6f4ea" : change.type === "removed" ? "var(--alert-soft)" : "transparent",
                  color: change.type === "added" ? "#1a7f37" : change.type === "removed" ? "var(--alert)" : "var(--ink)",
                  textDecoration: change.type === "removed" ? "line-through" : "none",
                  whiteSpace: "pre-wrap",
                }}
              >
                {change.value}
              </span>
            ))}
          </div>
        </div>
      )}
    </CollapsibleSection>
  );
}

const inputStyle: React.CSSProperties = { display: "block", width: "100%", padding: 6, marginTop: 4, fontSize: 13 };
const secondaryButtonStyle: React.CSSProperties = {
  background: "#fff",
  border: "1px solid var(--line)",
  borderRadius: 6,
  padding: "6px 12px",
  fontSize: 12,
  cursor: "pointer",
};
