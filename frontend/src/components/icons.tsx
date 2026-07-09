// Jeu d'icônes de navigation, monochromes (trait « currentColor ») : gris en
// temps normal, dorées quand le pôle est actif. Style ligne, sobre et premium
// (façon SAP Fiori / Microsoft 365), plus élégant que des emojis colorés.

type IconProps = { size?: number };

function Svg({ size = 16, children }: IconProps & { children: React.ReactNode }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      style={{ flexShrink: 0 }}
    >
      {children}
    </svg>
  );
}

export function IconHome(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M3 10.5 12 3l9 7.5" />
      <path d="M5 9.5V20h14V9.5" />
    </Svg>
  );
}

export function IconBook(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M4 4.5A1.5 1.5 0 0 1 5.5 3H19v16H6a2 2 0 0 0-2 2V4.5Z" />
      <path d="M6 19a2 2 0 0 0-2 2" />
    </Svg>
  );
}

export function IconProduction(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M6 9V3h12v6" />
      <rect x="4" y="9" width="16" height="8" rx="1.5" />
      <path d="M8 17v4h8v-4" />
      <circle cx="17" cy="12.5" r="0.6" fill="currentColor" />
    </Svg>
  );
}

export function IconCommercial(p: IconProps) {
  return (
    <Svg {...p}>
      <circle cx="9" cy="20" r="1.3" />
      <circle cx="18" cy="20" r="1.3" />
      <path d="M2.5 3h2l2.2 12.2a1.5 1.5 0 0 0 1.5 1.3h8.3a1.5 1.5 0 0 0 1.5-1.2L21 7H6" />
    </Svg>
  );
}

export function IconFinance(p: IconProps) {
  return (
    <Svg {...p}>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 7v10M9.5 9.2c0-1 1.1-1.7 2.5-1.7s2.5.7 2.5 1.7-1.1 1.6-2.5 1.6-2.5.7-2.5 1.7 1.1 1.7 2.5 1.7 2.5-.7 2.5-1.7" />
    </Svg>
  );
}

export function IconAdmin(p: IconProps) {
  return (
    <Svg {...p}>
      <circle cx="9" cy="8" r="3" />
      <path d="M3.5 20a5.5 5.5 0 0 1 11 0" />
      <path d="M17 11a2.5 2.5 0 1 0-2-4" />
      <path d="M16.5 20a5 5 0 0 0-1.8-3.9" />
    </Svg>
  );
}

export function IconPilotage(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M4 20V4M4 20h16" />
      <path d="M8 16l3.5-4 3 2.5L20 8" />
    </Svg>
  );
}

// Indicateur de présence : petite silhouette (dorée) au lieu d'une pastille.
export function IconPresence(p: IconProps) {
  return (
    <Svg {...p} >
      <circle cx="12" cy="8" r="3.2" />
      <path d="M5.5 20a6.5 6.5 0 0 1 13 0" />
    </Svg>
  );
}
