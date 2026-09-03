import { useEffect, useRef, useState } from "react";
import {
  createDocument,
  documentVersionDownloadUrl,
  listDocumentVersions,
  listDocuments,
  listRoles,
  notifyDocument,
  uploadDocumentVersion,
  listManuscriptReadingAssignments,
  readingReportFileUrl,
  type DocumentSummary,
  type DocumentVersionSummary,
  type RoleSummary,
  type ReadingAssignment,
} from "../api/client";
import { buildDepositOnLetterhead } from "../lib/finalReport";

// Pièces jointes d'un ouvrage (GED, Ch. 21 §21.9) : chaque pôle dépose,
// consulte, télécharge et remplace (nouvelle version) des fichiers, classés par
// catégorie et par confidentialité. Les fichiers vivent sur le stockage objet
// durable (S3) ; le versionnage et la traçabilité sont assurés côté serveur.
const CATEGORY_LABELS: Record<string, string> = {
  couverture: "Couvertures (1re / 4e)",
  livre_monte: "Livre monté (maquette finale)",
  visuel: "Visuels",
  contrat: "Contrats d'auteur",
  facture: "Factures & pièces finance",
  bat: "BAT",
  manuscrit: "Manuscrit",
  rapport_lecture: "Rapports de lecture",
  piece_archivage: "Pièces d'archivage",
  autre: "Autres pièces",
};

// Ordre d'affichage et de proposition des catégories.
const CATEGORY_ORDER = [
  "couverture",
  "livre_monte",
  "visuel",
  "contrat",
  "facture",
  "bat",
  "manuscrit",
  "rapport_lecture",
  "piece_archivage",
  "autre",
];

const CONFIDENTIALITY_LABELS: Record<string, string> = {
  public: "Public",
  interne: "Interne",
  restreint: "Restreint",
};

