import { useEffect, useState } from "react";
import { ManuscriptsDashboard } from "../components/ManuscriptsDashboard";
import { ManuscriptCleanupSection } from "../components/ManuscriptCleanupSection";
import {
  createManuscript,
  importManuscript,
  listCollections,
  listGenres,
  listManuscripts,
  listUsers,
  getManuscriptsHistoryByDay,
  type CatalogueFilters,
  type Collection,
  type Genre,
  type Manuscript,
  type ManuscriptHistoryDay,
  type UserSummary,
} from "../api/client";
import { Button } from "../components/Button";
import { GuidanceNote, GuidanceSteps } from "../components/GuidanceNote";
import { StepAssigneeControl } from "../components/StepAssigneeControl";

const CATALOGUE_STORAGE_KEY = "eclospace.catalogue.filters";

// Encadré d'orientation par sous-rubrique éditoriale (liste globale ou vue par
// étape). Explique ce que liste la rubrique et l'action attendue.
// Notes d'orientation par étape de production / contractualisation (une phrase
// disant ce qui s'y fait et la condition pour avancer).
const STAGE_NOTES: Record<string, string> = {
  CONTRACTUALISATION:
    "Établissez et activez le contrat d'édition (section « Contrats » dans la fiche). Un contrat actif est requis pour lancer la production, puis validez l'étape.",
  MISE_EN_PAGE:
    "Maquette et mise en page : ouvrez l'ouvrage pour la fiche technique de fabrication et le dépôt des fichiers. Validez pour passer à l'infographie.",
  INFOGRAPHIE:
    "Couverture et éléments graphiques. La convergence maquette/infographie (fiche complète, dos à jour, couverture conforme) est requise avant de valider.",
  ATTRIBUTION_REFERENCES:
    "ISBN, dépôt légal, métadonnées et classification. La liste de contrôle doit être complète avant de libérer l'ouvrage vers le BAT Final.",
  VALIDATION_BAT:
    "BAT Final (bon à tirer) : le BAT Final doit être signé électroniquement pour valider l'étape et autoriser le lancement de l'impression.",
  IMPRESSION:
    "Impression : bon de commande transmis à l'imprimeur, réception des exemplaires puis contrôle qualité avant l'entrée en stock.",
};

function ManuscriptsGuidance({ statusFilter, heading }: { statusFilter?: string; heading?: string }) {
  if (statusFilter === "COMITE_LECTURE") {
    return (
      <GuidanceSteps
        title="Comité de lecture — dans l'ordre"
        steps={[
          "Ouvrez un manuscrit de la liste.",
          "Affectez un ou plusieurs relecteurs (chacun reçoit sa mission dans « Mes lectures »).",
          "Quand tous les rapports sont remis, le dossier passe automatiquement à la décision — ou vous cliquez « Clore le comité ».",
        ]}
      />
    );
  }
  if (statusFilter === "DECISION_EDITORIALE") {
    return (
      <GuidanceNote title="Direction éditoriale">
        Manuscrits en attente de décision. Ouvrez un manuscrit pour acter la décision (acceptation, refus motivé…) au vu
        des rapports de lecture. Une acceptation lance la contractualisation.
      </GuidanceNote>
    );
  }
  if (statusFilter === "CORRECTION") {
    return (
      <GuidanceSteps
        title="Correction éditoriale — dans l'ordre"
        steps={[
          "Ouvrez le manuscrit : le correcteur y dépose le manuscrit corrigé (« Correction et versions ») et signale ses points bloquants.",
          "Les points bloquants sont levés (sinon la validation est refusée).",
          "Vous validez l'étape → le manuscrit passe à la mise en page.",
        ]}
      />
    );
  }
  const note = statusFilter ? STAGE_NOTES[statusFilter] : undefined;
  if (statusFilter) {
    return (
      <GuidanceNote title={heading ?? "Cette étape"}>
        {note ??
          "Liste des ouvrages actuellement à cette étape. Ouvrez un ouvrage pour saisir les informations de l'étape et le faire avancer."}
      </GuidanceNote>
    );
  }
  return (
    <GuidanceNote title="Manuscrits">
      Tous les ouvrages de la maison, du dépôt à l'archivage. Ouvrez un manuscrit pour voir son étape et le faire avancer,
      ou cliquez « + Nouveau manuscrit » pour enregistrer un dépôt.
    </GuidanceNote>
  );
}

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
  // Outils de nettoyage (fiches à compléter + épuration des essais), réservés à
  // l'administration ; affichés seulement sur la vue « Manuscrits » globale.
  canAdminister?: boolean;
  // Sous-module par étape : filtre la liste sur un statut de workflow et adapte
  // le titre. La création n'est proposée que sur la vue « Manuscrits » globale.
  statusFilter?: string;
  heading?: string;
  // Raccourci « Aller à Manuscrits » proposé dans l'état vide d'un sous-module.
  onGoToManuscripts?: () => void;
  // Droit d'affecter/changer la personne d'une étape (manuscripts:validation).
  canAssign?: boolean;
  // Périmètre personnel : sur une vue par étape, n'afficher que les ouvrages
  // confiés à l'utilisateur ou pas encore assignés (exécutant qui ne doit pas
  // voir les dossiers d'un collègue). Les responsables voient tout.
  scopeMine?: boolean;
}

