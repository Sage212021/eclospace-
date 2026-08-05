import { useEffect, useRef, useState } from "react";
import {
  listEvaluationCriteria,
  listMyReadingAssignments,
  submitEvaluation,
  uploadReadingReportFile,
  readingReportFileUrl,
  readingManuscriptFileUrl,
  attachReadingReport,
  getChatDirectory,
  startConversation,
  sendChatMessage,
  sendChatMessageWithFile,
  type ChatDirectoryEntry,
  type EvaluationCriterion,
  type ReadingAssignment,
} from "../api/client";
import { Button } from "../components/Button";
import { GuidanceNote } from "../components/GuidanceNote";
import { Field } from "../components/Modal";
import { printReadingReport, type PrintOpts } from "../lib/print";
import { buildReadingReport } from "../lib/readingReport";

const STATUS_LABELS: Record<string, string> = {
  pending: "À évaluer",
  submitted: "Remise",
  late: "En retard",
  cancelled: "Annulée",
};

// Vue lecteur du comité de lecture (Ch. 7 §7.3) : missions attribuées et
// formulaire de notation pondérée (Ch. 7 §7.4-7.5). Menu local en accordéon
// (même logique que le pôle éditorial) : missions regroupées par état — à
// évaluer, en retard, remises — pour retrouver d'un clic ce qu'il reste à faire.
import { useI18n } from "../i18n";

// Une mission est « en retard » si le serveur l'a marquée late, ou si elle est
// encore à évaluer alors que l'échéance est passée.
function isLate(a: ReadingAssignment): boolean {
  return a.status === "late" || (a.status === "pending" && new Date(a.dueAt).getTime() < Date.now());
}

export function MyReadings() {
  const { t } = useI18n();
  const [assignments, setAssignments] = useState<ReadingAssignment[]>([]);
  const [openAssignmentId, setOpenAssignmentId] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [section, setSection] = useState<string>("a_evaluer");

  const refresh = () => listMyReadingAssignments().then(setAssignments);

  useEffect(() => {
    refresh();
  }, []);

  async function attachFile(assignmentId: string, file: File) {
    try {
      await uploadReadingReportFile(assignmentId, file);
      setMessage(t("myr.file_attached_ok", "Rapport de relecture (fichier) joint."));
      await refresh();
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Dépôt du fichier impossible.");
    }
  }

  const cardProps = { openAssignmentId, setOpenAssignmentId, attachFile, refresh, setMessage };

  // Groupes du menu local : à évaluer (en cours, à l'heure), en retard, remises.
  const aEvaluer = assignments.filter((a) => a.status === "pending" && !isLate(a));
  const enRetard = assignments.filter((a) => isLate(a));
  const remises = assignments.filter((a) => a.status === "submitted");

  const buckets: { key: string; label: string; icon: string; items: ReadingAssignment[]; empty: string }[] = [
    { key: "a_evaluer", label: t("myr.bucket.pending", "À évaluer"), icon: "📖", items: aEvaluer, empty: t("myr.bucket.pending_empty", "Aucune mission à évaluer.") },
    { key: "en_retard", label: t("myr.bucket.late", "En retard"), icon: "⏰", items: enRetard, empty: t("myr.bucket.late_empty", "Aucune mission en retard.") },
    { key: "remises", label: t("myr.bucket.submitted", "Remises"), icon: "✅", items: remises, empty: t("myr.bucket.submitted_empty", "Aucune évaluation remise pour l'instant.") },
  ];

  return (
    <div className="ecl-page" style={{ maxWidth: 720 }}>
      <h1 className="ecl-page__title">{t("page.myreadings.title", "Mes lectures")}</h1>
      <p className="ecl-page__lead">{t("page.myreadings.lead", "Vos missions de lecture et la remise de vos évaluations.")}</p>

      <GuidanceNote title={t("myr.note.title", "Votre boîte de lecture personnelle")}>
        {t(
          "myr.note.body",
          "Cette page n'affiche que les missions confiées à VOTRE compte. Elle reste vide tant qu'un responsable ne vous a pas affecté(e) comme relecteur d'un manuscrit (au « Comité de lecture »). Les missions que vous confiez à d'autres apparaissent dans LEUR page « Mes lectures », pas ici.",
        )}
      </GuidanceNote>

      {message && (
        <div style={{ background: "var(--eclosion-soft)", color: "var(--eclosion)", borderRadius: 8, padding: "9px 13px", fontSize: 13, marginTop: 12 }}>
          {message}
        </div>
      )}

      <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 12 }}>
        {buckets.map((b) => (
            <AccordionSection
              key={b.key}
              open={section === b.key}
              onToggle={() => setSection(section === b.key ? "" : b.key)}
              icon={b.icon}
              label={b.label}
              count={b.items.length}
            >
              {b.items.length === 0 ? (
                <p style={{ fontSize: 13, color: "var(--muted)", margin: 0 }}>{b.empty}</p>
              ) : (
                b.items.map((assignment) => <AssignmentCard key={assignment.id} assignment={assignment} {...cardProps} />)
              )}
            </AccordionSection>
          ))}
      </div>
    </div>
  );
}

