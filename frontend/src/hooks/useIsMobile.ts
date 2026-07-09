import { useEffect, useState } from "react";

// Vrai en dessous du point de rupture : la barre latérale passe alors en
// tiroir escamotable (elle occupe sinon la majorité d'un écran de téléphone).
export function useIsMobile(breakpoint = 900): boolean {
  const query = `(max-width: ${breakpoint}px)`;
  const [isMobile, setIsMobile] = useState(() =>
    typeof window !== "undefined" ? window.matchMedia(query).matches : false,
  );

  useEffect(() => {
    const mql = window.matchMedia(query);
    const onChange = () => setIsMobile(mql.matches);
    onChange();
    mql.addEventListener("change", onChange);
    return () => mql.removeEventListener("change", onChange);
  }, [query]);

  return isMobile;
}
