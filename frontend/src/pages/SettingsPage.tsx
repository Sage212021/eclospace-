import { useEffect, useState } from "react";
import { listSettings, updateSetting, getPublisherIdentity, updatePublisherIdentity, getWorkflowDeliverableSteps, updateWorkflowDeliverableSteps, type AppSetting, type EffectiveUser, type PublisherIdentity, type WorkflowDeliverableConfig } from "../api/client";
import { AccountSecurity } from "../components/AccountSecurity";
import { SystemDiagnosticCard } from "../components/SystemDiagnosticCard";
import { GuidanceNote } from "../components/GuidanceNote";
import { SettingCard } from "../components/SettingCard";

interface SettingsPageProps {
  canAdminister: boolean;
  user: EffectiveUser;
}

// Libellés et descriptions lisibles pour les paramètres seedés. Toute clé
// absente reste affichée avec sa clé technique (aucun paramètre n'est masqué).
// Références au cahier des charges conservées en commentaire pour la traçabilité
// interne uniquement, jamais dans le texte affiché (convention du 06/07/2026).
const SETTING_LABELS: Record<string, { label: string; description: string }> = {
  evaluation_rating_thresholds: {
    label: "Seuils de classement du comité de lecture", // Ch. 7 §7.5
    description: "Bornes de notation (Excellent, Très bon, Bon…) appliquées aux évaluations.",
  },
  evaluation_score_gap_threshold: {
    label: "Seuil d'écart entre lecteurs", // Ch. 7 §7.5
    description: "Écart de note au-delà duquel un désaccord entre lecteurs est signalé.",
  },
  expense_dg_validation_threshold: {
    label: "Seuil de validation Direction générale des dépenses", // Ch. 18 §18.11
    description: "Montant au-delà duquel une dépense doit être validée par la Direction générale.",
  },
  isbn_stock_alert_threshold: {
    label: "Seuil d'alerte du stock d'ISBN", // Ch. 13 §13.2
    description: "Nombre d'ISBN disponibles restants déclenchant une alerte de réapprovisionnement.",
  },
  min_resolution_dpi: {
    label: "Résolution minimale des visuels", // Ch. 12
    description: "Résolution (dpi) en dessous de laquelle un visuel est jugé non conforme.",
  },
  purchase_order_delegation_threshold: {
    label: "Seuil de délégation des bons de commande", // Ch. 15 §15.3
    description: "Montant au-delà duquel la sélection d'un imprimeur relève de la Direction générale.",
  },
  stock_default_alert_threshold: {
    label: "Seuil d'alerte de stock par défaut", // Ch. 16 §16.5
    description: "Seuil d'alerte appliqué à une référence sans seuil propre.",
  },
};

export function SettingsPage({ canAdminister, user }: SettingsPageProps) {
  const [settings, setSettings] = useState<AppSetting[]>([]);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const refresh = async () => {
    const list = await listSettings();
    setSettings(list);
    const initial: Record<string, string> = {};
    for (const s of list) initial[s.key] = formatValue(s.value);
    setDrafts(initial);
  };

  useEffect(() => {
    // Sans habilitation « settings », la liste des seuils n'est pas chargée :
    // on laisse la page accessible pour la seule « Sécurité du compte » (accès
    // au mot de passe pour tous depuis le menu de profil), sans erreur bloquante.
    refresh().catch(() => setSettings([]));
  }, []);

  async function handleSave(setting: AppSetting) {
    const raw = drafts[setting.key];
    let parsed: unknown;
    try {
      parsed = parseValue(raw, setting.value);
    } catch {
      setError(`Valeur invalide pour « ${labelOf(setting.key)} » : le format attendu est ${typeof setting.value === "number" ? "un nombre" : "du JSON valide"}.`);
      return;
    }
    setError(null);
    try {
      await updateSetting(setting.key, parsed);
      setMessage(`« ${labelOf(setting.key)} » enregistré.`);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Échec de l'enregistrement.");
    }
  }

  return (
    <div style={{ padding: "clamp(16px, 4vw, 32px)", maxWidth: 1040 }}>
      <h1 style={{ fontFamily: "var(--font-title)", fontSize: 20, margin: 0 }}>Paramètres</h1>
      <p style={{ color: "var(--muted)", fontSize: 13, marginTop: 6 }}>
        Seuils, pondérations et réglages métier, ajustables sans redéploiement.
        {!canAdminister && " Consultation seule : la modification requiert l'habilitation d'administration."}
      </p>

      <GuidanceNote title="Paramètres">
        Les réglages métier de l'application (seuils, pondérations…), ajustables sans redéploiement. Chaque changement est
        journalisé{canAdminister ? "" : " ; leur modification requiert l'habilitation d'administration"}.
      </GuidanceNote>

      <AccountSecurity user={user} />

      {/* Identité de l'éditeur imprimée sur les contrats d'édition. */}
      <PublisherIdentityCard canAdminister={canAdminister} />

      {/* Verrou éditorial : étapes exigeant un livrable déposé avant l'avancement. */}
      <WorkflowDeliverableCard canAdminister={canAdminister} />

      {/* Diagnostic de persistance : vérifier que les données sont bien conservées en base. */}
      <SystemDiagnosticCard />

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

      {settings.length === 0 && <p style={{ color: "var(--muted)", fontSize: 13 }}>Aucun paramètre.</p>}

      {settings.map((setting) => (
        <SettingCard
          key={setting.key}
          label={labelOf(setting.key)}
          description={descriptionOf(setting.key)}
          techKey={setting.key}
          version={setting.version}
          isNumber={typeof setting.value === "number"}
          currentValue={setting.value}
          draft={drafts[setting.key] ?? ""}
          onDraftChange={(value) => setDrafts((d) => ({ ...d, [setting.key]: value }))}
          canAdminister={canAdminister}
          dirty={drafts[setting.key] !== formatValue(setting.value)}
          onSave={() => handleSave(setting)}
        />
      ))}
    </div>
  );
}

