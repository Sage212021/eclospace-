import { useEffect, useState } from "react";
import {
  createCollection,
  createGenre,
  deleteCollection,
  deleteGenre,
  listCollections,
  listGenres,
  listAllEvaluationCriteria,
  createEvaluationCriterion,
  updateEvaluationCriterion,
  deactivateEvaluationCriterion,
  type Collection,
  type Genre,
  type EvaluationCriterionAdmin,
} from "../api/client";
import { Button } from "../components/Button";
import { Card } from "../components/Card";
import { Modal } from "../components/Modal";
import { GuidanceNote } from "../components/GuidanceNote";
import { IconBook } from "../components/icons";

// Gestion des domaines & collections (spéc. fonctionnelle §6). Le secrétariat
// éditorial complète le catalogue selon la réalité de la maison (Ch. 6 §6.2).
// Le retrait est logique et refusé tant qu'un ouvrage utilise l'entrée.
export function CatalogueReferencePage({ canManage }: { canManage: boolean }) {
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  return (
    <div className="ecl-page" style={{ maxWidth: 900 }}>
      <h1 className="ecl-page__title">Domaines & collections</h1>
      <p className="ecl-page__lead">
        Listes de référence du catalogue, pour le classement des ouvrages.
        {canManage
          ? " Chaque ajout ou retrait est journalisé ; une entrée utilisée par un ouvrage ne peut pas être retirée."
          : " Leur gestion est réservée à l'administration éditoriale."}
      </p>

      <GuidanceNote title="Domaines & collections">
        Les <strong>domaines</strong> (genres) et <strong>collections</strong> servent à classer chaque ouvrage.
        Complétez-les selon la réalité de la maison{canManage ? "" : " (gestion réservée à l'administration éditoriale)"} ;
        ils apparaissent ensuite dans les filtres du catalogue et à la création d'un manuscrit.
      </GuidanceNote>

      {error && <div style={bannerStyle("var(--alert-soft)", "var(--alert)")}>{error}</div>}
      {message && <div style={bannerStyle("var(--eclosion-soft)", "var(--eclosion)")}>{message}</div>}

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 16 }}>
        <ReferencePanel title="Domaines" noun="domaine" canManage={canManage} load={listGenres} create={createGenre} remove={deleteGenre} onError={setError} onMessage={setMessage} />
        <ReferencePanel title="Collections" noun="collection" canManage={canManage} load={listCollections} create={createCollection} remove={deleteCollection} onError={setError} onMessage={setMessage} />
      </div>

      <div style={{ marginTop: 22 }}>
        <EvaluationGridCard canManage={canManage} onError={setError} onMessage={setMessage} />
      </div>
    </div>
  );
}

