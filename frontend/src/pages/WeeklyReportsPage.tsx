import { useEffect, useState } from "react";
import {
  currentWeeklyReport,
  getWeeklyReport,
  listObjectives,
  listWeeklyReports,
  patchWeeklyReport,
  submitWeeklyReport,
  validateWeeklyReport,
  type EffectiveUser,
  type Objective,
  type WeeklyReport,
  type WeeklyReportStatus,
} from "../api/client";
import { Card } from "../components/Card";
import { Modal } from "../components/Modal";

const badge: React.CSSProperties = {
  background: "var(--eclosion-soft)",
  color: "var(--eclosion)",
  borderRadius: 999,
  padding: "2px 10px",
  fontSize: 11,
};

const STATUS_LABELS: Record<WeeklyReportStatus, string> = {
  draft: "Brouillon",
  submitted: "Soumis — en attente de validation",
  validated: "Validé",
  returned: "Retourné pour révision",
};

interface LineDraft {
  objective_id?: string;
  label: string;
  progress_pct: number;
  comment: string;
}

function fmtDate(s: string) {
  return new Date(s).toLocaleDateString("fr-FR");
}

// Rapports hebdomadaires (Demande 3) : chaque agent rédige son rapport de la
// période, relié à ses objectifs et à sa recherche ; le chef de département (son
// pôle) ou la Direction générale suivent et valident.
export function WeeklyReportsPage({ user }: { user: EffectiveUser }) {
  const isOversight = user.permissions.includes("direction:consultation");
  const isChef = user.roles.includes("CHEF_DEPARTEMENT");

  return (
    <div className="ecl-page" style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <MyReport userId={user.id} />
      <MyObjectives userId={user.id} />
      {(isOversight || isChef) && <ReportOversight />}
    </div>
  );
}

