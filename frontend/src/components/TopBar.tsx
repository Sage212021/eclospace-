import { useEffect, useRef, useState } from "react";
import {
  getPresenceNames,
  listUnreadNotifications,
  markAllNotificationsRead,
  markNotificationRead,
  quickSearch,
  type Notification,
  type QuickSearchResult,
} from "../api/client";
import { useI18n } from "../i18n";
import { LanguageSwitch } from "./LanguageSwitch";

interface TopBarProps {
  // Nombre de personnes connectées (présence temps réel, sans identités).
  connectedTotal: number;
  // Effectif présent par pôle (compteurs seuls) pour la fenêtre « Hall ».
  // `status` = activité agrégée du pôle : « active » (vert), « away » (orange),
  // null (personne = gris).
  poles: { label: string; count: number; status: "active" | "away" | null }[];
  // Profil habilité à voir les identités des connectés (DG, super-admin).
  canSeePresenceNames?: boolean;
  // Sur mobile : ouvre le menu latéral escamotable (bouton ☰ à gauche).
  onMenu?: () => void;
  // Profil courant + actions du menu (déconnexion, accès aux paramètres).
  user: { username: string; email: string };
  onLogout: () => void;
  onOpenSettings?: () => void;
  // Ouvre la fiche d'un ouvrage depuis un résultat de recherche.
  onOpenManuscript?: (id: string) => void;
  // Ouvre une annonce du Babillard depuis une notification de la cloche.
  onOpenAnnouncement?: (id: string) => void;
  // Ouvre le calendrier depuis une notification d'événement.
  onOpenCalendar?: () => void;
  // Signal (compteur) : à chaque changement, la cloche recharge son badge de
  // non-lus (ex. arrivée d'une annonce en temps réel).
  refreshSignal?: number;
}

const NOTIF_COLORS: Record<string, string> = {
  low: "var(--muted)",
  medium: "var(--eclosion)",
  high: "#C4661F",
  critical: "var(--alert)",
};

function initials(username: string): string {
  const parts = username.replace(/[_.-]+/g, " ").trim().split(/\s+/);
  const letters = parts.length >= 2 ? parts[0][0] + parts[1][0] : username.slice(0, 2);
  return letters.toUpperCase();
}

