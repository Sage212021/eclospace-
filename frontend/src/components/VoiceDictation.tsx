import { useEffect, useRef, useState } from "react";

// Dictée vocale (mode audio) : utilise la reconnaissance vocale NATIVE du
// navigateur (Web Speech API) — aucun service externe, aucune clé, gratuit, et
// disponible sur Chrome (ordinateur et Android). On transcrit en français et on
// renvoie le texte à l'appelant, qui le place dans la zone de saisie : l'opérateur
// parle au lieu de taper, puis relit et envoie. Le bouton ne s'affiche que si le
// navigateur le supporte.

// Surface minimale de l'API (non typée par défaut dans tous les navigateurs).
interface SpeechRecognitionResultLike { 0: { transcript: string }; isFinal: boolean }
interface SpeechRecognitionEventLike { resultIndex: number; results: ArrayLike<SpeechRecognitionResultLike> }
interface SpeechRecognitionLike {
  lang: string; interimResults: boolean; continuous: boolean; maxAlternatives: number;
  start(): void; stop(): void;
  onresult: ((e: SpeechRecognitionEventLike) => void) | null;
  onend: (() => void) | null;
  onerror: ((e: unknown) => void) | null;
}
type RecCtor = new () => SpeechRecognitionLike;

function getRecognitionCtor(): RecCtor | null {
  const w = window as unknown as { SpeechRecognition?: RecCtor; webkitSpeechRecognition?: RecCtor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export function VoiceDictation({ disabled, onText }: { disabled?: boolean; onText: (text: string) => void }) {
  const [supported, setSupported] = useState(false);
  const [listening, setListening] = useState(false);
  const recRef = useRef<SpeechRecognitionLike | null>(null);

  useEffect(() => {
    setSupported(getRecognitionCtor() !== null);
    return () => { try { recRef.current?.stop(); } catch { /* ignore */ } };
  }, []);

  if (!supported) return null;

  const toggle = () => {
    if (listening) { try { recRef.current?.stop(); } catch { /* ignore */ } return; }
    const Ctor = getRecognitionCtor();
    if (!Ctor) return;
    const rec = new Ctor();
    rec.lang = "fr-FR";
    rec.interimResults = false;
    rec.continuous = false;
    rec.maxAlternatives = 1;
    rec.onresult = (e) => {
      let text = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i];
        if (r.isFinal) text += r[0].transcript;
      }
      if (text.trim()) onText(text.trim());
    };
    rec.onend = () => setListening(false);
    rec.onerror = () => setListening(false);
    recRef.current = rec;
    try { rec.start(); setListening(true); } catch { setListening(false); }
  };

  return (
    <button
      type="button"
      onClick={toggle}
      disabled={disabled}
      title={listening ? "Arrêter la dictée" : "Dicter à la voix (français)"}
      aria-label={listening ? "Arrêter la dictée vocale" : "Dicter à la voix"}
      style={{
        background: listening ? "var(--alert, #B23A2E)" : "#fff",
        color: listening ? "#fff" : "inherit",
        border: `1px solid ${listening ? "var(--alert, #B23A2E)" : "var(--line)"}`,
        borderRadius: 8, padding: "9px 12px", fontSize: 15,
        cursor: disabled ? "not-allowed" : "pointer", opacity: disabled ? 0.55 : 1,
      }}
    >
      {listening ? "🔴" : "🎤"}
    </button>
  );
}