// Identité légale de l'éditeur, imprimée en tête des contrats d'édition.
// Formulaire à champs (plus lisible que le JSON brut) ; enregistrement réservé
// à l'habilitation d'administration.
const PUBLISHER_FIELDS: { key: keyof PublisherIdentity; label: string }[] = [
  { key: "name", label: "Raison sociale" },
  { key: "desc", label: "Activité (description)" },
  { key: "rc", label: "Registre du commerce (RC)" },
  { key: "niu", label: "N° contribuable (NIU)" },
  { key: "siege", label: "Siège social" },
  { key: "tel", label: "Téléphone" },
  { key: "email", label: "E-mail" },
  { key: "web", label: "Site web" },
  { key: "rep", label: "Représentant (signataire)" },
  { key: "ville", label: "Ville (lieu de signature)" },
  { key: "dipe", label: "N° DIPE employeur (CNPS)" },
  { key: "dipe_cle", label: "Clé DIPE (CNPS)" },
  { key: "cnps_regime", label: "Régime CNPS (DIPE)" },
];

function PublisherIdentityCard({ canAdminister }: { canAdminister: boolean }) {
  const [identity, setIdentity] = useState<PublisherIdentity | null>(null);
  const [saving, setSaving] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    getPublisherIdentity().then(setIdentity).catch(() => setErr("Chargement de l'identité de l'éditeur impossible."));
  }, []);

  async function save() {
    if (!identity) return;
    setSaving(true);
    setErr(null);
    try {
      const saved = await updatePublisherIdentity(identity);
      setIdentity(saved);
      setNote("Identité de l'éditeur enregistrée. Elle apparaîtra sur les prochains contrats imprimés.");
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Échec de l'enregistrement.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div style={{ background: "var(--card)", border: "1px solid var(--line)", borderRadius: 10, padding: 16, marginTop: 16 }}>
      <div style={{ fontWeight: 600, fontSize: 14 }}>Identité de l'éditeur (contrats)</div>
      <p style={{ color: "var(--muted)", fontSize: 12.5, margin: "4px 0 12px" }}>
        Ces informations figurent en tête du « Contrat d'édition » imprimé. Modifiables ici, sans développeur.
      </p>
      {err && <div style={{ background: "var(--alert-soft)", color: "var(--alert)", borderRadius: 6, padding: "7px 11px", fontSize: 12.5, marginBottom: 10 }}>{err}</div>}
      {note && <div style={{ background: "var(--eclosion-soft)", color: "var(--eclosion)", borderRadius: 6, padding: "7px 11px", fontSize: 12.5, marginBottom: 10 }}>{note}</div>}
      {!identity ? (
        <p style={{ color: "var(--muted)", fontSize: 13 }}>Chargement…</p>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: 10 }}>
          {PUBLISHER_FIELDS.map((f) => (
            <label key={f.key} style={{ display: "flex", flexDirection: "column", gap: 3, fontSize: 12 }}>
              <span style={{ color: "var(--muted)" }}>{f.label}</span>
              <input
                value={identity[f.key] ?? ""}
                disabled={!canAdminister}
                onChange={(e) => setIdentity((cur) => (cur ? { ...cur, [f.key]: e.target.value } : cur))}
                onFocus={() => setNote(null)}
                style={{ padding: "8px 10px", border: "1px solid var(--line)", borderRadius: 6, fontSize: 13, background: canAdminister ? "#fff" : "var(--panel, #f4f5f8)" }}
              />
            </label>
          ))}
        </div>
      )}
      {canAdminister && identity && (
        <div style={{ marginTop: 12 }}>
          <button onClick={save} disabled={saving} style={{ border: "none", background: "var(--eclosion)", color: "#fff", borderRadius: 8, padding: "8px 16px", fontWeight: 700, fontSize: 13, cursor: saving ? "default" : "pointer", opacity: saving ? 0.6 : 1 }}>
            {saving ? "Enregistrement…" : "Enregistrer l'identité de l'éditeur"}
          </button>
        </div>
      )}
    </div>
  );
}