export function Manuscripts({ onOpenManuscript, canCreate, canAdminister, statusFilter, heading, onGoToManuscripts, canAssign, scopeMine }: ManuscriptsProps) {
  const [manuscripts, setManuscripts] = useState<Manuscript[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const isStageView = Boolean(statusFilter);
  // Menu local (accordéon) de la vue principale : liste complète (pour les
  // compteurs et les regroupements par étape) + section ouverte.
  const [allManuscripts, setAllManuscripts] = useState<Manuscript[]>([]);
  const [section, setSection] = useState<string>("recus");

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
    listManuscripts(statusFilter ? { status: statusFilter, ...(scopeMine ? { mine: "true" as const } : {}) } : filters)
      .then(setManuscripts)
      .catch((e) => setError(e.message));

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [statusFilter, filtersKey, scopeMine]);

  // Vue principale : liste complète pour alimenter le menu local (compteurs +
  // regroupements par étape), rechargée après création/import.
  const loadAll = () => listManuscripts({}).then(setAllManuscripts).catch(() => {});
  useEffect(() => {
    if (!isStageView) loadAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isStageView]);

  // Regroupements du menu local (accordéon) de la vue principale.
  const codeOf = (m: Manuscript) => m.status?.code ?? "";
  const orderOf = (m: Manuscript) => m.status?.stepOrder ?? 0;
  const buckets: { key: string; label: string; icon: string; match: (m: Manuscript) => boolean }[] = [
    { key: "recus", label: "Manuscrits reçus", icon: "📥", match: (m) => ["RECEPTION", "VERIF_ADMIN"].includes(codeOf(m)) },
    { key: "evaluation", label: "En évaluation (comité de lecture)", icon: "👓", match: (m) => codeOf(m) === "COMITE_LECTURE" },
    { key: "attente", label: "En attente de décision", icon: "⚖️", match: (m) => codeOf(m) === "DECISION_EDITORIALE" },
    { key: "acceptes", label: "Acceptés & en production", icon: "✅", match: (m) => orderOf(m) >= 5 && orderOf(m) <= 19 },
    { key: "archives", label: "Archivés / refusés", icon: "🗄", match: (m) => codeOf(m) === "ARCHIVAGE" },
  ];

  return (
    <div style={{ padding: "clamp(16px, 4vw, 32px)" }}>
      <h1 style={{ fontFamily: "var(--font-title)", fontSize: 20, margin: "0 0 12px" }}>{heading ?? "Manuscrits"}</h1>

      <ManuscriptsGuidance statusFilter={statusFilter} heading={heading} />
      {error && <p style={{ color: "var(--alert)", fontSize: 13 }}>{error}</p>}

      {isStageView ? (
        // Vue par étape : liste RANGÉE en trois piles pour ne pas confondre ses
        // propres dossiers (à traiter) avec ceux d'un collègue (consultation).
        manuscripts.length === 0 ? (
          <EmptyState isStageView={isStageView} heading={heading} onGoToManuscripts={onGoToManuscripts} />
        ) : (
          <StageGroups items={manuscripts} onOpen={onOpenManuscript} canAssign={canAssign} />
        )
      ) : (
        // Vue principale : MENU LOCAL en accordéon — chaque entrée se déplie sur
        // le travail correspondant (liste filtrée, saisie, recherche, stats).
        <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 8 }}>
          {canCreate && (
            <AccordionSection open={section === "nouveau"} onToggle={() => setSection(section === "nouveau" ? "" : "nouveau")} icon="➕" label="Nouveau manuscrit">
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: showForm || showImport ? 12 : 0 }}>
                <Button variant={showForm ? "view" : "add"} onClick={() => { setShowImport(false); setShowForm((v) => !v); }}>{showForm ? "Fermer" : "Saisir un nouveau manuscrit"}</Button>
                <Button variant="view" onClick={() => { setShowForm(false); setShowImport((v) => !v); }} title="Enregistrer un ouvrage déjà publié, avec sa date de parution réelle">{showImport ? "Fermer" : "Importer un ouvrage déjà paru"}</Button>
              </div>
              {showForm && <NewManuscriptForm onCreated={(m) => { setShowForm(false); loadAll(); onOpenManuscript(m.id); }} onError={setError} />}
              {showImport && <ImportBookForm onImported={(m) => { setShowImport(false); loadAll(); onOpenManuscript(m.id); }} onError={setError} />}
            </AccordionSection>
          )}

          {canAdminister && (
            <AccordionSection open={section === "nettoyage"} onToggle={() => setSection(section === "nettoyage" ? "" : "nettoyage")} icon="🧹" label="Nettoyage (fiches à compléter · essais)">
              <ManuscriptCleanupSection canAdminister onOpenManuscript={onOpenManuscript} />
            </AccordionSection>
          )}

          {buckets.map((b) => {
            const items = allManuscripts.filter(b.match);
            return (
              <AccordionSection key={b.key} open={section === b.key} onToggle={() => setSection(section === b.key ? "" : b.key)} icon={b.icon} label={b.label} count={items.length}>
                {items.length === 0 ? (
                  <p style={{ fontSize: 13, color: "var(--muted)", margin: 0 }}>Aucun manuscrit à cette étape.</p>
                ) : (
                  <ManuscriptTable items={items} onOpen={onOpenManuscript} />
                )}
              </AccordionSection>
            );
          })}

          <AccordionSection open={section === "recherche"} onToggle={() => setSection(section === "recherche" ? "" : "recherche")} icon="🔎" label="Recherche multicritère">
            <CatalogueFilterBar filters={filters} onChange={setFilters} />
            {hasActiveFilters(filters) && (
              <div style={{ marginTop: 8 }}>
                <Button variant="view" size="sm" onClick={() => setFilters({})}>Réinitialiser les filtres</Button>
              </div>
            )}
            <div style={{ marginTop: 12 }}>
              {manuscripts.length === 0 ? (
                <p style={{ fontSize: 13, color: "var(--muted)", margin: 0 }}>Aucun ouvrage ne correspond à ces critères.</p>
              ) : (
                <ManuscriptTable items={manuscripts} onOpen={onOpenManuscript} />
              )}
            </div>
          </AccordionSection>

          <AccordionSection open={section === "historique"} onToggle={() => setSection(section === "historique" ? "" : "historique")} icon="🗓️" label="Historique par jour (manuscrits reçus)">
            {section === "historique" && <HistoryByDay onOpenManuscript={onOpenManuscript} />}
          </AccordionSection>

          <AccordionSection open={section === "stats"} onToggle={() => setSection(section === "stats" ? "" : "stats")} icon="📊" label="Statistiques & indicateurs">
            <ManuscriptsDashboard />
          </AccordionSection>
        </div>
      )}
    </div>
  );
}

