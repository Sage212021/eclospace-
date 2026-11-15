import { getMyStockWork } from "../api/client";
import { MyProductionWork, type WorkStage } from "./MyProductionWork";

// « Mon espace Stock & magasin » (D-058) — pendant de « Mes travaux de production »
// pour le Responsable Stock : les ouvrages arrivés aux étapes qu'il gère EN
// PRIORITÉ (Impression, Réception et mise en stock, Commercialisation). Réutilise
// le tableau de bord de production (même rendu), avec les étapes du pôle Stock.
const STOCK_STAGES: WorkStage[] = [
  { key: "impression", label: "Impression (suivi du bon)", codes: ["IMPRESSION"] },
  { key: "reception", label: "Réception & mise en stock", codes: ["CONTROLE_QUALITE_IMPRESSION"] },
  { key: "commercialisation", label: "Commercialisation", codes: ["COMMERCIALISATION"] },
];

export function MyStockWork({ onOpenManuscript, canOpen }: { onOpenManuscript: (id: string) => void; canOpen: boolean }) {
  return (
    <MyProductionWork
      onOpenManuscript={onOpenManuscript}
      onOpenIntegration={onOpenManuscript}
      canOpen={canOpen}
      stages={STOCK_STAGES}
      fetcher={getMyStockWork}
      title="Mon espace Stock & magasin"
      headLabel="Étape"
      intro="Les ouvrages arrivés aux étapes que vous gérez en priorité : impression (suivi du bon), réception et mise en stock, commercialisation. Touchez une étape pour voir les ouvrages, puis un ouvrage pour agir."
      emptyText="Aucun ouvrage n'est actuellement à vos étapes (impression, réception et mise en stock, commercialisation). Dès qu'un ouvrage y arrivera, il apparaîtra ici."
    />
  );
}
