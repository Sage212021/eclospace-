import { useEffect, useState } from "react";
import {
  getContractualisationInbox,
  getContractualisationDelegateCandidates,
  delegateContractualisation,
  revokeContractualisationDelegation,
  validateStep,
  type ContractualisationInbox,
  type ContractualisationItem,
  type DelegateCandidate,
} from "../api/client";

// Écran « Dossiers à contractualiser » (demande opérateur 16/10). Après la
// contre-validation du BAT par le DG, l'ouvrage passe à la CONTRACTUALISATION :
// la Direction générale établit le contrat, le fait signer et dépose le scan
// signé des deux parties (rubrique Contrat de la fiche), puis valide — ce qui
// autorise enfin l'impression. Le DG peut déléguer la PRÉPARATION (Éditorial,
// RH, DAF) ; le clic final de validation reste au DG.

const CONTRACT_STATUS_LABEL: Record<string, string> = {
  preparation: "En préparation",
  legal_review: "Revue juridique",
  direction_approval: "Approbation Direction",
  awaiting_signature: "En attente de signature",
  active: "Actif (signé)",
};

function royaltySummary(royalty: unknown): string | null {
  if (!royalty || typeof royalty !== "object") return null;
  const r = royalty as { tiers?: { up_to: number | null; rate: number }[]; base?: string; advance_amount?: number | string | null };
  const parts: string[] = [];
  if (Array.isArray(r.tiers) && r.tiers.length > 0) {
    const rates = r.tiers.map((t) => `${Math.round((t.rate ?? 0) * 100)} %`);
    parts.push(`Taux : ${[...new Set(rates)].join(" / ")}`);
  }
  if (r.advance_amount != null && Number(r.advance_amount) > 0) parts.push(`À-valoir : ${Number(r.advance_amount).toLocaleString("fr-FR")}`);
  return parts.length ? parts.join(" · ") : null;
}

export function ContractualisationPage({ onOpenManuscript }: { onOpenManuscript: (id: string) => void }) {
  const [data, setData] = useState<ContractualisationInbox | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [candidates, setCandidates] = useState<DelegateCandidate[]>([]);
  const [busy, setBusy] = useState<string | null>(null);

  const refresh = () =>
    getContractualisationInbox()
      .then(setData)
      .catch((e) => setError(e instanceof Error ? e.message : "Chargement impossible."));

  useEffect(() => {
    refresh();
  }, []);

  useEffect(() => {
    if (data?.is_direction) {
      getContractualisationDelegateCandidates()
        .then((r) => setCandidates(r.items))
        .catch(() => setCandidates([]));
    }
  }, [data?.is_direction]);

  async function act(key: string, fn: () => Promise<unknown>) {
    setBusy(key);
    setError(null);
    try {
      await fn();
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Action impossible.");
    } finally {
      setBusy(null);
    }
  }

  const isDg = data?.is_direction ?? false;

  return (
    <section style={{ maxWidth: 820 }}>
      <h1 style={{ fontSize: 21, margin: "0 0 4px", fontFamily: "var(--font-title, inherit)" }}>Dossiers à contractualiser</h1>
      <p style={{ color: "var(--muted)", fontSize: 13, margin: "0 0 14px", lineHeight: 1.5 }}>
        Les ouvrages dont le BAT Final est contre-validé et qui attendent la <b>contractualisation</b> avant l'impression. Pour chaque dossier :
        établissez le contrat, faites-le signer et déposez le <b>scan signé des deux parties</b> (bouton « Ouvrir la fiche » → rubrique Contrat), puis
        {isDg ? " validez la contractualisation." : " le DG validera."} {isDg && "Vous pouvez déléguer la préparation à l'Éditorial, aux RH ou au DAF ; la validation finale reste la vôtre."}
      </p>

      {error && <div style={{ background: "var(--alert-soft)", color: "var(--alert)", borderRadius: 8, padding: "9px 12px", fontSize: 13, marginBottom: 12 }}>{error}</div>}
      {data === null && !error && <p style={{ color: "var(--muted)", fontSize: 13 }}>Chargement…</p>}

      {data !== null && data.items.length === 0 && (
        <div style={{ background: "var(--card)", border: "1px solid var(--line)", borderRadius: 12, padding: 24, textAlign: "center", color: "var(--muted)", fontSize: 13.5 }}>
          Aucun dossier en contractualisation pour l'instant. Dès qu'un BAT Final sera contre-validé, l'ouvrage apparaîtra ici.
        </div>
      )}

      <div style={{ display: "grid", gap: 12 }}>
        {(data?.items ?? []).map((item) => (
          <DossierCard
            key={item.manuscript_id}
            item={item}
            isDg={isDg}
            candidates={candidates}
            busy={busy}
            onOpen={() => onOpenManuscript(item.manuscript_id)}
            onDelegate={(assigneeId) => act(`del-${item.manuscript_id}`, () => delegateContractualisation(item.manuscript_id, assigneeId))}
            onRevoke={() => act(`rev-${item.manuscript_id}`, () => revokeContractualisationDelegation(item.manuscript_id))}
            onValidate={() => act(`val-${item.manuscript_id}`, () => validateStep(item.manuscript_id, "CONTRACTUALISATION"))}
          />
        ))}
      </div>
    </section>
  );
}