// Carte d'une mission de lecture : échéance, statut, dépôt de fichier de
// rapport et formulaire d'évaluation (inchangé). Extrait pour être réutilisé
// dans chaque section du menu local.
function AssignmentCard({
  assignment,
  openAssignmentId,
  setOpenAssignmentId,
  attachFile,
  refresh,
  setMessage,
}: {
  assignment: ReadingAssignment;
  openAssignmentId: string | null;
  setOpenAssignmentId: (id: string | null) => void;
  attachFile: (assignmentId: string, file: File) => void;
  refresh: () => void;
  setMessage: (m: string) => void;
}) {
  const { t, lang } = useI18n();
  return (
    <section className="ecl-card">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontWeight: 700, fontSize: 14.5, color: "var(--ink)" }}>{assignment.manuscript?.title}</div>
          <div style={{ fontSize: 12.5, color: "var(--muted)", marginTop: 3, display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
            <span>
              {t("myr.deadline", "Échéance")} : {new Date(assignment.dueAt).toLocaleDateString(lang === "en" ? "en-GB" : "fr-FR")}
            </span>
            <StatusChip label={t(`myr.status.${assignment.status}`, STATUS_LABELS[assignment.status] ?? assignment.status)} />
          </div>
        </div>
        {(assignment.status === "pending" || assignment.status === "late") && (
          <Button
            variant={openAssignmentId === assignment.id ? "view" : "add"}
            size="sm"
            onClick={() => setOpenAssignmentId(openAssignmentId === assignment.id ? null : assignment.id)}
          >
            {openAssignmentId === assignment.id ? t("myr.close", "Fermer") : t("myr.evaluate", "Évaluer")}
          </Button>
        )}
        {assignment.evaluation && <ReportMenu assignment={assignment} onMessage={setMessage} />}
      </div>

      {/* ENTRÉE de la mission : le manuscrit confié, que le relecteur ouvre pour
          le lire. Téléchargé depuis sa mission (pas besoin du droit « documents »). */}
      <div style={handoffRow}>
        <span style={handoffTag("in")}>{t("myr.inbox", "À lire")}</span>
        {assignment.manuscriptHasFile ? (
          <a href={readingManuscriptFileUrl(assignment.id)} target="_blank" rel="noreferrer" style={{ color: "var(--eclosion-dark)", fontWeight: 600 }}>
            📖 {t("myr.open_manuscript", "Ouvrir le manuscrit à lire")}
          </a>
        ) : (
          <span style={{ color: "var(--muted)" }}>{t("myr.no_manuscript_file", "Le fichier du manuscrit n'a pas encore été déposé sur l'ouvrage.")}</span>
        )}
      </div>

      {/* SORTIE de la mission : le rapport de relecture, déposé ici et reçu à
          l'étape suivante (décision éditoriale). */}
      <div style={handoffRow}>
        <span style={handoffTag("out")}>{t("myr.outbox", "À remettre")}</span>
        <label style={fileBtnStyle}>
          {assignment.hasReportFile ? t("myr.file_replace", "Remplacer le fichier joint") : t("myr.file_attach", "Déposer mon rapport (fichier)")}
          <input
            type="file"
            style={{ display: "none" }}
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) attachFile(assignment.id, f);
              e.target.value = "";
            }}
          />
        </label>
        {assignment.hasReportFile && (
          <a href={readingReportFileUrl(assignment.id)} target="_blank" rel="noreferrer" style={{ color: "var(--eclosion-dark)", fontWeight: 600 }}>
            📎 {assignment.reportFileName ?? t("myr.file_download", "Télécharger le fichier joint")}
          </a>
        )}
        <span style={{ color: "var(--muted)", fontSize: 11.5 }}>{t("myr.received_by", "→ reçu par la Direction éditoriale")}</span>
      </div>
      {openAssignmentId === assignment.id && (
        <EvaluationForm
          assignmentId={assignment.id}
          onSubmitted={() => {
            setOpenAssignmentId(null);
            setMessage(t("myr.submitted_ok", "Évaluation remise avec succès."));
            refresh();
          }}
        />
      )}
    </section>
  );
}

