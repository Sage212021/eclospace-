import { useId, useState, type InputHTMLAttributes } from "react";
import { getKnownEmails, rememberEmail } from "../lib/emailMemory";

// Champ e-mail avec mémoire : propose les adresses déjà utilisées (suggestions
// du navigateur) et mémorise l'adresse saisie à la sortie du champ. Remplace un
// <input type="email"> ordinaire — mêmes propriétés, comportement en plus.
export function EmailInput({ onBlur, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  const listId = useId();
  const [known, setKnown] = useState<string[]>(() => getKnownEmails());
  return (
    <>
      <input
        {...props}
        type="email"
        list={listId}
        autoComplete="email"
        onBlur={(e) => {
          rememberEmail(e.currentTarget.value);
          setKnown(getKnownEmails());
          onBlur?.(e);
        }}
      />
      {known.length > 0 && (
        <datalist id={listId}>
          {known.map((em) => (
            <option key={em} value={em} />
          ))}
        </datalist>
      )}
    </>
  );
}