function MyReport({ userId }: { userId: string }) {
  const [report, setReport] = useState<WeeklyReport | null>(null);
  const [objectives, setObjectives] = useState<Objective[]>([]);
  const [lines, setLines] = useState<LineDraft[]>([]);
  const [fields, setFields] = useState({ achievements: "", research: "", difficulties: "", next_plan: "" });
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    currentWeeklyReport()
      .then((r) => {
        setReport(r);
        setFields({
          achievements: r.achievements ?? "",
          research: r.research ?? "",
          difficulties: r.difficulties ?? "",
          next_plan: r.nextPlan ?? "",
        });
        setLines(r.objectives.map((o) => ({ objective_id: o.objectiveId ?? undefined, label: o.label ?? o.objective?.title ?? "", progress_pct: o.progressPct, comment: o.comment ?? "" })));
      })
      .catch((e) => setError(e instanceof Error ? e.message : "Chargement impossible."));
    listObjectives(userId).then(setObjectives).catch(() => setObjectives([]));
  }, [userId]);

  const editable = report?.status === "draft" || report?.status === "returned";

  async function save() {
    if (!report) return;
    setBusy(true);
    setError(null);
    setMsg(null);
    try {
      const updated = await patchWeeklyReport(report.id, {
        ...fields,
        objectives: lines.filter((l) => l.label.trim() || l.objective_id).map((l) => ({ objective_id: l.objective_id, label: l.label.trim() || undefined, progress_pct: l.progress_pct, comment: l.comment || undefined })),
      });
      setReport(updated);
      setMsg("Rapport enregistré.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Échec de l'enregistrement.");
    } finally {
      setBusy(false);
    }
  }

  async function submit() {
    if (!report) return;
    await save();
    try {
      const updated = await submitWeeklyReport(report.id);
      setReport(updated);
      setMsg("Rapport soumis pour validation.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Échec de la soumission.");
    }
  }

  function addObjectiveLine(o: Objective) {
    if (lines.some((l) => l.objective_id === o.id)) return;
    setLines((cur) => [...cur, { objective_id: o.id, label: o.title, progress_pct: 0, comment: "" }]);
  }

  if (error && !report) return <Card title="Mon rapport de la période"><p style={{ color: "var(--alert)" }}>{error}</p></Card>;
  if (!report) return <Card title="Mon rapport de la période"><p style={{ color: "var(--muted)" }}>Chargement…</p></Card>;

  const unusedObjectives = objectives.filter((o) => o.status === "active" && !lines.some((l) => l.objective_id === o.id));

  return (
    <Card
      title="Mon rapport de la période"
      subtitle={`Du ${fmtDate(report.periodStart)} au ${fmtDate(report.periodEnd)}`}
      action={<span style={badge}>{STATUS_LABELS[report.status]}</span>}
    >
      {report.status === "returned" && report.validationComment && (
        <p style={{ background: "var(--alert-soft)", color: "var(--alert)", borderRadius: 8, padding: "8px 12px", fontSize: 13 }}>
          Retourné : {report.validationComment}
        </p>
      )}
      {report.status === "validated" && (
        <p style={{ background: "var(--eclosion-soft)", color: "var(--eclosion)", borderRadius: 8, padding: "8px 12px", fontSize: 13 }}>
          Rapport validé{report.validatedBy ? ` par ${report.validatedBy.username}` : ""}{report.validationComment ? ` — « ${report.validationComment} »` : ""}.
        </p>
      )}

      <div style={{ display: "grid", gap: 12 }}>
        <FieldArea label="Objectifs et avancement" hint="Reliez vos objectifs (chiffrés) et ajoutez des points libres.">
          {lines.map((l, i) => (
            <div key={i} style={{ display: "grid", gridTemplateColumns: "1fr 90px 1fr 30px", gap: 8, alignItems: "center", marginBottom: 6 }}>
              <input disabled={!editable || !!l.objective_id} value={l.label} onChange={(e) => setLines((c) => c.map((x, idx) => (idx === i ? { ...x, label: e.target.value } : x)))} placeholder="Objectif" style={inp} />
              <input disabled={!editable} type="number" min={0} max={100} value={l.progress_pct} onChange={(e) => setLines((c) => c.map((x, idx) => (idx === i ? { ...x, progress_pct: Number(e.target.value) } : x)))} title="Avancement %" style={inp} />
              <input disabled={!editable} value={l.comment} onChange={(e) => setLines((c) => c.map((x, idx) => (idx === i ? { ...x, comment: e.target.value } : x)))} placeholder="Commentaire" style={inp} />
              {editable && <button onClick={() => setLines((c) => c.filter((_, idx) => idx !== i))} style={miniBtn} title="Retirer">✕</button>}
            </div>
          ))}
          {editable && (
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 4 }}>
              <button onClick={() => setLines((c) => [...c, { label: "", progress_pct: 0, comment: "" }])} style={miniBtn}>+ Point libre</button>
              {unusedObjectives.map((o) => (
                <button key={o.id} onClick={() => addObjectiveLine(o)} style={miniBtn} title={o.targetValue ? `Cible : ${o.targetValue} ${o.unit ?? ""}` : ""}>
                  + {o.title}
                </button>
              ))}
            </div>
          )}
        </FieldArea>

        <FieldArea label="Réalisations">
          <textarea disabled={!editable} rows={3} value={fields.achievements} onChange={(e) => setFields((f) => ({ ...f, achievements: e.target.value }))} style={ta} />
        </FieldArea>
        <FieldArea label="Recherche / veille">
          <textarea disabled={!editable} rows={3} value={fields.research} onChange={(e) => setFields((f) => ({ ...f, research: e.target.value }))} style={ta} />
        </FieldArea>
        <FieldArea label="Difficultés / besoins">
          <textarea disabled={!editable} rows={2} value={fields.difficulties} onChange={(e) => setFields((f) => ({ ...f, difficulties: e.target.value }))} style={ta} />
        </FieldArea>
        <FieldArea label="Plan de la période suivante">
          <textarea disabled={!editable} rows={2} value={fields.next_plan} onChange={(e) => setFields((f) => ({ ...f, next_plan: e.target.value }))} style={ta} />
        </FieldArea>
      </div>

      {msg && <p style={{ color: "var(--eclosion)", fontSize: 13 }}>{msg}</p>}
      {error && <p style={{ color: "var(--alert)", fontSize: 13 }}>{error}</p>}

      {editable && (
        <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
          <button onClick={save} disabled={busy} style={btnSecondary}>Enregistrer</button>
          <button onClick={submit} disabled={busy} style={btnPrimary}>Soumettre</button>
        </div>
      )}
    </Card>
  );
}

function MyObjectives({ userId }: { userId: string }) {
  const [objectives, setObjectives] = useState<Objective[]>([]);
  useEffect(() => {
    listObjectives(userId).then(setObjectives).catch(() => setObjectives([]));
  }, [userId]);
  return (
    <Card title="Mes objectifs" subtitle="Fixés par votre chef de département ou la Direction générale.">
      {objectives.length === 0 ? (
        <p style={{ color: "var(--muted)", fontSize: 13 }}>Aucun objectif défini pour l'instant.</p>
      ) : (
        objectives.map((o) => (
          <div key={o.id} style={{ borderTop: "1px solid var(--line)", padding: "8px 0", fontSize: 13 }}>
            <b>{o.title}</b>
            {o.targetValue && <span style={{ color: "var(--muted)" }}> — cible : <span style={{ fontFamily: "var(--font-mono)" }}>{o.targetValue}</span> {o.unit}</span>}
            <div style={{ fontSize: 12, color: "var(--muted)" }}>Période du {fmtDate(o.periodStart)} au {fmtDate(o.periodEnd)}</div>
          </div>
        ))
      )}
    </Card>
  );
}