function EvaluationForm({ assignmentId, onSubmitted }: { assignmentId: string; onSubmitted: () => void }) {
  const { t } = useI18n();
  const [criteria, setCriteria] = useState<EvaluationCriterion[]>([]);
  const [scores, setScores] = useState<Record<string, number>>({});
  const [comment, setComment] = useState("");
  const [recommendation, setRecommendation] = useState<"accept" | "accept_minor" | "accept_major" | "rewrite" | "new_expertise" | "reject">("accept");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    listEvaluationCriteria().then((c) => {
      setCriteria(c);
      setScores(Object.fromEntries(c.map((crit) => [crit.id, 5])));
    });
  }, []);

  const totalCoefficient = criteria.reduce((sum, c) => sum + Number(c.coefficient), 0);
  const livePreview =
    totalCoefficient > 0
      ? criteria.reduce((sum, c) => sum + (scores[c.id] ?? 0) * Number(c.coefficient), 0) / totalCoefficient
      : 0;

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    try {
      await submitEvaluation(assignmentId, {
        scores: criteria.map((c) => ({ criterion_id: c.id, score: scores[c.id] ?? 0 })),
        overall_comment: comment,
        recommendation,
      });
      onSubmitted();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Échec de la remise.");
    }
  }

  return (
    <form onSubmit={handleSubmit} style={{ marginTop: 16, borderTop: "1px solid var(--line)", paddingTop: 16 }}>
      {criteria.map((criterion) => (
        <div key={criterion.id} style={{ marginBottom: 12 }}>
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12.5 }}>
            <span>
              {criterion.label} <span style={{ color: "var(--muted)" }}>({t("myr.coef", "coef.")} {criterion.coefficient})</span>
            </span>
            <span style={{ fontFamily: "var(--font-mono)", fontWeight: 600 }}>{scores[criterion.id] ?? 0}/10</span>
          </div>
          <input
            type="range"
            min={0}
            max={10}
            step={0.5}
            value={scores[criterion.id] ?? 5}
            onChange={(e) => setScores((s) => ({ ...s, [criterion.id]: Number(e.target.value) }))}
            style={{ width: "100%", accentColor: "var(--eclosion)" }}
          />
        </div>
      ))}

      <div style={{ fontSize: 12.5, color: "var(--muted)", margin: "6px 0 14px", padding: "8px 12px", background: "var(--paper)", borderRadius: 8 }}>
        {t("myr.global_score", "Score global indicatif (recalculé et validé par le serveur à la remise) :")}{" "}
        <strong style={{ fontFamily: "var(--font-mono)", color: "var(--ink)" }}>{livePreview.toFixed(2)}</strong>
      </div>

      <Field label={t("myr.recommendation", "Recommandation")}>
        <select value={recommendation} onChange={(e) => setRecommendation(e.target.value as typeof recommendation)}>
          <option value="accept">{t("myr.reco.accept", "Acceptation sans modification")}</option>
          <option value="accept_minor">{t("myr.reco.accept_minor", "Acceptation sous réserve de corrections mineures")}</option>
          <option value="accept_major">{t("myr.reco.accept_major", "Acceptation sous réserve de corrections majeures")}</option>
          <option value="rewrite">{t("myr.reco.rewrite", "Demande de réécriture")}</option>
          <option value="new_expertise">{t("myr.reco.new_expertise", "Nouvelle expertise")}</option>
          <option value="reject">{t("myr.reco.reject", "Refus motivé")}</option>
        </select>
      </Field>

      <div style={{ marginTop: 12 }}>
        <Field label={t("myr.general_comment", "Appréciation générale")}>
          <textarea value={comment} onChange={(e) => setComment(e.target.value)} rows={3} />
        </Field>
      </div>

      {error && <p style={{ color: "var(--alert)", fontSize: 12.5, marginTop: 10 }}>{error}</p>}

      <div style={{ marginTop: 14 }}>
        <Button variant="add" size="md" type="submit">{t("myr.submit_report", "Remettre mon rapport")}</Button>
      </div>
    </form>
  );
}

