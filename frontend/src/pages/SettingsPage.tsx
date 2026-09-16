import { useEffect, useState } from "react";
import { listSettings, updateSetting, getPublisherIdentity, updatePublisherIdentity, getWorkflowDeliverableSteps, updateWorkflowDeliverableSteps, getWorkflowStepModes, updateWorkflowStepModes, getEditorialDecisionLetters, updateEditorialDecisionLetters, getReadingCommitteeRules, updateReadingCommitteeRules, getBranding, updateBranding, uploadBrandingStamp, clearBrandingStamp, type AppSetting, type EffectiveUser, type PublisherIdentity, type WorkflowDeliverableConfig, type WorkflowStepModesConfig, type EditorialLetters, type EditorialLetterKey, type ReadingCommitteeRules, type Branding, type BrandingStampKey } from "../api/client";
import { AccountSecurity } from "../components/AccountSecurity";
import { SystemDiagnosticCard } from "../components/SystemDiagnosticCard";
import { GuidanceNote } from "../components/GuidanceNote";
import { SettingCard } from "../components/SettingCard";
import { DocPrintMenu } from "../components/DocPrintMenu";
import { printBlankLetterhead, previewStampedDecisionLetter, previewStampedContract } from "../lib/print";
import { AiEditorialConfigCard, AiPromptsCard } from "../components/AiEditorialCard";
import { StepConsistencyCard } from "../components/StepConsistencyCard";

interface SettingsPageProps {
  canAdminister: boolean;
  user: EffectiveUser;
}

