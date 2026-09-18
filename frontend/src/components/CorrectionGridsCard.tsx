import { useEffect, useMemo, useState } from "react";
import {
  getCorrectionProfilesAdmin,
  saveBookType,
  saveCorrectionProfile,
  type BookTypeAdmin,
  type CorrectionProfileView,
} from "../api/client";

// Paramétrage éditable des GRILLES DE CORRECTION (moteur « Assistance de
// correction éditoriale IA »). Pour chaque type d'ouvrage, on modifie la liste
// des points de contrôle et leur sévérité (C1 bloquant · C2 important · C3
// mineur · S suggestion). On peut aussi ajouter un nouveau type. Le profil
// « par défaut » s'applique aux types sans grille propre.
const SEVERITIES = ["C1", "C2", "C3", "S"] as const;
const SEV_LABEL: Record<string, string> = { C1: "C1 · bloquant", C2: "C2 · important", C3: "C3 · mineur", S: "S · suggestion" };
type DraftPoint = { label: string; default_severity: string };

export function CorrectionGridsCard({ canAdminister }: { canAdminister: boolean }) {
  const [bookTypes, setBookTypes] = useState<BookTypeAdmin[]>([]);
  const [profiles, setProfiles] = useState<CorrectionProfileView[]>([]);
  const [code, setCode] = useState<string>("__defaut__");
  const [label, setLabel] = useState("");
  const [points, setPoints] = useState<DraftPoint[]>([]);
  const [saving, setSaving] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [newType, setNewType] = useState<{ code: string; label: string }>({ code: "", label: "" });

  const load = () =>
    getCorrectionProfilesAdmin()
      .then((r) => { setBookTypes(r.book_types); setProfiles(r.profiles); })
      .catch((e) => setErr(e instanceof Error ? e.message : "Chargement impossible."));
  useEffect(() => { if (canAdminister) load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [canAdminister]);

  // Liste des cibles éditables : le profil par défaut + chaque type d'ouvrage.
  const targets = useMemo(() => {
    const list: { code: string; label: string }[] = [{ code: "__defaut__", label: "Profil par défaut (commun)" }];
    for (const b of bookTypes) list.push({ code: b.code, label: b.label });
    return list;
  }, [bookTypes]);

  // Charge la grille du type sélectionné dans le brouillon éditable.
  useEffect(() => {
    const prof = profiles.find((p) => p.bookTypeCode === code);
    const target = targets.find((t) => t.code === code);
    setLabel(prof?.label ?? target?.label ?? code);
    setPoints((prof?.controlPoints ?? []).filter((c) => c.isActive).map((c) => ({ label: c.label, default_severity: c.defaultSeverity })));
    setNote(null); setErr(null);
  }, [code, profiles, targets]);

  if (!canAdminister) return null;

  async function save() {
    setSaving(true); setNote(null); setErr(null);
    try {
      await saveCorrectionProfile(code, { label: label.trim() || code, points: points.filter((p) => p.label.trim()).map((p) => ({ label: p.label.trim(), default_severity: p.default_severity })) });
      setNote("Grille enregistrée.");
      await load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Enregistrement impossible.");
    } finally {
      setSaving(false);
    }
  }

  async function addType() {
    const c = newType.code.trim().toLowerCase().replace(/[^a-z0-9_]/g, "_");
    if (!/^[a-z0-9_]{2,60}$/.test(c) || !newType.label.trim()) { setErr("Code (2–60 : lettres, chiffres, tirets bas) et libellé requis."); return; }
    setSaving(true); setErr(null); setNote(null);
    try {
      await saveBookType(c, { label: newType.label.trim() });
      setNewType({ code: "", label: "" });
      await load();
      setCode(c);
      setNote(`Type « ${newType.label.trim()} » ajouté — définissez sa grille ci-dessous.`);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Ajout impossible.");
    } finally {
      setSaving(false);
    }
  }

  const box: React.CSSProperties = { border: "1px solid var(--line)", borderRadius: 10, background: "var(--card)", padding: 16, marginTop: 16 };
  return (
    <section style={box}>
      <div style={{ fontWeight: 600, fontSize: 14 }}>Grilles de correction éditoriale (par type d'ouvrage)</div>
      <p style={{ fontSize: 12.5, color: "var(--muted)", margin: "4px 0 12px", lineHeight: 1.6 }}>
        La grille du type choisi est appliquée automatiquement par l'assistance de correction IA. Modifiez les points de
        contrôle et leur sévérité (C1 bloquant · C2 important · C3 mineur · S suggestion). Un type sans grille propre hérite du
        « profil par défaut ».
      </p>
      {err && <div style={{ background: "var(--alert-soft, #F6E2DE)", color: "var(--alert, #B23A2E)", borderRadius: 6, padding: "7px 11px", fontSize: 12.5, marginBottom: 10 }}>{err}</div>}
      {note && <div style={{ background: "var(--eclosion-soft)", color: "var(--eclosion)", borderRadius: 6, padding: "7px 11px", fontSize: 12.5, marginBottom: 10 }}>{note}</div>}

      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "flex-end", marginBottom: 12 }}>
        <label style={{ fontSize: 12.5, fontWeight: 600, display: "flex", flexDirection: "column", gap: 4 }}>
          Type d'ouvrage à éditer
          <select value={code} onChange={(e) => setCode(e.target.value)} style={{ fontSize: 13, padding: "6px 8px", border: "1px solid var(--line)", borderRadius: 6, minWidth: 220 }}>
            {targets.map((t) => <option key={t.code} value={t.code}>{t.label}</option>)}
          </select>
        </label>
      </div>

      <div style={{ display: "grid", gap: 6 }}>
        {points.map((p, i) => (
          <div key={i} style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <input
              value={p.label}
              onChange={(e) => setPoints((cur) => cur.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)))}
              placeholder="Point de contrôle…"
              style={{ flex: 1, minWidth: 180, fontSize: 13, padding: "6px 8px", border: "1px solid var(--line)", borderRadius: 6 }}
            />
            <select value={p.default_severity} onChange={(e) => setPoints((cur) => cur.map((x, j) => (j === i ? { ...x, default_severity: e.target.value } : x)))} style={{ fontSize: 12.5, padding: "6px 8px", border: "1px solid var(--line)", borderRadius: 6 }}>
              {SEVERITIES.map((s) => <option key={s} value={s}>{SEV_LABEL[s]}</option>)}
            </select>
            <button type="button" onClick={() => setPoints((cur) => cur.filter((_, j) => j !== i))} title="Retirer ce point" style={{ background: "#fff", border: "1px solid var(--alert, #B23A2E)", color: "var(--alert, #B23A2E)", borderRadius: 6, cursor: "pointer", fontSize: 12, padding: "5px 9px" }}>✕</button>
          </div>
        ))}
      </div>
      <div style={{ display: "flex", gap: 8, marginTop: 10, flexWrap: "wrap" }}>
        <button type="button" onClick={() => setPoints((cur) => [...cur, { label: "", default_severity: "C3" }])} style={{ background: "#fff", border: "1px solid var(--line)", borderRadius: 6, cursor: "pointer", fontSize: 12.5, padding: "6px 12px", fontWeight: 600 }}>+ Ajouter un point de contrôle</button>
        <button type="button" onClick={save} disabled={saving} style={{ background: "var(--eclosion)", color: "#0B0B0C", border: "none", borderRadius: 6, padding: "6px 14px", fontSize: 13, fontWeight: 700, cursor: saving ? "default" : "pointer" }}>{saving ? "Enregistrement…" : "Enregistrer la grille"}</button>
      </div>

      <div style={{ marginTop: 16, paddingTop: 12, borderTop: "1px solid var(--line)" }}>
        <div style={{ fontSize: 12.5, fontWeight: 700, color: "var(--muted)", marginBottom: 6 }}>Ajouter un nouveau type d'ouvrage</div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
          <input value={newType.label} onChange={(e) => setNewType((n) => ({ ...n, label: e.target.value }))} placeholder="Libellé (ex. Livre de recettes)" style={{ fontSize: 13, padding: "6px 8px", border: "1px solid var(--line)", borderRadius: 6, minWidth: 200 }} />
          <input value={newType.code} onChange={(e) => setNewType((n) => ({ ...n, code: e.target.value }))} placeholder="code (ex. recettes)" style={{ fontSize: 13, padding: "6px 8px", border: "1px solid var(--line)", borderRadius: 6, minWidth: 140 }} />
          <button type="button" onClick={addType} disabled={saving} style={{ background: "#fff", border: "1px solid var(--line)", borderRadius: 6, cursor: saving ? "default" : "pointer", fontSize: 12.5, padding: "6px 12px", fontWeight: 600 }}>Ajouter</button>
        </div>
      </div>
    </section>
  );
}
