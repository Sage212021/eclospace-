import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// ── Test d'architecture : les frontières entre couches sont VÉRIFIÉES ─────────
// Ce test ne teste pas une fonctionnalité : il verrouille la structure du code
// pour qu'elle reste maintenable dans le temps. Les invariants ci-dessous
// interdisent les dépendances qui, à terme, transforment un logiciel propre en
// « plat de spaghettis ». Toute violation fait échouer la CI, donc la règle ne
// peut pas se dégrader silencieusement au fil des ajouts.
//
// Couches (de la plus basse à la plus haute) :
//   lib/     → règles métier et utilitaires partagés (ne connaît pas les routes)
//   routes/  → points d'entrée HTTP ; orchestrent, s'appuient sur lib/
//   app.ts / server.ts → assemblage et démarrage (personne ne les importe)

const SRC = resolve(dirname(fileURLToPath(import.meta.url)), "../src");

// Liste récursive des fichiers .ts d'un sous-dossier de src/.
function tsFiles(dir: string): string[] {
  const root = join(SRC, dir);
  if (!existsSync(root)) return [];
  const out: string[] = [];
  for (const entry of readdirSync(root, { withFileTypes: true, recursive: true })) {
    if (entry.isFile() && entry.name.endsWith(".ts")) {
      // parentPath : disponible sur Node ≥ 18.17 avec l'option recursive.
      const base = (entry as unknown as { parentPath?: string; path?: string }).parentPath ?? (entry as unknown as { path: string }).path;
      out.push(join(base, entry.name));
    }
  }
  return out;
}

// Extrait les spécificateurs d'import RELATIFS d'un fichier, résolus en chemin
// absolu (sans extension). On ignore les paquets externes (fastify, zod, …) et
// les imports @prisma/client : seuls les liens internes nous intéressent.
function localImports(file: string): string[] {
  const src = readFileSync(file, "utf8");
  const specifiers: string[] = [];
  // Trois formes d'import : `… from "x"`, `import("x")` (dynamique), et
  // `import "x"` (effet de bord, sans liaison). Les trois sont couvertes pour
  // qu'aucune ne contourne le contrôle.
  const re = /(?:import|export)\s[^'"]*?from\s*["']([^"']+)["']|import\s*\(\s*["']([^"']+)["']\s*\)|import\s+["']([^"']+)["']/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) {
    const spec = m[1] ?? m[2] ?? m[3];
    if (spec && spec.startsWith(".")) {
      specifiers.push(resolve(dirname(file), spec).replace(/\.js$/, ""));
    }
  }
  return specifiers;
}

// Un import résolu pointe-t-il vers tel sous-dossier / fichier de src ?
function inLayer(resolvedImport: string, layer: string): boolean {
  const rel = relative(SRC, resolvedImport);
  return rel === layer || rel.startsWith(`${layer}/`) || rel.startsWith(`${layer}\\`);
}
function isFile(resolvedImport: string, name: string): boolean {
  return relative(SRC, resolvedImport) === name;
}

describe("architecture — frontières entre couches", () => {
  it("aucun fichier lib/ ne dépend d'une route (pas de dépendance montante)", () => {
    const offenders: string[] = [];
    for (const file of tsFiles("lib")) {
      for (const imp of localImports(file)) {
        if (inLayer(imp, "routes")) offenders.push(`${relative(SRC, file)} → ${relative(SRC, imp)}`);
      }
    }
    expect(offenders, `Une règle partagée doit vivre dans lib/, pas être tirée depuis une route :\n${offenders.join("\n")}`).toEqual([]);
  });

  it("aucune route n'importe une autre route (la logique partagée passe par lib/)", () => {
    const offenders: string[] = [];
    for (const file of tsFiles("routes")) {
      for (const imp of localImports(file)) {
        // Un fichier de routes/ ne doit pas importer un AUTRE fichier de routes/.
        if (inLayer(imp, "routes") && relative(SRC, imp) !== relative(SRC, file).replace(/\.ts$/, "")) {
          offenders.push(`${relative(SRC, file)} → ${relative(SRC, imp)}`);
        }
      }
    }
    expect(offenders, `Deux routes ne doivent pas se dépendre l'une l'autre — extrayez le partagé dans lib/ :\n${offenders.join("\n")}`).toEqual([]);
  });

  it("ni lib/ ni routes/ n'importent l'assemblage (app.ts / server.ts)", () => {
    const offenders: string[] = [];
    for (const dir of ["lib", "routes"]) {
      for (const file of tsFiles(dir)) {
        for (const imp of localImports(file)) {
          if (isFile(imp, "app") || isFile(imp, "server")) offenders.push(`${relative(SRC, file)} → ${relative(SRC, imp)}`);
        }
      }
    }
    expect(offenders, `L'assemblage se fait dans app.ts/server.ts uniquement ; personne ne les importe :\n${offenders.join("\n")}`).toEqual([]);
  });
});