export function AttachmentsSection({ manuscriptId, canManage }: { manuscriptId: string; canManage: boolean }) {
  const [docs, setDocs] = useState<DocumentSummary[]>([]);
  const [versionsByDoc, setVersionsByDoc] = useState<Record<string, DocumentVersionSummary[]>>({});
  const [roles, setRoles] = useState<RoleSummary[]>([]);
  const [reportFiles, setReportFiles] = useState<ReadingAssignment[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const load = async () => {
    try {
      const list = await listDocuments("manuscript", manuscriptId);
      setDocs(list);
      const entries = await Promise.all(
        list.map(async (d) => [d.id, await listDocumentVersions(d.id)] as const),
      );
      setVersionsByDoc(Object.fromEntries(entries));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Échec du chargement des pièces jointes.");
    }
  };

  useEffect(() => {
    load();
    listRoles().then(setRoles).catch(() => setRoles([]));
    // Rapports de lecture joints (visibles pour qui a accès au comité) : on
    // ignore silencieusement un refus (403) pour les profils non concernés.
    listManuscriptReadingAssignments(manuscriptId)
      .then((list) => setReportFiles(list.filter((a) => a.hasReportFile)))
      .catch(() => setReportFiles([]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [manuscriptId]);

  // Repose le rapport DÉPOSÉ par le relecteur sur le papier à en-tête Éclosion
  // (en-tête, filet or, pied légal, filigrane) et l'ouvre pour impression / PDF.
  async function imprimerSurEntete(a: ReadingAssignment) {
    setError(null);
    try {
      const res = await buildDepositOnLetterhead(a);
      if (res.depositExcluded) {
        setError("Le rapport déposé n'est ni un PDF ni une image : impossible de le poser sur le papier à en-tête. Il doit être déposé au format PDF.");
        return;
      }
      const url = URL.createObjectURL(res.blob);
      const w = window.open(url, "_blank");
      if (!w) {
        const link = document.createElement("a");
        link.href = url; link.download = res.fileName;
        document.body.appendChild(link); link.click(); link.remove();
      }
      setTimeout(() => URL.revokeObjectURL(url), 60000);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Préparation impossible.");
    }
  }

  async function handleNotify(doc: DocumentSummary, roleCode: string) {
    setError(null);
    try {
      await notifyDocument(doc.id, roleCode);
      const roleLabel = roles.find((r) => r.code === roleCode)?.label ?? roleCode;
      setMessage(`« ${doc.title} » signalée à : ${roleLabel}.`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Échec du signalement.");
    }
  }

  async function handleNewVersion(doc: DocumentSummary, file: File) {
    setError(null);
    try {
      await uploadDocumentVersion(doc.id, file);
      setMessage(`Nouvelle version déposée pour « ${doc.title} ».`);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Échec du dépôt de la version.");
    }
  }

  const byCategory = (cat: string) => docs.filter((d) => d.category === cat);

  return (
    <div style={{ background: "var(--card)", border: "1px solid var(--line)", borderRadius: 10, padding: 18, marginTop: 20 }}>
      <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 4 }}>Pièces jointes</div>
      <p style={{ fontSize: 12, color: "var(--muted)", margin: "0 0 12px" }}>
        Couvertures, livre monté, contrats scannés, pièces finance, archivage… — déposés par ouvrage, visibles par les pôles
        autorisés, versionnés et conservés durablement.
      </p>

      {error && <Banner tone="alert">{error}</Banner>}
      {message && <Banner tone="ok">{message}</Banner>}

      {canManage && <UploadForm manuscriptId={manuscriptId} onDone={load} onError={setError} onMessage={setMessage} />}

      {CATEGORY_ORDER.filter((cat) => byCategory(cat).length > 0).map((cat) => (
        <div key={cat} style={{ marginTop: 14 }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: "var(--eclosion)", marginBottom: 6 }}>{CATEGORY_LABELS[cat] ?? cat}</div>
          {byCategory(cat).map((doc) => {
            const versions = versionsByDoc[doc.id] ?? [];
            const latest = versions[0];
            return (
              <div key={doc.id} style={{ borderTop: "1px solid var(--line)", padding: "8px 0", fontSize: 13 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
                  <span>
                    {doc.title}{" "}
                    <span style={{ fontSize: 11, color: "var(--muted)" }}>
                      · {CONFIDENTIALITY_LABELS[doc.confidentiality] ?? doc.confidentiality}
                      {versions.length > 0 ? ` · v${versions.length}` : ""}
                    </span>
                  </span>
                  <span style={{ display: "flex", gap: 10, alignItems: "center" }}>
                    {latest ? (
                      <a href={documentVersionDownloadUrl(latest.id)} style={{ color: "var(--eclosion)", fontSize: 12 }}>
                        Télécharger
                      </a>
                    ) : (
                      <span style={{ fontSize: 12, color: "var(--muted)" }}>Aucun fichier</span>
                    )}
                    {canManage && (
                      <FilePicker label="Nouvelle version" onFile={(file) => handleNewVersion(doc, file)} />
                    )}
                    <select
                      defaultValue=""
                      title="Prévenir un pôle qu'une pièce est disponible"
                      onChange={(e) => {
                        if (e.target.value) {
                          handleNotify(doc, e.target.value);
                          e.target.value = "";
                        }
                      }}
                      style={{ fontSize: 11, border: "1px solid var(--line)", borderRadius: 6, padding: "3px 6px", background: "#fff" }}
                    >
                      <option value="">Signaler au pôle…</option>
                      {roles.map((r) => (
                        <option key={r.id} value={r.code}>
                          {r.label}
                        </option>
                      ))}
                    </select>
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      ))}

      {reportFiles.length > 0 && (
        <div style={{ marginTop: 14 }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: "var(--eclosion)", marginBottom: 6 }}>Rapports de lecture joints</div>
          {reportFiles.map((a) => (
            <div key={a.id} style={{ borderTop: "1px solid var(--line)", padding: "8px 0", fontSize: 13, display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
              <span>
                {a.reportFileName ?? "Rapport de lecture"}{" "}
                <span style={{ fontSize: 11, color: "var(--muted)" }}>· {a.reader?.username ?? "relecteur"}</span>
              </span>
              <span style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
                <a href={readingReportFileUrl(a.id)} target="_blank" rel="noreferrer" style={{ color: "var(--eclosion)", fontSize: 12, fontWeight: 600 }}>
                  📎 Télécharger
                </a>
                <button
                  type="button"
                  onClick={() => imprimerSurEntete(a)}
                  style={{ background: "none", border: "none", padding: 0, cursor: "pointer", color: "var(--eclosion-dark, #9a7a12)", fontSize: 12, fontWeight: 600 }}
                >
                  🖨 Sur papier à en-tête
                </button>
              </span>
            </div>
          ))}
        </div>
      )}

      {docs.length === 0 && reportFiles.length === 0 && <p style={{ fontSize: 13, color: "var(--muted)", margin: "8px 0 0" }}>Aucune pièce jointe pour cet ouvrage.</p>}
    </div>
  );
}

function UploadForm({
  manuscriptId,
  onDone,
  onError,
  onMessage,
}: {
  manuscriptId: string;
  onDone: () => void | Promise<void>;
  onError: (m: string) => void;
  onMessage: (m: string) => void;
}) {
  const [category, setCategory] = useState("couverture");
  const [title, setTitle] = useState("");
  const [confidentiality, setConfidentiality] = useState("interne");
  const [file, setFile] = useState<File | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!file) {
      onError("Choisissez un fichier à déposer.");
      return;
    }
    setSubmitting(true);
    try {
      const doc = await createDocument({
        entity_type: "manuscript",
        entity_id: manuscriptId,
        category,
        title: title.trim() || file.name,
        confidentiality,
      });
      await uploadDocumentVersion(doc.id, file);
      onMessage(`Pièce « ${title.trim() || file.name} » déposée.`);
      setTitle("");
      setFile(null);
      await onDone();
    } catch (err) {
      onError(err instanceof Error ? err.message : "Échec du dépôt.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} style={{ border: "1px solid var(--line)", borderRadius: 8, padding: 12, background: "var(--paper)" }}>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
        <label style={labelStyle}>
          Type de pièce
          <select value={category} onChange={(e) => setCategory(e.target.value)} style={fieldStyle}>
            {CATEGORY_ORDER.map((c) => (
              <option key={c} value={c}>
                {CATEGORY_LABELS[c] ?? c}
              </option>
            ))}
          </select>
        </label>
        <label style={labelStyle}>
          Confidentialité
          <select value={confidentiality} onChange={(e) => setConfidentiality(e.target.value)} style={fieldStyle}>
            {Object.entries(CONFIDENTIALITY_LABELS).map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </select>
        </label>
      </div>
      <label style={{ ...labelStyle, marginTop: 8 }}>
        Intitulé (facultatif — le nom du fichier sinon)
        <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="ex. 1re de couverture" style={fieldStyle} />
      </label>

      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          if (e.dataTransfer.files[0]) setFile(e.dataTransfer.files[0]);
        }}
        style={{
          marginTop: 8,
          border: `1px dashed ${dragOver ? "var(--eclosion)" : "var(--line)"}`,
          borderRadius: 8,
          padding: 14,
          textAlign: "center",
          background: dragOver ? "var(--eclosion-soft)" : "transparent",
          fontSize: 13,
          color: "var(--muted)",
        }}
      >
        {file ? (
          <span style={{ color: "var(--ink)" }}>{file.name}</span>
        ) : (
          <>
            Glissez-déposez un fichier ici, ou{" "}
            <FilePicker label="choisir un fichier" onFile={setFile} inline />
          </>
        )}
      </div>

      <button type="submit" disabled={submitting} style={primaryButtonStyle(submitting)}>
        Déposer la pièce
      </button>
    </form>
  );
}

// Sélecteur de fichier réutilisable : un bouton (label) masquant un input file,
// utilisable sur mobile comme sur ordinateur.
function FilePicker({ label, onFile, inline }: { label: string; onFile: (f: File) => void; inline?: boolean }) {
  const ref = useRef<HTMLInputElement>(null);
  return (
    <>
      <button
        type="button"
        onClick={() => ref.current?.click()}
        style={
          inline
            ? { background: "none", border: "none", color: "var(--eclosion)", cursor: "pointer", fontSize: 13, padding: 0, textDecoration: "underline" }
            : { background: "#fff", border: "1px solid var(--line)", borderRadius: 6, padding: "4px 10px", fontSize: 12, cursor: "pointer" }
        }
      >
        {label}
      </button>
      <input
        ref={ref}
        type="file"
        style={{ display: "none" }}
        onChange={(e) => {
          if (e.target.files?.[0]) onFile(e.target.files[0]);
          e.target.value = "";
        }}
      />
    </>
  );
}

function Banner({ tone, children }: { tone: "alert" | "ok"; children: React.ReactNode }) {
  const alert = tone === "alert";
  return (
    <div
      style={{
        background: alert ? "var(--alert-soft)" : "var(--eclosion-soft)",
        color: alert ? "var(--alert)" : "var(--eclosion)",
        borderRadius: 6,
        padding: "8px 12px",
        fontSize: 13,
        marginBottom: 10,
      }}
    >
      {children}
    </div>
  );
}

const labelStyle: React.CSSProperties = { display: "block", fontSize: 12, color: "var(--muted)" };
const fieldStyle: React.CSSProperties = {
  display: "block",
  width: "100%",
  marginTop: 4,
  padding: "8px 10px",
  border: "1px solid var(--line)",
  borderRadius: 6,
  fontSize: 13,
  background: "#fff",
};

function primaryButtonStyle(disabled: boolean): React.CSSProperties {
  return {
    marginTop: 10,
    background: "var(--eclosion)",
    color: "#fff",
    border: "none",
    borderRadius: 6,
    padding: "8px 16px",
    fontSize: 13,
    fontWeight: 600,
    cursor: disabled ? "default" : "pointer",
    opacity: disabled ? 0.6 : 1,
  };
}
