import { useEffect, useState } from "react";
import {
  createManuscript,
  importManuscript,
  listCollections,
  listGenres,
  listManuscripts,
  listUsers,
  type CatalogueFilters,
  type Collection,
  type Genre,
  type Manuscript,
  type UserSummary,
} from "../api/client";
import { Button } from "../components/Button";

const CATALOGUE_STORAGE_KEY = "eclospace.catalogue.filters";

// Raccourcis par période (spéc. fonctionnelle §5) : traduisent un libellé en
// bornes de date de parution. Renvoie { from, to } au format AAAA-MM-JJ.
function periodBounds(key: string): { from?: string; to?: string } {
  const now = new Date();
  const y = now.getFullYear();
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  switch (key) {
    case "this_year":
      return { from: `${y}-01-01`, to: `${y}-12-31` };
    case "last_year":
      return { from: `${y - 1}-01-01`, to: `${y - 1}-12-31` };
    case "this_month":
      return { from: iso(new Date(y, now.getMonth(), 1)), to: iso(new Date(y, now.getMonth() + 1, 0)) };
    default:
      return {};
  }
}

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

  // Mémorisation du dernier tri/filtre (spéc. fonctionnelle §6) : on restaure
  // les préférences de l'opérateur d'une session à l'autre, sur la vue globale.
  const [filters, setFilters] = useState<CatalogueFilters>(() => {
    if (statusFilter) return {};
    try {
      return JSON.parse(localStorage.getItem(CATALOGUE_STORAGE_KEY) ?? "{}") as CatalogueFilters;
    } catch {
      return {};
    }
  });
  const filtersKey = JSON.stringify(filters);

  useEffect(() => {
    if (isStageView) return;
    localStorage.setItem(CATALOGUE_STORAGE_KEY, filtersKey);
  }, [filtersKey, isStageView]);

  const refresh = () =>
    listManuscripts(statusFilter ? { status: statusFilter } : filters)
      .then(setManuscripts)
      .catch((e) => setError(e.message));

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [statusFilter, filtersKey]);

  return (
    <div style={{ padding: "clamp(16px, 4vw, 32px)" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
        <h1 style={{ fontFamily: "var(--font-title)", fontSize: 20, margin: 0 }}>{heading ?? "Manuscrits"}</h1>
        {canCreate && !isStageView && (
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <Button
              variant={showForm ? "view" : "add"}
              onClick={() => {
                setShowImport(false);
                setShowForm((v) => !v);
              }}
            >
              {showForm ? "Annuler" : "+ Nouveau manuscrit"}
            </Button>
            <Button
              variant="view"
              onClick={() => {
                setShowForm(false);
                setShowImport((v) => !v);
              }}
              title="Enregistrer un ouvrage déjà publié, avec sa date de parution réelle"
            >
              {showImport ? "Annuler" : "+ Importer un ouvrage déjà paru"}
            </Button>
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

      {!isStageView && <CatalogueFilterBar filters={filters} onChange={setFilters} />}

      {manuscripts.length === 0 ? (
        !isStageView && hasActiveFilters(filters) ? (
          <div style={{ background: "var(--card)", border: "1px solid var(--line)", borderRadius: 10, padding: 24, marginTop: 16, maxWidth: 720 }}>
            <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 6 }}>Aucun ouvrage ne correspond à ces critères.</div>
            <p style={{ fontSize: 13, color: "var(--muted)", margin: "0 0 12px" }}>
              Élargissez la période ou retirez un filtre pour voir davantage d'ouvrages.
            </p>
            <Button variant="view" size="sm" onClick={() => setFilters({})}>
              Réinitialiser les filtres
            </Button>
          </div>
        ) : (
          <EmptyState isStageView={isStageView} heading={heading} onGoToManuscripts={onGoToManuscripts} />
        )
      ) : (
      <div style={{ background: "var(--card)", border: "1px solid var(--line)", borderRadius: 10, overflow: "hidden", marginTop: 16 }}>
        <div style={{ overflowX: "auto" }}>
        <table className="ecl-table">
          <thead>
            <tr>
              <th>N°</th>
              <th>Titre</th>
              <th>Genre</th>
              <th>Étape</th>
              <th>Reçu le</th>
              <th>Paru le</th>
            </tr>
          </thead>
          <tbody>
            {manuscripts.map((m) => (
              <tr key={m.id} onClick={() => onOpenManuscript(m.id)} style={{ cursor: "pointer" }}>
                <td className="mono">{m.manuscriptNumber}</td>
                <td className="linklike">{m.title}</td>
                <td>{m.genre?.label ?? "—"}</td>
                <td>
                  <span
                    style={{
                      background: "var(--eclosion-soft)",
                      color: "var(--eclosion-dark)",
                      borderRadius: 999,
                      padding: "2px 10px",
                      fontSize: 11,
                      whiteSpace: "nowrap",
                    }}
                  >
                    {m.status.label}
                  </span>
                </td>
                <td className="mono">{new Date(m.receivedAt).toLocaleDateString("fr-FR")}</td>
                <td className="mono">{m.publicationDate ? new Date(m.publicationDate).toLocaleDateString("fr-FR") : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
        </div>
      </div>
      )}
    </div>
  );
}

function hasActiveFilters(f: CatalogueFilters): boolean {
  return Boolean(f.genre || f.collection || f.language || f.back_catalogue || f.published_from || f.published_to || f.q);
}

// Barre de classement du catalogue (spéc. fonctionnelle §5/§6) : raccourcis par
// période, filtres multicritères et tri. Les choix sont mémorisés (localStorage,
// géré par le parent) pour être restaurés à la session suivante.
function CatalogueFilterBar({ filters, onChange }: { filters: CatalogueFilters; onChange: (f: CatalogueFilters) => void }) {
  const [genres, setGenres] = useState<Genre[]>([]);
  const [collections, setCollections] = useState<Collection[]>([]);

  useEffect(() => {
    listGenres().then(setGenres).catch(() => {});
    listCollections().then(setCollections).catch(() => {});
  }, []);

  const set = (patch: Partial<CatalogueFilters>) => onChange({ ...filters, ...patch });
  const applyPeriod = (key: string) => {
    const { from, to } = periodBounds(key);
    set({ published_from: from, published_to: to });
  };
  const activePeriod = (() => {
    for (const key of ["this_year", "last_year", "this_month"]) {
      const b = periodBounds(key);
      if (b.from === filters.published_from && b.to === filters.published_to) return key;
    }
    if (!filters.published_from && !filters.published_to) return "all";
    return "custom";
  })();

  const chip = (active: boolean): React.CSSProperties => ({
    border: `1px solid ${active ? "var(--eclosion)" : "var(--line)"}`,
    background: active ? "var(--eclosion-soft)" : "#fff",
    color: active ? "var(--eclosion)" : "var(--ink)",
    borderRadius: 999,
    padding: "4px 12px",
    fontSize: 12,
    cursor: "pointer",
  });
  const field: React.CSSProperties = { padding: "6px 8px", fontSize: 12, border: "1px solid var(--line)", borderRadius: 6, background: "#fff" };

  return (
    <div style={{ background: "var(--card)", border: "1px solid var(--line)", borderRadius: 10, padding: 14, marginTop: 16 }}>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center", marginBottom: 10 }}>
        <span style={{ fontSize: 11, color: "var(--muted)", textTransform: "uppercase" }}>Période de parution</span>
        <button style={chip(activePeriod === "all")} onClick={() => set({ published_from: undefined, published_to: undefined })}>
          Tout
        </button>
        <button style={chip(activePeriod === "this_year")} onClick={() => applyPeriod("this_year")}>
          Cette année
        </button>
        <button style={chip(activePeriod === "last_year")} onClick={() => applyPeriod("last_year")}>
          Année dernière
        </button>
        <button style={chip(activePeriod === "this_month")} onClick={() => applyPeriod("this_month")}>
          Ce mois-ci
        </button>
        <span style={{ fontSize: 11, color: "var(--muted)" }}>du</span>
        <input type="date" value={filters.published_from ?? ""} onChange={(e) => set({ published_from: e.target.value || undefined })} style={field} />
        <span style={{ fontSize: 11, color: "var(--muted)" }}>au</span>
        <input type="date" value={filters.published_to ?? ""} onChange={(e) => set({ published_to: e.target.value || undefined })} style={field} />
      </div>

      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
        <input
          placeholder="Rechercher un titre…"
          value={filters.q ?? ""}
          onChange={(e) => set({ q: e.target.value || undefined })}
          style={{ ...field, minWidth: 180 }}
        />
        <select value={filters.genre ?? ""} onChange={(e) => set({ genre: e.target.value || undefined })} style={field}>
          <option value="">Tous les domaines</option>
          {genres.map((g) => (
            <option key={g.id} value={g.id}>
              {g.label}
            </option>
          ))}
        </select>
        <select value={filters.collection ?? ""} onChange={(e) => set({ collection: e.target.value || undefined })} style={field}>
          <option value="">Toutes les collections</option>
          {collections.map((c) => (
            <option key={c.id} value={c.id}>
              {c.label}
            </option>
          ))}
        </select>
        <select value={filters.back_catalogue ?? ""} onChange={(e) => set({ back_catalogue: (e.target.value || undefined) as CatalogueFilters["back_catalogue"] })} style={field}>
          <option value="">Tous les ouvrages</option>
          <option value="true">Déjà parus (importés)</option>
          <option value="false">Entrés en production</option>
        </select>
        <span style={{ width: 1, height: 20, background: "var(--line)" }} />
        <span style={{ fontSize: 11, color: "var(--muted)" }}>Trier par</span>
        <select value={filters.sort ?? "priority"} onChange={(e) => set({ sort: e.target.value as CatalogueFilters["sort"] })} style={field}>
          <option value="priority">Priorité</option>
          <option value="title">Titre</option>
          <option value="publication_date">Date de parution</option>
          <option value="received_at">Date de réception</option>
        </select>
        <select value={filters.order ?? ""} onChange={(e) => set({ order: (e.target.value || undefined) as CatalogueFilters["order"] })} style={field}>
          <option value="">Ordre par défaut</option>
          <option value="desc">Décroissant</option>
          <option value="asc">Croissant</option>
        </select>
        {hasActiveFilters(filters) && (
          <button onClick={() => onChange({ sort: filters.sort, order: filters.order })} style={{ ...field, cursor: "pointer", color: "var(--muted)" }}>
            Effacer les filtres
          </button>
        )}
      </div>
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
            <Button variant="add" onClick={onGoToManuscripts}>
              Aller à Manuscrits
            </Button>
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
      <div style={{ marginTop: 14 }}>
        <Button variant="add" type="submit" disabled={submitting}>
          Enregistrer le dossier
        </Button>
      </div>
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
      <div style={{ marginTop: 14 }}>
        <Button variant="add" type="submit" disabled={submitting}>
          Importer l'ouvrage
        </Button>
      </div>
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
