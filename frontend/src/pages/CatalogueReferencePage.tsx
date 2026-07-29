import { useEffect, useState } from "react";
import {
  createCollection,
  createGenre,
  deleteCollection,
  deleteGenre,
  listCollections,
  listGenres,
  type Collection,
  type Genre,
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
    </div>
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
