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

// Gestion des domaines & collections (spéc. fonctionnelle §6). Le secrétariat
// éditorial complète le catalogue selon la réalité de la maison (Ch. 6 §6.2).
// Le retrait est logique et refusé tant qu'un ouvrage utilise l'entrée.
export function CatalogueReferencePage({ canManage }: { canManage: boolean }) {
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  return (
    <div style={{ padding: 32, maxWidth: 900 }}>
      <h1 style={{ fontFamily: "var(--font-title)", fontSize: 20, margin: 0 }}>Domaines & collections</h1>
      <p style={{ color: "var(--muted)", fontSize: 13, marginTop: 6 }}>
        Listes de référence du catalogue. Les domaines (genres) et collections servent au classement des ouvrages.
        {canManage
          ? " Chaque ajout ou retrait est journalisé ; un domaine ou une collection utilisé par un ouvrage ne peut pas être retiré."
          : " Leur gestion est réservée à l'administration éditoriale."}
      </p>

      {error && (
        <div style={{ background: "var(--alert-soft)", color: "var(--alert)", borderRadius: 6, padding: "8px 12px", fontSize: 13, marginTop: 12 }}>
          {error}
        </div>
      )}
      {message && (
        <div style={{ background: "var(--eclosion-soft)", color: "var(--eclosion)", borderRadius: 6, padding: "8px 12px", fontSize: 13, marginTop: 12 }}>
          {message}
        </div>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginTop: 16 }}>
        <ReferencePanel
          title="Domaines"
          noun="domaine"
          canManage={canManage}
          load={listGenres}
          create={createGenre}
          remove={deleteGenre}
          onError={setError}
          onMessage={setMessage}
        />
        <ReferencePanel
          title="Collections"
          noun="collection"
          canManage={canManage}
          load={listCollections}
          create={createCollection}
          remove={deleteCollection}
          onError={setError}
          onMessage={setMessage}
        />
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

  async function handleRemove(item: RefItem) {
    if (!window.confirm(`Retirer le ${noun} « ${item.label} » ?`)) return;
    onError(null);
    onMessage(null);
    try {
      await remove(item.id);
      onMessage(`« ${item.label} » retiré.`);
      await refresh();
    } catch (err) {
      onError(err instanceof Error ? err.message : "Échec du retrait.");
    }
  }

  return (
    <div style={{ background: "var(--card)", border: "1px solid var(--line)", borderRadius: 10, padding: 18 }}>
      <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 10 }}>
        {title} <span style={{ color: "var(--muted)", fontWeight: 400 }}>({items.length})</span>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        {items.length === 0 && <span style={{ fontSize: 12, color: "var(--muted)" }}>Aucune entrée.</span>}
        {items.map((item) => (
          <div
            key={item.id}
            style={{ display: "flex", justifyContent: "space-between", alignItems: "center", borderBottom: "1px solid var(--line)", padding: "4px 0" }}
          >
            <span style={{ fontSize: 13 }}>
              {item.label} <span style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--muted)" }}>{item.code}</span>
            </span>
            {canManage && (
              <button
                onClick={() => handleRemove(item)}
                title="Retirer"
                style={{ border: "none", background: "transparent", color: "var(--alert)", cursor: "pointer", fontSize: 16, lineHeight: 1, padding: "0 4px" }}
              >
                ×
              </button>
            )}
          </div>
        ))}
      </div>

      {canManage && (
        <form onSubmit={handleCreate} style={{ display: "flex", gap: 6, marginTop: 12 }}>
          <input
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder={`Nouveau ${noun}…`}
            style={{ flex: 1, padding: "6px 8px", fontSize: 13, border: "1px solid var(--line)", borderRadius: 6 }}
          />
          <Button variant="add" size="sm" type="submit" disabled={submitting || !label.trim()}>
            Ajouter
          </Button>
        </form>
      )}
    </div>
  );
}
