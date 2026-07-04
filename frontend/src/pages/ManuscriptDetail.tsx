import { useEffect, useState } from "react";
import {
  assignReader,
  getManuscript,
  getManuscriptTimeline,
  listUsers,
  submitEditorialDecision,
  validateStep,
  type Manuscript,
  type TimelineStep,
  type UserSummary,
} from "../api/client";
import { Spine } from "../components/Spine";

interface ManuscriptDetailProps {
  manuscriptId: string;
  permissions: Set<string>;
  onBack: () => void;
}

type ManuscriptWithExtras = Manuscript & {
  workContributors: { author: { firstName: string; lastName: string; penName: string | null } }[];
  owner: UserSummary;
};

export function ManuscriptDetail({ manuscriptId, permissions, onBack }: ManuscriptDetailProps) {
  const [manuscript, setManuscript] = useState<ManuscriptWithExtras | null>(null);
  const [timeline, setTimeline] = useState<TimelineStep[]>([]);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = async () => {
    const [m, t] = await Promise.all([getManuscript(manuscriptId), getManuscriptTimeline(manuscriptId)]);
    setManuscript(m);
    setTimeline(t);
  };

  useEffect(() => {
    refresh().catch((e) => setError(e.message));
  }, [manuscriptId]);

  if (!manuscript) return <div style={{ padding: 32 }}>Chargement…</div>;

  const canValidate = permissions.has("manuscripts:validation");
  const canAssignReader = permissions.has("comite_lecture:saisie");
  const canDecide = permissions.has("decision_editoriale:validation");

  async function handle(action: () => Promise<unknown>, successMessage: string) {
    setError(null);
    setMessage(null);
    try {
      await action();
      setMessage(successMessage);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Une action a échoué.");
    }
  }

  return (
    <div style={{ padding: 32, maxWidth: 760 }}>
      <button onClick={onBack} style={{ background: "none", border: "none", color: "var(--muted)", cursor: "pointer", fontSize: 13, padding: 0, marginBottom: 12 }}>
        ← Manuscrits
      </button>

      <h1 style={{ fontFamily: "var(--font-title)", fontSize: 20, margin: 0 }}>{manuscript.title}</h1>
      <p style={{ fontFamily: "var(--font-mono)", color: "var(--muted)", fontSize: 12 }}>{manuscript.manuscriptNumber}</p>
      <p style={{ fontSize: 13 }}>
        Auteur : {manuscript.workContributors.map((c) => `${c.author.firstName} ${c.author.lastName}`).join(", ")} · Genre :{" "}
        {manuscript.genre?.label ?? "—"} · Responsable : {manuscript.owner.username}
      </p>

      <Spine steps={timeline} currentStatusCode={manuscript.status.code} />

      {message && (
        <div style={{ background: "var(--eclosion-soft)", color: "var(--eclosion)", borderRadius: 6, padding: "8px 12px", fontSize: 13, marginTop: 12 }}>
          {message}
        </div>
      )}
      {error && (
        <div style={{ background: "var(--alert-soft)", color: "var(--alert)", borderRadius: 6, padding: "8px 12px", fontSize: 13, marginTop: 12 }}>
          {error}
        </div>
      )}

      <div style={{ background: "var(--card)", border: "1px solid var(--line)", borderRadius: 10, padding: 18, marginTop: 20 }}>
        <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 10 }}>Étape courante : {manuscript.status.label}</div>

        {manuscript.status.code === "VERIF_ADMIN" && canValidate && (
          <div style={{ display: "flex", gap: 8 }}>
            <ActionButton
              onClick={() =>
                handle(
                  () => validateStep(manuscript.id, "VERIF_ADMIN", { outcome: "conforme" }),
                  "Dossier conforme : passage au comité de lecture.",
                )
              }
            >
              Dossier conforme
            </ActionButton>
            <SecondaryButton
              onClick={() =>
                handle(
                  () => validateStep(manuscript.id, "VERIF_ADMIN", { outcome: "incomplet", observations: "Pièces manquantes" }),
                  "Dossier incomplet : le secrétariat a été notifié.",
                )
              }
            >
              Dossier incomplet
            </SecondaryButton>
          </div>
        )}

        {manuscript.status.code === "COMITE_LECTURE" && canAssignReader && (
          <AssignReaderForm manuscriptId={manuscript.id} onAssigned={() => handle(async () => {}, "Lecteur affecté.")} />
        )}

        {manuscript.status.code === "DECISION_EDITORIALE" && canDecide && (
          <EditorialDecisionForm
            manuscriptId={manuscript.id}
            onDecided={(msg) => handle(async () => {}, msg)}
          />
        )}

        {!["VERIF_ADMIN", "COMITE_LECTURE", "DECISION_EDITORIALE"].includes(manuscript.status.code) && (
          <p style={{ fontSize: 13, color: "var(--muted)" }}>
            Aucune action disponible à cette étape dans les lots actuellement livrés.
          </p>
        )}
      </div>
    </div>
  );
}

