// Bouton sémantique : chaque intention a sa couleur (identité premium).
//   add     → Ajouter / action principale (or)
//   edit    → Modifier (bleu marine)
//   view    → Voir / action neutre (contour)
//   danger  → Supprimer / retirer (rouge discret)
//   export  → Exporter (vert)
//   subtle  → action tertiaire (texte seul)
// Les styles vivent dans tokens.css (.ecl-btn / .ecl-btn--*) pour bénéficier
// des états :hover / :active / :disabled.
type Variant = "add" | "edit" | "view" | "danger" | "export" | "subtle";

type ButtonProps = Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, "className"> & {
  variant?: Variant;
  size?: "sm" | "md";
};

export function Button({ variant = "add", size = "md", type = "button", style, ...rest }: ButtonProps) {
  const classes = ["ecl-btn", `ecl-btn--${variant}`];
  if (size === "sm") classes.push("ecl-btn--sm");
  return <button type={type} className={classes.join(" ")} style={style} {...rest} />;
}