function DossierCard({
  item,
  isDg,
  candidates,
  busy,
  onOpen,
  onDelegate,
  onRevoke,
  onValidate,
}: {
  item: ContractualisationItem;
  isDg: boolean;
  candidates: DelegateCandidate[];
  busy: string | null;
  onOpen: () => void;
  onDelegate: (assigneeId: string) => void;
  onRevoke: () => void;
  onValidate: () => void;
}) {
  const [pick, setPick] = useState("");
  const hasContract = !!item.contract;
  const hasScan = !!item.contract?.has_signed_scan;
  const royalty = item.contract ? royaltySummary(item.contract.royalty) : null;

  return (
    <div style={{ border: "1px solid var(--line)", borderRadius: 12, background: "var(--card)", padding: 14, boxShadow: "0 1px 2px rgba(11,11,12,.04)" }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 8, flexWrap: "wrap" }}>
        <span style={{ fontWeight: 700, fontSize: 14.5 }}>📕 {item.title}</span>
        <span style={{ fontFamily: "var(--font-mono, ui-monospace, monospace)", fontSize: 12, color: "var(--muted)" }}>{item.manuscript_number}</span>
      </div>

      {/* Contrat + droits d'auteur */}
      <div style={{ marginTop: 8, padding: 10, borderRadius: 8, background: "var(--ivory, #FAF8F2)", fontSize: 12.5, lineHeight: 1.6 }}>
        {!hasContract ? (
          <div style={{ color: "#B87400" }}>⚠ Aucun contrat établi pour ce dossier. Ouvrez la fiche pour créer le contrat.</div>
        ) : (
          <>
            <div>
              📄 <b>Contrat</b> <span style={{ fontFamily: "var(--font-mono, ui-monospace, monospace)" }}>{item.contract!.contract_number}</span> — {CONTRACT_STATUS_LABEL[item.contract!.status] ?? item.contract!.status}
            </div>
            {royalty && <div>💰 <b>Droits d'auteur</b> — {royalty}</div>}
            <div style={{ color: hasScan ? "#2F7D4A" : "#B87400", fontWeight: 600 }}>
              {hasScan ? "✅ Contrat signé des deux parties déposé (scan)" : "⬜ Scan du contrat signé des deux parties non déposé"}
            </div>
          </>
        )}
        {item.delegate && (
          <div style={{ marginTop: 4, color: "var(--muted)" }}>
            👤 Préparation déléguée à <b>{item.delegate.name}</b>.
          </div>
        )}
      </div>

      {/* Actions */}
      <div style={{ display: "flex", gap: 8, marginTop: 10, flexWrap: "wrap", alignItems: "center" }}>
        <button onClick={onOpen} style={secondaryBtn}>Ouvrir la fiche (Contrat)</button>

        {isDg && (
          <>
            <button
              onClick={onValidate}
              disabled={!hasScan || busy === `val-${item.manuscript_id}`}
              title={!hasScan ? "Déposez d'abord le contrat signé des deux parties (scan) dans la rubrique Contrat." : undefined}
              style={{ ...primaryBtn, cursor: hasScan ? "pointer" : "not-allowed", opacity: hasScan ? 1 : 0.55 }}
            >
              {busy === `val-${item.manuscript_id}` ? "Validation…" : "Valider la contractualisation"}
            </button>

            {!item.delegate ? (
              <span style={{ display: "inline-flex", gap: 6, alignItems: "center" }}>
                <select value={pick} onChange={(e) => setPick(e.target.value)} style={{ fontSize: 12.5, padding: "5px 6px" }}>
                  <option value="">— Déléguer à… —</option>
                  {candidates.map((c) => (
                    <option key={c.id} value={c.id}>{c.name}{c.roles.length ? ` (${c.roles.join(", ")})` : ""}</option>
                  ))}
                </select>
                <button onClick={() => pick && onDelegate(pick)} disabled={!pick || busy === `del-${item.manuscript_id}`} style={secondaryBtn}>
                  Déléguer
                </button>
              </span>
            ) : (
              <button onClick={onRevoke} disabled={busy === `rev-${item.manuscript_id}`} style={secondaryBtn}>
                Reprendre la main
              </button>
            )}
          </>
        )}
      </div>
    </div>
  );
}

const secondaryBtn: React.CSSProperties = {
  background: "#fff",
  border: "1px solid var(--line)",
  borderRadius: 8,
  padding: "6px 13px",
  fontSize: 12.5,
  fontWeight: 600,
  cursor: "pointer",
};
const primaryBtn: React.CSSProperties = {
  background: "var(--eclosion, #D9B21A)",
  color: "#0B0B0C",
  border: "1px solid var(--eclosion, #D9B21A)",
  borderRadius: 8,
  padding: "6px 15px",
  fontSize: 12.5,
  fontWeight: 700,
};