// Libellés et descriptions lisibles pour les paramètres seedés. Toute clé
// absente reste affichée avec sa clé technique (aucun paramètre n'est masqué).
// Références au cahier des charges conservées en commentaire pour la traçabilité
// interne uniquement, jamais dans le texte affiché (convention du 06/07/2026).
const SETTING_LABELS: Record<string, { label: string; description: string }> = {
  public_base_url: {
    label: "Adresse web publique de l'ERP",
    description: "Adresse que les auteurs ouvriront depuis leurs e-mails (ex. https://erp.eclosion.cm), pour confirmer la réception d'une lettre de décision. Laissée vide, l'ERP utilise l'adresse du serveur.",
  },
  evaluation_rating_thresholds: {
    label: "Seuils de classement du comité de lecture", // Ch. 7 §7.5
    description: "Bornes de notation (Excellent, Très bon, Bon…) appliquées aux évaluations.",
  },
  evaluation_score_gap_threshold: {
    label: "Seuil d'écart entre lecteurs", // Ch. 7 §7.5
    description: "Écart de note au-delà duquel un désaccord entre lecteurs est signalé.",
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

      {/* Étapes « à option » : facultative (on peut passer) / obligatoire (à réaliser). */}
      <WorkflowStepModesCard canAdminister={canAdminister} />

      {/* Cachets & signature officiels apposés sur les lettres et contrats. */}
      <BrandingCard canAdminister={canAdminister} />

      {/* Papeterie : papier à en-tête VIERGE généré par l'ERP, même en-tête que
          les lettres de décision (logo, coordonnées, pied, filigrane). */}
      <section className="ecl-card" style={{ borderLeft: "4px solid var(--eclosion, #d9b21a)" }}>
        <div style={{ fontWeight: 600, fontSize: 14 }}>Papier à en-tête vierge</div>
        <p style={{ fontSize: 13, color: "var(--muted)", margin: "4px 0 10px" }}>
          Génère une page à l'en-tête officiel d'Éclosion (logo, coordonnées, pied et filigrane), au corps laissé vierge — le même en-tête que les lettres de décision éditoriale. À enregistrer en PDF (« Imprimer / Enregistrer en PDF ») ou à imprimer pour écrire à la main.
        </p>
        <DocPrintMenu label="Aperçu / Imprimer / PDF" onPrint={(o) => printBlankLetterhead(o)} />
      </section>

      {/* Lettres de réponse à l'auteur à la décision éditoriale (modèles éditables). */}
      <DecisionLettersCard canAdminister={canAdminister} />

      <ReadingCommitteeRulesCard canAdminister={canAdminister} />

      <AiEditorialConfigCard canAdminister={canAdminister} />

      <AiPromptsCard canAdminister={canAdminister} />

      <StepConsistencyCard canAdminister={canAdminister} />

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

// Étapes « à option » (Expertise, Réécriture, Projet) : mode défini à l'avance —
// « facultative » (l'opérateur peut passer l'étape avec un motif) ou
// « obligatoire » (l'étape doit être réalisée, ses éléments renseignés). Demande
// opérateur du 20/08/2026.
function WorkflowStepModesCard({ canAdminister }: { canAdminister: boolean }) {
  const [config, setConfig] = useState<WorkflowStepModesConfig | null>(null);
  const [draft, setDraft] = useState<WorkflowStepModesConfig["modes"] | null>(null);
  const [saving, setSaving] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    getWorkflowStepModes()
      .then((c) => { setConfig(c); setDraft(c.modes); })
      .catch(() => setErr("Chargement des modes d'étape impossible."));
  }, []);

  function set(code: string, mode: "facultative" | "obligatoire") {
    setNote(null);
    setDraft((d) => (d ? { ...d, [code]: mode } : d));
  }

  async function save() {
    if (!draft) return;
    setSaving(true);
    setErr(null);
    try {
      const saved = await updateWorkflowStepModes(draft);
      setConfig(saved);
      setDraft(saved.modes);
      setNote("Modes d'étape enregistrés. Ils s'appliquent dès la prochaine validation d'étape.");
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Échec de l'enregistrement.");
    } finally {
      setSaving(false);
    }
  }

  const dirty = config && draft ? JSON.stringify(draft) !== JSON.stringify(config.modes) : false;

  return (
    <div style={{ background: "var(--card)", border: "1px solid var(--line)", borderRadius: 10, padding: 16, marginTop: 16 }}>
      <div style={{ fontWeight: 600, fontSize: 14 }}>Étapes à option (Expertise, Réécriture, Projet)</div>
      <p style={{ color: "var(--muted)", fontSize: 12.5, margin: "4px 0 12px", lineHeight: 1.6 }}>
        Pour chaque étape, choisissez si elle est <strong>facultative</strong> (l'opérateur peut la passer en indiquant un
        motif) ou <strong>obligatoire</strong> (elle doit être réalisée : les éléments attendus sont renseignés et le
        fichier déposé avant de poursuivre).
      </p>
      {err && <div style={{ background: "var(--alert-soft)", color: "var(--alert)", borderRadius: 6, padding: "7px 11px", fontSize: 12.5, marginBottom: 10 }}>{err}</div>}
      {note && <div style={{ background: "var(--eclosion-soft)", color: "var(--eclosion)", borderRadius: 6, padding: "7px 11px", fontSize: 12.5, marginBottom: 10 }}>{note}</div>}
      {!config || !draft ? (
        <p style={{ color: "var(--muted)", fontSize: 13 }}>Chargement…</p>
      ) : (
        <div style={{ display: "grid", gap: 8 }}>
          {config.steps.map((s) => (
            <div key={s.code} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, padding: "9px 11px", border: "1px solid var(--line)", borderRadius: 6, flexWrap: "wrap" }}>
              <span style={{ fontSize: 13 }}>{s.label}</span>
              <div style={{ display: "flex", gap: 12 }}>
                {(["facultative", "obligatoire"] as const).map((m) => (
                  <label key={m} style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 12.5, color: "var(--muted)", cursor: canAdminister ? "pointer" : "default" }}>
                    <input type="radio" name={`mode-${s.code}`} checked={(draft as Record<string, string>)[s.code] === m} disabled={!canAdminister} onChange={() => set(s.code, m)} />
                    {m === "facultative" ? "Facultative" : "Obligatoire"}
                  </label>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
      {canAdminister && config && (
        <div style={{ marginTop: 12 }}>
          <button onClick={save} disabled={saving || !dirty} style={{ border: "none", background: "var(--eclosion)", color: "#fff", borderRadius: 8, padding: "8px 16px", fontWeight: 700, fontSize: 13, cursor: saving || !dirty ? "default" : "pointer", opacity: saving || !dirty ? 0.55 : 1 }}>
            {saving ? "Enregistrement…" : "Enregistrer les modes d'étape"}
          </button>
        </div>
      )}
    </div>
  );
}

function ReadingCommitteeRulesCard({ canAdminister }: { canAdminister: boolean }) {
  const [rules, setRules] = useState<ReadingCommitteeRules | null>(null);
  const [draft, setDraft] = useState<ReadingCommitteeRules | null>(null);
  const [saving, setSaving] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    getReadingCommitteeRules()
      .then((r) => { setRules(r.rules); setDraft(r.rules); })
      .catch(() => setErr("Chargement des règles du comité impossible."));
  }, []);

  function patch(p: Partial<ReadingCommitteeRules>) {
    setNote(null);
    setDraft((d) => (d ? { ...d, ...p } : d));
  }

  async function save() {
    if (!draft) return;
    setSaving(true);
    setErr(null);
    try {
      const saved = await updateReadingCommitteeRules({ ...draft, quorum: Math.max(1, Math.min(10, Math.round(draft.quorum) || 2)) });
      setRules(saved.rules);
      setDraft(saved.rules);
      setNote("Règles du comité enregistrées. Elles s'appliquent dès la prochaine lecture.");
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Échec de l'enregistrement.");
    } finally {
      setSaving(false);
    }
  }

  const dirty = rules && draft ? JSON.stringify(draft) !== JSON.stringify(rules) : false;

  return (
    <div style={{ background: "var(--card)", border: "1px solid var(--line)", borderRadius: 10, padding: 16, marginTop: 16 }}>
      <div style={{ fontWeight: 600, fontSize: 14 }}>Règles du comité de lecture (à activer au besoin)</div>
      <p style={{ color: "var(--muted)", fontSize: 12.5, margin: "4px 0 12px", lineHeight: 1.6 }}>
        Réglages « comité professionnel », <strong>désactivés par défaut</strong> : le comité fonctionne comme aujourd'hui
        (un seul rapport suffit, aucune déclaration demandée). Activez-les le jour où la Maison grandit.
      </p>
      {err && <div style={{ background: "var(--alert-soft)", color: "var(--alert)", borderRadius: 6, padding: "7px 11px", fontSize: 12.5, marginBottom: 10 }}>{err}</div>}
      {note && <div style={{ background: "var(--eclosion-soft)", color: "var(--eclosion)", borderRadius: 6, padding: "7px 11px", fontSize: 12.5, marginBottom: 10 }}>{note}</div>}
      {!draft ? (
        <p style={{ color: "var(--muted)", fontSize: 13 }}>Chargement…</p>
      ) : (
        <div style={{ display: "grid", gap: 10 }}>
          <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, padding: "9px 11px", border: "1px solid var(--line)", borderRadius: 6, cursor: canAdminister ? "pointer" : "default" }}>
            <input type="checkbox" checked={draft.quorumEnabled} disabled={!canAdminister} onChange={(e) => patch({ quorumEnabled: e.target.checked })} />
            <span>
              <strong>Quorum de lecteurs</strong> — exiger un nombre minimal de rapports remis avant de pouvoir décider.
            </span>
          </label>
          {draft.quorumEnabled && (
            <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12.5, paddingLeft: 11 }}>
              Nombre de lecteurs requis :
              <input
                type="number"
                min={1}
                max={10}
                value={draft.quorum}
                disabled={!canAdminister}
                onChange={(e) => patch({ quorum: Number(e.target.value) })}
                style={{ width: 64, padding: "5px 8px", border: "1px solid var(--line)", borderRadius: 6, fontFamily: "var(--font-mono)" }}
              />
            </label>
          )}
          <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, padding: "9px 11px", border: "1px solid var(--line)", borderRadius: 6, cursor: canAdminister ? "pointer" : "default" }}>
            <input type="checkbox" checked={draft.conflictEnabled} disabled={!canAdminister} onChange={(e) => patch({ conflictEnabled: e.target.checked })} />
            <span>
              <strong>Déclaration de conflit d'intérêt</strong> — chaque lecteur déclare, à la remise, l'absence de lien avec l'auteur (ou signale un conflit).
            </span>
          </label>
        </div>
      )}
      {canAdminister && draft && (
        <div style={{ marginTop: 12 }}>
          <button onClick={save} disabled={saving || !dirty} style={{ border: "none", background: "var(--eclosion)", color: "#fff", borderRadius: 8, padding: "8px 16px", fontWeight: 700, fontSize: 13, cursor: saving || !dirty ? "default" : "pointer", opacity: saving || !dirty ? 0.55 : 1 }}>
            {saving ? "Enregistrement…" : "Enregistrer les règles du comité"}
          </button>
        </div>
      )}
    </div>
  );
}

