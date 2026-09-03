import { useEffect, useState } from "react";
import {
  getAiEditorialConfig,
  saveAiEditorialConfig,
  testAiEditorialConnection,
  listAiPrompts,
  saveAiPrompt,
  type AiEditorialConfigView,
  type AiConfigInput,
  type AiModelPreset,
  type AiWorkType,
  type AiPrompt,
} from "../api/client";

// IA éditoriale — Lot IA-0b : écran de configuration (compte/clé/modèles) et
// éditeur de la bibliothèque de prompts. Réservé à l'administration ; la clé API
// n'est jamais réaffichée en clair (seuls ses 4 derniers caractères).

const PRESETS: AiModelPreset[] = ["leger", "intermediaire", "premium"];
const WORK_LABELS: Record<AiWorkType, string> = {
  evaluation: "Rapport d'évaluation (Comité de lecture)",
  correction_1: "Relecture BAT1 (Correction éditoriale)",
  correction_2: "Relecture BAT2 (Correction éditoriale)",
  couverture: "Relecture de couverture (BAT1 / BAT2)",
};
const CONF_LABELS: Record<string, string> = { public: "Public", interne: "Interne", restreint: "Restreint" };

const card: React.CSSProperties = { background: "var(--card)", border: "1px solid var(--line)", borderRadius: 10, padding: 16, marginTop: 16 };
const okBox: React.CSSProperties = { background: "var(--eclosion-soft)", color: "var(--eclosion)", borderRadius: 6, padding: "7px 11px", fontSize: 12.5, marginBottom: 10 };
const errBox: React.CSSProperties = { background: "var(--alert-soft)", color: "var(--alert)", borderRadius: 6, padding: "7px 11px", fontSize: 12.5, marginBottom: 10 };
const input: React.CSSProperties = { padding: "8px 10px", border: "1px solid var(--line)", borderRadius: 6, fontSize: 13, background: "#fff", width: "100%" };
const btn: React.CSSProperties = { background: "var(--eclosion)", color: "#0B0B0C", border: "none", borderRadius: 6, padding: "8px 14px", fontSize: 13, fontWeight: 700, cursor: "pointer" };
const btnGhost: React.CSSProperties = { background: "#fff", color: "var(--ink)", border: "1px solid var(--line)", borderRadius: 6, padding: "8px 14px", fontSize: 13, fontWeight: 600, cursor: "pointer" };

