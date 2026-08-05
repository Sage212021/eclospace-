import { useEffect, useState } from "react";

// Administration du workflow éditorial (refonte — Lot C). Règle SANS code, par
// étape : libellé, département responsable, délai cible (jours) et notifications
// à l'entrée. L'ordre des étapes et les règles métier profondes (contrat signé,
// BAT signé…) restent gérés par le moteur — cet écran ne les touche pas.

const API_BASE = import.meta.env.VITE_API_BASE ?? (import.meta.env.DEV ? "http://localhost:3000" : "");

interface Step {
  code: string;
  label: string;
  step_order: number;
  is_conditional: boolean;
  department_id: string | null;
  department_name: string | null;
  target_days: number | null;
  notify_on_entry: boolean;
}
interface Dept {
  id: string;
  name: string;
}
interface Config {
  steps: Step[];
  departments: Dept[];
}

export function WorkflowAdminSection({ canAdminister }: { canAdminister: boolean }) {
  const [config, setConfig] = useState<Config | null>(null);
  const [drafts, setDrafts] = useState<Record<string, Step>>({});
  const [savingCode, setSavingCode] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  const load = () =>
    fetch(`${API_BASE}/api/v1/workflow/config`, { credentials: "include" })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((c: Config) => {
        setConfig(c);
        setDrafts(Object.fromEntries(c.steps.map((s) => [s.code, { ...s }])));
      })
      .catch(() => setFailed(true));

  useEffect(() => {
    load();
  }, []);

  if (failed || !config) return null;

  const isDirty = (s: Step) => {
    const orig = config.steps.find((x) => x.code === s.code)!;
    return orig.label !== s.label || orig.department_id !== s.department_id || orig.target_days !== s.target_days || orig.notify_on_entry !== s.notify_on_entry;
  };

  const setDraft = (code: string, patch: Partial<Step>) => setDrafts((d) => ({ ...d, [code]: { ...d[code], ...patch } }));

  async function save(code: string) {
    const s = drafts[code];
    setSavingCode(code);
    setError(null);
    setMessage(null);
    try {
      const res = await fetch(`${API_BASE}/api/v1/workflow/steps/${code}`, {
        method: "PATCH",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          label: s.label,
          department_id: s.department_id,
          target_days: s.target_days,
          notify_on_entry: s.notify_on_entry,
        }),
      });
      if (!res.ok) throw new Error(((await res.json().catch(() => null)) as { message?: string } | null)?.message ?? `Erreur ${res.status}`);
      setMessage(`Étape « ${s.label} » enregistrée.`);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Enregistrement impossible.");
    } finally {
      setSavingCode(null);
    }
  }

  return (
    <section className="ecl-card" style={{ marginTop: 20 }}>
      <h2 style={{ fontFamily: "var(--font-title)", fontSize: 16, margin: "0 0 4px" }}>Administration du workflow éditorial</h2>
      <p style={{ color: "var(--muted)", fontSize: 13, margin: "0 0 6px" }}>
        Réglez, par étape : le libellé, le département responsable, le délai cible et les notifications.
        {!canAdminister && " Consultation seule."}
      </p>
      <p style={{ color: "var(--muted)", fontSize: 12, margin: "0 0 14px", fontStyle: "italic" }}>
        L'ordre des étapes et les contrôles métier (contrat signé, BAT signé…) restent gérés par le système et ne sont pas modifiables ici.
      </p>

      {error && <div style={{ background: "var(--alert-soft)", color: "var(--alert)", borderRadius: 6, padding: "8px 12px", fontSize: 13, marginBottom: 10 }}>{error}</div>}
      {message && <div style={{ background: "var(--eclosion-soft)", color: "var(--eclosion)", borderRadius: 6, padding: "8px 12px", fontSize: 13, marginBottom: 10 }}>{message}</div>}

      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12.5, minWidth: 720 }}>
          <thead>
            <tr style={{ textAlign: "left", color: "var(--muted)", fontSize: 11 }}>
              <th style={th}>#</th>
              <th style={th}>Libellé</th>
              <th style={th}>Département</th>
              <th style={th}>Délai (j)</th>
              <th style={th}>Notif.</th>
              <th style={th}></th>
            </tr>
          </thead>
          <tbody>
            {config.steps.map((orig) => {
              const s = drafts[orig.code];
              if (!s) return null;
              const dirty = isDirty(s);
              return (
                <tr key={s.code} style={{ borderTop: "1px solid var(--line)" }}>
                  <td style={{ ...td, fontFamily: "var(--font-mono)", color: "var(--muted)" }}>{s.step_order}</td>
                  <td style={td}>
                    <input
                      value={s.label}
                      disabled={!canAdminister}
                      onChange={(e) => setDraft(s.code, { label: e.target.value })}
                      style={{ ...inp, minWidth: 160 }}
                    />
                    {s.is_conditional && <div style={{ fontSize: 10, color: "var(--muted)", fontStyle: "italic" }}>étape conditionnelle</div>}
                  </td>
                  <td style={td}>
                    <select
                      value={s.department_id ?? ""}
                      disabled={!canAdminister}
                      onChange={(e) => setDraft(s.code, { department_id: e.target.value || null })}
                      style={{ ...inp, minWidth: 130 }}
                    >
                      <option value="">— aucun —</option>
                      {config.departments.map((d) => (
                        <option key={d.id} value={d.id}>{d.name}</option>
                      ))}
                    </select>
                  </td>
                  <td style={td}>
                    <input
                      type="number"
                      min={0}
                      value={s.target_days ?? ""}
                      disabled={!canAdminister}
                      placeholder="—"
                      onChange={(e) => setDraft(s.code, { target_days: e.target.value === "" ? null : Math.max(0, Number(e.target.value)) })}
                      style={{ ...inp, width: 64, fontFamily: "var(--font-mono)" }}
                    />
                  </td>
                  <td style={{ ...td, textAlign: "center" }}>
                    <input
                      type="checkbox"
                      checked={s.notify_on_entry}
                      disabled={!canAdminister}
                      onChange={(e) => setDraft(s.code, { notify_on_entry: e.target.checked })}
                    />
                  </td>
                  <td style={td}>
                    {canAdminister && (
                      <button
                        onClick={() => save(s.code)}
                        disabled={!dirty || savingCode === s.code}
                        style={{
                          border: "none",
                          borderRadius: 6,
                          padding: "6px 12px",
                          fontSize: 12,
                          fontWeight: 700,
                          cursor: dirty ? "pointer" : "default",
                          background: dirty ? "var(--eclosion)" : "var(--line)",
                          color: dirty ? "#fff" : "var(--muted)",
                        }}
                      >
                        {savingCode === s.code ? "…" : "Enregistrer"}
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

const th: React.CSSProperties = { padding: "4px 8px", fontWeight: 600 };
const td: React.CSSProperties = { padding: "8px 8px", verticalAlign: "top" };
const inp: React.CSSProperties = { padding: "6px 8px", border: "1px solid var(--line)", borderRadius: 6, fontSize: 12.5, boxSizing: "border-box" };