// Cachets & signature officiels (demande opérateur 09/09/2026) : cachet Direction
// Éditoriale (lettres), cachet Direction Générale + signature du DG (contrats).
// Images téléversables ; nominatif (nom + qualité) et interrupteur « signer les
// contrats automatiquement » paramétrables.
const STAMP_META: { key: BrandingStampKey; label: string; hint: string }[] = [
  { key: "cachet_editoriale", label: "Cachet — Direction Éditoriale", hint: "Apposé sur les lettres de décision à l'auteur (e-mail et impression)." },
  { key: "cachet_generale", label: "Cachet — Direction Générale", hint: "Apposé sur les contrats d'auteur." },
  { key: "signature_dg", label: "Signature du Directeur Général", hint: "Apposée sur les contrats (fond transparent recommandé)." },
];

function BrandingCard({ canAdminister }: { canAdminister: boolean }) {
  const [b, setB] = useState<Branding | null>(null);
  const [dgName, setDgName] = useState("");
  const [dgTitle, setDgTitle] = useState("");
  const [note, setNote] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  // Résolution réelle (px) de chaque image enregistrée, mesurée dans le
  // navigateur : sert à indiquer si un cachet est assez net pour l'impression.
  const [dims, setDims] = useState<Record<string, { w: number; h: number }>>({});

  function apply(next: Branding) {
    setB(next);
    setDgName(next.dg_name);
    setDgTitle(next.dg_title);
  }
  useEffect(() => {
    getBranding().then(apply).catch(() => setErr("Chargement des cachets impossible."));
  }, []);
  // Mesure la résolution de chaque image dès qu'elle change.
  useEffect(() => {
    if (!b) return;
    setDims({});
    for (const s of STAMP_META) {
      const src = b[s.key];
      if (!src) continue;
      const im = new Image();
      im.onload = () => setDims((d) => ({ ...d, [s.key]: { w: im.naturalWidth, h: im.naturalHeight } }));
      im.src = src;
    }
  }, [b]);

  async function onUpload(key: BrandingStampKey, file: File | null) {
    if (!file) return;
    setErr(null); setNote(null); setBusy(key);
    try { apply(await uploadBrandingStamp(key, file)); setNote("Image enregistrée."); }
    catch (e) { setErr(e instanceof Error ? e.message : "Téléversement impossible."); }
    finally { setBusy(null); }
  }
  async function onClear(key: BrandingStampKey) {
    setErr(null); setNote(null); setBusy(key);
    try { apply(await clearBrandingStamp(key)); setNote("Image retirée."); }
    catch (e) { setErr(e instanceof Error ? e.message : "Suppression impossible."); }
    finally { setBusy(null); }
  }
  async function saveMeta(patch: Partial<Pick<Branding, "dg_name" | "dg_title" | "auto_sign_contracts">>) {
    setErr(null); setNote(null);
    try { apply(await updateBranding(patch)); setNote("Paramètres enregistrés."); }
    catch (e) { setErr(e instanceof Error ? e.message : "Enregistrement impossible."); }
  }
  // Aperçu « document type » : ouvre un exemple de lettre (cachet éditorial) ou de
  // contrat (cachet + signature DG) tel qu'il sera imprimé, pour vérifier le rendu.
  function preview(key: BrandingStampKey) {
    if (!b) return;
    if (key === "cachet_editoriale") previewStampedDecisionLetter(b.cachet_editoriale);
    else previewStampedContract({ cachet: b.cachet_generale, signature: b.signature_dg, dgName: b.dg_name, dgTitle: b.dg_title });
  }
  const previewLabel = (key: BrandingStampKey) => (key === "cachet_editoriale" ? "Aperçu (lettre)" : "Aperçu (contrat)");

  return (
    <div style={{ background: "var(--card)", border: "1px solid var(--line)", borderRadius: 10, padding: 16, marginTop: 16 }}>
      <div style={{ fontWeight: 600, fontSize: 14 }}>Cachets &amp; signature officiels</div>
      <p style={{ color: "var(--muted)", fontSize: 12.5, margin: "4px 0 12px", lineHeight: 1.6 }}>
        Ces cachets et la signature du Directeur Général sont apposés automatiquement sur les documents sortants
        (lettres de décision à l'auteur, contrats d'auteur). Vous pouvez les remplacer par vos propres images (PNG à fond transparent recommandé).
      </p>
      {err && <div style={{ background: "var(--alert-soft)", color: "var(--alert)", borderRadius: 6, padding: "7px 11px", fontSize: 12.5, marginBottom: 10 }}>{err}</div>}
      {note && <div style={{ background: "var(--eclosion-soft)", color: "var(--eclosion)", borderRadius: 6, padding: "7px 11px", fontSize: 12.5, marginBottom: 10 }}>{note}</div>}
      {!b ? (
        <p style={{ color: "var(--muted)", fontSize: 13 }}>Chargement…</p>
      ) : (
        <div style={{ display: "grid", gap: 14 }}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(210px, 1fr))", gap: 12 }}>
            {STAMP_META.map((s) => {
              const img = b[s.key];
              return (
                <div key={s.key} style={{ border: "1px solid var(--line)", borderRadius: 8, padding: 10 }}>
                  <div style={{ fontSize: 12.5, fontWeight: 600, marginBottom: 6 }}>{s.label}</div>
                  <div style={{ height: 90, display: "flex", alignItems: "center", justifyContent: "center", background: "var(--paper, #faf8f2)", borderRadius: 6, marginBottom: 6 }}>
                    {img ? <img src={img} alt={s.label} style={{ maxHeight: 84, maxWidth: "100%" }} /> : <span style={{ fontSize: 11.5, color: "var(--muted)" }}>Aucune image</span>}
                  </div>
                  {img && (() => {
                    const d = dims[s.key];
                    if (!d) return null;
                    const lowRes = Math.max(d.w, d.h) < 700;
                    return (
                      <div style={{ fontSize: 11, marginBottom: 6, color: lowRes ? "var(--alert)" : "var(--muted)" }}>
                        {d.w}×{d.h} px — {lowRes ? "basse résolution, à re-déposer (scan net) pour une impression nette" : "résolution suffisante"}
                      </div>
                    );
                  })()}
                  <div style={{ fontSize: 11, color: "var(--muted)", marginBottom: 6, lineHeight: 1.4 }}>{s.hint}</div>
                  <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                    <button type="button" onClick={() => preview(s.key)} style={{ fontSize: 12, cursor: "pointer", border: "1px solid var(--line)", borderRadius: 6, padding: "4px 9px", background: "#fff" }}>{previewLabel(s.key)}</button>
                    {canAdminister && (
                      <>
                        <label style={{ fontSize: 12, cursor: "pointer", border: "1px solid var(--line)", borderRadius: 6, padding: "4px 9px", background: "#fff" }}>
                          {busy === s.key ? "…" : img ? "Remplacer" : "Téléverser"}
                          <input type="file" accept="image/*" style={{ display: "none" }} onChange={(e) => { onUpload(s.key, e.target.files?.[0] ?? null); e.target.value = ""; }} />
                        </label>
                        {img && <button type="button" onClick={() => onClear(s.key)} style={{ fontSize: 12, cursor: "pointer", border: "1px solid var(--line)", borderRadius: 6, padding: "4px 9px", background: "#fff", color: "var(--alert)" }}>Retirer</button>}
                      </>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          <div style={{ display: "grid", gap: 8, maxWidth: 520 }}>
            <label style={{ fontSize: 12.5 }}>
              Nom du signataire (Directeur Général)
              <input value={dgName} disabled={!canAdminister} onChange={(e) => setDgName(e.target.value)} style={{ width: "100%", fontSize: 12.5, padding: "6px 8px", border: "1px solid var(--line)", borderRadius: 6, boxSizing: "border-box", marginTop: 4 }} />
            </label>
            <label style={{ fontSize: 12.5 }}>
              Qualité / nominatif (une ligne par mention)
              <textarea value={dgTitle} disabled={!canAdminister} onChange={(e) => setDgTitle(e.target.value)} rows={2} style={{ width: "100%", fontSize: 12.5, padding: "6px 8px", border: "1px solid var(--line)", borderRadius: 6, boxSizing: "border-box", marginTop: 4, fontFamily: "inherit" }} />
            </label>
            {canAdminister && (
              <div>
                <button type="button" onClick={() => saveMeta({ dg_name: dgName.trim(), dg_title: dgTitle })} style={{ fontSize: 12.5, cursor: "pointer", border: "none", borderRadius: 6, padding: "7px 14px", background: "var(--eclosion, #d9b21a)", color: "#0b0b0c", fontWeight: 600 }}>Enregistrer le nominatif</button>
              </div>
            )}
            <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12.5, marginTop: 4 }}>
              <input type="checkbox" checked={b.auto_sign_contracts} disabled={!canAdminister} onChange={(e) => saveMeta({ auto_sign_contracts: e.target.checked })} />
              Apposer automatiquement la signature du DG sur les contrats d'auteur
            </label>
            <p style={{ fontSize: 11, color: "var(--muted)", margin: 0 }}>
              Décoché : le contrat sort avec la zone « L'éditeur » vierge, à signer à la main. Coché : signature + cachet + nominatif du DG apposés automatiquement.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}

function DecisionLettersCard({ canAdminister }: { canAdminister: boolean }) {
  const [data, setData] = useState<EditorialLetters | null>(null);
  const [draft, setDraft] = useState<EditorialLetters["templates"] | null>(null);
  const [saving, setSaving] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    getEditorialDecisionLetters()
      .then((d) => { setData(d); setDraft(d.templates); })
      .catch(() => setErr("Chargement des modèles de lettres impossible."));
  }, []);

  function set(key: EditorialLetterKey, field: "subject" | "body", value: string) {
    setNote(null);
    setDraft((d) => (d ? { ...d, [key]: { ...d[key], [field]: value } } : d));
  }
  async function save() {
    if (!draft) return;
    setSaving(true);
    setErr(null);
    try {
      await updateEditorialDecisionLetters(draft);
      setData((x) => (x ? { ...x, templates: draft } : x));
      setNote("Modèles enregistrés. Ils s'appliquent aux prochaines décisions éditoriales.");
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Échec de l'enregistrement.");
    } finally {
      setSaving(false);
    }
  }
  const dirty = data && draft ? JSON.stringify(draft) !== JSON.stringify(data.templates) : false;

  return (
    <div style={{ background: "var(--card)", border: "1px solid var(--line)", borderRadius: 10, padding: 16, marginTop: 16 }}>
      <div style={{ fontWeight: 600, fontSize: 14 }}>Lettres de décision éditoriale (réponse à l'auteur)</div>
      <p style={{ color: "var(--muted)", fontSize: 12.5, margin: "4px 0 10px", lineHeight: 1.6 }}>
        À chaque décision (acceptation, sous conditions, refus), une lettre est adressée automatiquement à l'auteur.
        Personnalisez l'objet et le texte.{" "}
        {data && (
          <>Balises : {data.placeholders.map((p) => (
            <code key={p} style={{ background: "var(--panel, #f4f5f8)", borderRadius: 4, padding: "1px 5px", marginRight: 4, fontSize: 11.5 }}>{p}</code>
          ))}</>
        )}
      </p>
      {err && <div style={{ background: "var(--alert-soft)", color: "var(--alert)", borderRadius: 6, padding: "7px 11px", fontSize: 12.5, marginBottom: 10 }}>{err}</div>}
      {note && <div style={{ background: "var(--eclosion-soft)", color: "var(--eclosion)", borderRadius: 6, padding: "7px 11px", fontSize: 12.5, marginBottom: 10 }}>{note}</div>}
      {!data || !draft ? (
        <p style={{ color: "var(--muted)", fontSize: 13 }}>Chargement…</p>
      ) : (
        <div style={{ display: "grid", gap: 14 }}>
          {data.keys.map((k) => (
            <div key={k} style={{ border: "1px solid var(--line)", borderRadius: 8, padding: 12 }}>
              <div style={{ fontSize: 12.5, fontWeight: 600, marginBottom: 6 }}>{data.labels[k]}</div>
              <input
                value={draft[k].subject}
                disabled={!canAdminister}
                onChange={(e) => set(k, "subject", e.target.value)}
                placeholder="Objet de la lettre"
                style={{ width: "100%", fontSize: 12.5, padding: "6px 8px", border: "1px solid var(--line)", borderRadius: 6, boxSizing: "border-box", marginBottom: 6 }}
              />
              <textarea
                value={draft[k].body}
                disabled={!canAdminister}
                onChange={(e) => set(k, "body", e.target.value)}
                rows={8}
                style={{ width: "100%", fontSize: 12.5, padding: 8, border: "1px solid var(--line)", borderRadius: 6, boxSizing: "border-box", fontFamily: "inherit", lineHeight: 1.5 }}
              />
            </div>
          ))}
        </div>
      )}
      {canAdminister && data && (
        <div style={{ marginTop: 12 }}>
          <button onClick={save} disabled={saving || !dirty} style={{ border: "none", background: "var(--eclosion)", color: "#fff", borderRadius: 8, padding: "8px 16px", fontWeight: 700, fontSize: 13, cursor: saving || !dirty ? "default" : "pointer", opacity: saving || !dirty ? 0.55 : 1 }}>
            {saving ? "Enregistrement…" : "Enregistrer les modèles"}
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