function ActionButton({ children, onClick }: { children: React.ReactNode; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      style={{ background: "var(--eclosion)", color: "#fff", border: "none", borderRadius: 6, padding: "8px 14px", fontSize: 13, fontWeight: 600, cursor: "pointer" }}
    >
      {children}
    </button>
  );
}

function SecondaryButton({ children, onClick }: { children: React.ReactNode; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      style={{ background: "#fff", color: "var(--alert)", border: "1px solid var(--alert)", borderRadius: 6, padding: "8px 14px", fontSize: 13, cursor: "pointer" }}
    >
      {children}
    </button>
  );
}

function AssignReaderForm({ manuscriptId, onAssigned }: { manuscriptId: string; onAssigned: () => void }) {
  const [users, setUsers] = useState<UserSummary[]>([]);
  const [readerId, setReaderId] = useState("");
  const [dueAt, setDueAt] = useState("");

  useEffect(() => {
    listUsers().then((u) => {
      setUsers(u);
      if (u[0]) setReaderId(u[0].id);
    });
  }, []);

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        assignReader(manuscriptId, readerId, new Date(dueAt).toISOString()).then(onAssigned);
      }}
      style={{ display: "flex", gap: 8, alignItems: "flex-end" }}
    >
      <label style={{ fontSize: 12 }}>
        Lecteur
        <select value={readerId} onChange={(e) => setReaderId(e.target.value)} style={{ display: "block", padding: 6 }}>
          {users.map((u) => (
            <option key={u.id} value={u.id}>
              {u.username}
            </option>
          ))}
        </select>
      </label>
      <label style={{ fontSize: 12 }}>
        Échéance
        <input type="date" value={dueAt} onChange={(e) => setDueAt(e.target.value)} required style={{ display: "block", padding: 6 }} />
      </label>
      <ActionButton onClick={() => {}}>Affecter</ActionButton>
    </form>
  );
}

function EditorialDecisionForm({ manuscriptId, onDecided }: { manuscriptId: string; onDecided: (message: string) => void }) {
  const [decision, setDecision] = useState<"acceptation" | "acceptation_conditions" | "revision" | "attente" | "refus">("acceptation");
  const [motivation, setMotivation] = useState("");

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        submitEditorialDecision(manuscriptId, decision, motivation).then(() => onDecided(`Décision enregistrée : ${decision}.`));
      }}
    >
      <label style={{ fontSize: 12, display: "block", marginBottom: 8 }}>
        Décision
        <select value={decision} onChange={(e) => setDecision(e.target.value as typeof decision)} style={{ display: "block", padding: 6, marginTop: 4 }}>
          <option value="acceptation">Acceptation</option>
          <option value="acceptation_conditions">Acceptation sous conditions</option>
          <option value="revision">Demande de révision</option>
          <option value="attente">Mise en attente</option>
          <option value="refus">Refus motivé</option>
        </select>
      </label>
      <label style={{ fontSize: 12, display: "block", marginBottom: 8 }}>
        Motivation (obligatoire)
        <textarea
          value={motivation}
          onChange={(e) => setMotivation(e.target.value)}
          required
          rows={3}
          style={{ display: "block", width: "100%", padding: 8, marginTop: 4, fontFamily: "inherit", fontSize: 13 }}
        />
      </label>
      <ActionButton onClick={() => {}}>Enregistrer la décision</ActionButton>
    </form>
  );
}
