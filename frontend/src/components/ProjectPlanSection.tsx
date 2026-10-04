import { useEffect, useMemo, useState } from "react";
import {
  getProjectPlan,
  saveProjectPlan,
  getProjectPlanDocument,
  uploadProjectPlanDocument,
  projectPlanDocumentUrl,
  getBranding,
  type ProjectPlanActivity,
  type ProjectPlanDocument,
  type ProjectActivityPriority,
  type ProjectActivityStatus,
} from "../api/client";
import { Card } from "./Card";
import { Button } from "./Button";
import { DocPrintMenu } from "./DocPrintMenu";
import { printProjectPlan, type ProjectPlanPrintData } from "../lib/print";
import { buildProjectPlanPdf, downloadProjectPlanPdf } from "../lib/projectPlanPdf";

const fmtSize = (n?: number) => (n == null ? "" : n < 1024 ? `${n} o` : n < 1_048_576 ? `${(n / 1024).toFixed(0)} Ko` : `${(n / 1_048_576).toFixed(1)} Mo`);

// Planification du projet SAISIE dans Eclospace (plus de fichier à déposer) :
// informations générales + activités datées, liées au manuscrit. Après
// enregistrement : aperçu / impression / PDF officiel (en-tête + bloc
// « Direction éditoriale » avec le cachet enregistré dans le système).

const PRIORITIES: { value: ProjectActivityPriority; label: string }[] = [
  { value: "basse", label: "Basse" },
  { value: "normale", label: "Normale" },
  { value: "haute", label: "Haute" },
];
const STATUSES: { value: ProjectActivityStatus; label: string }[] = [
  { value: "a_faire", label: "À faire" },
  { value: "en_cours", label: "En cours" },
  { value: "termine", label: "Terminé" },
];

const emptyActivity = (): ProjectPlanActivity => ({
  label: "",
  responsible: "",
  location: "",
  start_date: null,
  end_date: null,
  priority: "normale",
  status: "a_faire",
  dependencies: "",
  observations: "",
});

// yyyy-mm-dd pour <input type="date"> ; renvoie "" si vide/invalide.
const toDateInput = (iso: string | null) => (iso ? iso.slice(0, 10) : "");
const durationDays = (a: string | null, b: string | null): number | null => {
  if (!a || !b) return null;
  const da = new Date(a).getTime();
  const db = new Date(b).getTime();
  if (Number.isNaN(da) || Number.isNaN(db) || db < da) return null;
  return Math.round((db - da) / 86_400_000) + 1;
};

const inputStyle: React.CSSProperties = { width: "100%", padding: "6px 8px", border: "1px solid var(--line)", borderRadius: 6, fontSize: 12.5, fontFamily: "inherit" };

