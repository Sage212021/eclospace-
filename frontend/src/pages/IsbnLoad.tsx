import { useMemo, useState } from "react";
import { loadIsbns, type IsbnFormat, type IsbnLoadResult } from "../api/client";

// Écran Administrateur — « Chargement des ISBN ».
// Quand la maison reçoit une nouvelle tranche d'ISBN de l'agence, l'administrateur
// la charge ici au statut « disponible », sans passer par un fichier CSV : il
// COLLE la liste (un numéro par ligne) ou GÉNÈRE une séquence. Chaque numéro est
// vérifié (13 chiffres + chiffre de contrôle) avant d'entrer dans la banque ; un
// numéro déjà présent n'est jamais réutilisé (signalé « déjà en banque »).

const FORMATS: { value: IsbnFormat; label: string }[] = [
  { value: "print", label: "Imprimé" },
  { value: "epub", label: "ePub" },
  { value: "pdf", label: "PDF" },
  { value: "audio", label: "Audio" },
];

// Chiffre de contrôle ISBN-13 (= EAN-13) des 12 premiers chiffres.
function checkDigit(first12: string): number {
  const sum = first12.split("").map(Number).reduce((acc, d, i) => acc + d * (i % 2 === 0 ? 1 : 3), 0);
  return (10 - (sum % 10)) % 10;
}
// Présentation lisible 978-9956-0-7966-7 (découpage indicatif, sans valeur légale).
function pretty(isbn13: string): string {
  if (!/^\d{13}$/.test(isbn13)) return isbn13;
  return `${isbn13.slice(0, 3)}-${isbn13.slice(3, 7)}-${isbn13.slice(7, 8)}-${isbn13.slice(8, 12)}-${isbn13.slice(12)}`;
}