function StatusChip({ label }: { label: string }) {
  return (
    <span style={{ fontSize: 11, fontWeight: 600, color: "var(--muted)", background: "var(--paper)", border: "1px solid var(--line)", borderRadius: 999, padding: "2px 9px", whiteSpace: "nowrap" }}>
      {label}
    </span>
  );
}

// Libellés des recommandations, pour le résumé texte (copie / transfert).
const RECO_LABELS: Record<string, string> = {
  accept: "Acceptation sans modification",
  accept_minor: "Acceptation sous réserve de corrections mineures",
  accept_major: "Acceptation sous réserve de corrections majeures",
  rewrite: "Demande de réécriture",
  new_expertise: "Nouvelle expertise",
  reject: "Refus motivé",
};

function reportSummary(a: ReadingAssignment): string {
  const e = a.evaluation;
  const lines = [`Rapport de lecture — « ${a.manuscript?.title ?? ""} »`];
  if (e) {
    lines.push(`Recommandation : ${RECO_LABELS[e.recommendation] ?? e.recommendation}`);
    lines.push(`Score global : ${Number(e.globalScore).toFixed(2)}/10`);
    if (e.overallComment) lines.push(`Appréciation : ${e.overallComment}`);
    for (const s of e.scores) lines.push(`• ${s.criterion.label} : ${s.score}/10`);
  }
  return lines.join("\n");
}

