import { useEffect, useMemo, useState } from "react";
import { useRef } from "react";
import {
  getAuthorProfile,
  getAuthorWorks,
  getAuthorWork,
  getAuthorWorkFiles,
  uploadAuthorWorkFile,
  authorFileDownloadUrl,
  deleteAuthorFile,
  listNotifications,
  markNotificationRead,
  setMyLanguage,
  type AuthorProfile,
  type AuthorWork,
  type AuthorWorkDetail,
  type AuthorFile,
  type Notification,
} from "../../api/client";
import { useI18n } from "../../i18n";

function humanSize(n: number | null | undefined): string {
  if (!n || n <= 0) return "";
  if (n < 1024) return `${n} o`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} Ko`;
  return `${(n / (1024 * 1024)).toFixed(1)} Mo`;
}

// Espace Auteur — portail externe (inc. 1). Interface volontairement DISTINCTE de
// l'ERP employé : pas de menu à pôles, une coquille épurée orientée « mes
// ouvrages / avancement / notifications ». Un auteur ne voit que ses données.

function AuthorHeader({ name, onLogout }: { name: string; onLogout: () => void }) {
  const { t, lang, setLang } = useI18n();
  const switchLang = (l: "fr" | "en") => {
    setLang(l);
    setMyLanguage(l).catch(() => {});
  };
  return (
    <header style={{ background: "var(--marine, #16233D)", color: "#fff", padding: "12px 20px", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 10 }}>
        <span style={{ fontFamily: "Georgia, serif", fontSize: 22, fontWeight: 700, letterSpacing: 0.3 }}>Eclospace</span>
        <span style={{ fontSize: 12, color: "var(--or, #C89A1B)", fontWeight: 700, textTransform: "uppercase", letterSpacing: 1 }}>{t("author.space", "Espace Auteur")}</span>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
        <div style={{ display: "flex", gap: 4, background: "rgba(255,255,255,.12)", borderRadius: 999, padding: 2 }}>
          {(["fr", "en"] as const).map((l) => (
            <button key={l} onClick={() => switchLang(l)} style={{ border: "none", cursor: "pointer", borderRadius: 999, padding: "3px 10px", fontSize: 12, fontWeight: 700, background: lang === l ? "var(--or, #C89A1B)" : "transparent", color: lang === l ? "#16233D" : "#fff" }}>{l.toUpperCase()}</button>
          ))}
        </div>
        <span style={{ fontSize: 13, opacity: 0.9 }}>{name}</span>
        <button onClick={onLogout} style={{ border: "1px solid rgba(255,255,255,.4)", background: "transparent", color: "#fff", borderRadius: 8, padding: "5px 12px", fontSize: 13, cursor: "pointer" }}>{t("author.logout", "Déconnexion")}</button>
      </div>
    </header>
  );
}

function stageColor(published: boolean, current: boolean): { bg: string; fg: string } {
  if (published) return { bg: "var(--eclosion-soft, #F3E9CC)", fg: "var(--or-dark, #8A6A12)" };
  if (current) return { bg: "var(--eclosion, #16233D)", fg: "#fff" };
  return { bg: "#EEF1F6", fg: "#4A5568" };
}

export function AuthorPortal({ userName, onLogout }: { userName: string; onLogout: () => void }) {
  const { t, lang } = useI18n();
  const [profile, setProfile] = useState<AuthorProfile | null>(null);
  const [works, setWorks] = useState<AuthorWork[]>([]);
  const [notifs, setNotifs] = useState<Notification[]>([]);
  const [detail, setDetail] = useState<AuthorWorkDetail | null>(null);
  const [files, setFiles] = useState<AuthorFile[]>([]);
  const [uploadLabel, setUploadLabel] = useState("");
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const dateFmt = useMemo(() => new Intl.DateTimeFormat(lang === "en" ? "en-GB" : "fr-FR", { dateStyle: "long" }), [lang]);

  useEffect(() => {
    Promise.all([getAuthorProfile(), getAuthorWorks(), listNotifications().catch(() => [])])
      .then(([p, w, n]) => {
        setProfile(p);
        setWorks(w);
        setNotifs(n);
      })
      .catch((e) => setError(e instanceof Error ? e.message : "Erreur"))
      .finally(() => setLoading(false));
  }, []);

  async function openWork(id: string) {
    setError(null);
    setFiles([]);
    setUploadLabel("");
    try {
      const [d, f] = await Promise.all([getAuthorWork(id), getAuthorWorkFiles(id).catch(() => [])]);
      setDetail(d);
      setFiles(f);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erreur");
    }
  }

  async function upload(file: File) {
    if (!detail || uploading) return;
    setUploading(true);
    setError(null);
    try {
      const created = await uploadAuthorWorkFile(detail.id, uploadLabel.trim(), file);
      setFiles((prev) => [created, ...prev]);
      setUploadLabel("");
      if (fileInputRef.current) fileInputRef.current.value = "";
    } catch (e) {
      setError(e instanceof Error ? e.message : "Envoi impossible.");
    } finally {
      setUploading(false);
    }
  }

  async function removeFile(id: string) {
    try {
      await deleteAuthorFile(id);
      setFiles((prev) => prev.filter((f) => f.id !== id));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erreur");
    }
  }

  async function readNotif(n: Notification) {
    if (n.readAt) return;
    try {
      await markNotificationRead(n.id);
      setNotifs((prev) => prev.map((x) => (x.id === n.id ? { ...x, readAt: new Date().toISOString() } : x)));
    } catch {
      /* sans effet */
    }
  }

  const displayName = profile?.name || userName;
  const stageLabel = (w: { stage_fr: string; stage_en: string }) => (lang === "en" ? w.stage_en : w.stage_fr);

  return (
    <div style={{ minHeight: "100vh", background: "var(--bg, #F8F9FB)" }}>
      <AuthorHeader name={displayName} onLogout={onLogout} />

      <main style={{ maxWidth: 920, margin: "0 auto", padding: "22px 18px 60px" }}>
        <h1 style={{ fontFamily: "Georgia, serif", color: "var(--marine, #16233D)", fontSize: 26, margin: "6px 0 2px" }}>
          {t("author.hello", "Bonjour")} {displayName.split(" ")[0]}
        </h1>
        <p style={{ color: "var(--muted, #667085)", fontSize: 14, marginTop: 0 }}>
          {t("author.subtitle", "Suivez l'avancement de vos ouvrages chez Éclosion Édition.")}
        </p>

        {error && <div style={{ background: "var(--alert-soft, #F6E3DF)", color: "var(--alert, #C24B3A)", borderRadius: 8, padding: "9px 13px", fontSize: 13, marginBottom: 12 }}>{error}</div>}
        {loading && <p style={{ color: "var(--muted, #667085)" }}>{t("author.loading", "Chargement…")}</p>}

        {!loading && (
          <>
            {/* Mes ouvrages */}
            <section style={{ marginTop: 18 }}>
              <h2 style={{ fontSize: 15, textTransform: "uppercase", letterSpacing: 1, color: "var(--marine, #16233D)" }}>{t("author.myworks", "Mes ouvrages")}</h2>
              {works.length === 0 && <p style={{ color: "var(--muted, #667085)", fontSize: 14 }}>{t("author.noworks", "Aucun ouvrage associé à votre compte pour le moment.")}</p>}
              <div style={{ display: "grid", gap: 12 }}>
                {works.map((w) => {
                  const c = stageColor(w.published, false);
                  return (
                    <button key={w.id} onClick={() => openWork(w.id)} style={{ textAlign: "left", border: "1px solid var(--line, #E3E8EF)", borderRadius: 12, background: "#fff", padding: "14px 16px", cursor: "pointer", display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
                      <div>
                        <div style={{ fontWeight: 700, color: "var(--marine, #16233D)", fontSize: 16 }}>{w.title}</div>
                        <div style={{ fontSize: 12.5, color: "var(--muted, #667085)", marginTop: 2, fontFamily: "monospace" }}>{w.reference}</div>
                      </div>
                      <span style={{ background: c.bg, color: c.fg, borderRadius: 999, padding: "5px 12px", fontSize: 12.5, fontWeight: 700, whiteSpace: "nowrap" }}>{stageLabel(w)}</span>
                    </button>
                  );
                })}
              </div>
            </section>

            {/* Notifications */}
            <section style={{ marginTop: 26 }}>
              <h2 style={{ fontSize: 15, textTransform: "uppercase", letterSpacing: 1, color: "var(--marine, #16233D)" }}>{t("author.notifications", "Notifications")}</h2>
              {notifs.length === 0 && <p style={{ color: "var(--muted, #667085)", fontSize: 14 }}>{t("author.nonotif", "Aucune notification.")}</p>}
              <div style={{ display: "grid", gap: 8 }}>
                {notifs.slice(0, 12).map((n) => (
                  <div key={n.id} onClick={() => readNotif(n)} style={{ border: "1px solid var(--line, #E3E8EF)", borderLeft: `3px solid ${n.readAt ? "var(--line, #E3E8EF)" : "var(--or, #C89A1B)"}`, borderRadius: 8, background: n.readAt ? "#fff" : "var(--eclosion-soft, #FBF6E7)", padding: "9px 13px", cursor: n.readAt ? "default" : "pointer" }}>
                    <div style={{ fontWeight: 600, color: "var(--marine, #16233D)", fontSize: 13.5 }}>{n.title}</div>
                    {n.body && <div style={{ fontSize: 12.5, color: "var(--muted, #667085)", marginTop: 2 }}>{n.body}</div>}
                    <div style={{ fontSize: 11, color: "var(--muted, #667085)", marginTop: 3 }}>{dateFmt.format(new Date(n.createdAt))}</div>
                  </div>
                ))}
              </div>
            </section>
          </>
        )}
      </main>

      {/* Détail d'un ouvrage : fil d'avancement */}
      {detail && (
        <div onClick={() => setDetail(null)} style={{ position: "fixed", inset: 0, background: "rgba(22,35,61,.5)", display: "flex", alignItems: "flex-end", justifyContent: "center", zIndex: 100 }}>
          <div onClick={(e) => e.stopPropagation()} style={{ background: "#fff", borderRadius: "16px 16px 0 0", width: "100%", maxWidth: 640, maxHeight: "85vh", overflowY: "auto", padding: "20px 22px 30px" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12 }}>
              <div>
                <h3 style={{ fontFamily: "Georgia, serif", color: "var(--marine, #16233D)", fontSize: 22, margin: 0 }}>{detail.title}</h3>
                <div style={{ fontSize: 12.5, color: "var(--muted, #667085)", fontFamily: "monospace", marginTop: 2 }}>{detail.reference}</div>
              </div>
              <button onClick={() => setDetail(null)} aria-label={t("author.close", "Fermer")} style={{ border: "none", background: "none", fontSize: 24, cursor: "pointer", color: "var(--muted, #667085)", lineHeight: 1 }}>×</button>
            </div>
            <p style={{ fontSize: 13, color: "var(--muted, #667085)" }}>
              {t("author.received", "Déposé le")} {dateFmt.format(new Date(detail.received_at))}
              {detail.publication_date ? ` · ${t("author.published_on", "Publié le")} ${dateFmt.format(new Date(detail.publication_date))}` : ""}
            </p>

            <h4 style={{ fontSize: 13, textTransform: "uppercase", letterSpacing: 1, color: "var(--marine, #16233D)", marginTop: 18 }}>{t("author.progress", "Avancement")}</h4>
            <ol style={{ listStyle: "none", padding: 0, margin: 0 }}>
              {detail.timeline.map((s, i) => {
                const color = s.state === "done" ? "var(--or, #C89A1B)" : s.state === "current" ? "var(--marine, #16233D)" : "#CBD2DE";
                return (
                  <li key={i} style={{ display: "flex", gap: 12, alignItems: "flex-start", paddingBottom: 14 }}>
                    <div style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
                      <span style={{ width: 16, height: 16, borderRadius: "50%", background: s.state === "upcoming" ? "#fff" : color, border: `2px solid ${color}`, flexShrink: 0 }} />
                      {i < detail.timeline.length - 1 && <span style={{ width: 2, flex: 1, minHeight: 20, background: "#E3E8EF" }} />}
                    </div>
                    <div style={{ paddingTop: -2 }}>
                      <div style={{ fontWeight: s.state === "current" ? 700 : 600, color: s.state === "upcoming" ? "var(--muted, #667085)" : "var(--marine, #16233D)", fontSize: 14 }}>
                        {lang === "en" ? s.stage_en : s.stage_fr}
                        {s.state === "current" && <span style={{ marginLeft: 8, fontSize: 11, color: "var(--or-dark, #8A6A12)", fontWeight: 700 }}>{t("author.inprogress", "en cours")}</span>}
                      </div>
                      {s.done_at && <div style={{ fontSize: 12, color: "var(--muted, #667085)", marginTop: 1 }}>{dateFmt.format(new Date(s.done_at))}</div>}
                    </div>
                  </li>
                );
              })}
            </ol>

            {/* Fichiers : dépôt par l'auteur + documents partagés par la maison */}
            <h4 style={{ fontSize: 13, textTransform: "uppercase", letterSpacing: 1, color: "var(--marine, #16233D)", marginTop: 22 }}>{t("author.files", "Fichiers")}</h4>
            <div style={{ display: "grid", gap: 8 }}>
              {files.length === 0 && <p style={{ fontSize: 13, color: "var(--muted, #667085)", margin: 0 }}>{t("author.nofiles", "Aucun fichier pour le moment.")}</p>}
              {files.map((f) => (
                <div key={f.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, border: "1px solid var(--line, #E3E8EF)", borderRadius: 8, padding: "8px 12px" }}>
                  <div style={{ minWidth: 0 }}>
                    <a href={authorFileDownloadUrl(f.id)} target="_blank" rel="noreferrer" style={{ color: "var(--marine, #16233D)", fontWeight: 600, fontSize: 13.5, textDecoration: "none" }}>
                      📎 {f.label || f.name} <span style={{ color: "var(--muted, #667085)", fontWeight: 400 }}>{f.size ? `(${humanSize(f.size)})` : ""}</span>
                    </a>
                    <div style={{ fontSize: 11, marginTop: 2 }}>
                      {f.from_house
                        ? <span style={{ color: "var(--or-dark, #8A6A12)", fontWeight: 700 }}>{t("author.from_house", "Partagé par la maison")}</span>
                        : <span style={{ color: "var(--muted, #667085)" }}>{t("author.from_me", "Déposé par vous")}</span>}
                    </div>
                  </div>
                  <div style={{ display: "flex", gap: 8, alignItems: "center", flexShrink: 0 }}>
                    <a href={authorFileDownloadUrl(f.id)} target="_blank" rel="noreferrer" style={{ fontSize: 12.5, color: "var(--eclosion, #16233D)", fontWeight: 600 }}>{t("author.download", "Télécharger")}</a>
                    {!f.from_house && <button onClick={() => removeFile(f.id)} style={{ border: "none", background: "none", color: "var(--alert, #C24B3A)", cursor: "pointer", fontSize: 12, textDecoration: "underline" }}>{t("author.remove", "Retirer")}</button>}
                  </div>
                </div>
              ))}
            </div>

            <div style={{ marginTop: 12, border: "1px dashed var(--line, #E3E8EF)", borderRadius: 10, padding: 12 }}>
              <div style={{ fontSize: 12.5, fontWeight: 700, color: "var(--marine, #16233D)", marginBottom: 8 }}>{t("author.send_file", "Envoyer un fichier à la maison")}</div>
              <input value={uploadLabel} onChange={(e) => setUploadLabel(e.target.value)} placeholder={t("author.file_label", "Intitulé (ex. corrections chapitre 3)")} style={{ width: "100%", padding: "8px 11px", border: "1px solid var(--line, #E3E8EF)", borderRadius: 8, fontSize: 13, marginBottom: 8, boxSizing: "border-box" }} />
              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <input ref={fileInputRef} type="file" onChange={(e) => { const f = e.target.files?.[0]; if (f) upload(f); }} style={{ fontSize: 12.5 }} />
                {uploading && <span style={{ fontSize: 12.5, color: "var(--muted, #667085)" }}>{t("author.sending", "Envoi…")}</span>}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