export function ProjectPlanSection({ manuscriptId, manuscriptTitle, manuscriptNumber, canManage }: { manuscriptId: string; manuscriptTitle: string; manuscriptNumber: string; canManage: boolean }) {
  const [manager, setManager] = useState("");
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [objectives, setObjectives] = useState("");
  const [notes, setNotes] = useState("");
  const [activities, setActivities] = useState<ProjectPlanActivity[]>([]);
  const [version, setVersion] = useState(0);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [cachet, setCachet] = useState<string | null>(null);
  // Document officiel conservé : `doc` = carte fichier (nom/date/déposant…) ;
  // `generatedAt` = date du dernier PDF conservé ; `planUpdatedAt` = dernier
  // enregistrement. Si le planning a été modifié APRÈS la conservation, le PDF
  // détenu n'est plus à jour (invite à re-conserver).
  const [doc, setDoc] = useState<ProjectPlanDocument | null>(null);
  const [generatedAt, setGeneratedAt] = useState<string | null>(null);
  const [planUpdatedAt, setPlanUpdatedAt] = useState<string | null>(null);
  const [storing, setStoring] = useState(false);

  useEffect(() => {
    let done = false;
    const finish = () => { if (!done) { done = true; setLoaded(true); } };
    // Filet de sécurité : si la requête ne répond pas (réseau lent / point
    // d'accès indisponible), on débloque l'affichage au bout de 8 s pour que la
    // carte et le formulaire restent utilisables au lieu de rester bloqués.
    const guard = setTimeout(finish, 8000);
    getProjectPlan(manuscriptId)
      .then((p) => {
        if (p) {
          setManager(p.manager_name ?? "");
          setStart(toDateInput(p.start_date));
          setEnd(toDateInput(p.end_date));
          setObjectives(p.objectives ?? "");
          setNotes(p.notes ?? "");
          setActivities(p.activities.map((a) => ({ ...a, responsible: a.responsible ?? "", location: a.location ?? "", dependencies: a.dependencies ?? "", observations: a.observations ?? "" })));
          setVersion(p.version);
          setGeneratedAt(p.pdf_generated_at);
          setPlanUpdatedAt(p.updated_at);
        }
      })
      .catch((e) => setError(e instanceof Error ? e.message : "Chargement impossible."))
      .finally(() => { clearTimeout(guard); finish(); });
    getProjectPlanDocument(manuscriptId).then((d) => setDoc(d)).catch(() => {});
    getBranding().then((b) => setCachet(b.cachet_editoriale)).catch(() => {});
    return () => clearTimeout(guard);
  }, [manuscriptId]);

  const progress = useMemo(() => {
    if (activities.length === 0) return 0;
    return Math.round((activities.filter((a) => a.status === "termine").length / activities.length) * 100);
  }, [activities]);
  const globalDuration = durationDays(start ? `${start}T00:00:00` : null, end ? `${end}T00:00:00` : null);

  const touch = () => { setDirty(true); setMessage(null); };
  const updateActivity = (i: number, patch: Partial<ProjectPlanActivity>) => {
    setActivities((cur) => cur.map((a, j) => (j === i ? { ...a, ...patch } : a)));
    touch();
  };
  const move = (i: number, dir: -1 | 1) => {
    setActivities((cur) => {
      const next = [...cur];
      const j = i + dir;
      if (j < 0 || j >= next.length) return cur;
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });
    touch();
  };

  const hasEmptyLabel = activities.some((a) => !a.label.trim());

  async function save(quiet = false) {
    if (hasEmptyLabel) { if (!quiet) setError("Chaque activité doit avoir un intitulé."); return; }
    setBusy(true); setError(null);
    try {
      const saved = await saveProjectPlan(manuscriptId, {
        manager_name: manager.trim() || null,
        start_date: start || null,
        end_date: end || null,
        objectives: objectives.trim() || null,
        notes: notes.trim() || null,
        activities: activities.map((a) => ({
          label: a.label.trim(),
          responsible: (a.responsible ?? "").trim() || null,
          location: (a.location ?? "").trim() || null,
          start_date: a.start_date || null,
          end_date: a.end_date || null,
          priority: a.priority,
          status: a.status,
          dependencies: (a.dependencies ?? "").trim() || null,
          observations: (a.observations ?? "").trim() || null,
        })),
      });
      setVersion(saved.version);
      setPlanUpdatedAt(saved.updated_at);
      setDirty(false);
      setSavedAt(new Date().toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" }));
      if (!quiet) setMessage(`Planning enregistré (version ${saved.version}).`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Enregistrement impossible.");
    } finally {
      setBusy(false);
    }
  }

  // Sauvegarde AUTOMATIQUE : après une pause de saisie, le planning est
  // enregistré sans action de l'utilisateur (dès qu'il est valide). Le bouton
  // « Enregistrer maintenant » reste disponible comme filet.
  useEffect(() => {
    if (!canManage || !dirty || busy || hasEmptyLabel) return;
    const t = setTimeout(() => { void save(true); }, 1500);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dirty, busy, hasEmptyLabel, manager, start, end, objectives, notes, activities]);

  const printData = (): ProjectPlanPrintData => ({
    manuscriptTitle,
    manuscriptNumber,
    managerName: manager.trim() || null,
    startDate: start ? `${start}T00:00:00` : null,
    endDate: end ? `${end}T00:00:00` : null,
    objectives: objectives.trim() || null,
    notes: notes.trim() || null,
    version: version || 1,
    activities: activities.map((a) => ({
      label: a.label, responsible: (a.responsible ?? "").trim() || null,
      location: (a.location ?? "").trim() || null,
      startDate: a.start_date, endDate: a.end_date,
      priority: a.priority, status: a.status,
      dependencies: (a.dependencies ?? "").trim() || null, observations: (a.observations ?? "").trim() || null,
    })),
  });

  // « Déposer le planning » : on enregistre le planning s'il reste des
  // modifications, on génère le PDF officiel à partir des données saisies, et on
  // le CONSERVE côté serveur comme document versionné du dossier. C'est ce dépôt
  // qui autorise le passage à l'étape suivante et qui reste consultable ensuite.
  async function conserve() {
    setError(null); setMessage(null);
    try {
      if (canManage && !hasEmptyLabel && (dirty || version === 0)) await save(true);
      setStoring(true);
      const bytes = await buildProjectPlanPdf(printData(), cachet);
      const safe = (manuscriptTitle || "planning").replace(/[^a-zA-Z0-9._-]+/g, "-").slice(0, 60);
      const res = await uploadProjectPlanDocument(manuscriptId, bytes, `Planning-${safe}.pdf`);
      setGeneratedAt(res.deposited_at);
      setDoc(await getProjectPlanDocument(manuscriptId));
      setMessage(`Planning conservé (PDF officiel) — version ${res.version_number}.`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Conservation du planning impossible.");
    } finally {
      setStoring(false);
    }
  }

  // Le PDF officiel est-il conservé et à jour ? Non tant qu'aucun n'a été déposé,
  // ou si le planning a été enregistré après le dernier dépôt.
  const generated = !!doc?.has_file;
  const depositedAt = doc?.deposited_at ?? generatedAt;
  const stale = !!(generated && depositedAt && planUpdatedAt && new Date(planUpdatedAt).getTime() > new Date(depositedAt).getTime());

  // La carte reste TOUJOURS visible à l'étape Planification — même si le
  // chargement du planning est lent ou échoue, elle ne disparaît jamais
  // (sinon elle « manquait » sur certains postes, cf. incident 11/09/2026).
  if (!loaded) {
    return (
      <Card title="Planification du projet" subtitle="Renseignez le planning ici : il est lié au projet et devient un document officiel (aperçu + PDF), sans fichier à déposer." collapsible accent>
        {error
          ? <div style={{ background: "#f8e3df", color: "var(--danger, #B23A2E)", borderRadius: 8, padding: "8px 12px", fontSize: 13 }}>{error}</div>
          : <p style={{ color: "var(--muted)", fontSize: 13, margin: 0 }}>Chargement du planning…</p>}
      </Card>
    );
  }

  return (
    <Card title="Planification du projet" subtitle="Renseignez le planning ici : il est lié au projet et devient un document officiel (aperçu + PDF), sans fichier à déposer." collapsible accent>
      {error && <div style={{ background: "#f8e3df", color: "var(--danger, #B23A2E)", borderRadius: 8, padding: "8px 12px", fontSize: 13, marginBottom: 10 }}>{error}</div>}
      {message && <div style={{ background: "var(--eclosion-soft)", color: "var(--ink)", borderRadius: 8, padding: "8px 12px", fontSize: 13, marginBottom: 10 }}>{message}</div>}

      {/* Informations générales */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(180px,1fr))", gap: 10, marginBottom: 12 }}>
        <label style={{ fontSize: 12 }}>Responsable du projet
          <input value={manager} disabled={!canManage} onChange={(e) => { setManager(e.target.value); touch(); }} style={inputStyle} placeholder="Nom du responsable" />
        </label>
        <label style={{ fontSize: 12 }}>Date de début prévue
          <input type="date" value={start} disabled={!canManage} onChange={(e) => { setStart(e.target.value); touch(); }} style={inputStyle} />
        </label>
        <label style={{ fontSize: 12 }}>Date de fin prévue
          <input type="date" value={end} disabled={!canManage} onChange={(e) => { setEnd(e.target.value); touch(); }} style={inputStyle} />
        </label>
      </div>
      <label style={{ fontSize: 12, display: "block", marginBottom: 12 }}>Objectifs / livrables
        <textarea value={objectives} disabled={!canManage} onChange={(e) => { setObjectives(e.target.value); touch(); }} rows={2} style={{ ...inputStyle, resize: "vertical" }} placeholder="Ce que le projet doit produire…" />
      </label>

      {/* Indicateurs calculés */}
      <div style={{ display: "flex", gap: 16, flexWrap: "wrap", fontSize: 12.5, marginBottom: 10, color: "var(--ink)" }}>
        <span>Activités : <b>{activities.length}</b></span>
        {globalDuration !== null && <span>Durée globale : <b>{globalDuration} j</b></span>}
        <span>Avancement : <b>{progress}%</b></span>
      </div>

      {/* Activités — une CARTE par activité (lisible sur mobile), en nombre
          illimité (actions, dédicaces, lieux…). */}
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {activities.length === 0 && (
          <p style={{ fontSize: 12.5, color: "var(--muted)", margin: 0 }}>Aucune activité. Ajoutez la première étape du projet (ou une date de dédicace).</p>
        )}
        {activities.map((a, i) => {
          const dur = durationDays(a.start_date, a.end_date);
          return (
            <div key={i} style={{ border: "1px solid var(--line)", borderLeft: "3px solid var(--eclosion, #D9B21A)", borderRadius: 8, padding: 10, background: "var(--paper, #faf8f2)" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
                <span style={{ fontFamily: "var(--font-mono)", fontSize: 12, color: "var(--muted)", minWidth: 20 }}>{i + 1}.</span>
                <input value={a.label} disabled={!canManage} onChange={(e) => updateActivity(i, { label: e.target.value })} style={{ ...inputStyle, fontWeight: 600 }} placeholder="Intitulé de l'activité (ex. : Dédicace à Douala)" />
                {canManage && (
                  <span style={{ whiteSpace: "nowrap" }}>
                    <button type="button" title="Monter" onClick={() => move(i, -1)} style={miniBtn}>↑</button>
                    <button type="button" title="Descendre" onClick={() => move(i, 1)} style={miniBtn}>↓</button>
                    <button type="button" title="Retirer" onClick={() => { setActivities((c) => c.filter((_, j) => j !== i)); touch(); }} style={{ ...miniBtn, color: "var(--danger, #B23A2E)" }}>✕</button>
                  </span>
                )}
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(150px,1fr))", gap: 8 }}>
                <label style={miniLabel}>Responsable
                  <input value={a.responsible ?? ""} disabled={!canManage} onChange={(e) => updateActivity(i, { responsible: e.target.value })} style={inputStyle} placeholder="Qui ?" />
                </label>
                <label style={miniLabel}>Lieu
                  <input value={a.location ?? ""} disabled={!canManage} onChange={(e) => updateActivity(i, { location: e.target.value })} style={inputStyle} placeholder="Ex. : Douala (GECAM)" />
                </label>
                <label style={miniLabel}>Début
                  <input type="date" value={toDateInput(a.start_date)} disabled={!canManage} onChange={(e) => updateActivity(i, { start_date: e.target.value || null })} style={inputStyle} />
                </label>
                <label style={miniLabel}>Fin
                  <input type="date" value={toDateInput(a.end_date)} disabled={!canManage} onChange={(e) => updateActivity(i, { end_date: e.target.value || null })} style={inputStyle} />
                </label>
                <label style={miniLabel}>Priorité
                  <select value={a.priority} disabled={!canManage} onChange={(e) => updateActivity(i, { priority: e.target.value as ProjectActivityPriority })} style={inputStyle}>
                    {PRIORITIES.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
                  </select>
                </label>
                <label style={miniLabel}>Statut
                  <select value={a.status} disabled={!canManage} onChange={(e) => updateActivity(i, { status: e.target.value as ProjectActivityStatus })} style={inputStyle}>
                    {STATUSES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
                  </select>
                </label>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(150px,1fr))", gap: 8, marginTop: 8 }}>
                <input value={a.dependencies ?? ""} disabled={!canManage} onChange={(e) => updateActivity(i, { dependencies: e.target.value })} style={inputStyle} placeholder="Dépendances (facultatif)" />
                <input value={a.observations ?? ""} disabled={!canManage} onChange={(e) => updateActivity(i, { observations: e.target.value })} style={inputStyle} placeholder="Observations (facultatif)" />
              </div>
              <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 6 }}>Durée : {dur !== null ? `${dur} j` : "—"}</div>
            </div>
          );
        })}
      </div>

      {canManage && (
        <div style={{ marginTop: 8 }}>
          <Button variant="view" size="sm" type="button" onClick={() => { setActivities((c) => [...c, emptyActivity()]); touch(); }}>+ Ajouter une activité</Button>
        </div>
      )}

      <label style={{ fontSize: 12, display: "block", margin: "12px 0" }}>Observations et points de vigilance
        <textarea value={notes} disabled={!canManage} onChange={(e) => { setNotes(e.target.value); touch(); }} rows={2} style={{ ...inputStyle, resize: "vertical" }} />
      </label>

      <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", borderTop: "1px solid var(--line)", paddingTop: 10 }}>
        {canManage && <Button variant="add" size="sm" type="button" disabled={busy || !dirty} onClick={() => save(false)}>{busy ? "…" : "Enregistrer maintenant"}</Button>}
        <span style={{ fontSize: 11.5, color: "var(--muted)" }}>
          {busy ? "Enregistrement…" : dirty ? "Modifications en cours — sauvegarde automatique…" : savedAt ? `Enregistré automatiquement à ${savedAt}${version ? ` (version ${version})` : ""}.` : version > 0 ? `Version ${version} enregistrée.` : "Sauvegarde automatique activée."}
        </span>
        <div style={{ marginLeft: "auto" }}>
          {/* Aperçu / impression à la volée (sans conserver). Le document officiel
              du dossier est celui qui est DÉPOSÉ ci-dessous. */}
          <DocPrintMenu
            label="Aperçu / Imprimer"
            onPrint={(opts) => printProjectPlan(printData(), opts, cachet)}
            onDownloadPdf={() => { downloadProjectPlanPdf(printData(), cachet).catch((e) => setError(e instanceof Error ? e.message : "Téléchargement impossible.")); }}
          />
        </div>
      </div>

      {/* DÉPÔT DU PLANNING DU PROJET (obligatoire) — le planning saisi ci-dessus
          est conservé comme document officiel du dossier (PDF versionné). Sa
          présence conditionne le passage à l'étape suivante. */}
      <div style={{ marginTop: 12, border: "1px solid var(--line)", borderRadius: 10, padding: 12, background: "var(--paper, #faf8f2)" }}>
        <div style={{ fontSize: 13, fontWeight: 700, letterSpacing: 0.2, marginBottom: 4 }}>DÉPOSER LE PLANNING DU PROJET</div>
        <p style={{ fontSize: 12, color: "var(--muted)", margin: "0 0 10px" }}>
          Le planning saisi ci-dessus est conservé comme document officiel du projet (PDF). Ce dépôt est obligatoire pour valider l'étape ; il reste ensuite consultable et téléchargeable.
        </p>

        {/* Carte fichier du planning conservé */}
        {generated && doc?.has_file ? (
          <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", background: "#fff", border: "1px solid var(--line)", borderRadius: 8, padding: "8px 12px" }}>
            <span style={{ fontSize: 20 }}>📄</span>
            <div style={{ minWidth: 200, flex: "1 1 auto" }}>
              <div style={{ fontWeight: 600, fontSize: 13 }}>Planning du projet — PDF{doc.version_number ? ` (v${doc.version_number})` : ""}</div>
              <div style={{ fontSize: 11.5, color: "var(--muted)" }}>
                PDF{doc.file_size ? ` · ${fmtSize(doc.file_size)}` : ""}
                {doc.deposited_at ? ` · déposé le ${new Date(doc.deposited_at).toLocaleDateString("fr-FR")}` : ""}
                {doc.deposited_by ? ` · par ${doc.deposited_by}` : ""}
              </div>
            </div>
            <a href={projectPlanDocumentUrl(manuscriptId)} target="_blank" rel="noreferrer" style={fileActionStyle}>👁 Aperçu</a>
            <a href={projectPlanDocumentUrl(manuscriptId, { download: true })} style={fileActionStyle}>⬇ Télécharger</a>
          </div>
        ) : (
          <p style={{ fontSize: 12.5, color: "var(--muted)", margin: "0 0 8px" }}>Aucun planning conservé pour l'instant.</p>
        )}

        {canManage && (
          <div style={{ marginTop: 10 }}>
            <Button variant="add" size="sm" type="button" disabled={storing || busy || hasEmptyLabel} onClick={() => void conserve()}>
              {storing ? "Conservation…" : generated ? "Mettre à jour le planning conservé" : "Déposer / conserver le planning (PDF officiel)"}
            </Button>
          </div>
        )}

        {/* État du garde-fou : le passage à l'étape suivante est bloqué tant que
            le planning n'a pas été déposé. */}
        <div style={{
          marginTop: 10, borderRadius: 8, padding: "8px 12px", fontSize: 12.5,
          background: generated && !stale ? "#e7f1ea" : "#fbf3e0",
          color: generated && !stale ? "var(--valid, #2F7D4A)" : "var(--warn, #B87400)",
          border: `1px solid ${generated && !stale ? "#bfdcc9" : "#eddcae"}`,
        }}>
          {generated && !stale
            ? "✓ Planning déposé — le passage à l'étape suivante est autorisé."
            : stale
              ? "⚠ Planning modifié depuis le dernier dépôt — redéposez le planning à jour avant de passer à l'étape suivante."
              : "⚠ Le dépôt du planning du projet est obligatoire pour valider cette étape."}
        </div>
      </div>
      {!cachet && (
        <p style={{ fontSize: 11, color: "var(--muted)", marginTop: 6 }}>Astuce : téléversez le cachet « Direction éditoriale » dans Réglages → Cachets &amp; signature pour qu'il apparaisse automatiquement sur le PDF.</p>
      )}
    </Card>
  );
}

const fileActionStyle: React.CSSProperties = { color: "var(--eclosion-dark, #9a7a12)", textDecoration: "none", fontWeight: 600, fontSize: 12.5, border: "1px solid var(--eclosion)", borderRadius: 6, padding: "5px 10px", whiteSpace: "nowrap", background: "#fff" };

const miniBtn: React.CSSProperties = { background: "none", border: "1px solid var(--line)", borderRadius: 6, padding: "2px 7px", fontSize: 12, cursor: "pointer", marginRight: 3 };
const miniLabel: React.CSSProperties = { fontSize: 11, color: "var(--muted)", display: "flex", flexDirection: "column", gap: 2 };