// Verrou éditorial « livrable de sortie » : l'opérateur choisit ici les étapes
// qui ne pourront plus être validées tant que leur fichier attendu par l'étape
// suivante n'est pas déposé (garde-fou demandé le 20/08/2026). Cases à cocher :
// aucun JSON à manipuler.
function WorkflowDeliverableCard({ canAdminister }: { canAdminister: boolean }) {
  const [config, setConfig] = useState<WorkflowDeliverableConfig | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    getWorkflowDeliverableSteps()
      .then((c) => { setConfig(c); setSelected(c.steps); })
      .catch(() => setErr("Chargement des étapes verrouillées impossible."));
  }, []);

  function toggle(code: string) {
    setNote(null);
    setSelected((cur) => (cur.includes(code) ? cur.filter((c) => c !== code) : [...cur, code]));
  }

  async function save() {
    setSaving(true);
    setErr(null);
    try {
      const saved = await updateWorkflowDeliverableSteps(selected);
      setConfig(saved);
      setSelected(saved.steps);
      setNote("Étapes verrouillées enregistrées. Le verrou s'applique dès la prochaine validation d'étape.");
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Échec de l'enregistrement.");
    } finally {
      setSaving(false);
    }
  }

  const dirty = config ? selected.slice().sort().join(",") !== config.steps.slice().sort().join(",") : false;

  return (
    <div style={{ background: "var(--card)", border: "1px solid var(--line)", borderRadius: 10, padding: 16, marginTop: 16 }}>
      <div style={{ fontWeight: 600, fontSize: 14 }}>Verrou éditorial — livrables exigés</div>
      <p style={{ color: "var(--muted)", fontSize: 12.5, margin: "4px 0 12px", lineHeight: 1.6 }}>
        Cochez les étapes qui ne pourront pas être validées tant que leur fichier de sortie (celui qu'attend l'étape
        suivante) n'aura pas été déposé. Cela évite qu'un manuscrit avance sans que l'étape précédente ait été
        réellement traitée.
      </p>
      {err && <div style={{ background: "var(--alert-soft)", color: "var(--alert)", borderRadius: 6, padding: "7px 11px", fontSize: 12.5, marginBottom: 10 }}>{err}</div>}
      {note && <div style={{ background: "var(--eclosion-soft)", color: "var(--eclosion)", borderRadius: 6, padding: "7px 11px", fontSize: 12.5, marginBottom: 10 }}>{note}</div>}
      {!config ? (
        <p style={{ color: "var(--muted)", fontSize: 13 }}>Chargement…</p>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: 8 }}>
          {config.candidates.map((c) => (
            <label key={c.code} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, padding: "8px 10px", border: "1px solid var(--line)", borderRadius: 6, cursor: canAdminister ? "pointer" : "default", background: canAdminister ? "#fff" : "var(--panel, #f4f5f8)" }}>
              <input type="checkbox" checked={selected.includes(c.code)} disabled={!canAdminister} onChange={() => toggle(c.code)} />
              <span>{c.label}</span>
            </label>
          ))}
        </div>
      )}
      {canAdminister && config && (
        <div style={{ marginTop: 12 }}>
          <button onClick={save} disabled={saving || !dirty} style={{ border: "none", background: "var(--eclosion)", color: "#fff", borderRadius: 8, padding: "8px 16px", fontWeight: 700, fontSize: 13, cursor: saving || !dirty ? "default" : "pointer", opacity: saving || !dirty ? 0.55 : 1 }}>
            {saving ? "Enregistrement…" : "Enregistrer les étapes verrouillées"}
          </button>
        </div>
      )}
    </div>
  );
}

function labelOf(key: string): string {
  return SETTING_LABELS[key]?.label ?? key;
}

function descriptionOf(key: string): string {
  return SETTING_LABELS[key]?.description ?? "Paramètre technique.";
}

// Un nombre s'édite tel quel ; toute autre valeur (objet de seuils…) s'édite en JSON.
function formatValue(value: unknown): string {
  if (typeof value === "number") return String(value);
  return JSON.stringify(value, null, 2);
}

function parseValue(raw: string, current: unknown): unknown {
  if (typeof current === "number") {
    const n = Number(raw);
    if (!Number.isFinite(n)) throw new Error("not a number");
    return n;
  }
  return JSON.parse(raw);
}