// Historique chronologique des manuscrits reçus / inscrits, un jour = une
// section dépliable (chargé à l'ouverture de l'accordéon parent).
function HistoryByDay({ onOpenManuscript }: { onOpenManuscript: (id: string) => void }) {
  const [days, setDays] = useState<ManuscriptHistoryDay[] | null>(null);
  const [openDay, setOpenDay] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getManuscriptsHistoryByDay()
      .then((d) => { setDays(d); setOpenDay(d[0]?.date ?? null); })
      .catch((e) => setError(e instanceof Error ? e.message : "Chargement impossible."));
  }, []);

  const fmtDay = (iso: string) => new Date(iso + "T00:00:00Z").toLocaleDateString("fr-FR", { weekday: "long", day: "2-digit", month: "long", year: "numeric" });
  const fmtTime = (iso: string) => new Date(iso).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });

  if (error) return <p style={{ color: "var(--alert)", fontSize: 13, margin: 0 }}>{error}</p>;
  if (days === null) return <p style={{ color: "var(--muted)", fontSize: 13, margin: 0 }}>Chargement…</p>;
  if (days.length === 0) return <p style={{ color: "var(--muted)", fontSize: 13, margin: 0 }}>Aucun manuscrit enregistré pour l'instant.</p>;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      {days.map((d) => {
        const open = openDay === d.date;
        return (
          <div key={d.date} style={{ border: "1px solid var(--line)", borderRadius: 8, overflow: "hidden" }}>
            <button
              onClick={() => setOpenDay(open ? null : d.date)}
              style={{ width: "100%", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, background: open ? "var(--eclosion-soft)" : "#fff", border: "none", padding: "9px 12px", cursor: "pointer", textAlign: "left", fontSize: 13 }}
            >
              <span style={{ fontWeight: 600, textTransform: "capitalize" }}>{open ? "▾" : "▸"} {fmtDay(d.date)}</span>
              <span style={{ fontFamily: "var(--font-mono)", color: "var(--muted)" }}>{d.count} manuscrit{d.count > 1 ? "s" : ""}</span>
            </button>
            {open && (
              <div style={{ padding: "4px 12px 10px" }}>
                {d.items.map((m) => (
                  <div key={m.id} style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", padding: "6px 0", borderTop: "1px solid var(--line)" }}>
                    <span style={{ fontFamily: "var(--font-mono)", fontSize: 11.5, color: "var(--muted)" }}>{fmtTime(m.at)}</span>
                    <button onClick={() => onOpenManuscript(m.id)} style={{ border: "none", background: "none", padding: 0, cursor: "pointer", color: "var(--eclosion-dark)", fontWeight: 600, fontSize: 13, textAlign: "left" }}>
                      {m.title}
                    </button>
                    <span style={{ fontFamily: "var(--font-mono)", fontSize: 11.5, color: "var(--muted)" }}>{m.manuscript_number}</span>
                    <span style={{ marginLeft: "auto", fontSize: 11, background: "var(--eclosion-soft)", color: "var(--eclosion-dark, #9a7a12)", borderRadius: 999, padding: "1px 9px", fontWeight: 600 }}>{m.status_label}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// Section d'accordéon du menu local : en-tête cliquable (icône + libellé +
// compteur) qui déroule son contenu. Une seule ouverte à la fois.
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
          <span style={{ background: "var(--eclosion-soft)", color: "var(--eclosion-dark, #9a7a12)", borderRadius: 999, padding: "1px 9px", fontSize: 12, fontFamily: "var(--font-mono)" }}>{count}</span>
        )}
        <span style={{ color: "var(--muted)", display: "inline-block", transform: open ? "rotate(90deg)" : "none", transition: "transform .15s" }}>▸</span>
      </button>
      {open && <div style={{ padding: 14, borderTop: "1px solid var(--line)" }}>{children}</div>}
    </div>
  );
}

// Rangement de la vue par étape en trois piles claires, pour qu'un responsable
// (qui voit tout) ne confonde JAMAIS ses dossiers à traiter avec ceux d'un
// collègue (qu'il ne fait que consulter). Un exécutant ne voit, lui, que ses
// dossiers + les non-assignés (filtre serveur) : la 3ᵉ pile reste vide.
function StageGroups({ items, onOpen, canAssign }: { items: Manuscript[]; onOpen: (id: string) => void; canAssign?: boolean }) {
  const mine = items.filter((m) => m.assignedToMe);
  const unassigned = items.filter((m) => !m.currentAssignee);
  const others = items.filter((m) => m.currentAssignee && !m.assignedToMe);
  // S'il n'y a qu'une seule pile pertinente (cas de l'exécutant), on n'alourdit
  // pas l'écran avec des en-têtes : liste simple.
  const groupsUsed = [mine.length > 0, unassigned.length > 0, others.length > 0].filter(Boolean).length;
  if (groupsUsed <= 1) {
    return <ManuscriptTable items={items} onOpen={onOpen} showAssignee canAssign={canAssign} />;
  }
  const Section = ({ title, hint, tone, list }: { title: string; hint: string; tone: string; list: Manuscript[] }) =>
    list.length === 0 ? null : (
      <div style={{ marginBottom: 18 }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: 8, margin: "0 0 6px" }}>
          <h2 style={{ fontFamily: "var(--font-title)", fontSize: 15, margin: 0, color: tone }}>{title}</h2>
          <span style={{ fontSize: 12, color: "var(--muted)" }}>{list.length} · {hint}</span>
        </div>
        <ManuscriptTable items={list} onOpen={onOpen} showAssignee canAssign={canAssign} />
      </div>
    );
  return (
    <div>
      <Section title="📌 Mes dossiers à traiter" hint="qui vous sont confiés" tone="var(--eclosion-dark, #9a7a12)" list={mine} />
      <Section title="🆕 Non assignés — à confier / à prendre" hint="en attente d'attribution" tone="var(--ink)" list={unassigned} />
      <Section title="👥 Confiés à un collègue — consultation" hint="lecture seule (ne pas modifier sans reprise)" tone="var(--muted)" list={others} />
    </div>
  );
}

// Tableau de manuscrits réutilisable (une ligne cliquable par ouvrage).
function ManuscriptTable({ items, onOpen, showAssignee, canAssign }: { items: Manuscript[]; onOpen: (id: string) => void; showAssignee?: boolean; canAssign?: boolean }) {
  return (
    <div style={{ overflowX: "auto" }}>
      <table className="ecl-table">
        <thead>
          <tr>
            <th>N°</th>
            <th>Titre</th>
            <th>Genre</th>
            <th>Étape</th>
            {showAssignee && <th>Assigné à</th>}
            <th>Reçu le</th>
            <th>Paru le</th>
          </tr>
        </thead>
        <tbody>
          {items.map((m) => (
            <tr key={m.id} onClick={() => onOpen(m.id)} style={{ cursor: "pointer" }}>
              <td className="mono">{m.manuscriptNumber}</td>
              <td className="linklike">{m.title}</td>
              <td>{m.genre?.label ?? "—"}</td>
              <td>
                <span style={{ background: "var(--eclosion-soft)", color: "var(--eclosion-dark)", borderRadius: 999, padding: "2px 10px", fontSize: 11, whiteSpace: "nowrap" }}>{m.status.label}</span>
              </td>
              {showAssignee && (
                <td onClick={(e) => e.stopPropagation()} style={{ cursor: "default" }}>
                  <StepAssigneeControl manuscriptId={m.id} canAssign={!!canAssign} />
                </td>
              )}
              <td className="mono">{new Date(m.receivedAt).toLocaleDateString("fr-FR")}</td>
              <td className="mono">{m.publicationDate ? new Date(m.publicationDate).toLocaleDateString("fr-FR") : "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
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

const EMPTY_AUTHOR = {
  first_name: "", last_name: "", pen_name: "",
  birth_date: "", birth_place: "", nationality: "", profession: "",
  id_type: "", id_number: "", id_issued_date: "", id_issued_place: "", niu: "",
  country: "", city: "", quartier: "", address: "", postal_box: "",
  email: "", phone: "", whatsapp: "", other_contact: "",
};

function SectionTitle({ children }: { children: React.ReactNode }) {
  return <div style={{ gridColumn: "1 / -1", fontSize: 12.5, fontWeight: 700, color: "var(--eclosion-dark, #9a7a12)", textTransform: "uppercase", letterSpacing: 0.4, marginTop: 6, borderBottom: "1px solid var(--line)", paddingBottom: 4 }}>{children}</div>;
}

// Fiche d'enregistrement du manuscrit — digne d'une grande maison d'édition :
// ouvrage + identité complète de l'auteur (état civil, pièce d'identité,
// coordonnées) + traitement éditorial (frais de dépôt d'évaluation, délai de
// réponse). Nom/prénom et champs ouvrage obligatoires ; le reste, recommandé.
function NewManuscriptForm({ onCreated, onError }: { onCreated: (m: Manuscript) => void; onError: (m: string) => void }) {
  const [genres, setGenres] = useState<Genre[]>([]);
  const [users, setUsers] = useState<UserSummary[]>([]);
  const [title, setTitle] = useState("");
  const [genreId, setGenreId] = useState("");
  const [language, setLanguage] = useState("fr");
  const [ownerId, setOwnerId] = useState("");
  const [a, setA] = useState({ ...EMPTY_AUTHOR });
  const [evalFee, setEvalFee] = useState<"non_defini" | "a_payer" | "sans_frais">("non_defini");
  const [responseDelay, setResponseDelay] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const set = (k: keyof typeof EMPTY_AUTHOR, v: string) => setA((cur) => ({ ...cur, [k]: v }));

  useEffect(() => {
    listGenres().then((g) => { setGenres(g); if (g[0]) setGenreId(g[0].id); });
    listUsers().then((u) => { setUsers(u); if (u[0]) setOwnerId(u[0].id); });
  }, []);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    try {
      // Ne transmet que les champs auteur renseignés ; dates → ISO.
      const author: Record<string, string> = { first_name: a.first_name.trim(), last_name: a.last_name.trim() };
      for (const [k, v] of Object.entries(a)) {
        if (k === "first_name" || k === "last_name") continue;
        const val = v.trim();
        if (!val) continue;
        author[k] = k === "birth_date" || k === "id_issued_date" ? new Date(val).toISOString() : val;
      }
      const manuscript = await createManuscript({
        title, genre_id: genreId, language, owner_id: ownerId,
        evaluation_fee_choice: evalFee,
        ...(responseDelay.trim() ? { author_response_delay_days: Number(responseDelay) } : {}),
        author: author as unknown as Parameters<typeof createManuscript>[0]["author"],
      });
      onCreated(manuscript);
    } catch (err) {
      onError(err instanceof Error ? err.message : "Erreur lors de la création.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} style={{ background: "var(--card)", border: "1px solid var(--line)", borderRadius: 10, padding: 18, marginBottom: 8 }}>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        <SectionTitle>Ouvrage</SectionTitle>
        <LabeledInput label="Titre de l'ouvrage *"><input value={title} onChange={(e) => setTitle(e.target.value)} required /></LabeledInput>
        <LabeledInput label="Langue *"><input value={language} onChange={(e) => setLanguage(e.target.value)} required /></LabeledInput>
        <LabeledInput label="Domaine *">
          <select value={genreId} onChange={(e) => setGenreId(e.target.value)} required>{genres.map((g) => <option key={g.id} value={g.id}>{g.label}</option>)}</select>
        </LabeledInput>
        <LabeledInput label="Responsable du dossier *">
          <select value={ownerId} onChange={(e) => setOwnerId(e.target.value)} required>{users.map((u) => <option key={u.id} value={u.id}>{u.username}</option>)}</select>
        </LabeledInput>

        <SectionTitle>Auteur — état civil</SectionTitle>
        <LabeledInput label="Prénom *"><input value={a.first_name} onChange={(e) => set("first_name", e.target.value)} required /></LabeledInput>
        <LabeledInput label="Nom *"><input value={a.last_name} onChange={(e) => set("last_name", e.target.value)} required /></LabeledInput>
        <LabeledInput label="Pseudonyme (nom de plume)"><input value={a.pen_name} onChange={(e) => set("pen_name", e.target.value)} /></LabeledInput>
        <LabeledInput label="Nationalité"><input value={a.nationality} onChange={(e) => set("nationality", e.target.value)} /></LabeledInput>
        <LabeledInput label="Date de naissance"><input type="date" value={a.birth_date} onChange={(e) => set("birth_date", e.target.value)} /></LabeledInput>
        <LabeledInput label="Lieu de naissance"><input value={a.birth_place} onChange={(e) => set("birth_place", e.target.value)} /></LabeledInput>
        <LabeledInput label="Travail / emploi"><input value={a.profession} onChange={(e) => set("profession", e.target.value)} placeholder="Profession" /></LabeledInput>

        <SectionTitle>Auteur — pièce d'identité</SectionTitle>
        <LabeledInput label="Type de pièce d'identité">
          <select value={a.id_type} onChange={(e) => set("id_type", e.target.value)}>
            <option value="">—</option>
            <option value="CNI">Carte nationale d'identité (CNI)</option>
            <option value="Passeport">Passeport</option>
            <option value="Carte de séjour">Carte de séjour</option>
            <option value="Permis de conduire">Permis de conduire</option>
            <option value="Récépissé">Récépissé</option>
            <option value="Autre">Autre</option>
          </select>
        </LabeledInput>
        <LabeledInput label="Numéro de la pièce"><input value={a.id_number} onChange={(e) => set("id_number", e.target.value)} /></LabeledInput>
        <LabeledInput label="Délivrée le"><input type="date" value={a.id_issued_date} onChange={(e) => set("id_issued_date", e.target.value)} /></LabeledInput>
        <LabeledInput label="Délivrée à"><input value={a.id_issued_place} onChange={(e) => set("id_issued_place", e.target.value)} /></LabeledInput>
        <LabeledInput label="NIU (identifiant fiscal, si disponible)"><input value={a.niu} onChange={(e) => set("niu", e.target.value)} /></LabeledInput>

        <SectionTitle>Auteur — coordonnées & résidence</SectionTitle>
        <LabeledInput label="Pays"><input value={a.country} onChange={(e) => set("country", e.target.value)} /></LabeledInput>
        <LabeledInput label="Ville"><input value={a.city} onChange={(e) => set("city", e.target.value)} /></LabeledInput>
        <LabeledInput label="Quartier"><input value={a.quartier} onChange={(e) => set("quartier", e.target.value)} /></LabeledInput>
        <LabeledInput label="Résidence / adresse"><input value={a.address} onChange={(e) => set("address", e.target.value)} /></LabeledInput>
        <LabeledInput label="Boîte postale (BP)"><input value={a.postal_box} onChange={(e) => set("postal_box", e.target.value)} /></LabeledInput>
        <LabeledInput label="E-mail"><input type="email" value={a.email} onChange={(e) => set("email", e.target.value)} /></LabeledInput>
        <LabeledInput label="Téléphone"><input value={a.phone} onChange={(e) => set("phone", e.target.value)} /></LabeledInput>
        <LabeledInput label="WhatsApp"><input value={a.whatsapp} onChange={(e) => set("whatsapp", e.target.value)} placeholder="+237 6 XX XX XX XX" /></LabeledInput>
        <LabeledInput label="Autre moyen de contact"><input value={a.other_contact} onChange={(e) => set("other_contact", e.target.value)} placeholder="Réseau, personne à contacter…" /></LabeledInput>

        <SectionTitle>Traitement éditorial</SectionTitle>
        <div style={{ gridColumn: "1 / -1" }}>
          <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 6 }}>Frais de dépôt pour évaluation du manuscrit</div>
          <div style={{ display: "flex", gap: 16, flexWrap: "wrap", fontSize: 13 }}>
            <label style={{ display: "flex", gap: 6, alignItems: "center", cursor: "pointer" }}><input type="radio" name="evalfee" checked={evalFee === "a_payer"} onChange={() => setEvalFee("a_payer")} style={{ width: "auto" }} /> À payer par l'auteur</label>
            <label style={{ display: "flex", gap: 6, alignItems: "center", cursor: "pointer" }}><input type="radio" name="evalfee" checked={evalFee === "sans_frais"} onChange={() => setEvalFee("sans_frais")} style={{ width: "auto" }} /> Sans frais</label>
            <label style={{ display: "flex", gap: 6, alignItems: "center", cursor: "pointer" }}><input type="radio" name="evalfee" checked={evalFee === "non_defini"} onChange={() => setEvalFee("non_defini")} style={{ width: "auto" }} /> À décider plus tard</label>
          </div>
          {evalFee === "a_payer" && <div style={{ fontSize: 11.5, color: "var(--eclosion-dark, #9a7a12)", marginTop: 6 }}>→ Une demande de facture de frais de dépôt sera transmise automatiquement à la Finance à l'enregistrement.</div>}
        </div>
        <LabeledInput label="Délai de réponse à l'auteur (jours)"><input type="number" min={0} value={responseDelay} onChange={(e) => setResponseDelay(e.target.value)} placeholder="Ex. 60" /></LabeledInput>
      </div>

      <div style={{ marginTop: 14 }}>
        <Button variant="add" type="submit" disabled={submitting}>{submitting ? "Enregistrement…" : "Enregistrer le dossier"}</Button>
        <span style={{ fontSize: 11.5, color: "var(--muted)", marginLeft: 10 }}>Les champs marqués * sont obligatoires ; les autres renseignements sont vivement recommandés.</span>
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
