import { useEffect, useRef } from "react";
import { useI18n } from "../i18n";

// Éditeur de contenu enrichi léger (sans bibliothèque lourde) : un champ
// `contentEditable` doté d'une petite barre d'outils (gras, italique, souligné,
// listes, lien). Le HTML produit est TOUJOURS réassaini côté serveur avant
// stockage — l'éditeur ne fait que la saisie confortable, il n'est pas la
// barrière de sécurité.
export function RichTextEditor({
  value,
  onChange,
  placeholder,
}: {
  value: string;
  onChange: (html: string) => void;
  placeholder?: string;
}) {
  const { t } = useI18n();
  const ref = useRef<HTMLDivElement>(null);

  // Initialise le contenu une seule fois (et lors d'un vidage externe), pour ne
  // pas déplacer le curseur à chaque frappe.
  useEffect(() => {
    if (ref.current && ref.current.innerHTML !== value && document.activeElement !== ref.current) {
      ref.current.innerHTML = value;
    }
  }, [value]);

  function exec(command: string, arg?: string) {
    document.execCommand(command, false, arg);
    ref.current?.focus();
    if (ref.current) onChange(ref.current.innerHTML);
  }

  function addLink() {
    const url = window.prompt(t("cm.link_prompt", "Adresse du lien (https://…)") + "");
    if (url && /^https?:\/\//i.test(url)) exec("createLink", url);
  }

  const btn: React.CSSProperties = {
    border: "1px solid var(--line)",
    background: "var(--card)",
    borderRadius: 6,
    padding: "4px 9px",
    fontSize: 13,
    cursor: "pointer",
    minWidth: 30,
  };

  return (
    <div>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 6 }}>
        <button type="button" title={t("cm.bold", "Gras")} style={{ ...btn, fontWeight: 700 }} onClick={() => exec("bold")}>B</button>
        <button type="button" title={t("cm.italic", "Italique")} style={{ ...btn, fontStyle: "italic" }} onClick={() => exec("italic")}>I</button>
        <button type="button" title={t("cm.underline", "Souligné")} style={{ ...btn, textDecoration: "underline" }} onClick={() => exec("underline")}>U</button>
        <button type="button" title={t("cm.bullet_list", "Liste à puces")} style={btn} onClick={() => exec("insertUnorderedList")}>• —</button>
        <button type="button" title={t("cm.numbered_list", "Liste numérotée")} style={btn} onClick={() => exec("insertOrderedList")}>1.</button>
        <button type="button" title={t("cm.link", "Lien")} style={btn} onClick={addLink}>🔗</button>
      </div>
      <div
        ref={ref}
        contentEditable
        role="textbox"
        aria-multiline="true"
        data-placeholder={placeholder}
        onInput={() => ref.current && onChange(ref.current.innerHTML)}
        style={{
          minHeight: 160,
          border: "1px solid var(--line)",
          borderRadius: 8,
          padding: "10px 12px",
          fontSize: 14,
          lineHeight: 1.5,
          background: "var(--card)",
          overflowY: "auto",
          maxHeight: 360,
        }}
      />
      <p style={{ fontSize: 11.5, color: "var(--muted)", margin: "6px 0 0" }}>
        {t("cm.editor_note", "Mise en forme simple. Le contenu est vérifié et sécurisé automatiquement à l'enregistrement.")}
      </p>
    </div>
  );
}
