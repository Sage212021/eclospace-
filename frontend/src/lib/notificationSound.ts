// Sonnerie de notification légère, générée par Web Audio (aucun fichier binaire
// à embarquer). Deux notes brèves et discrètes. Le volume (0-100) est réglable
// par l'utilisateur dans ses préférences.
//
// Contrainte navigateur : l'audio ne peut démarrer qu'APRÈS une première
// interaction de l'utilisateur avec la page (règle anti-lecture-automatique).
// On crée donc l'AudioContext paresseusement et on tente de le réactiver
// (`resume`) à chaque lecture ; tant qu'aucune interaction n'a eu lieu, la
// lecture échoue silencieusement — la cloche et le pop-up restent, eux, visibles.

let ctx: AudioContext | null = null;

function getContext(): AudioContext | null {
  if (typeof window === "undefined") return null;
  const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AC) return null;
  if (!ctx) ctx = new AC();
  return ctx;
}

export function playNotificationSound(volume = 70): void {
  const audio = getContext();
  if (!audio) return;
  // Réactive le contexte si le navigateur l'a suspendu (au meilleur effort).
  void audio.resume?.().catch(() => {});

  const gain = audio.createGain();
  const peak = Math.max(0, Math.min(1, volume / 100)) * 0.18; // plafond discret
  gain.connect(audio.destination);

  const now = audio.currentTime;
  const notes = [
    { freq: 880, start: 0, dur: 0.12 },
    { freq: 1320, start: 0.13, dur: 0.16 },
  ];
  for (const n of notes) {
    const osc = audio.createOscillator();
    osc.type = "sine";
    osc.frequency.value = n.freq;
    const g = audio.createGain();
    g.gain.setValueAtTime(0, now + n.start);
    g.gain.linearRampToValueAtTime(peak, now + n.start + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, now + n.start + n.dur);
    osc.connect(g);
    g.connect(gain);
    osc.start(now + n.start);
    osc.stop(now + n.start + n.dur + 0.02);
  }
}
