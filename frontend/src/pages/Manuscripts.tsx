import { useEffect, useState } from "react";
import { createManuscript, listGenres, listManuscripts, listUsers, type Genre, type Manuscript, type UserSummary } from "../api/client";

interface ManuscriptsProps {
  onOpenManuscript: (id: string) => void;
  canCreate: boolean;
}

export function Manuscripts({ onOpenManuscript, canCreate }: ManuscriptsProps) {
  const [manuscripts, setManuscripts] = useState<Manuscript[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = () => listManuscripts().then(setManuscripts).catch((e) => setError(e.message));

  useEffect(() => {
    refresh();
  }, []);

  return (
    <div style={{ padding: 32 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
        <h1 style={{ fontFamily: "var(--font-title)", fontSize: 20, margin: 0 }}>Manuscrits</h1>
        {canCreate && (
          <button
            onClick={() => setShowForm((v) => !v)}
            style={{
              background: "var(--eclosion)",
              color: "#fff",
              border: "none",
              borderRadius: 6,
              padding: "8px 14px",
              fontSize: 13,
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            {showForm ? "Annuler" : "+ Nouveau manuscrit"}
          </button>
        )}
      </div>

      {error && <p style={{ color: "var(--alert)", fontSize: 13 }}>{error}</p>}

      {showForm && (
        <NewManuscriptForm
          onCreated={(m) => {
            setShowForm(false);
            refresh();
            onOpenManuscript(m.id);
          }}
          onError={setError}
        />
      )}

      <div style={{ background: "var(--card)", border: "1px solid var(--line)", borderRadius: 10, overflow: "hidden", marginTop: 16 }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
          <thead>
            <tr style={{ textAlign: "left", color: "var(--muted)", fontSize: 11, textTransform: "uppercase" }}>
              <th style={{ padding: 10 }}>N°</th>
              <th style={{ padding: 10 }}>Titre</th>
              <th style={{ padding: 10 }}>Genre</th>
              <th style={{ padding: 10 }}>Étape</th>
              <th style={{ padding: 10 }}>Reçu le</th>
            </tr>
          </thead>
          <tbody>
            {manuscripts.map((m) => (
              <tr
                key={m.id}
                onClick={() => onOpenManuscript(m.id)}
                style={{ borderTop: "1px solid var(--line)", cursor: "pointer" }}
              >
                <td style={{ padding: 10, fontFamily: "var(--font-mono)" }}>{m.manuscriptNumber}</td>
                <td style={{ padding: 10 }} className="linklike">
                  {m.title}
                </td>
                <td style={{ padding: 10 }}>{m.genre?.label ?? "—"}</td>
                <td style={{ padding: 10 }}>
                  <span
                    style={{
                      background: "var(--eclosion-soft)",
                      color: "var(--eclosion)",
                      borderRadius: 999,
                      padding: "2px 10px",
                      fontSize: 11,
                    }}
                  >
                    {m.status.label}
                  </span>
                </td>
                <td style={{ padding: 10, fontFamily: "var(--font-mono)" }}>
                  {new Date(m.receivedAt).toLocaleDateString("fr-FR")}
                </td>
              </tr>
            ))}
            {manuscripts.length === 0 && (
              <tr>
                <td colSpan={5} style={{ padding: 20, textAlign: "center", color: "var(--muted)" }}>
                  Aucun manuscrit enregistré — les nouveaux dépôts apparaîtront ici.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function NewManuscriptForm({ onCreated, onError }: { onCreated: (m: Manuscript) => void; onError: (m: string) => void }) {
  const [genres, setGenres] = useState<Genre[]>([]);
  const [users, setUsers] = useState<UserSummary[]>([]);
  const [title, setTitle] = useState("");
  const [genreId, setGenreId] = useState("");
  const [language, setLanguage] = useState("fr");
  const [ownerId, setOwnerId] = useState("");
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    listGenres().then((g) => {
      setGenres(g);
      if (g[0]) setGenreId(g[0].id);
    });
    listUsers().then((u) => {
      setUsers(u);
      if (u[0]) setOwnerId(u[0].id);
    });
  }, []);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    try {
      const manuscript = await createManuscript({
        title,
        genre_id: genreId,
        language,
        owner_id: ownerId,
        author: { first_name: firstName, last_name: lastName },
      });
      onCreated(manuscript);
    } catch (err) {
      onError(err instanceof Error ? err.message : "Erreur lors de la création.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form
      onSubmit={handleSubmit}
      style={{ background: "var(--card)", border: "1px solid var(--line)", borderRadius: 10, padding: 18, marginBottom: 8 }}
    >
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        <LabeledInput label="Titre de l'ouvrage">
          <input value={title} onChange={(e) => setTitle(e.target.value)} required />
        </LabeledInput>
        <LabeledInput label="Langue">
          <input value={language} onChange={(e) => setLanguage(e.target.value)} required />
        </LabeledInput>
        <LabeledInput label="Domaine">
          <select value={genreId} onChange={(e) => setGenreId(e.target.value)} required>
            {genres.map((g) => (
              <option key={g.id} value={g.id}>
                {g.label}
              </option>
            ))}
          </select>
        </LabeledInput>
        <LabeledInput label="Responsable du dossier">
          <select value={ownerId} onChange={(e) => setOwnerId(e.target.value)} required>
            {users.map((u) => (
              <option key={u.id} value={u.id}>
                {u.username}
              </option>
            ))}
          </select>
        </LabeledInput>
        <LabeledInput label="Prénom de l'auteur">
          <input value={firstName} onChange={(e) => setFirstName(e.target.value)} required />
        </LabeledInput>
        <LabeledInput label="Nom de l'auteur">
          <input value={lastName} onChange={(e) => setLastName(e.target.value)} required />
        </LabeledInput>
      </div>
      <button
        type="submit"
        disabled={submitting}
        style={{
          marginTop: 14,
          background: "var(--eclosion)",
          color: "#fff",
          border: "none",
          borderRadius: 6,
          padding: "8px 16px",
          fontSize: 13,
          fontWeight: 600,
          cursor: submitting ? "default" : "pointer",
          opacity: submitting ? 0.6 : 1,
        }}
      >
        Enregistrer le dossier
      </button>
      <style>{`
        label input, label select { width: 100%; padding: 8px 10px; border: 1px solid var(--line); border-radius: 6px; font-size: 13px; }
      `}</style>
    </form>
  );
}

function LabeledInput({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label style={{ fontSize: 12, color: "var(--muted)" }}>
      <span style={{ display: "block", marginBottom: 4 }}>{label}</span>
      {children}
    </label>
  );
}
