// Rend le FOND BLANC d'un cachet / d'une signature TRANSPARENT, pour que l'image
// se fonde dans un PDF jsPDF (qui ne gère pas `mix-blend-mode`) comme un vrai
// tampon encré — sans le rectangle blanc « collé ». Équivalent, pour les PDF
// natifs, du `mix-blend-mode: multiply` utilisé à l'impression HTML (D-035).
//
// Traitement 100 % navigateur (canvas), sans dépendance. Les pixels quasi blancs
// (chaque canal ≥ seuil) deviennent transparents ; l'encre est préservée à pleine
// résolution.

export interface InkedImage {
  url: string; // data URL PNG (fond transparent)
  w: number; // largeur native en px (pour conserver les proportions)
  h: number;
}

export function inkStamp(dataUrl: string | null | undefined, threshold = 232): Promise<InkedImage | null> {
  if (!dataUrl) return Promise.resolve(null);
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const w = img.naturalWidth || img.width;
      const h = img.naturalHeight || img.height;
      try {
        const cv = document.createElement("canvas");
        cv.width = w;
        cv.height = h;
        const ctx = cv.getContext("2d");
        if (!ctx) { resolve({ url: dataUrl, w, h }); return; }
        ctx.drawImage(img, 0, 0);
        const id = ctx.getImageData(0, 0, w, h);
        const d = id.data;
        for (let i = 0; i < d.length; i += 4) {
          if (d[i] >= threshold && d[i + 1] >= threshold && d[i + 2] >= threshold) d[i + 3] = 0;
        }
        ctx.putImageData(id, 0, 0);
        resolve({ url: cv.toDataURL("image/png"), w, h });
      } catch {
        // Repli : image telle quelle (au pire, fond blanc conservé).
        resolve({ url: dataUrl, w, h });
      }
    };
    img.onerror = () => resolve(null);
    img.src = dataUrl;
  });
}