// Barre supérieure (guide §6) : recherche globale + présence + notifications +
// menu de profil (avatar) à droite, façon Microsoft 365 / Notion.
export function TopBar({ connectedTotal, poles, canSeePresenceNames, onMenu, user, onLogout, onOpenSettings, onOpenManuscript, onOpenAnnouncement, onOpenCalendar, refreshSignal }: TopBarProps) {
  const { t, lang } = useI18n();
  const [unreadCount, setUnreadCount] = useState(0);
  const [menuOpen, setMenuOpen] = useState(false);
  const [hallOpen, setHallOpen] = useState(false);
  const [notifOpen, setNotifOpen] = useState(false);
  const [notifs, setNotifs] = useState<Notification[]>([]);
  // Glissement d'une notification vers la gauche pour la rabattre (mobile).
  const [swipe, setSwipe] = useState<{ id: string; dx: number } | null>(null);
  const swipeStartX = useRef(0);
  const swipedRef = useRef(false);
  // Noms par grand pôle, chargés à la demande à l'ouverture du Hall, pour les
  // seuls profils habilités. Rechargés à chaque ouverture pour rester à jour.
  const [namesByPole, setNamesByPole] = useState<Record<string, { name: string; activity: "active" | "away" }[]>>({});

  useEffect(() => {
    if (!hallOpen || !canSeePresenceNames) return;
    let cancelled = false;
    getPresenceNames()
      .then((data) => {
        if (cancelled) return;
        const map: Record<string, { name: string; activity: "active" | "away" }[]> = {};
        for (const p of data.poles) map[p.pole] = p.users;
        setNamesByPole(map);
      })
      .catch(() => {
        if (!cancelled) setNamesByPole({});
      });
    return () => {
      cancelled = true;
    };
    // Recharge aussi quand une activité bascule (actif↔arrière-plan), pas
    // seulement quand l'effectif change, pour recolorer les noms en temps réel.
  }, [hallOpen, canSeePresenceNames, connectedTotal, poles.map((p) => `${p.label}:${p.status ?? "-"}`).join("|")]);

  // Recherche rapide : requête saisie, résultats et état d'ouverture du menu
  // déroulant. La recherche part après une courte pause de frappe (anti-rebond)
  // pour ne pas solliciter le serveur à chaque touche.
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<QuickSearchResult[]>([]);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searching, setSearching] = useState(false);
  const searchBoxRef = useRef<HTMLDivElement>(null);

  // Badge de non-lus : au montage, puis à chaque signal (arrivée temps réel).
  useEffect(() => {
    listUnreadNotifications()
      .then((notifications) => setUnreadCount(notifications.length))
      .catch(() => setUnreadCount(0));
  }, [refreshSignal]);

  // Report du nombre de non-lus sur l'ICÔNE de l'application installée (écran
  // d'accueil du téléphone), à la manière d'un badge Play Store / WhatsApp.
  // API « Badging » : n'agit que sur l'app INSTALLÉE (PWA) et les navigateurs
  // qui la gèrent (Chrome/Edge Android, Safari iOS ≥ 16.4) ; ailleurs l'appel
  // est ignoré sans effet. La valeur posée PERSISTE sur l'icône même après
  // fermeture de l'application, jusqu'à ce que les notifications soient lues.
  useEffect(() => {
    const nav = navigator as Navigator & {
      setAppBadge?: (n?: number) => Promise<void>;
      clearAppBadge?: () => Promise<void>;
    };
    try {
      if (unreadCount > 0) void nav.setAppBadge?.(unreadCount)?.catch(() => {});
      else void nav.clearAppBadge?.()?.catch(() => {});
    } catch {
      /* API indisponible : sans effet, l'icône reste normale */
    }
  }, [unreadCount]);

  // Charge la liste complète à l'ouverture du panneau (et sur signal si ouvert),
  // pour rester à jour.
  useEffect(() => {
    if (!notifOpen) return;
    // Le panneau ne montre que les notifications NON LUES : une notification
    // ouverte (donc lue) disparaît. Décision opérateur — la cloche reste propre,
    // l'historique complet restant consultable ailleurs (journal / audit).
    listUnreadNotifications()
      .then((list) => setNotifs(list.slice(0, 30)))
      .catch(() => setNotifs([]));
  }, [notifOpen, refreshSignal]);

  function notifTime(iso: string): string {
    return new Date(iso).toLocaleDateString(lang === "en" ? "en-GB" : "fr-FR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
  }

  async function handleNotifClick(n: Notification) {
    if (!n.readAt) {
      setUnreadCount((c) => Math.max(0, c - 1));
      void markNotificationRead(n.id).catch(() => {});
    }
    // Une notification OUVERTE disparaît du panneau (décision opérateur) : le
    // financier voit « Commande à facturer », l'ouvre, elle s'en va ; idem pour
    // l'administrateur qui la verrait exceptionnellement.
    setNotifs((list) => list.filter((x) => x.id !== n.id));
    if (n.entityType === "announcement" && n.entityId && onOpenAnnouncement) {
      setNotifOpen(false);
      onOpenAnnouncement(n.entityId);
    } else if (n.entityType === "calendar_event" && onOpenCalendar) {
      setNotifOpen(false);
      onOpenCalendar();
    }
  }

  // Rabattre (faire disparaître) une notification sans l'ouvrir — via le
  // glissement vers la gauche. Elle est marquée lue et retirée du panneau.
  function dismissNotif(n: Notification) {
    if (!n.readAt) {
      setUnreadCount((c) => Math.max(0, c - 1));
      void markNotificationRead(n.id).catch(() => {});
    }
    setNotifs((list) => list.filter((x) => x.id !== n.id));
    setSwipe(null);
  }

  const DISMISS_THRESHOLD = 70; // px de glissement vers la gauche pour rabattre
  function onNotifTouchStart(e: React.TouchEvent) {
    swipeStartX.current = e.touches[0].clientX;
    swipedRef.current = false;
  }
  function onNotifTouchMove(id: string, e: React.TouchEvent) {
    const dx = e.touches[0].clientX - swipeStartX.current;
    if (dx < -6) swipedRef.current = true; // c'est un glissement, pas un tap
    setSwipe({ id, dx: Math.min(0, dx) }); // ne suit que vers la gauche
  }
  function onNotifTouchEnd(n: Notification) {
    const dx = swipe?.id === n.id ? swipe.dx : 0;
    if (dx <= -DISMISS_THRESHOLD) dismissNotif(n);
    else setSwipe(null); // revient en place
  }

  async function handleMarkAll() {
    setNotifs((list) => list.map((x) => ({ ...x, readAt: x.readAt ?? new Date().toISOString() })));
    setUnreadCount(0);
    void markAllNotificationsRead().catch(() => {});
  }

  useEffect(() => {
    const term = query.trim();
    if (term.length === 0) {
      setResults([]);
      setSearching(false);
      return;
    }
    setSearching(true);
    const handle = setTimeout(() => {
      quickSearch(term)
        .then((data) => setResults(data.results))
        .catch(() => setResults([]))
        .finally(() => setSearching(false));
    }, 250);
    return () => clearTimeout(handle);
  }, [query]);

  // Ferme le menu déroulant quand on clique en dehors de la zone de recherche.
  useEffect(() => {
    if (!searchOpen) return;
    function onClickOutside(event: MouseEvent) {
      if (searchBoxRef.current && !searchBoxRef.current.contains(event.target as Node)) {
        setSearchOpen(false);
      }
    }
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, [searchOpen]);

  function openResult(id: string) {
    setSearchOpen(false);
    setQuery("");
    setResults([]);
    onOpenManuscript?.(id);
  }

  return (
    <header
      style={{
        display: "flex",
        alignItems: "center",
        gap: 16,
        padding: "12px clamp(12px, 3vw, 24px)",
        borderBottom: "1px solid var(--line)",
        background: "var(--card)",
      }}
    >
      {/* Bouton ☰ : la classe app-menu-btn le masque sur grand écran et
          l'affiche sous 900px (média-requête, pas de JS). */}
      {onMenu && (
        <button onClick={onMenu} aria-label="Ouvrir le menu" className="app-menu-btn">
          ☰
        </button>
      )}
      {/* Recherche rapide : au fil de la frappe, un menu déroulant présente les
          ouvrages correspondants (titre, auteur, ISBN). Cliquer un résultat
          ouvre sa fiche. La présentation générale reste inchangée : le champ
          garde sa place et son style, seul le déroulé s'ajoute au clic. */}
      <div ref={searchBoxRef} style={{ position: "relative", flex: 1, minWidth: 0, maxWidth: 420 }}>
        <input
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setSearchOpen(true);
          }}
          onFocus={() => setSearchOpen(true)}
          placeholder={t("topbar.search", "Rechercher un ouvrage, un auteur, un ISBN…")}
          aria-label={t("topbar.search", "Rechercher un ouvrage, un auteur, un ISBN…")}
          style={{
            width: "100%",
            padding: "8px 12px",
            border: "1px solid var(--line)",
            borderRadius: 6,
            fontSize: 13,
            color: "var(--ink)",
          }}
        />
        {searchOpen && query.trim().length > 0 && (
          <div
            style={{
              position: "absolute",
              top: "calc(100% + 6px)",
              left: 0,
              right: 0,
              zIndex: 61,
              background: "var(--card)",
              border: "1px solid var(--line)",
              borderRadius: 12,
              boxShadow: "0 12px 32px rgba(9, 16, 33, 0.18)",
              overflow: "hidden",
              maxHeight: 360,
              overflowY: "auto",
            }}
          >
            {searching && results.length === 0 && (
              <div style={{ padding: "12px 14px", fontSize: 13, color: "var(--muted)" }}>Recherche…</div>
            )}
            {!searching && results.length === 0 && (
              <div style={{ padding: "12px 14px", fontSize: 13, color: "var(--muted)" }}>
                Aucun ouvrage ne correspond à « {query.trim()} ».
              </div>
            )}
            {results.map((r) => (
              <button
                key={r.id}
                onClick={() => openResult(r.id)}
                style={{
                  display: "block",
                  width: "100%",
                  textAlign: "left",
                  background: "transparent",
                  border: "none",
                  borderBottom: "1px solid var(--line)",
                  padding: "10px 14px",
                  cursor: "pointer",
                }}
                onMouseEnter={(e) => (e.currentTarget.style.background = "var(--paper)")}
                onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
              >
                <div style={{ fontSize: 13, fontWeight: 600, color: "var(--ink)" }}>{r.title}</div>
                <div style={{ fontSize: 12, color: "var(--muted)", display: "flex", gap: 8, flexWrap: "wrap" }}>
                  <span style={{ fontFamily: "var(--font-mono)" }}>{r.manuscriptNumber}</span>
                  {r.author && <span>· {r.author}</span>}
                  {r.isbn && <span style={{ fontFamily: "var(--font-mono)" }}>· {r.isbn}</span>}
                </div>
              </button>
            ))}
          </div>
        )}
      </div>
      {/* Présence : nombre de personnes connectées, sans aucune identité
          (confidentialité). Cliquer ouvre la fenêtre « Hall / Présence » qui
          détaille l'activité pôle par pôle (actif/inactif + effectif), toujours
          sans nommer personne. */}
      <div style={{ position: "relative" }}>
        <button
          onClick={() => setHallOpen((v) => !v)}
          aria-label="Voir la présence par pôle"
          aria-expanded={hallOpen}
          title={`${connectedTotal} personne(s) connectée(s) — voir par pôle`}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 6,
            fontSize: 12,
            color: "var(--muted)",
            whiteSpace: "nowrap",
            background: "transparent",
            border: "none",
            cursor: "pointer",
            padding: "4px 2px",
          }}
        >
          <span style={{ width: 9, height: 9, borderRadius: 999, background: "var(--eclosion)", display: "inline-block" }} />
          <span style={{ fontFamily: "var(--font-mono)" }}>{connectedTotal}</span> {t("topbar.online", "en ligne")}
        </button>

        {hallOpen && (
          <>
            <div onClick={() => setHallOpen(false)} style={{ position: "fixed", inset: 0, zIndex: 60 }} aria-hidden="true" />
            <div className="ecl-hall-panel">
              <div style={{ padding: "12px 14px", borderBottom: "1px solid var(--line)", display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
                <span style={{ fontSize: 13, fontWeight: 600, color: "var(--ink)" }}>Hall — présence</span>
                <span style={{ fontSize: 12, color: "var(--muted)" }}>
                  <span style={{ fontFamily: "var(--font-mono)", color: "var(--ink)" }}>{connectedTotal}</span> {t("topbar.online", "en ligne")}
                </span>
              </div>
              <div style={{ maxHeight: 320, overflowY: "auto" }}>
                {poles.map((p) => {
                  const active = p.count > 0;
                  // Voyant à 3 états : vert = au moins un membre actif (premier
                  // plan) ; orange = connecté(s) mais tout en arrière-plan ;
                  // gris = personne. (charte : ambre pour l'attente/arrière-plan.)
                  const dotColor = p.status === "active" ? "var(--success)" : p.status === "away" ? "#B87400" : "var(--line)";
                  // Noms révélés pour ce pôle (profils habilités uniquement) :
                  // un chef ne reçoit que son propre pôle, la DG les reçoit tous.
                  const names = canSeePresenceNames ? namesByPole[p.label] ?? [] : [];
                  return (
                    <div key={p.label} style={{ padding: "10px 14px", borderBottom: "1px solid var(--line)" }}>
                      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
                        <span style={{ display: "flex", alignItems: "center", gap: 9, fontSize: 13, color: "var(--ink)" }}>
                          <span
                            title={p.status === "active" ? "Actif" : p.status === "away" ? "Connecté (arrière-plan)" : "Personne"}
                            style={{
                              width: 9,
                              height: 9,
                              borderRadius: 999,
                              background: dotColor,
                              border: p.status ? "none" : "1px solid var(--line)",
                              display: "inline-block",
                              flexShrink: 0,
                            }}
                          />
                          {p.label}
                        </span>
                        <span style={{ fontSize: 12, color: active ? "var(--ink)" : "var(--muted)" }}>
                          {active ? (
                            <>
                              <span style={{ fontFamily: "var(--font-mono)" }}>{p.count}</span> présent{p.count > 1 ? "s" : ""}
                              {p.status === "away" ? " · en arrière-plan" : ""}
                            </>
                          ) : (
                            "personne"
                          )}
                        </span>
                      </div>
                      {names.length > 0 && (
                        <div style={{ marginTop: 5, marginLeft: 18, fontSize: 12, color: "var(--muted)", lineHeight: 1.6, display: "flex", flexWrap: "wrap", gap: "2px 12px" }}>
                          {names.map((u) => (
                            <span key={u.name} style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                              <span
                                title={u.activity === "active" ? "Actif" : "Connecté (arrière-plan)"}
                                style={{ width: 7, height: 7, borderRadius: 999, background: u.activity === "active" ? "var(--success)" : "#B87400", display: "inline-block", flexShrink: 0 }}
                              />
                              {u.name}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
              <div style={{ padding: "8px 14px", fontSize: 11, color: "var(--muted)" }}>
                {canSeePresenceNames
                  ? "Identités visibles au titre de votre habilitation."
                  : "Effectifs par pôle — sans identités (confidentialité)."}
              </div>
            </div>
          </>
        )}
      </div>
      <div style={{ position: "relative" }}>
        <button
          onClick={() => setNotifOpen((v) => !v)}
          aria-label={t("notif.title", "Notifications")}
          aria-expanded={notifOpen}
          title={`${unreadCount} ${t("notif.unread_count", "notification(s) non lue(s)")}`}
          style={{ position: "relative", fontSize: 18, background: "transparent", border: "none", cursor: "pointer", padding: "2px 4px", lineHeight: 1 }}
        >
          🔔
          {unreadCount > 0 && (
            <span
              style={{
                position: "absolute",
                top: -2,
                right: -4,
                background: "var(--alert)",
                color: "#fff",
                borderRadius: 999,
                fontSize: 10,
                padding: "1px 5px",
                fontFamily: "var(--font-mono)",
              }}
            >
              {unreadCount}
            </span>
          )}
        </button>

        {notifOpen && (
          <>
            <div onClick={() => setNotifOpen(false)} style={{ position: "fixed", inset: 0, zIndex: 60 }} aria-hidden="true" />
            {/* Ancré au bord DROIT de la fenêtre (position fixe) plutôt qu'à la
                cloche : sur mobile étroit, un panneau large accroché à la cloche
                (qui n'est pas l'élément le plus à droite) débordait hors de
                l'écran et coupait le texte. La largeur s'adapte à la fenêtre. */}
            <div
              style={{
                position: "fixed",
                top: 62,
                right: 8,
                zIndex: 61,
                width: "min(340px, calc(100vw - 16px))",
                background: "var(--card)",
                border: "1px solid var(--line)",
                borderRadius: 12,
                boxShadow: "0 12px 32px rgba(9, 16, 33, 0.18)",
                overflow: "hidden",
              }}
            >
              <div style={{ padding: "12px 14px", borderBottom: "1px solid var(--line)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <span style={{ fontSize: 13, fontWeight: 600, color: "var(--ink)" }}>{t("notif.title", "Notifications")}</span>
                {unreadCount > 0 && (
                  <button
                    onClick={handleMarkAll}
                    style={{ background: "transparent", border: "none", color: "var(--eclosion-dark)", fontSize: 12, cursor: "pointer", padding: 0 }}
                  >
                    {t("notif.mark_all", "Tout marquer comme lu")}
                  </button>
                )}
              </div>
              <div style={{ maxHeight: 380, overflowY: "auto" }}>
                {notifs.length === 0 ? (
                  <div style={{ padding: "16px 14px", fontSize: 13, color: "var(--muted)" }}>{t("notif.empty", "Aucune notification.")}</div>
                ) : (
                  notifs.map((n) => {
                    const dx = swipe?.id === n.id ? swipe.dx : 0;
                    const swiping = dx < 0;
                    return (
                      // Conteneur : un fond rouge « rabattre » se révèle au glissement
                      // vers la gauche ; la carte glisse par-dessus (translateX).
                      <div key={n.id} style={{ position: "relative", overflow: "hidden", borderBottom: "1px solid var(--line)" }}>
                        <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "flex-end", paddingRight: 16, background: "var(--alert, #C24B3A)", color: "#fff", fontSize: 12.5, fontWeight: 700 }}>
                          Rabattre ✕
                        </div>
                        <button
                          onClick={() => { if (swipedRef.current) { swipedRef.current = false; return; } handleNotifClick(n); }}
                          onTouchStart={onNotifTouchStart}
                          onTouchMove={(e) => onNotifTouchMove(n.id, e)}
                          onTouchEnd={() => onNotifTouchEnd(n)}
                          title={t("notif.open_dismiss_swipe", "Ouvrir — ou glisser vers la gauche pour rabattre")}
                          style={{
                            position: "relative",
                            display: "block",
                            width: "100%",
                            textAlign: "left",
                            background: n.readAt ? "var(--card, #fff)" : "var(--eclosion-soft)",
                            border: "none",
                            padding: "10px 14px",
                            cursor: "pointer",
                            transform: `translateX(${dx}px)`,
                            transition: swiping ? "none" : "transform .18s ease",
                            touchAction: "pan-y",
                          }}
                        >
                          <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
                            <span style={{ width: 8, height: 8, borderRadius: 999, background: NOTIF_COLORS[n.priority] ?? "var(--muted)", display: "inline-block", flexShrink: 0 }} />
                            <span style={{ fontSize: 13, fontWeight: n.readAt ? 500 : 700, color: "var(--ink)", flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{n.title}</span>
                            <span style={{ fontSize: 10.5, color: "var(--muted)", fontFamily: "var(--font-mono)", flexShrink: 0 }}>{notifTime(n.createdAt)}</span>
                          </div>
                          <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 3, marginLeft: 15, overflow: "hidden", textOverflow: "ellipsis", display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical" }}>{n.body}</div>
                        </button>
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          </>
        )}
      </div>

      {/* Menu de profil : avatar (initiales) → identité + Paramètres + Déconnexion. */}
      <div style={{ position: "relative" }}>
        <button
          onClick={() => setMenuOpen((v) => !v)}
          aria-label="Menu du profil"
          aria-expanded={menuOpen}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            background: "transparent",
            border: "none",
            cursor: "pointer",
            padding: 2,
          }}
        >
          <span
            style={{
              width: 34,
              height: 34,
              borderRadius: 999,
              background: "linear-gradient(180deg, var(--eclosion-light), var(--eclosion))",
              color: "#fff",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: 12.5,
              fontWeight: 700,
              letterSpacing: 0.3,
            }}
          >
            {initials(user.username)}
          </span>
        </button>

        {menuOpen && (
          <>
            {/* Zone cliquable pour fermer le menu en cliquant ailleurs. */}
            <div onClick={() => setMenuOpen(false)} style={{ position: "fixed", inset: 0, zIndex: 60 }} aria-hidden="true" />
            <div
              style={{
                position: "absolute",
                top: "calc(100% + 8px)",
                right: 0,
                zIndex: 61,
                width: 248,
                maxWidth: "80vw",
                background: "var(--card)",
                border: "1px solid var(--line)",
                borderRadius: 12,
                boxShadow: "0 12px 32px rgba(9, 16, 33, 0.18)",
                overflow: "hidden",
              }}
            >
              <div style={{ padding: "12px 14px", borderBottom: "1px solid var(--line)" }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: "var(--ink)", wordBreak: "break-word" }}>{user.username}</div>
                <div style={{ fontSize: 12, color: "var(--muted)", wordBreak: "break-word" }}>{user.email}</div>
              </div>
              {onOpenSettings && (
                <MenuItem
                  onClick={() => {
                    setMenuOpen(false);
                    onOpenSettings();
                  }}
                >
                  {t("topbar.account_settings", "Paramètres du compte")}
                </MenuItem>
              )}
              <div style={{ padding: "8px 14px", borderTop: "1px solid var(--line)" }}>
                <LanguageSwitch />
              </div>
              <MenuItem
                danger
                onClick={() => {
                  setMenuOpen(false);
                  onLogout();
                }}
              >
                {t("topbar.logout", "Se déconnecter")}
              </MenuItem>
            </div>
          </>
        )}
      </div>
    </header>
  );
}

function MenuItem({ children, onClick, danger }: { children: React.ReactNode; onClick: () => void; danger?: boolean }) {
  return (
    <button
      onClick={onClick}
      style={{
        display: "block",
        width: "100%",
        textAlign: "left",
        background: "transparent",
        border: "none",
        padding: "10px 14px",
        fontSize: 13,
        cursor: "pointer",
        color: danger ? "var(--alert)" : "var(--ink)",
      }}
      onMouseEnter={(e) => (e.currentTarget.style.background = danger ? "var(--alert-soft)" : "var(--paper)")}
      onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
    >
      {children}
    </button>
  );
}