// Éditeur de la GRILLE D'ÉVALUATION (critères + coefficients). Sert au formulaire
// de notation du comité de lecture ET au rapport d'évaluation IA — la modifier
// ici change les deux de façon cohérente. Le retrait est une désactivation
// (des évaluations passées peuvent référencer un critère).
function EvaluationGridCard({ canManage, onError, onMessage }: { canManage: boolean; onError: (m: string | null) => void; onMessage: (m: string | null) => void }) {
  const [items, setItems] = useState<EvaluationCriterionAdmin[]>([]);
  const [sum, setSum] = useState(0);
  const [label, setLabel] = useState("");
  const [coeff, setCoeff] = useState("1");
  const [busy, setBusy] = useState(false);

  const refresh = () =>
    listAllEvaluationCriteria()
      .then((r) => { setItems(r.criteria); setSum(r.active_coefficient_sum); })
      .catch((e) => onError(e instanceof Error ? e.message : "Chargement de la grille impossible."));

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { refresh(); }, []);

  async function add(e: React.FormEvent) {
    e.preventDefault();
    const c = Number(coeff.replace(",", "."));
    if (!label.trim() || !(c > 0)) { onError("Libellé et coefficient (> 0) requis."); return; }
    onError(null); onMessage(null); setBusy(true);
    try {
      await createEvaluationCriterion({ label: label.trim(), coefficient: c });
      onMessage(`Critère « ${label.trim()} » ajouté.`); setLabel(""); setCoeff("1"); await refresh();
    } catch (err) { onError(err instanceof Error ? err.message : "Ajout impossible."); }
    finally { setBusy(false); }
  }

  async function saveCoeff(id: string, value: string) {
    const c = Number(value.replace(",", "."));
    if (!(c > 0)) { onError("Coefficient invalide (> 0)."); return; }
    onError(null);
    try { await updateEvaluationCriterion(id, { coefficient: c }); onMessage("Coefficient enregistré."); await refresh(); }
    catch (err) { onError(err instanceof Error ? err.message : "Enregistrement impossible."); }
  }

  async function toggleActive(it: EvaluationCriterionAdmin) {
    onError(null);
    try {
      if (it.isActive) await deactivateEvaluationCriterion(it.id);
      else await updateEvaluationCriterion(it.id, { is_active: true });
      onMessage(it.isActive ? `« ${it.label} » retiré de la grille.` : `« ${it.label} » réactivé.`);
      await refresh();
    } catch (err) { onError(err instanceof Error ? err.message : "Action impossible."); }
  }

  return (
    <Card title="Grille d'évaluation (comité de lecture & rapport IA)" icon={<IconBook />}>
      <p style={{ fontSize: 12.5, color: "var(--muted)", margin: "0 0 10px" }}>
        Chaque critère est noté sur 10 et pondéré par son coefficient. Cette grille pilote le formulaire de notation
        du comité <strong>et</strong> le rapport d'évaluation de l'IA. Somme des coefficients actifs :{" "}
        <strong style={{ fontFamily: "var(--font-mono)" }}>{sum}</strong>.
      </p>
      <div className="ecl-list">
        {items.map((it) => (
          <div key={it.id} className="ecl-row" style={{ padding: "9px 12px", gap: 10, opacity: it.isActive ? 1 : 0.55 }}>
            <span className="ecl-row__main" style={{ flex: 1 }}>
              <span className="ecl-row__title" style={{ fontWeight: 500 }}>{it.label}</span>
              {!it.isActive && <span style={{ marginLeft: 8, fontSize: 10.5, fontWeight: 700, color: "var(--muted)", border: "1px solid var(--line)", borderRadius: 999, padding: "1px 8px" }}>Retiré</span>}
            </span>
            <label style={{ fontSize: 11.5, color: "var(--muted)", display: "flex", alignItems: "center", gap: 5 }}>
              coeff.
              <input
                defaultValue={String(Number(it.coefficient))}
                disabled={!canManage || !it.isActive}
                onBlur={(e) => { if (canManage && it.isActive && e.target.value !== String(Number(it.coefficient))) saveCoeff(it.id, e.target.value); }}
                inputMode="decimal"
                style={{ width: 52, padding: "4px 6px", border: "1px solid var(--line)", borderRadius: 6, fontFamily: "var(--font-mono)", textAlign: "center" }}
              />
            </label>
            {canManage && (
              <button onClick={() => toggleActive(it)} title={it.isActive ? "Retirer de la grille" : "Réactiver"} style={{ border: "1px solid var(--line)", background: "#fff", color: it.isActive ? "var(--alert)" : "var(--eclosion-dark)", cursor: "pointer", borderRadius: 6, padding: "3px 9px", fontSize: 12, fontWeight: 600 }}>
                {it.isActive ? "Retirer" : "Réactiver"}
              </button>
            )}
          </div>
        ))}
      </div>
      {canManage && (
        <form onSubmit={add} style={{ display: "flex", gap: 8, marginTop: 12, flexWrap: "wrap" }}>
          <div className="ecl-field" style={{ flex: 1, minWidth: 180 }}>
            <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Nouveau critère…" />
          </div>
          <div className="ecl-field" style={{ width: 90 }}>
            <input value={coeff} onChange={(e) => setCoeff(e.target.value)} inputMode="decimal" placeholder="coeff." title="Coefficient" />
          </div>
          <Button variant="add" size="sm" type="submit" disabled={busy || !label.trim()}>Ajouter</Button>
        </form>
      )}
    </Card>
  );
}

