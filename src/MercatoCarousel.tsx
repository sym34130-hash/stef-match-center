import { useEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent } from "react";
import { ChevronLeft, ChevronRight, Mars, Users, Venus } from "lucide-react";
import { parseMercatoEntrants, type MercatoEntrant, type MercatoProfiles } from "./mercato";

type Props = {
  entrants: MercatoEntrant[];
  profiles: MercatoProfiles;
};

const PLAYER_IMAGES = {
  female: "/assets/mercato-player-female.jpg",
  male: "/assets/mercato-player-male.jpg",
} as const;

export function MercatoKpiCard({ entrants, profiles }: Props) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const activeIndexRef = useRef(0);
  const navigationTargetRef = useRef<number | null>(null);
  const dragRef = useRef<{ pointerId: number; startX: number; scrollLeft: number; moved: boolean } | null>(null);
  const [activeIndex, setActiveIndex] = useState(0);
  const lastIndex = entrants.length - 1;

  useEffect(() => {
    activeIndexRef.current = 0;
    navigationTargetRef.current = null;
    setActiveIndex(0);
    viewportRef.current?.scrollTo({ left: 0, behavior: "instant" });
    const viewport = viewportRef.current;
    if (!viewport) return;
    const observer = new ResizeObserver(() => {
      viewport.scrollTo({ left: viewport.clientWidth * activeIndexRef.current, behavior: "instant" });
    });
    observer.observe(viewport);
    return () => observer.disconnect();
  }, [entrants]);

  if (entrants.length === 0) return null;

  const goTo = (requestedIndex: number) => {
    const nextIndex = Math.max(0, Math.min(lastIndex, requestedIndex));
    activeIndexRef.current = nextIndex;
    navigationTargetRef.current = nextIndex;
    setActiveIndex(nextIndex);
    const viewport = viewportRef.current;
    if (!viewport) return;
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    viewport.scrollTo({ left: viewport.clientWidth * nextIndex, behavior: reducedMotion ? "instant" : "smooth" });
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (entrants.length < 2 || !["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    event.stopPropagation();
    if (event.key === "Home") goTo(0);
    else if (event.key === "End") goTo(lastIndex);
    else goTo(activeIndexRef.current + (event.key === "ArrowRight" ? 1 : -1));
  };

  const startDrag = (event: PointerEvent<HTMLDivElement>) => {
    if (event.pointerType !== "mouse" || event.button !== 0 || (event.target as Element).closest("button")) return;
    event.stopPropagation();
    navigationTargetRef.current = null;
    dragRef.current = { pointerId: event.pointerId, startX: event.clientX, scrollLeft: event.currentTarget.scrollLeft, moved: false };
  };

  const moveDrag = (event: PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    event.stopPropagation();
    const delta = event.clientX - drag.startX;
    if (!drag.moved && Math.abs(delta) < 5) return;
    drag.moved = true;
    event.currentTarget.setPointerCapture(event.pointerId);
    event.currentTarget.classList.add("is-dragging");
    event.currentTarget.scrollLeft = drag.scrollLeft - delta;
  };

  const endDrag = (event: PointerEvent<HTMLDivElement>) => {
    if (!dragRef.current || dragRef.current.pointerId !== event.pointerId) return;
    event.stopPropagation();
    const moved = dragRef.current.moved;
    dragRef.current = null;
    event.currentTarget.classList.remove("is-dragging");
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    if (moved) goTo(Math.round(event.currentTarget.scrollLeft / Math.max(1, event.currentTarget.clientWidth)));
  };

  return (
    <div className="mercato-kpi" aria-label={entrants.length === 1 ? "Nouveau joueur du Mercato" : `${entrants.length} nouveaux joueurs du Mercato`}>
      <div className="mercato-kpi-viewport" ref={viewportRef} role="group" aria-label="Joueurs du Mercato" tabIndex={entrants.length > 1 ? 0 : undefined}
        onKeyDownCapture={onKeyDown}
        onPointerDown={startDrag} onPointerMove={moveDrag} onPointerUp={endDrag} onPointerCancel={endDrag} onLostPointerCapture={endDrag}
        onTouchStart={(event) => { event.stopPropagation(); navigationTargetRef.current = null; }} onTouchEnd={(event) => event.stopPropagation()} onTouchCancel={(event) => event.stopPropagation()}
        onWheel={() => { navigationTargetRef.current = null; }}
        onScroll={(event) => {
          const viewport = event.currentTarget;
          const nextIndex = Math.max(0, Math.min(lastIndex, Math.round(viewport.scrollLeft / Math.max(1, viewport.clientWidth))));
          const targetIndex = navigationTargetRef.current;
          if (targetIndex === null) {
            activeIndexRef.current = nextIndex;
            setActiveIndex((current) => current === nextIndex ? current : nextIndex);
          } else if (Math.abs(viewport.scrollLeft - viewport.clientWidth * targetIndex) <= 2) {
            navigationTargetRef.current = null;
            activeIndexRef.current = targetIndex;
            setActiveIndex((current) => current === targetIndex ? current : targetIndex);
          }
        }}>
        <div className="mercato-kpi-track">
          {entrants.map((entrant, index) => {
            const profile = profiles[entrant.key];
            const nameLength = [...entrant.name].length;
            const flocageFontSize = Math.max(6, Math.min(12.5, 198 / Math.max(1, nameLength * 0.7)));
            const flocageTextLength = Math.max(52, Math.min(198, nameLength * flocageFontSize * 0.7));
            return (
              <div className="mercato-kpi-slide" key={entrant.id} aria-hidden={index !== activeIndex}>
                {profile ? (
                  <img className="mercato-kpi-photo" src={PLAYER_IMAGES[profile]} alt="" draggable={false} data-profile={profile} />
                ) : (
                  <div className="mercato-kpi-profile-needed">
                    <Users size={23} aria-hidden="true" />
                    <strong>Profil à choisir</strong>
                    <span>Choisir Femme ou Homme dans Coach pour afficher la photo.</span>
                  </div>
                )}
                {profile && (
                  <svg className="mercato-kpi-flocage" viewBox="0 0 280 36" preserveAspectRatio="none" role="img" aria-label={`Flocage : ${entrant.name}`}>
                    <defs>
                      <linearGradient id={`mercato-kpi-flock-fill-${index}`} x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0" stopColor="#fff" />
                        <stop offset="0.48" stopColor="#e7e9ed" />
                        <stop offset="1" stopColor="#fff" />
                      </linearGradient>
                      <filter id={`mercato-kpi-flock-shadow-${index}`} x="-15%" y="-35%" width="130%" height="180%" colorInterpolationFilters="sRGB">
                        <feTurbulence type="fractalNoise" baseFrequency="0.72 0.22" numOctaves="1" seed="7" result="fabric-grain" />
                        <feDisplacementMap in="SourceGraphic" in2="fabric-grain" scale="0.34" xChannelSelector="R" yChannelSelector="G" result="fabric-print" />
                        <feDropShadow in="fabric-print" dx="0" dy="0.7" stdDeviation="0.48" floodColor="#020817" floodOpacity="0.78" />
                      </filter>
                      <path id={`mercato-kpi-flock-baseline-${index}`} d="M 30 23 Q 140 25 250 23" />
                    </defs>
                    <text fill={`url(#mercato-kpi-flock-fill-${index})`} stroke="rgba(245, 247, 252, 0.28)" strokeWidth="0.28" paintOrder="stroke" filter={`url(#mercato-kpi-flock-shadow-${index})`} fontFamily="Arial Narrow, Arial, sans-serif" fontSize={flocageFontSize} fontWeight="800" letterSpacing="0.55">
                      <textPath href={`#mercato-kpi-flock-baseline-${index}`} startOffset="50%" textAnchor="middle" textLength={flocageTextLength} lengthAdjust="spacingAndGlyphs">
                        {entrant.name.toLocaleUpperCase("fr-FR")}
                      </textPath>
                    </text>
                  </svg>
                )}
                <span className="mercato-kpi-kind"><Users size={14} aria-hidden="true" /> Mercato</span>
                <span className="mercato-kpi-subtitle">{entrants.length === 1 ? "Nouveau joueur" : "Nouveaux joueurs"}</span>
                {profile && (
                  <span className="mercato-kpi-profile" data-profile={profile}>
                    {profile === "female" ? <Venus size={13} aria-hidden="true" /> : <Mars size={13} aria-hidden="true" />}
                    {profile === "female" ? "Femme" : "Homme"}
                  </span>
                )}
                {entrants.length > 1 && <span className="mercato-kpi-flocage-index" aria-hidden="true">{String(index + 1).padStart(2, "0")}</span>}
              </div>
            );
          })}
        </div>
      </div>

      {entrants.length > 1 && (
        <div className="mercato-kpi-navigation" aria-label="Navigation des nouveaux joueurs">
          <button type="button" aria-label="Joueur précédent dans le Mercato" title="Joueur précédent" disabled={activeIndex === 0} onClick={() => goTo(activeIndexRef.current - 1)}><ChevronLeft size={16} /></button>
          <span aria-live="polite" aria-atomic="true">{activeIndex + 1} / {entrants.length}</span>
          <button type="button" aria-label="Joueur suivant dans le Mercato" title="Joueur suivant" disabled={activeIndex === lastIndex} onClick={() => goTo(activeIndexRef.current + 1)}><ChevronRight size={16} /></button>
        </div>
      )}
    </div>
  );
}

type MercatoCarouselSectionProps = {
  mercato: string | null;
  profiles: MercatoProfiles;
};

export function MercatoCarouselSection({ mercato, profiles }: MercatoCarouselSectionProps) {
  const entrants = useMemo(() => parseMercatoEntrants(mercato ?? ""), [mercato]);
  if (entrants.length === 0) return null;

  return (
    <article
      className="match-indicator-card is-mercato mercato-carousel-card"
      style={{ "--indicator-accent": "#cba6f4" } as CSSProperties}
      aria-label={`${entrants.length === 1 ? "Nouveau joueur" : "Nouveaux joueurs"} : ${entrants.map((entrant) => entrant.name).join(", ")}`}
    >
      <MercatoKpiCard entrants={entrants} profiles={profiles} />
    </article>
  );
}