export function IsbnLoad() {
  const [format, setFormat] = useState<IsbnFormat>("print");
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<IsbnLoadResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Générateur de séquence (facultatif) : base = chiffres avant le bloc
  // incrémental (978-9956-0 → « 97899560 »), premier numéro et nombre à générer.
  const [genBase, setGenBase] = useState("97899560");
  const [genStart, setGenStart] = useState("7986");
  const [genCount, setGenCount] = useState(10);

  const lines = useMemo(
    () => text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean),
    [text],
  );

  function generate() {
    const base = genBase.replace(/\D/g, "");
    const startRaw = genStart.replace(/\D/g, "");
    const width = startRaw.length || 4;
    const startNum = Number(startRaw);
    const count = Math.max(1, Math.min(2000, Math.floor(genCount) || 0));
    if (!base || isNaN(startNum)) { setError("Génération impossible : vérifiez la base et le premier numéro (chiffres uniquement)."); return; }
    setError(null);
    const out: string[] = [];
    for (let i = 0; i < count; i++) {
      const block = String(startNum + i).padStart(width, "0");
      const first12 = (base + block);
      if (first12.length !== 12) { setError(`Génération impossible : « base + numéro » doit faire 12 chiffres (ici ${first12.length}). Pour la maison : base « 97899560 » + numéro à 4 chiffres.`); return; }
      out.push(pretty(first12 + checkDigit(first12)));
    }
    // On AJOUTE à ce qui est déjà saisi (sans doublonner bêtement les lignes).
    setText((cur) => {
      const existing = new Set(cur.split(/\r?\n/).map((l) => l.trim()).filter(Boolean));
      const merged = [...existing];
      for (const o of out) if (!existing.has(o)) merged.push(o);
      return merged.join("\n");
    });
  }

  async function charger() {
    if (lines.length === 0) { setError("Collez au moins un numéro ISBN (un par ligne), ou générez une séquence."); return; }
    setBusy(true); setError(null); setResult(null);
    try {
      const res = await loadIsbns(lines, format);
      setResult(res);
      // On vide la zone de saisie si TOUT est entré (rien à corriger).
      if (res.invalid.length === 0 && res.duplicates === 0) setText("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Chargement impossible.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ maxWidth: 820 }}>
      <h1 style={{ fontSize: 22, margin: "0 0 4px" }}>Chargement des ISBN</h1>
      <p style={{ color: "var(--muted)", margin: "0 0 12px", fontSize: 13.5, lineHeight: 1.5 }}>
        Réservé à l'administrateur. Chargez ici une nouvelle tranche d'ISBN <strong>disponibles</strong> (neufs, non
        utilisés). Collez la liste (un numéro par ligne) ou générez une séquence. Chaque numéro est vérifié (13 chiffres
        et chiffre de contrôle) ; un numéro déjà présent dans la banque n'est jamais rechargé ni réutilisé.
      </p>

      {/* Mode d'emploi REPLIÉ par défaut : n'envahit pas l'écran, se déplie au besoin. */}
      <details style={{ ...box, background: "var(--eclosion-soft, #FBF4D9)", borderColor: "var(--eclosion, #D9B21A)", marginBottom: 16 }}>
        <summary style={{ cursor: "pointer", fontWeight: 700, fontSize: 14 }}>📘 Mode d'emploi — comment charger des ISBN (cliquer pour déplier)</summary>
        <div style={{ fontSize: 13, lineHeight: 1.6, marginTop: 10 }}>
          <p style={{ margin: "0 0 10px" }}>
            Un ISBN se termine toujours par un dernier chiffre « de contrôle » (le <strong>7</strong> dans
            978-9956-0-7966-<strong>7</strong>) : il se calcule à partir des autres et sert à repérer une faute de frappe.
            Vous n'avez pas à le calculer — l'écran le vérifie, et le génère pour vous. Deux façons de faire :
          </p>
          <p style={{ margin: "0 0 4px", fontWeight: 700 }}>Façon 1 — Coller la liste (le plus simple)</p>
          <p style={{ margin: "0 0 10px" }}>
            Vous avez déjà les numéros (papier, e-mail, fichier). Tapez-les ou copiez-les dans la grande case ci-dessous,
            <strong> un par ligne</strong>, puis cliquez « Charger ». Les tirets sont facultatifs
            (<span style={{ fontFamily: "var(--font-mono)" }}>978-9956-0-7986-5</span> ou
            <span style={{ fontFamily: "var(--font-mono)" }}> 9789956079865</span>, les deux marchent).
            À utiliser quand vous avez peu de numéros, ou une liste déjà écrite.
          </p>
          <p style={{ margin: "0 0 4px", fontWeight: 700 }}>Façon 2 — Générer une séquence (pour gagner du temps)</p>
          <p style={{ margin: "0 0 6px" }}>
            Quand les numéros se suivent (7986, 7987, 7988…), l'écran les fabrique tout seul. Remplissez 3 cases dans
            l'encadré « Générer une séquence » :
          </p>
          <ul style={{ margin: "0 0 10px", paddingLeft: 18 }}>
            <li><strong>Base</strong> : la partie fixe du début, toujours la même pour Éclosion →
              <span style={{ fontFamily: "var(--font-mono)" }}> 97899560</span> (c'est 978-9956-0).</li>
            <li><strong>Premier numéro</strong> : le point de départ, ex.
              <span style={{ fontFamily: "var(--font-mono)" }}> 7986</span>.</li>
            <li><strong>Combien</strong> : combien en créer d'un coup, ex. <strong>10</strong>.</li>
          </ul>
          <p style={{ margin: 0 }}>
            Cliquez « ➕ Générer » : les numéros s'écrivent dans la grande case (avec leur chiffre de contrôle). Vous les
            <strong> relisez</strong>, en ajoutez/enlevez si besoin, puis « Charger ».
            À la fin, l'écran indique : combien <span style={{ color: "#2F7D4A", fontWeight: 700 }}>chargés</span>,
            combien <span style={{ color: "#B87400", fontWeight: 700 }}>déjà en banque</span> (ignorés),
            combien <span style={{ color: "#B23A2E", fontWeight: 700 }}>refusés</span> et pourquoi.
          </p>
        </div>
      </details>

      {error && (
        <div style={{ background: "#F6E2DE", color: "#B23A2E", border: "1px solid #E4B8AF", borderRadius: 8, padding: "9px 13px", fontSize: 13, marginBottom: 14 }}>{error}</div>
      )}

      <section style={box}>
        <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 8 }}>1 · Format des ISBN à charger</div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {FORMATS.map((f) => (
            <button key={f.value} type="button" onClick={() => setFormat(f.value)}
              style={{ background: format === f.value ? "var(--eclosion)" : "#fff", color: format === f.value ? "#0B0B0C" : "var(--ink)", border: "1px solid var(--line)", borderRadius: 999, padding: "4px 14px", fontSize: 12.5, fontWeight: 700, cursor: "pointer" }}>
              {f.label}
            </button>
          ))}
        </div>
      </section>

      <section style={box}>
        <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 8 }}>2 · Générer une séquence (facultatif)</div>
        <p style={{ color: "var(--muted)", fontSize: 12.5, margin: "0 0 10px" }}>
          Pour une tranche qui se suit (ex. 978-9956-0-<strong>7986</strong> → …). Les numéros générés s'ajoutent à la zone ci-dessous ; vous pouvez les relire avant de charger.
        </p>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "flex-end" }}>
          <label style={fieldLbl}>Base (chiffres avant le bloc)
            <input value={genBase} onChange={(e) => setGenBase(e.target.value)} style={{ ...inp, width: 130, fontFamily: "var(--font-mono)" }} />
          </label>
          <label style={fieldLbl}>Premier numéro
            <input value={genStart} onChange={(e) => setGenStart(e.target.value)} style={{ ...inp, width: 100, fontFamily: "var(--font-mono)" }} />
          </label>
          <label style={fieldLbl}>Combien
            <input type="number" min={1} max={2000} value={genCount} onChange={(e) => setGenCount(Number(e.target.value))} style={{ ...inp, width: 90, fontFamily: "var(--font-mono)" }} />
          </label>
          <button type="button" onClick={generate} style={btnGhost}>➕ Générer</button>
        </div>
        <p style={{ color: "var(--muted)", fontSize: 11.5, margin: "8px 0 0" }}>
          Pour Éclosion : base « 97899560 » (978-9956-0) + premier numéro à 4 chiffres. Le chiffre de contrôle est calculé automatiquement.
        </p>
      </section>

      <section style={box}>
        <div style={{ display: "flex", alignItems: "baseline", gap: 10, flexWrap: "wrap", marginBottom: 8 }}>
          <div style={{ fontWeight: 600, fontSize: 14 }}>3 · Numéros à charger</div>
          <span style={{ color: "var(--muted)", fontSize: 12.5 }}>{lines.length} numéro(s) — un par ligne</span>
        </div>
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={"978-9956-0-7986-5\n978-9956-0-7987-2\n…"}
          spellCheck={false}
          style={{ width: "100%", minHeight: 180, fontSize: 13.5, fontFamily: "var(--font-mono)", padding: "10px 12px", border: "1px solid var(--line)", borderRadius: 8, boxSizing: "border-box", lineHeight: 1.7 }}
        />
        <div style={{ display: "flex", gap: 10, marginTop: 10, flexWrap: "wrap" }}>
          <button type="button" onClick={charger} disabled={busy || lines.length === 0}
            style={{ background: "var(--eclosion)", color: "#0B0B0C", border: "none", borderRadius: 8, padding: "9px 18px", fontSize: 14, fontWeight: 700, cursor: busy || lines.length === 0 ? "default" : "pointer", opacity: busy || lines.length === 0 ? 0.6 : 1 }}>
            {busy ? "Chargement…" : `Charger ${lines.length || ""} ISBN`}
          </button>
          {text && <button type="button" onClick={() => { setText(""); setResult(null); setError(null); }} style={btnGhost}>Vider</button>}
        </div>
      </section>

      {result && (
        <section style={{ ...box, borderColor: "var(--eclosion, #D9B21A)" }}>
          <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 8 }}>Résultat du chargement</div>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 10 }}>
            <span style={pill("#2F7D4A")}>✔ {result.created} chargé(s)</span>
            <span style={pill("#B87400")}>↺ {result.duplicates} déjà en banque</span>
            <span style={pill(result.invalid.length ? "#B23A2E" : "#5B6472")}>✘ {result.invalid.length} invalide(s)</span>
          </div>
          {result.created_list.length > 0 && (
            <details style={{ marginBottom: 8 }}>
              <summary style={{ cursor: "pointer", fontSize: 12.5, fontWeight: 600, color: "#2F7D4A" }}>Voir les {result.created_list.length} ISBN chargés</summary>
              <div style={{ fontFamily: "var(--font-mono)", fontSize: 12.5, marginTop: 6, lineHeight: 1.7, columns: 2 }}>
                {result.created_list.map((n) => <div key={n}>{pretty(n)}</div>)}
              </div>
            </details>
          )}
          {result.invalid.length > 0 && (
            <div>
              <div style={{ fontSize: 12.5, fontWeight: 600, color: "#B23A2E", marginBottom: 4 }}>Numéros refusés (à corriger) :</div>
              <ul style={{ margin: 0, paddingLeft: 18, fontSize: 12.5, lineHeight: 1.6 }}>
                {result.invalid.map((v, i) => (
                  <li key={i}><span style={{ fontFamily: "var(--font-mono)" }}>{v.value || "(vide)"}</span> — {v.reason}</li>
                ))}
              </ul>
            </div>
          )}
          {result.created > 0 && (
            <p style={{ fontSize: 12.5, color: "var(--muted)", margin: "10px 0 0" }}>
              Ces ISBN sont désormais « disponibles » dans la <strong>Banque des ISBN</strong> et seront proposés à l'attribution.
            </p>
          )}
        </section>
      )}
    </div>
  );
}

const box: React.CSSProperties = { border: "1px solid var(--line)", borderRadius: 10, background: "var(--paper, #FAF8F2)", padding: 14, marginBottom: 14 };
const btnGhost: React.CSSProperties = { background: "#fff", color: "var(--ink)", border: "1px solid var(--line)", borderRadius: 8, padding: "8px 14px", fontSize: 13, fontWeight: 600, cursor: "pointer" };
const fieldLbl: React.CSSProperties = { display: "flex", flexDirection: "column", gap: 4, fontSize: 12, color: "var(--muted)", fontWeight: 600 };
const inp: React.CSSProperties = { border: "1px solid var(--line)", borderRadius: 6, padding: "7px 9px", fontSize: 13 };
function pill(color: string): React.CSSProperties {
  return { background: "#fff", color, border: `1px solid ${color}`, borderRadius: 999, padding: "3px 12px", fontSize: 12.5, fontWeight: 700, fontFamily: "var(--font-mono)" };
}