// Menu « Mon rapport … » sur une mission remise : télécharger (PDF, 3 formats),
// extraire le fichier joint, joindre à l'ouvrage (reçu par la Direction),
// transférer par messagerie à un collègue, ou copier le résumé.
function ReportMenu({ assignment, onMessage }: { assignment: ReadingAssignment; onMessage: (m: string) => void }) {
  const [transferOpen, setTransferOpen] = useState(false);
  const detailsRef = useRef<HTMLDetailsElement | null>(null);
  const close = () => {
    if (detailsRef.current) detailsRef.current.open = false;
  };
  const print = (opts: PrintOpts) => {
    printReadingReport(buildReadingReport(assignment), opts);
    close();
  };
  async function joindre() {
    close();
    try {
      await attachReadingReport(assignment.id);
      onMessage("Rapport joint à l'ouvrage — reçu par la Direction éditoriale.");
    } catch (e) {
      onMessage(e instanceof Error ? e.message : "Impossible de joindre le rapport.");
    }
  }
  async function copier() {
    close();
    try {
      await navigator.clipboard.writeText(reportSummary(assignment));
      onMessage("Résumé du rapport copié.");
    } catch {
      onMessage("Copie impossible sur cet appareil.");
    }
  }

  return (
    <>
      <details ref={detailsRef} style={{ position: "relative", display: "inline-block" }}>
        <summary style={menuSummaryStyle}>Mon rapport ▾</summary>
        <div style={menuBoxStyle}>
          <div style={menuHeadStyle}>Télécharger (PDF)</div>
          <button style={menuItemStyle} onClick={() => print({})}>Numérique / PDF</button>
          <button style={menuItemStyle} onClick={() => print({ embed: true })}>Avec papier à en-tête intégré</button>
          <button style={menuItemStyle} onClick={() => print({ letterhead: true })}>Sur papier à en-tête vierge</button>
          <div style={menuSepStyle} />
          {assignment.hasReportFile && (
            <a href={readingReportFileUrl(assignment.id)} target="_blank" rel="noreferrer" style={menuItemStyle} onClick={close}>
              📎 Extraire le fichier joint
            </a>
          )}
          <button style={menuItemStyle} onClick={joindre}>📌 Joindre à l'ouvrage</button>
          <button style={menuItemStyle} onClick={() => { close(); setTransferOpen(true); }}>✉️ Transférer par messagerie</button>
          <button style={menuItemStyle} onClick={copier}>📋 Copier le résumé</button>
        </div>
      </details>
      {transferOpen && <TransferDialog assignment={assignment} onClose={() => setTransferOpen(false)} onMessage={onMessage} />}
    </>
  );
}

// Transfert du rapport à un collègue via la messagerie interne (avec le fichier
// joint s'il existe, sinon le résumé texte).
function TransferDialog({ assignment, onClose, onMessage }: { assignment: ReadingAssignment; onClose: () => void; onMessage: (m: string) => void }) {
  const [dir, setDir] = useState<ChatDirectoryEntry[]>([]);
  const [recipient, setRecipient] = useState("");
  const [note, setNote] = useState("");
  const [sending, setSending] = useState(false);

  useEffect(() => {
    getChatDirectory().then((d) => {
      setDir(d);
      if (d[0]) setRecipient(d[0].id);
    }).catch(() => setDir([]));
  }, []);

  async function send() {
    if (!recipient) return;
    setSending(true);
    try {
      const conv = await startConversation(recipient);
      const body = (note.trim() ? note.trim() + "\n\n" : "") + reportSummary(assignment);
      if (assignment.hasReportFile) {
        const resp = await fetch(readingReportFileUrl(assignment.id), { credentials: "include" });
        const blob = await resp.blob();
        const file = new File([blob], assignment.reportFileName ?? "rapport-de-lecture", { type: blob.type || "application/octet-stream" });
        await sendChatMessageWithFile(conv.id, body, file);
      } else {
        await sendChatMessage(conv.id, body);
      }
      onMessage(`Rapport transféré à ${conv.other_name}.`);
      onClose();
    } catch (e) {
      onMessage(e instanceof Error ? e.message : "Transfert impossible.");
    } finally {
      setSending(false);
    }
  }

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(22,35,61,.35)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 50, padding: 16 }} onClick={onClose}>
      <div style={{ background: "#fff", borderRadius: 12, padding: 18, maxWidth: 420, width: "100%" }} onClick={(e) => e.stopPropagation()}>
        <div style={{ fontFamily: "var(--font-title)", fontSize: 16, marginBottom: 10 }}>Transférer mon rapport</div>
        <Field label="Destinataire">
          <select value={recipient} onChange={(e) => setRecipient(e.target.value)}>
            {dir.map((u) => (
              <option key={u.id} value={u.id}>{u.name}</option>
            ))}
          </select>
        </Field>
        <div style={{ marginTop: 10 }}>
          <Field label="Note (facultative)">
            <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} placeholder="Un mot d'accompagnement…" />
          </Field>
        </div>
        <p style={{ fontSize: 11.5, color: "var(--muted)", margin: "8px 0 0" }}>
          {assignment.hasReportFile ? "Le fichier de votre rapport sera joint au message." : "Le résumé de votre rapport sera envoyé (aucun fichier joint)."}
        </p>
        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 14 }}>
          <button onClick={onClose} style={{ background: "#fff", border: "1px solid var(--line)", borderRadius: 8, padding: "7px 13px", fontSize: 13, cursor: "pointer" }}>Annuler</button>
          <Button variant="add" size="sm" onClick={send} disabled={sending || !recipient}>{sending ? "Envoi…" : "Transférer"}</Button>
        </div>
      </div>
    </div>
  );
}

