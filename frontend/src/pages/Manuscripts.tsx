import { useEffect, useState } from "react";
import { createManuscript, importManuscript, listGenres, listManuscripts, listUsers, type Genre, type Manuscript, type UserSummary } from "../api/client";

interface ManuscriptsProps {
  onOpenManuscript: (id: string) => void;
  canCreate: boolean;
  // Sous-module par étape : filtre la liste sur un statut de workflow et adapte
  // le titre. La création n'est proposée que sur la vue « Manuscrits » globale.
  statusFilter?: string;
  heading?: string;
  // Raccourci « Aller à Manuscrits » proposé dans l'état vide d'un sous-module.
  onGoToManuscripts?: () => void;
}

export function Manuscripts({ onOpenManuscript, canCreate, statusFilter, heading, onGoToManuscripts }: ManuscriptsProps) {
  const [manuscripts, setManuscripts] = useState<Manuscript[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const isStageView = Boolean(statusFilter);

  const refresh = () =>
    listManuscripts(statusFilter ? { status: statusFilter } : undefined)
      .then(setManuscripts)
      .catch((e) => setError(e.message));

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [statusFilter]);

  return (
    <div style={{ padding: 32 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
        <h1 style={{ fontFamily: "var(--font-title)", fontSize: 20, margin: 0 }}>{heading ?? "Manuscrits"}</h1>
        {canCreate && !isStageView && (
          <div style={{ display: "flex", gap: 8 }}>
            <button
              onClick={() => {
                setShowImport(false);
                setShowForm((v) => !v);
              }}
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
            <button
              onClick={() => {
                setShowForm(false);
                setShowImport((v) => !v);
              }}
              title="Enregistrer un ouvrage déjà publié, avec sa date de parution réelle"
              style={{
                background: "#fff",
                color: "var(--eclosion)",
                border: "1px solid var(--eclosion)",
                borderRadius: 6,
                padding: "8px 14px",
                fontSize: 13,
                fontWeight: 600,
                cursor: "pointer",
              }}
            >
              {showImport ? "Annuler" : "+ Importer un ouvrage déjà paru"}
            </button>
          </div>
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

      {showImport && (
        <ImportBookForm
          onImported={(m) => {
            setShowImport(false);
            refresh();
            onOpenManuscript(m.id);
          }}
          onError={setError}
        />
      )}

      {manuscripts.length === 0 ? (
        <EmptyState isStageView={isStageView} heading={heading} onGoToManuscripts={onGoToManuscripts} />
      ) : (
      <div style={{ background: "var(--card)", border: "1px solid var(--line)", borderRadius: 10, overflow: "hidden", marginTop: 16 }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
          <thead>
            <tr style={{ textAlign: "left", color: "var(--muted)", fontSize: 11, textTransform: "uppercase" }}>
              <th style={{ padding: 10 }}>N°</th>
              <th style={{ padding: 10 }}>Titre</th>
              <th style={{ padding: 10 }}>Genre</th>
              <th style={{ padding: 10 }}>Étape</th>
              <th style={{ padding: 10 }}>Reçu le</th>
              <th style={{ padding: 10 }}>Paru le</th>
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
                <td style={{ padding: 10, fontFamily: "var(--font-mono)" }}>
                  {m.publicationDate ? new Date(m.publicationDate).toLocaleDateString("fr-FR") : "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      )}
    </div>
  );
}

// État vide guidé : explique ce que liste le module et comment un ouvrage y
// arrive, plutôt qu'un tableau vide. Les formulaires de saisie d'un ouvrage
// vivent dans sa fiche, à l'étape correspondante — voir la démonstration
// remise à l'opérateur.
function EmptyState({
  isStageView,
  heading,
  onGoToManuscripts,
}: {
  isStageView: boolean;
  heading?: string;
  onGoToManuscripts?: () => void;
}) {
  return (
    <div
      style={{
        background: "var(--card)",
        border: "1px solid var(--line)",
        borderRadius: 10,
        padding: 28,
        marginTop: 16,
        maxWidth: 720,
      }}
    >
      {isStageView ? (
        <>
          <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 8 }}>
            Aucun ouvrage à l'étape « {heading} » pour le moment.
          </div>
          <p style={{ fontSize: 13, color: "var(--muted)", lineHeight: 1.6, margin: "0 0 8px" }}>
            Ce module liste les ouvrages qui sont <strong>actuellement</strong> à cette étape du circuit de production.
            Un ouvrage y apparaît <strong>automatiquement</strong> dès qu'il l'atteint ; c'est alors, en ouvrant sa fiche,
            que l'on saisit les informations de l'étape (contrat, correction, maquette, ISBN, BAT, impression…).
          </p>
          <p style={{ fontSize: 13, color: "var(--muted)", lineHeight: 1.6, margin: "0 0 16px" }}>
            Pour démarrer, créez un ouvrage dans <strong>Manuscrits</strong> ; il progressera ensuite d'étape en étape
            et arrivera ici le moment venu.
          </p>
          {onGoToManuscripts && (
            <button
              onClick={onGoToManuscripts}
              style={{
                background: "var(--eclosion)",
                color: "#fff",
                border: "none",
                borderRadius: 6,
                padding: "8px 16px",
                fontSize: 13,
                fontWeight: 600,
                cursor: "pointer",
              }}
            >
              Aller à Manuscrits
            </button>
          )}
        </>
      ) : (
        <>
          <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 8 }}>Aucun ouvrage enregistré pour le moment.</div>
          <p style={{ fontSize: 13, color: "var(--muted)", lineHeight: 1.6, margin: 0 }}>
            Cliquez sur <strong>« + Nouveau manuscrit »</strong> ci-dessus pour créer le premier. Chaque ouvrage suit
            ensuite les étapes du circuit — du dépôt à l'archivage — et apparaît dans les modules correspondants
            (Comité de lecture, Correction, Maquette, BAT, Impression…) au fil de son avancement.
          </p>
        </>
      )}
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

// Import d'un ouvrage déjà paru (spéc. fonctionnelle §8) : mêmes champs que la
// création, plus la date de parution réelle (obligatoire). L'ouvrage entre
// directement dans le catalogue au « suivi post-publication », sans repasser
// par le circuit de production.
function ImportBookForm({ onImported, onError }: { onImported: (m: Manuscript) => void; onError: (m: string) => void }) {
  const [genres, setGenres] = useState<Genre[]>([]);
  const [users, setUsers] = useState<UserSummary[]>([]);
  const [title, setTitle] = useState("");
  const [genreId, setGenreId] = useState("");
  const [language, setLanguage] = useState("fr");
  const [ownerId, setOwnerId] = useState("");
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [publicationDate, setPublicationDate] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const today = new Date().toISOString().slice(0, 10);

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
      const manuscript = await importManuscript({
        title,
        genre_id: genreId,
        language,
        owner_id: ownerId,
        author: { first_name: firstName, last_name: lastName },
        publication_date: publicationDate,
      });
      onImported(manuscript);
    } catch (err) {
      onError(err instanceof Error ? err.message : "Erreur lors de l'import.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form
      onSubmit={handleSubmit}
      style={{ background: "var(--card)", border: "1px solid var(--line)", borderRadius: 10, padding: 18, marginBottom: 8, marginTop: 8 }}
    >
      <p style={{ fontSize: 13, color: "var(--muted)", margin: "0 0 12px", lineHeight: 1.6 }}>
        Enregistrez un ouvrage <strong>déjà publié</strong> pour le faire figurer au catalogue avec sa{" "}
        <strong>date de parution réelle</strong>. La saisie est datée du jour et l'antidatage est conservé au journal.
      </p>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        <LabeledInput label="Titre de l'ouvrage">
          <input value={title} onChange={(e) => setTitle(e.target.value)} required />
        </LabeledInput>
        <LabeledInput label="Date de parution (réelle)">
          <input
            type="date"
            value={publicationDate}
            max={today}
            onChange={(e) => setPublicationDate(e.target.value)}
            required
          />
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
        Importer l'ouvrage
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
