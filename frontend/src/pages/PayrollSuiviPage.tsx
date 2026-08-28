import { PayrollMonthlySection } from "../components/PayrollMonthlySection";
import { HandoffCard, DipeCard } from "../components/PayrollEngineHub";
import { GuidanceNote } from "../components/GuidanceNote";

// Page dédiée « Paie — validation & suivi » (D-016) : un point d'entrée unique
// pour le DG et le DAF, sans ouvrir toute la page Ressources humaines. Réutilise
// les cartes existantes du Moteur de paie (aucune duplication) :
//   • validation mensuelle par le DG (fil de validation daté) ;
//   • suivi de prise en charge DAF (décaissement, déclarations, archivage, clôture) ;
//   • DIPE mensuel CNPS (provisoire tant que non validé, définitif après).
export function PayrollSuiviPage({ canValidatePayrollDg, canHandoffDaf }: { canValidatePayrollDg: boolean; canHandoffDaf: boolean }) {
  return (
    <div className="ecl-page" style={{ maxWidth: 880 }}>
      <h1 className="ecl-page__title">Paie — validation (DG) &amp; suivi (DAF)</h1>
      <p className="ecl-page__lead">Circuit RH → DG → DAF : validation de la paie par le DG, puis prise en charge et suivi par le DAF (décaissement, déclarations, archivage), DIPE et clôture du mois.</p>

      <GuidanceNote title="Qui fait quoi">
        Le <b>RH</b> prépare et soumet la paie (dans « Ressources humaines »). <b>Seul le DG valide</b> le mois — la
        validation est réservée à la Direction générale. Le <b>DAF ne valide pas la paie</b> : il assure ensuite le
        <b> suivi</b> (décaissement des salaires, déclarations CNPS/impôts, archivage des bulletins) puis la <b>clôture</b>
        du cycle. Le <b>DIPE</b> devient <b>définitif</b> (bon pour dépôt CNPS) une fois la paie validée par le DG.
      </GuidanceNote>

      {canValidatePayrollDg && <PayrollMonthlySection canManage={false} canValidateDg collapsible defaultOpen />}
      <HandoffCard canManage={canHandoffDaf} defaultOpen />
      <DipeCard defaultOpen />
    </div>
  );
}
