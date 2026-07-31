import { useEffect, useState } from "react";
import { listSettings, updateSetting, type AppSetting, type EffectiveUser } from "../api/client";
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