export function AiEditorialConfigCard({ canAdminister }: { canAdminister: boolean }) {
  const [cfg, setCfg] = useState<AiEditorialConfigView | null>(null);
  const [enabled, setEnabled] = useState(false);
  const [accountLabel, setAccountLabel] = useState("");
  const [models, setModels] = useState<Record<AiWorkType, AiModelPreset>>({ evaluation: "leger", correction_1: "leger", correction_2: "leger", couverture: "leger" });
  const [conf, setConf] = useState<string[]>(["public", "interne", "restreint"]);
  const [apiKey, setApiKey] = useState("");
  const [forbidden, setForbidden] = useState(false);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  function hydrate(c: AiEditorialConfigView) {
    setCfg(c); setEnabled(c.enabled); setAccountLabel(c.accountLabel); setModels(c.models); setConf(c.allowedConfidentiality);
  }
  useEffect(() => {
    getAiEditorialConfig().then(hydrate).catch((e) => {
      if ((e as { status?: number }).status === 403) setForbidden(true);
      else setErr("Chargement de la configuration IA impossible.");
    });
  }, []);

  function toggleConf(level: string) {
    setNote(null);
    setConf((c) => (c.includes(level) ? c.filter((x) => x !== level) : [...c, level]));
  }

  async function save() {
    setSaving(true); setErr(null); setNote(null);
    try {
      const payload: AiConfigInput = { enabled, account_label: accountLabel, models, allowed_confidentiality: conf };
      if (apiKey.trim() !== "") payload.api_key = apiKey.trim();
      const saved = await saveAiEditorialConfig(payload);
      hydrate(saved); setApiKey("");
      setNote("Configuration IA enregistrée." + (payload.api_key ? " Clé API mise à jour (stockée chiffrée)." : ""));
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Échec de l'enregistrement.");
    } finally { setSaving(false); }
  }

  async function clearKey() {
    setSaving(true); setErr(null); setNote(null);
    try {
      const saved = await saveAiEditorialConfig({ enabled, account_label: accountLabel, models, allowed_confidentiality: conf, api_key: "" });
      hydrate(saved); setApiKey("");
      setNote("Clé API effacée.");
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Échec.");
    } finally { setSaving(false); }
  }

  async function test() {
    setTesting(true); setErr(null); setNote(null);
    try {
      const r = await testAiEditorialConnection();
      setNote(`Connexion à l'API Claude réussie (modèle : ${r.model}).`);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Connexion impossible.");
    } finally { setTesting(false); }
  }

  if (forbidden) {
    return (
      <div style={card}>
        <div style={{ fontWeight: 600, fontSize: 14 }}>Configuration IA éditoriale</div>
        <p style={{ color: "var(--muted)", fontSize: 12.5, margin: "6px 0 0" }}>Réservé à l'administration générale.</p>
      </div>
    );
  }

  return (
    <div style={card}>
      <div style={{ fontWeight: 600, fontSize: 14 }}>Configuration IA éditoriale</div>
      <p style={{ color: "var(--muted)", fontSize: 12.5, margin: "4px 0 12px", lineHeight: 1.6 }}>
        Relecture assistée par Claude, <strong>au nom du relecteur d'Éclosion</strong>. Renseignez la <strong>clé API</strong> de
        votre compte Anthropic (console.anthropic.com), choisissez le modèle par type de travail, puis testez la connexion.
        La clé est stockée <strong>chiffrée</strong> et n'est jamais réaffichée.
      </p>
      {err && <div style={errBox}>{err}</div>}
      {note && <div style={okBox}>{note}</div>}
      {!cfg ? (
        <p style={{ color: "var(--muted)", fontSize: 13 }}>Chargement…</p>
      ) : (
        <div style={{ display: "grid", gap: 14 }}>
          <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13 }}>
            <input type="checkbox" checked={enabled} disabled={!canAdminister} onChange={(e) => setEnabled(e.target.checked)} />
            <span><strong>Activer l'IA éditoriale</strong> (les boutons « Lancer avec Claude » n'apparaîtront que si activé)</span>
          </label>

          <div>
            <div style={{ fontSize: 12.5, fontWeight: 600, marginBottom: 4 }}>Libellé du compte</div>
            <input style={input} value={accountLabel} disabled={!canAdminister} placeholder="Ex. Compte Éclosion API" onChange={(e) => setAccountLabel(e.target.value)} />
          </div>

          <div>
            <div style={{ fontSize: 12.5, fontWeight: 600, marginBottom: 4 }}>Clé API</div>
            <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 6 }}>
              {cfg.apiKeyConfigured ? `Une clé est configurée (se termine par ••••${cfg.apiKeyLast4}).` : "Aucune clé configurée."}
            </div>
            <input style={input} type="password" value={apiKey} disabled={!canAdminister} placeholder={cfg.apiKeyConfigured ? "Saisir une nouvelle clé pour la remplacer" : "sk-ant-…"} onChange={(e) => setApiKey(e.target.value)} />
            {canAdminister && cfg.apiKeyConfigured && (
              <button style={{ ...btnGhost, marginTop: 8 }} disabled={saving} onClick={clearKey}>Effacer la clé</button>
            )}
          </div>

          <div>
            <div style={{ fontSize: 12.5, fontWeight: 600, marginBottom: 6 }}>Modèle par type de travail</div>
            <div style={{ display: "grid", gap: 8 }}>
              {(Object.keys(WORK_LABELS) as AiWorkType[]).map((wt) => (
                <div key={wt} style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                  <span style={{ fontSize: 12.5, flex: "1 1 240px" }}>{WORK_LABELS[wt]}</span>
                  <select style={{ ...input, width: "auto" }} value={models[wt]} disabled={!canAdminister} onChange={(e) => setModels((m) => ({ ...m, [wt]: e.target.value as AiModelPreset }))}>
                    {PRESETS.map((p) => <option key={p} value={p}>{cfg.modelPresets[p]?.label ?? p}</option>)}
                  </select>
                </div>
              ))}
            </div>
          </div>

          <div>
            <div style={{ fontSize: 12.5, fontWeight: 600, marginBottom: 6 }}>Confidentialité — niveaux de manuscrits autorisés à être envoyés à l'API</div>
            <div style={{ display: "flex", gap: 14, flexWrap: "wrap" }}>
              {["public", "interne", "restreint"].map((lvl) => (
                <label key={lvl} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13 }}>
                  <input type="checkbox" checked={conf.includes(lvl)} disabled={!canAdminister} onChange={() => toggleConf(lvl)} />
                  {CONF_LABELS[lvl]}
                </label>
              ))}
            </div>
          </div>

          {canAdminister && (
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <button style={btn} disabled={saving || conf.length === 0} onClick={save}>{saving ? "Enregistrement…" : "Enregistrer"}</button>
              <button style={btnGhost} disabled={testing || !cfg.apiKeyConfigured} onClick={test}>{testing ? "Test en cours…" : "Tester la connexion"}</button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export function AiPromptsCard({ canAdminister }: { canAdminister: boolean }) {
  const [prompts, setPrompts] = useState<AiPrompt[] | null>(null);
  const [openKey, setOpenKey] = useState<AiWorkType | null>(null);
  const [draft, setDraft] = useState<{ label: string; system_prompt: string; user_template: string; report_template: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const [forbidden, setForbidden] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  function load() {
    listAiPrompts().then((r) => setPrompts(r.prompts)).catch((e) => {
      if ((e as { status?: number }).status === 403) setForbidden(true);
      else setErr("Chargement des prompts impossible.");
    });
  }
  useEffect(() => { load(); }, []);

  function edit(p: AiPrompt) {
    setNote(null); setErr(null);
    setOpenKey(p.workType);
    setDraft({ label: p.label, system_prompt: p.systemPrompt, user_template: p.userTemplate, report_template: JSON.stringify(p.reportTemplate, null, 2) });
  }

  async function save(wt: AiWorkType) {
    if (!draft) return;
    let reportTemplate: unknown;
    try { reportTemplate = JSON.parse(draft.report_template); }
    catch { setErr("Le modèle de rapport n'est pas un JSON valide."); return; }
    setSaving(true); setErr(null);
    try {
      await saveAiPrompt(wt, { label: draft.label, system_prompt: draft.system_prompt, user_template: draft.user_template, report_template: reportTemplate });
      setNote("Prompt enregistré (nouvelle version).");
      setOpenKey(null); setDraft(null); load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Échec de l'enregistrement.");
    } finally { setSaving(false); }
  }

  if (forbidden) return null;

  return (
    <div style={card}>
      <div style={{ fontWeight: 600, fontSize: 14 }}>Bibliothèque de prompts IA</div>
      <p style={{ color: "var(--muted)", fontSize: 12.5, margin: "4px 0 12px", lineHeight: 1.6 }}>
        Les consignes envoyées à Claude pour chaque type de travail. Vous pouvez les ajuster : chaque enregistrement crée une
        <strong> nouvelle version</strong>. Le modèle de rapport (structure imposée) est édité en JSON.
      </p>
      {err && <div style={errBox}>{err}</div>}
      {note && <div style={okBox}>{note}</div>}
      {!prompts ? (
        <p style={{ color: "var(--muted)", fontSize: 13 }}>Chargement…</p>
      ) : (
        <div style={{ display: "grid", gap: 8 }}>
          {prompts.map((p) => (
            <div key={p.id} style={{ border: "1px solid var(--line)", borderRadius: 8, padding: 12 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                <div>
                  <div style={{ fontSize: 13.5, fontWeight: 600 }}>{WORK_LABELS[p.workType] ?? p.label}</div>
                  <div style={{ fontSize: 11.5, color: "var(--muted)" }}>version {p.version}</div>
                </div>
                <button style={btnGhost} onClick={() => (openKey === p.workType ? (setOpenKey(null), setDraft(null)) : edit(p))}>
                  {openKey === p.workType ? "Fermer" : canAdminister ? "Modifier" : "Voir"}
                </button>
              </div>
              {openKey === p.workType && draft && (
                <div style={{ display: "grid", gap: 8, marginTop: 10 }}>
                  <label style={{ fontSize: 12, fontWeight: 600 }}>Libellé
                    <input style={{ ...input, marginTop: 4 }} value={draft.label} disabled={!canAdminister} onChange={(e) => setDraft({ ...draft, label: e.target.value })} />
                  </label>
                  <label style={{ fontSize: 12, fontWeight: 600 }}>Consigne système (règle d'or)
                    <textarea style={{ ...input, marginTop: 4, minHeight: 90, fontFamily: "inherit" }} value={draft.system_prompt} disabled={!canAdminister} onChange={(e) => setDraft({ ...draft, system_prompt: e.target.value })} />
                  </label>
                  <label style={{ fontSize: 12, fontWeight: 600 }}>Gabarit de consigne (variables {"{{manuscrit}}"}, {"{{recommandation_editeur}}"}…)
                    <textarea style={{ ...input, marginTop: 4, minHeight: 90, fontFamily: "inherit" }} value={draft.user_template} disabled={!canAdminister} onChange={(e) => setDraft({ ...draft, user_template: e.target.value })} />
                  </label>
                  <label style={{ fontSize: 12, fontWeight: 600 }}>Modèle de rapport imposé (JSON)
                    <textarea style={{ ...input, marginTop: 4, minHeight: 140, fontFamily: "var(--font-mono, monospace)", fontSize: 12 }} value={draft.report_template} disabled={!canAdminister} onChange={(e) => setDraft({ ...draft, report_template: e.target.value })} />
                  </label>
                  {canAdminister && <button style={btn} disabled={saving} onClick={() => save(p.workType)}>{saving ? "Enregistrement…" : "Enregistrer cette version"}</button>}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