const menuSummaryStyle: React.CSSProperties = { listStyle: "none", background: "#fff", border: "1px solid var(--line)", borderRadius: 6, padding: "6px 12px", fontSize: 12, cursor: "pointer", userSelect: "none" };
const menuBoxStyle: React.CSSProperties = { position: "absolute", right: 0, zIndex: 20, marginTop: 4, background: "#fff", border: "1px solid var(--line)", borderRadius: 8, boxShadow: "0 8px 24px rgba(22,35,61,.14)", minWidth: 240, overflow: "hidden" };
const menuHeadStyle: React.CSSProperties = { fontSize: 10.5, fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.4, color: "var(--muted)", padding: "8px 12px 2px" };
const menuItemStyle: React.CSSProperties = { display: "block", width: "100%", textAlign: "left", background: "none", border: "none", padding: "8px 12px", fontSize: 13, color: "var(--ink)", cursor: "pointer", textDecoration: "none" };
const menuSepStyle: React.CSSProperties = { height: 1, background: "var(--line)", margin: "4px 0" };

// Section d'accordéon du menu local (même patron que le pôle éditorial).
function AccordionSection({
  open,
  onToggle,
  icon,
  label,
  count,
  children,
}: {
  open: boolean;
  onToggle: () => void;
  icon: string;
  label: string;
  count?: number;
  children: React.ReactNode;
}) {
  return (
    <div style={{ border: "1px solid var(--line)", borderRadius: 10, background: "var(--card)", overflow: "hidden" }}>
      <button
        onClick={onToggle}
        style={{ display: "flex", alignItems: "center", gap: 10, width: "100%", textAlign: "left", background: open ? "var(--eclosion-soft)" : "#fff", border: "none", padding: "12px 14px", cursor: "pointer", fontSize: 14, fontWeight: 600, color: "var(--ink)" }}
      >
        <span style={{ fontSize: 16 }}>{icon}</span>
        <span style={{ flex: 1 }}>{label}</span>
        {count !== undefined && (
          <span style={{ background: "var(--eclosion-soft)", color: "var(--eclosion-dark, #8A6A12)", borderRadius: 999, padding: "1px 9px", fontSize: 12, fontFamily: "var(--font-mono)" }}>{count}</span>
        )}
        <span style={{ color: "var(--muted)", display: "inline-block", transform: open ? "rotate(90deg)" : "none", transition: "transform .15s" }}>▸</span>
      </button>
      {open && <div style={{ padding: 14, borderTop: "1px solid var(--line)" }}>{children}</div>}
    </div>
  );
}

const fileBtnStyle: React.CSSProperties = {
  cursor: "pointer",
  fontWeight: 600,
  color: "var(--muted)",
  border: "1px solid var(--line)",
  borderRadius: 6,
  padding: "4px 10px",
};

// Ligne « entrée / sortie » d'une mission : ce qu'on reçoit, ce qu'on remet.
const handoffRow: React.CSSProperties = {
  display: "flex",
  gap: 10,
  flexWrap: "wrap",
  alignItems: "center",
  marginTop: 10,
  fontSize: 12.5,
};
function handoffTag(dir: "in" | "out"): React.CSSProperties {
  return {
    fontSize: 10.5,
    fontWeight: 700,
    textTransform: "uppercase",
    letterSpacing: 0.4,
    color: dir === "in" ? "var(--eclosion-dark, #8A6A12)" : "#2E6B4F",
    background: dir === "in" ? "var(--eclosion-soft)" : "#DDF0E5",
    borderRadius: 999,
    padding: "2px 9px",
    whiteSpace: "nowrap",
  };
}
