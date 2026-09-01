import { getPushPublicKey, subscribePush, unsubscribePush } from "../api/client";

// Activation des notifications « push » sur l'appareil courant (téléphone /
// navigateur). Encapsule les détails techniques (service worker, permission,
// clé VAPID) derrière deux fonctions simples utilisées par l'écran des
// préférences. Tout est au meilleur effort : en cas d'échec ou de navigateur
// non compatible, on renvoie un état clair sans jamais casser la page.

// La fonctionnalité est-elle disponible sur cet appareil/navigateur ?
export function pushSupported(): boolean {
  return typeof window !== "undefined" && "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
}

function urlBase64ToUint8Array(base64: string): Uint8Array<ArrayBuffer> {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const b64 = (base64 + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(b64);
  const buffer = new ArrayBuffer(raw.length);
  const out = new Uint8Array(buffer);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

export type PushState = "unsupported" | "not_configured" | "denied" | "enabled" | "disabled";

// État actuel des notifications push sur cet appareil.
export async function getPushState(): Promise<PushState> {
  if (!pushSupported()) return "unsupported";
  let info;
  try {
    info = await getPushPublicKey();
  } catch {
    return "not_configured";
  }
  if (!info.configured || !info.publicKey) return "not_configured";
  if (Notification.permission === "denied") return "denied";
  try {
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.getSubscription();
    return sub ? "enabled" : "disabled";
  } catch {
    return "disabled";
  }
}

// Active les notifications : demande la permission, crée l'abonnement et
// l'enregistre côté serveur. Renvoie l'état final.
export async function enablePush(): Promise<PushState> {
  if (!pushSupported()) return "unsupported";
  const info = await getPushPublicKey().catch(() => null);
  if (!info || !info.configured || !info.publicKey) return "not_configured";

  const permission = await Notification.requestPermission();
  if (permission !== "granted") return permission === "denied" ? "denied" : "disabled";

  const reg = await navigator.serviceWorker.ready;
  let sub = await reg.pushManager.getSubscription();
  if (!sub) {
    sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(info.publicKey),
    });
  }
  const json = sub.toJSON() as { endpoint?: string; keys?: { p256dh?: string; auth?: string } };
  if (!json.endpoint || !json.keys?.p256dh || !json.keys?.auth) return "disabled";
  await subscribePush({ endpoint: json.endpoint, keys: { p256dh: json.keys.p256dh, auth: json.keys.auth } });
  return "enabled";
}

// Désactive les notifications sur cet appareil (annule l'abonnement local et
// le retire côté serveur).
export async function disablePush(): Promise<PushState> {
  if (!pushSupported()) return "unsupported";
  try {
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.getSubscription();
    if (sub) {
      const endpoint = sub.endpoint;
      await sub.unsubscribe().catch(() => {});
      await unsubscribePush(endpoint).catch(() => {});
    }
  } catch {
    /* rien à annuler */
  }
  return "disabled";
}