type RefItem = Genre | Collection;

function ReferencePanel({
  title,
  noun,
  canManage,
  load,
  create,
  remove,
  onError,
  onMessage,
}: {
  title: string;
  noun: string;
  canManage: boolean;
  load: () => Promise<RefItem[]>;
  create: (label: string) => Promise<RefItem>;
  remove: (id: string) => Promise<unknown>;
  onError: (m: string | null) => void;
  onMessage: (m: string | null) => void;
}) {
  const [items, setItems] = useState<RefItem[]>([]);
  const [label, setLabel] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [confirmItem, setConfirmItem] = useState<RefItem | null>(null);

  const refresh = () => load().then(setItems).catch((e) => onError(e instanceof Error ? e.message : "Échec du chargement."));

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!label.trim()) return;
    onError(null);
    onMessage(null);
    setSubmitting(true);
    try {
      await create(label.trim());
      onMessage(`« ${label.trim()} » ajouté.`);
      setLabel("");
      await refresh();
    } catch (err) {
      onError(err instanceof Error ? err.message : "Échec de l'ajout.");
    } finally {
      setSubmitting(false);
    }
  }

  async function confirmRemove() {
    if (!confirmItem) return;
    onError(null);
    onMessage(null);
    try {
      await remove(confirmItem.id);
      onMessage(`« ${confirmItem.label} » retiré.`);
      setConfirmItem(null);
      await refresh();
    } catch (err) {
      onError(err instanceof Error ? err.message : "Échec du retrait.");
    }
  }

  return (
    <Card title={`${title} (${items.length})`} icon={<IconBook />}>
      {items.length === 0 ? (
        <p style={{ fontSize: 12.5, color: "var(--muted)", margin: 0 }}>Aucune entrée.</p>
      ) : (
        <div className="ecl-list">
          {items.map((item) => (
            <div key={item.id} className="ecl-row" style={{ padding: "9px 12px" }}>
              <span className="ecl-row__main" style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span className="ecl-row__title" style={{ fontWeight: 500 }}>{item.label}</span>
                <span style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--muted)" }}>{item.code}</span>
              </span>
              {canManage && (
                <button
                  onClick={() => setConfirmItem(item)}
                  title="Retirer"
                  style={{ border: "none", background: "transparent", color: "var(--alert)", cursor: "pointer", fontSize: 18, lineHeight: 1, padding: "0 4px" }}
                >
                  ×
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      {canManage && (
        <form onSubmit={handleCreate} style={{ display: "flex", gap: 8, marginTop: 12 }}>
          <div className="ecl-field" style={{ flex: 1 }}>
            <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder={`Nouveau ${noun}…`} />
          </div>
          <Button variant="add" size="sm" type="submit" disabled={submitting || !label.trim()}>Ajouter</Button>
        </form>
      )}

      {confirmItem && (
        <Modal
          title="Confirmer le retrait"
          onClose={() => setConfirmItem(null)}
          footer={
            <>
              <Button variant="view" size="sm" onClick={() => setConfirmItem(null)}>Annuler</Button>
              <Button variant="danger" size="sm" onClick={confirmRemove}>Retirer</Button>
            </>
          }
        >
          <p style={{ margin: 0, fontSize: 13 }}>
            Retirer le {noun} « <strong>{confirmItem.label}</strong> » ? Cette entrée ne sera plus proposée au classement.
          </p>
        </Modal>
      )}
    </Card>
  );
}

function bannerStyle(bg: string, color: string): React.CSSProperties {
  return { background: bg, color, borderRadius: 8, padding: "9px 13px", fontSize: 13, marginTop: 12 };
}
