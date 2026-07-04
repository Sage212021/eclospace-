import { useEffect, useState } from "react";
import { createTask, listTasks, listUsers, patchTask, type Task, type TaskStatus, type UserSummary } from "../api/client";

const STATUS_LABELS: Record<TaskStatus, string> = {
  non_commencee: "Non commencée",
  en_cours: "En cours",
  suspendue: "Suspendue",
  terminee: "Terminée",
  validee: "Validée",
};

const TASK_TYPES = [
  { value: "correction_ortho", label: "Correction orthographique" },
  { value: "correction_gramm", label: "Correction grammaticale" },
  { value: "correction_style", label: "Correction stylistique" },
  { value: "layout", label: "Mise en page" },
  { value: "cover", label: "Couverture" },
  { value: "illustration", label: "Illustration" },
  { value: "autre", label: "Autre" },
];

interface TasksSectionProps {
  manuscriptId: string;
  canManage: boolean;
}

// Gantt simplifié (Ch. 8 §8.4-8.7) : liste des tâches avec dépendances et
// avancement. Le diagramme interactif avec glisser-déposer (§8.7) est un
// développement frontend plus lourd, hors périmètre de cette première passe
// — voir docs/JOURNAL_TECHNIQUE.md.
export function TasksSection({ manuscriptId, canManage }: TasksSectionProps) {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = () => listTasks(manuscriptId).then(setTasks).catch((e) => setError(e.message));

  useEffect(() => {
    refresh();
  }, [manuscriptId]);

  async function cycleStatus(task: Task) {
    const order: TaskStatus[] = ["non_commencee", "en_cours", "terminee", "validee"];
    const next = order[order.indexOf(task.status) + 1];
    if (!next) return;
    try {
      await patchTask(task.id, { status: next });
      refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Échec de la mise à jour.");
    }
  }

  return (
    <div style={{ background: "var(--card)", border: "1px solid var(--line)", borderRadius: 10, padding: 18, marginTop: 16 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
        <div style={{ fontSize: 13, fontWeight: 600 }}>Tâches</div>
        {canManage && (
          <button onClick={() => setShowForm((v) => !v)} style={secondaryButtonStyle}>
            {showForm ? "Annuler" : "+ Nouvelle tâche"}
          </button>
        )}
      </div>

      {error && <p style={{ color: "var(--alert)", fontSize: 12 }}>{error}</p>}

      {showForm && (
        <NewTaskForm
          manuscriptId={manuscriptId}
          tasks={tasks}
          onCreated={() => {
            setShowForm(false);
            refresh();
          }}
          onError={setError}
        />
      )}

      {tasks.length === 0 && !showForm && <p style={{ color: "var(--muted)", fontSize: 13 }}>Aucune tâche pour ce manuscrit.</p>}

      {tasks.map((task) => (
        <div key={task.id} style={{ borderTop: "1px solid var(--line)", padding: "8px 0", fontSize: 13 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div>
              <strong>{task.title}</strong>
              {task.dependsOnTaskId && (
                <span style={{ color: "var(--muted)", fontSize: 11 }}>
                  {" "}
                  · dépend de {tasks.find((t) => t.id === task.dependsOnTaskId)?.title ?? "…"}
                </span>
              )}
            </div>
            {canManage && task.status !== "validee" && (
              <button onClick={() => cycleStatus(task)} style={secondaryButtonStyle}>
                {STATUS_LABELS[task.status]} →
              </button>
            )}
            {!canManage && (
              <span style={{ background: "var(--eclosion-soft)", color: "var(--eclosion)", borderRadius: 999, padding: "2px 10px", fontSize: 11 }}>
                {STATUS_LABELS[task.status]}
              </span>
            )}
          </div>
          <div style={{ color: "var(--muted)", fontSize: 11, marginTop: 2 }}>
            {task.assignee?.username ?? "Non affecté"}
            {task.plannedStart && task.plannedEnd && (
              <>
                {" "}
                · {new Date(task.plannedStart).toLocaleDateString("fr-FR")} → {new Date(task.plannedEnd).toLocaleDateString("fr-FR")}
              </>
            )}
          </div>
          <div style={{ background: "var(--line)", borderRadius: 999, height: 4, marginTop: 6, overflow: "hidden" }}>
            <div style={{ background: "var(--eclosion)", height: "100%", width: `${task.progressPct}%` }} />
          </div>
        </div>
      ))}
    </div>
  );
}

function NewTaskForm({
  manuscriptId,
  tasks,
  onCreated,
  onError,
}: {
  manuscriptId: string;
  tasks: Task[];
  onCreated: () => void;
  onError: (m: string) => void;
}) {
  const [title, setTitle] = useState("");
  const [type, setType] = useState(TASK_TYPES[0].value);
  const [assigneeId, setAssigneeId] = useState("");
  const [dependsOn, setDependsOn] = useState("");
  const [users, setUsers] = useState<UserSummary[]>([]);

  useEffect(() => {
    listUsers().then(setUsers);
  }, []);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    try {
      await createTask(manuscriptId, {
        title,
        type,
        assignee_id: assigneeId || undefined,
        depends_on_task_id: dependsOn || undefined,
      });
      onCreated();
    } catch (err) {
      onError(err instanceof Error ? err.message : "Échec de la création.");
    }
  }

  return (
    <form onSubmit={handleSubmit} style={{ borderTop: "1px solid var(--line)", paddingTop: 10, marginBottom: 10 }}>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
        <label style={{ fontSize: 12 }}>
          Intitulé
          <input value={title} onChange={(e) => setTitle(e.target.value)} required style={inputStyle} />
        </label>
        <label style={{ fontSize: 12 }}>
          Type
          <select value={type} onChange={(e) => setType(e.target.value)} style={inputStyle}>
            {TASK_TYPES.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </select>
        </label>
        <label style={{ fontSize: 12 }}>
          Responsable
          <select value={assigneeId} onChange={(e) => setAssigneeId(e.target.value)} style={inputStyle}>
            <option value="">—</option>
            {users.map((u) => (
              <option key={u.id} value={u.id}>
                {u.username}
              </option>
            ))}
          </select>
        </label>
        <label style={{ fontSize: 12 }}>
          Dépend de
          <select value={dependsOn} onChange={(e) => setDependsOn(e.target.value)} style={inputStyle}>
            <option value="">—</option>
            {tasks.map((t) => (
              <option key={t.id} value={t.id}>
                {t.title}
              </option>
            ))}
          </select>
        </label>
      </div>
      <button type="submit" style={{ ...secondaryButtonStyle, marginTop: 10, background: "var(--eclosion)", color: "#fff", border: "none" }}>
        Créer la tâche
      </button>
    </form>
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
