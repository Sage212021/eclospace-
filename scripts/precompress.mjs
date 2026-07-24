// Pré-compression des fichiers statiques du frontend (Brotli + gzip), exécutée
// une fois à la construction (build). Le serveur sert ensuite directement le
// fichier .br/.gz correspondant selon ce que le navigateur accepte, SANS
// recompresser à chaque requête — idéal pour un petit serveur : le processeur
// ne travaille pas, et les fichiers envoyés sont 3 à 4× plus légers.
//
// N'ajoute aucune dépendance : n'utilise que le module « zlib » intégré à Node.

import { readdirSync, statSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { gzipSync, brotliCompressSync, constants } from "node:zlib";

const ROOT = "backend/public";
// Types de fichiers qui gagnent à être compressés (texte). On ignore images,
// polices et médias, déjà compressés par nature.
const COMPRESSIBLE = new Set([".js", ".css", ".html", ".svg", ".json", ".map", ".txt", ".xml", ".webmanifest"]);
const MIN_BYTES = 1024; // en dessous, la compression n'apporte rien d'utile

let count = 0;

function walk(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const s = statSync(p);
    if (s.isDirectory()) {
      walk(p);
      continue;
    }
    if (name.endsWith(".br") || name.endsWith(".gz")) continue;
    const dot = name.lastIndexOf(".");
    const ext = dot >= 0 ? name.slice(dot) : "";
    if (!COMPRESSIBLE.has(ext) || s.size < MIN_BYTES) continue;

    const buf = readFileSync(p);
    writeFileSync(p + ".br", brotliCompressSync(buf, { params: { [constants.BROTLI_PARAM_QUALITY]: 11 } }));
    writeFileSync(p + ".gz", gzipSync(buf, { level: 9 }));
    count++;
  }
}

if (!existsSync(ROOT)) {
  console.log(`[precompress] ${ROOT} absent — rien à faire (normal hors build).`);
} else {
  walk(ROOT);
  console.log(`[precompress] ${count} fichier(s) pré-compressé(s) (.br + .gz) sous ${ROOT}.`);
}
