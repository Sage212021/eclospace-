import { Component, type ReactNode } from "react";

// Garde-fou LOCAL (à l'échelle d'une section) : contrairement à l'ErrorBoundary
// globale qui remplace toute la page par un écran « Recharger », celui-ci
// contient l'erreur À L'INTÉRIEUR de la section. Si un bloc (ex. « Planification
// du projet ») échoue au rendu, on affiche un petit message de repli à sa place
// et le RESTE DE LA PAGE reste affiché — la section « ne disparaît » jamais et
// n'emporte pas tout l'écran avec elle.
export class SectionErrorBoundary extends Component<{ children: ReactNode; fallback: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render(): ReactNode {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}
