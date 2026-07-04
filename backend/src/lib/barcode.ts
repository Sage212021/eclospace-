// Génération de code-barres EAN-13 en SVG (Ch. 13 §13.4), calculée à la volée
// plutôt que stockée en image binaire — approximation documentée
// (docs/JOURNAL_TECHNIQUE.md) : suffisante pour l'impression, pas de
// dépendance externe pour un algorithme normalisé et stable.
const L_CODE = [
  "0001101", "0011001", "0010011", "0111101", "0100011",
  "0110001", "0101111", "0111011", "0110111", "0001011",
];
const G_CODE = [
  "0100111", "0110011", "0011011", "0100001", "0011101",
  "0111001", "0000101", "0010001", "0001001", "0010111",
];
const R_CODE = [
  "1110010", "1100110", "1101100", "1000010", "1011100",
  "1001110", "1010000", "1000100", "1001000", "1110100",
];
const FIRST_DIGIT_PARITY = [
  "LLLLLL", "LLGLGG", "LLGGLG", "LLGGGL", "LGLLGG",
  "LGGLLG", "LGGGLL", "LGLGLG", "LGLGGL", "LGGLGL",
];

export function computeEan13CheckDigit(first12Digits: string): number {
  const sum = first12Digits
    .split("")
    .map(Number)
    .reduce((acc, digit, index) => acc + digit * (index % 2 === 0 ? 1 : 3), 0);
  return (10 - (sum % 10)) % 10;
}

export function isbn13ToBarcodeSvg(isbn13: string): string {
  if (!/^\d{13}$/.test(isbn13)) {
    throw new Error("Un ISBN-13 doit comporter exactement 13 chiffres.");
  }

  const digits = isbn13.split("").map(Number);
  const parity = FIRST_DIGIT_PARITY[digits[0]];
  const leftDigits = digits.slice(1, 7);
  const rightDigits = digits.slice(7, 13);

  let bits = "101"; // garde de début
  leftDigits.forEach((digit, index) => {
    bits += parity[index] === "L" ? L_CODE[digit] : G_CODE[digit];
  });
  bits += "01010"; // garde centrale
  rightDigits.forEach((digit) => {
    bits += R_CODE[digit];
  });
  bits += "101"; // garde de fin

  const barWidth = 2;
  const barHeight = 60;
  const width = bits.length * barWidth;
  const height = barHeight + 20;

  let rects = "";
  for (let i = 0; i < bits.length; i++) {
    if (bits[i] === "1") {
      rects += `<rect x="${i * barWidth}" y="0" width="${barWidth}" height="${barHeight}" fill="#000"/>`;
    }
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}">
  <rect x="0" y="0" width="${width}" height="${height}" fill="#fff"/>
  ${rects}
  <text x="${width / 2}" y="${height - 4}" font-family="monospace" font-size="14" text-anchor="middle">${isbn13}</text>
</svg>`;
}
