import { createContext, useCallback, useContext, useState, type ReactNode } from "react";
import { Modal } from "./Modal";
import { Button } from "./Button";
import { useI18n } from "../i18n";

// Confirmation « en deux temps » (demande opérateur du 29/07/2026) : une action
// de validation (valider une facture, une dépense, accepter un devis…) ne
// s'exécute qu'après une confirmation explicite, pour éviter les fausses
// manœuvres. Fournit une fonction `confirm()` qui rend une fenêtre intégrée à
// l'identité de l'app (pas la pop-up grise du navigateur) et renvoie une
// promesse résolue à true (confirmé) ou false (annulé).

export interface ConfirmOptions {
  title?: string;
  // Message principal — ce que l'utilisateur s'apprête à faire.
  message: string;
  // Précision facultative (conséquence, montant, irréversibilité…).
  detail?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  // « danger » colore le bouton de confirmation en rouge (action lourde).
  tone?: "default" | "danger";
}

type ConfirmFn = (options: ConfirmOptions) => Promise<boolean>;

const ConfirmContext = createContext<ConfirmFn | null>(null);

interface PendingConfirm extends ConfirmOptions {
  resolve: (ok: boolean) => void;
}

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const { t } = useI18n();
  const [pending, setPending] = useState<PendingConfirm | null>(null);

  const confirm = useCallback<ConfirmFn>((options) => {
    return new Promise<boolean>((resolve) => {
      setPending({ ...options, resolve });
    });
  }, []);

  const close = (ok: boolean) => {
    if (pending) pending.resolve(ok);
    setPending(null);
  };

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      {pending && (
        <Modal
          title={pending.title ?? t("confirm.title", "Confirmation")}
          onClose={() => close(false)}
          footer={
            <>
              <Button variant="view" size="sm" onClick={() => close(false)}>
                {pending.cancelLabel ?? t("confirm.cancel", "Annuler")}
              </Button>
              <Button variant={pending.tone === "danger" ? "danger" : "add"} size="sm" onClick={() => close(true)} autoFocus>
                {pending.confirmLabel ?? t("confirm.ok", "Confirmer")}
              </Button>
            </>
          }
        >
          <p style={{ margin: 0, fontSize: 14, color: "var(--ink)" }}>{pending.message}</p>
          {pending.detail && <p style={{ margin: "8px 0 0", fontSize: 13, color: "var(--muted)" }}>{pending.detail}</p>}
        </Modal>
      )}
    </ConfirmContext.Provider>
  );
}

// Hook d'accès : renvoie la fonction confirm(). Utilisation :
//   const confirm = useConfirm();
//   if (await confirm({ message: "Valider cette facture ?" })) { …action… }
export function useConfirm(): ConfirmFn {
  const ctx = useContext(ConfirmContext);
  if (!ctx) throw new Error("useConfirm doit être utilisé dans un ConfirmProvider.");
  return ctx;
}