// Suivi / validation (chef de pôle ou Direction générale).
function ReportOversight() {
  const [reports, setReports] = useState<WeeklyReport[]>([]);
  const [open, setOpen] = useState<WeeklyReport | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = () => listWeeklyReports().then(setReports).catch((e) => setError(e.message));
  useEffect(() => {
    refresh();
  }, []);

  return (
    <Card title="Suivi des rapports" subtitle="Rapports de votre périmètre — à consulter et valider.">
      {error && <p style={{ color: "var(--alert)", fontSize: 13 }}>{error}</p>}
      {reports.length === 0 ? (
        <p style={{ color: "var(--muted)", fontSize: 13 }}>Aucun rapport dans votre périmètre.</p>
      ) : (
        reports.map((r) => (
          <div key={r.id} style={{ borderTop: "1px solid var(--line)", padding: "8px 0", fontSize: 13, display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <span>
              <b>{r.user?.username}</b> · {r.pole} · {fmtDate(r.periodStart)}
            </span>
            <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span style={badge}>{STATUS_LABELS[r.status]}</span>
              <button onClick={() => getWeeklyReport(r.id).then(setOpen).catch((e) => setError(e.message))} style={miniBtn}>Ouvrir</button>
            </span>
          </div>
        ))
      )}
      {open && <ReviewModal report={open} onClose={() => setOpen(null)} onDone={() => { setOpen(null); refresh(); }} />}
    </Card>
  );
}

function ReviewModal({ report, onClose, onDone }: { report: WeeklyReport; onClose: () => void; onDone: () => void }) {
  const [comment, setComment] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function act(decision: "validate" | "return") {
    setBusy(true);
    setError(null);
    try {
      await validateWeeklyReport(report.id, { decision, comment: comment || undefined });
      onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Échec.");
      setBusy(false);
    }
  }

  return (
    <Modal
      title={`Rapport de ${report.user?.username ?? ""} — ${fmtDate(report.periodStart)}`}
      wide
      onClose={onClose}
      footer={
        report.status === "submitted" ? (
          <>
            <button onClick={() => act("return")} disabled={busy} style={btnSecondary}>Retourner</button>
            <button onClick={() => act("validate")} disabled={busy} style={btnPrimary}>Valider</button>
          </>
        ) : (
          <button onClick={onClose} style={btnSecondary}>Fermer</button>
        )
      }
    >
      <div style={{ fontSize: 13, display: "grid", gap: 10 }}>
        <Block title="Objectifs">
          {report.objectives.length === 0
            ? "—"
            : report.objectives.map((o) => (
                <div key={o.id}>• {o.objective?.title ?? o.label} — <b>{o.progressPct}%</b>{o.comment ? ` (${o.comment})` : ""}</div>
              ))}
        </Block>
        <Block title="Réalisations">{report.achievements || "—"}</Block>
        <Block title="Recherche / veille">{report.research || "—"}</Block>
        <Block title="Difficultés / besoins">{report.difficulties || "—"}</Block>
        <Block title="Plan suivant">{report.nextPlan || "—"}</Block>
      </div>
      {report.status === "submitted" && (
        <textarea placeholder="Commentaire (facultatif)" value={comment} onChange={(e) => setComment(e.target.value)} rows={2} style={{ ...ta, marginTop: 10 }} />
      )}
      {error && <p style={{ color: "var(--alert)", fontSize: 13 }}>{error}</p>}
    </Modal>
  );
}

function Block({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <div style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: ".5px", color: "var(--muted)" }}>{title}</div>
      <div style={{ whiteSpace: "pre-wrap" }}>{children}</div>
    </div>
  );
}

function FieldArea({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div>
      <div style={{ fontSize: 12, fontWeight: 600 }}>{label}</div>
      {hint && <div style={{ fontSize: 11, color: "var(--muted)", marginBottom: 4 }}>{hint}</div>}
      {children}
    </div>
  );
}

const inp: React.CSSProperties = { width: "100%", padding: 6, fontSize: 13, boxSizing: "border-box" };
const ta: React.CSSProperties = { width: "100%", padding: 8, fontSize: 13, boxSizing: "border-box", fontFamily: "inherit" };
const miniBtn: React.CSSProperties = { background: "#fff", border: "1px solid var(--line)", borderRadius: 6, padding: "5px 10px", fontSize: 12, cursor: "pointer" };
const btnSecondary: React.CSSProperties = { ...miniBtn, padding: "7px 14px" };
const btnPrimary: React.CSSProperties = { ...btnSecondary, background: "var(--eclosion)", color: "#fff", border: "none" };
