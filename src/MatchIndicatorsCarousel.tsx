import { useEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent } from "react";
import { Activity, ArrowDownToLine, ArrowUpFromLine, ChevronLeft, ChevronRight, Flag, Package, ShieldPlus, Thermometer, Users, Weight, type LucideIcon } from "lucide-react";
import { MercatoCarouselSection } from "./MercatoCarousel";
import { parseMercatoEntrants, type MercatoProfiles } from "./mercato";
import type { Snapshot } from "./types";
import "./match-indicators.css";

type Props = {
  snapshot: Snapshot;
  performance: string;
  motivation: string;
  injuries: string;
  staffPercent: string;
  staffDetail: string;
  mercato: string | null;
  mercatoProfiles: MercatoProfiles;
};

const number = new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 2 });
const smooth = (value: number) => { const t = Math.max(0, Math.min(1, value)); return t * t * (3 - 2 * t); };
type PunctualityKey = "arrivalPunctuality" | "departurePunctuality" | "destinationPunctuality" | "temperatureReturn";

export function MatchIndicatorsCarousel({ snapshot, performance, motivation, injuries, staffPercent, staffDetail, mercato, mercatoProfiles }: Props) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const trackRef = useRef<HTMLDivElement>(null);
  const geometry = useRef({ pitch: 296, width: 280, centers: 2, first: 0 });
  const drag = useRef<{ id: number; x: number; scroll: number; moved: boolean } | null>(null);
  const touching = useRef(false);
  const manualScroll = useRef(false);
  const goRef = useRef<(index: number, instant?: boolean) => void>(() => {});
  const settleRef = useRef<() => void>(() => {});
  const [position, setPosition] = useState({ first: 0, centers: 2 });
  const mercatoEntrants = useMemo(() => parseMercatoEntrants(mercato ?? ""), [mercato]);
  const hasMercato = mercatoEntrants.length > 0;
  const pdf = snapshot.dailyIndicators;
  const punctuality = pdf?.punctuality;
  const punctualityTargets = pdf?.punctualityTargets;
  const pdfDetail = pdf?.referenceDate ? `PDF 106J · ${pdf.referenceDate}` : "PDF 106J";
  const metric = (value: number | undefined | null, unit: string) => typeof value === "number" && Number.isFinite(value) ? `${number.format(value)}${unit}` : null;
  const pdfMetricDetail = (key: keyof NonNullable<typeof punctuality>) => {
    const target = punctualityTargets?.[key];
    return target === undefined ? pdfDetail : `${pdfDetail} · objectif ${number.format(target)}%`;
  };
  const cards: Array<{ id: string; label: string; value: string | null; detail: string; icon: LucideIcon; accent: string; percent?: number; targetKey?: PunctualityKey }> = [
    { id: "performance", label: "Performance d'équipe", value: performance, detail: motivation, icon: Users, accent: "#91d7c0" },
    { id: "injuries", label: "NB DE BLESSURES (A.T)", value: injuries.trim() ? number.format(Number(injuries)) : null, detail: "Accidents du travail · saisie manuelle", icon: ShieldPlus, accent: "#e1c58e" },
    { id: "tonnage", label: "Tonnage", value: metric(pdf?.expedition.tonnage, " t"), detail: `Expédition · ${pdfDetail}`, icon: Weight, accent: "#98d6d6" },
    { id: "positions", label: "Positions", value: metric(snapshot.summary.positions, ""), detail: `Excel · plage ${snapshot.match.timeRangeLabel}`, icon: Package, accent: "#a8c9f0" },
    { id: "arrival", label: "Ponctualité arrivage", value: metric(punctuality?.arrivalPunctuality, "%"), detail: pdfMetricDetail("arrivalPunctuality"), icon: ArrowDownToLine, accent: "#a4cbee", percent: punctuality?.arrivalPunctuality, targetKey: "arrivalPunctuality" },
    { id: "departure", label: "Ponctualité départ", value: metric(punctuality?.departurePunctuality, "%"), detail: pdfMetricDetail("departurePunctuality"), icon: ArrowUpFromLine, accent: "#b9c6ed", percent: punctuality?.departurePunctuality, targetKey: "departurePunctuality" },
    { id: "destination", label: "Ponctualité destination", value: metric(punctuality?.destinationPunctuality, "%"), detail: pdfMetricDetail("destinationPunctuality"), icon: Flag, accent: "#a4d5c8", percent: punctuality?.destinationPunctuality, targetKey: "destinationPunctuality" },
    { id: "temperature", label: "Température retour ramasse", value: metric(punctuality?.temperatureReturn, "%"), detail: pdfMetricDetail("temperatureReturn"), icon: Thermometer, accent: "#dcc0d7", percent: punctuality?.temperatureReturn, targetKey: "temperatureReturn" },
  ];
  useEffect(() => {
    const viewport = viewportRef.current;
    const track = trackRef.current;
    if (!viewport || !track) return;
    const slides = Array.from(track.children) as HTMLElement[];
    const normalCount = cards.length;
    const mercatoIndex = hasMercato ? normalCount : -1;
    const motion = window.matchMedia("(prefers-reduced-motion: reduce)");
    let frame = 0;
    let settleTimer = 0;
    let disposed = false;
    let navigationTarget: number | null = null;
    const slideStart = (index: number) => {
      const slide = slides[index];
      if (!slide) return 0;
      return slide.getBoundingClientRect().left - viewport.getBoundingClientRect().left + viewport.scrollLeft;
    };
    const isMercatoPosition = () => mercatoIndex >= 0 && viewport.scrollLeft >= slideStart(mercatoIndex) - 2;
    const targetLeft = (index: number, centers: number) => {
      if (index === mercatoIndex && mercatoIndex >= 0) return slideStart(mercatoIndex);
      const maxNormalFirst = Math.max(0, normalCount - centers);
      return !hasMercato && index === maxNormalFirst
        ? Math.max(0, viewport.scrollWidth - viewport.clientWidth)
        : index * geometry.current.pitch;
    };

    // Depth follows the actual scroll position; React only tracks the settled group.
    const paint = () => {
      frame = 0;
      const { pitch, width, centers } = geometry.current;
      const maxFirst = Math.max(0, normalCount - centers);
      const maxScrollLeft = Math.max(0, viewport.scrollWidth - viewport.clientWidth);
      const atStart = viewport.scrollLeft <= 2;
      const atEnd = viewport.scrollLeft >= maxScrollLeft - 2;
      const inMercato = isMercatoPosition();
      viewport.classList.toggle("is-mercato-active", inMercato);
      const first = inMercato
        ? mercatoIndex
        : atStart
        ? 0
        : atEnd
          ? maxFirst
          : Math.max(0, Math.min(maxFirst, Math.round(viewport.scrollLeft / pitch)));
      const visibleCenters = inMercato ? 1 : centers;
      geometry.current.first = first;
      setPosition((current) => current.first === first && current.centers === visibleCenters ? current : { first, centers: visibleCenters });
      const core = (centers - 1) * pitch / 2;
      slides.forEach((slide, index) => {
        if (index === mercatoIndex) {
          const active = inMercato;
          slide.style.setProperty("--indicator-scale", "1");
          slide.style.setProperty("--indicator-opacity", active ? "1" : "0.12");
          slide.style.setProperty("--indicator-lift", "0px");
          slide.style.zIndex = active ? "100" : "0";
          slide.toggleAttribute("data-featured", active);
          return;
        }
        if (inMercato) {
          slide.style.setProperty("--indicator-scale", "1");
          slide.style.setProperty("--indicator-opacity", "0");
          slide.style.setProperty("--indicator-lift", "0px");
          slide.style.zIndex = "0";
          slide.removeAttribute("data-featured");
          return;
        }
        const distance = Math.abs((index - viewport.scrollLeft / pitch) * pitch - core);
        const depth = Math.max(0, (distance - core) / pitch);
        const edge = smooth((distance - (viewport.clientWidth / 2 - width / 2)) / width);
        const scale = 1 - .05 * smooth(depth) - .07 * smooth((depth - 1) / 2);
        const opacity = (1 - .09 * smooth(depth) - .38 * smooth((depth - 1) / 2)) * (1 - .75 * edge);
        slide.style.setProperty("--indicator-scale", String(scale));
        slide.style.setProperty("--indicator-opacity", String(opacity));
        slide.style.setProperty("--indicator-lift", `${(1 - scale) * 100}px`);
        slide.style.zIndex = String(Math.round((1 - Math.min(depth / 5, 1)) * 100));
        slide.toggleAttribute("data-featured", distance <= core + 2);
      });
    };
    const schedulePaint = () => { if (!frame) frame = requestAnimationFrame(paint); };
    const go = (requested: number, instant = false) => {
      if (disposed) return;
      const { centers } = geometry.current;
      const maxFirst = Math.max(0, normalCount - centers);
      const next = hasMercato && requested >= mercatoIndex
        ? mercatoIndex
        : Math.max(0, Math.min(maxFirst, requested));
      geometry.current.first = next;
      manualScroll.current = false;
      navigationTarget = next;
      const visibleCenters = next === mercatoIndex ? 1 : centers;
      setPosition((current) => current.first === next && current.centers === visibleCenters ? current : { first: next, centers: visibleCenters });
      viewport.scrollTo({ left: targetLeft(next, centers), behavior: instant || motion.matches ? "instant" : "smooth" });
      schedulePaint();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
      if (event.target instanceof Element && event.target.closest(".mercato-kpi-viewport")) return;
      event.preventDefault();
      const maxFirst = Math.max(0, normalCount - geometry.current.centers);
      const current = geometry.current.first;
      if (event.key === "ArrowLeft" && current === mercatoIndex) {
        go(maxFirst);
        return;
      }
      if ((event.key === "ArrowRight" && current === maxFirst || event.key === "End") && hasMercato) {
        go(mercatoIndex);
        return;
      }
      go(event.key === "Home" ? 0 : event.key === "End" ? maxFirst : current + (event.key === "ArrowRight" ? 1 : -1));
    };
    goRef.current = go;
    const layout = () => {
      const available = viewport.clientWidth;
      const centers = available >= 640 ? 2 : 1;
      const width = centers === 2 ? (available >= 1500 ? 260 : 280) : Math.min(320, available - 72);
      const padding = (available - centers * width - (centers - 1) * 16) / 2;
      const special = slides[mercatoIndex];
      if (special) {
        special.style.width = `${available}px`;
        special.style.flexBasis = `${available}px`;
        special.style.marginRight = `${-Math.max(0, padding)}px`;
      }
      const wasMercato = geometry.current.first === mercatoIndex && hasMercato;
      const first = wasMercato ? mercatoIndex : Math.min(geometry.current.first, normalCount - centers);
      geometry.current = { width, pitch: width + 16, centers, first };
      viewport.style.setProperty("--indicator-width", `${width}px`);
      viewport.style.setProperty("--indicator-padding", `${Math.max(0, padding)}px`);
      go(first, true);
      paint();
    };
    const settle = () => {
      if (drag.current || touching.current) return;
      if (manualScroll.current) navigationTarget = null;
      const target = navigationTarget;
      if (target !== null) {
        const expectedLeft = targetLeft(target, geometry.current.centers);
        if (Math.abs(viewport.scrollLeft - expectedLeft) > 2) {
          queueSettle();
          return;
        }
      }
      manualScroll.current = false;
      navigationTarget = null;
      if (isMercatoPosition()) go(mercatoIndex, true);
      else go(Math.round(viewport.scrollLeft / geometry.current.pitch), true);
    };
    const queueSettle = () => {
      clearTimeout(settleTimer);
      settleTimer = window.setTimeout(settle, 140);
    };
    settleRef.current = queueSettle;
    const onScroll = () => {
      schedulePaint();
      queueSettle();
    };
    const observer = new ResizeObserver(layout);
    observer.observe(viewport);
    viewport.addEventListener("scroll", onScroll, { passive: true });
    viewport.addEventListener("keydown", onKeyDown);
    layout();
    return () => {
      disposed = true;
      observer.disconnect();
      viewport.removeEventListener("scroll", onScroll);
      viewport.removeEventListener("keydown", onKeyDown);
      cancelAnimationFrame(frame);
      clearTimeout(settleTimer);
      settleRef.current = () => {};
    };
  }, [cards.length, hasMercato]);

  const startDrag = (event: PointerEvent<HTMLDivElement>) => {
    if (event.pointerType !== "mouse" || event.button !== 0 || (event.target as Element).closest(".mercato-kpi-viewport")) return;
    manualScroll.current = true;
    drag.current = { id: event.pointerId, x: event.clientX, scroll: event.currentTarget.scrollLeft, moved: false };
  };
  const moveDrag = (event: PointerEvent<HTMLDivElement>) => {
    const state = drag.current;
    if (!state || state.id !== event.pointerId) return;
    const delta = event.clientX - state.x;
    if (!state.moved && Math.abs(delta) < 5) return;
    state.moved = true;
    event.currentTarget.setPointerCapture(event.pointerId);
    event.currentTarget.classList.add("is-dragging");
    event.currentTarget.scrollLeft = state.scroll - delta;
  };
  const endDrag = (event: PointerEvent<HTMLDivElement>) => {
    if (!drag.current || drag.current.id !== event.pointerId) return;
    const moved = drag.current.moved;
    drag.current = null;
    event.currentTarget.classList.remove("is-dragging");
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    if (moved) settleRef.current();
  };
  const lastNormal = Math.max(0, cards.length - geometry.current.centers);
  const lastView = hasMercato ? cards.length : lastNormal;
  return (
    <section className="match-indicators" aria-label="Indicateurs du match" aria-roledescription="carrousel">
      <header className="match-indicators-heading">
        <span><Activity size={17} /> Le collectif en chiffres</span>
        <div className="match-indicators-navigation">
          <span aria-live="polite" aria-atomic="true">{position.first === cards.length ? `${cards.length + 1} / ${cards.length + 1}` : `${position.first + 1}${position.centers === 2 ? `–${position.first + 2}` : ""} / ${cards.length + (hasMercato ? 1 : 0)}`}</span>
          <button type="button" disabled={position.first === 0} aria-label="Indicateurs précédents" title="Indicateurs précédents" onClick={() => goRef.current(position.first - 1)}><ChevronLeft size={19} /></button>
          <button type="button" disabled={position.first === lastView} aria-label="Indicateurs suivants" title="Indicateurs suivants" onClick={() => goRef.current(position.first === lastNormal && hasMercato ? cards.length : position.first + 1)}><ChevronRight size={19} /></button>
        </div>
      </header>
      <div ref={viewportRef} className="match-indicators-viewport" tabIndex={0} role="group" aria-label="Défilement des indicateurs du match"
        onPointerDown={startDrag} onPointerMove={moveDrag} onPointerUp={endDrag} onPointerCancel={endDrag} onLostPointerCapture={endDrag}
        onTouchStart={(event) => { if (event.target instanceof Element && event.target.closest(".mercato-kpi-viewport")) return; manualScroll.current = true; touching.current = true; }}
        onTouchEnd={(event) => { if (event.target instanceof Element && event.target.closest(".mercato-kpi-viewport")) return; touching.current = event.touches.length > 0; settleRef.current(); }}
        onTouchCancel={(event) => { if (event.target instanceof Element && event.target.closest(".mercato-kpi-viewport")) return; touching.current = false; settleRef.current(); }}
        onPointerLeave={() => { if (!drag.current?.moved) drag.current = null; }}
        >
        <div className="match-indicators-track" ref={trackRef}>
          {cards.map(({ id, label, value, detail, icon: Icon, accent, percent, targetKey }, index) => (
            <div className="match-indicator-slide" key={id} data-indicator={id} data-featured={index >= position.first && index < position.first + position.centers ? "" : undefined} role="group" aria-roledescription="diapositive" aria-label={`${label}, ${index + 1} sur ${cards.length}`}>
              <article className={`match-indicator-card ${id === "performance" ? "is-performance" : ""} ${typeof percent === "number" ? (percent > (targetKey ? punctualityTargets?.[targetKey] ?? 100 : 100) ? "is-at-target" : "is-below-target") : ""}`} style={{ "--indicator-accent": accent } as CSSProperties}>
                <div className="match-indicator-title"><Icon size={21} /><h3>{label}</h3></div>
                <div className="match-indicator-body">
                  <strong className={`match-indicator-value ${value === null ? "is-empty" : ""}`}>{value ?? (id === "injuries" ? "À renseigner" : pdf ? "Indisponible" : "PDF à importer")}</strong>
                  {id === "performance" && <p className="team-motivation-message">{detail}</p>}
                  {typeof percent === "number" && Number.isFinite(percent) && (() => {
                    const target = targetKey ? punctualityTargets?.[targetKey] : undefined;
                    return (
                      <div className="match-indicator-meter-wrap">
                        <div className="match-indicator-meter" aria-label={`${number.format(percent)}% sur 100%${target === undefined ? "" : `, objectif ${number.format(target)}%`}`}>
                          <i style={{ width: `${Math.max(0, Math.min(100, percent))}%` }} />
                          {target !== undefined && <b className="match-indicator-target" style={{ left: `${Math.max(0, Math.min(100, target))}%` }} aria-hidden="true" />}
                        </div>
                        <div className="match-indicator-meter-scale" aria-hidden="true"><span>0%</span>{target !== undefined && <strong>Objectif {number.format(target)}%</strong>}<span>100%</span></div>
                      </div>
                    );
                  })()}
                </div>
                {id === "performance" ? <div className="match-indicator-staff real-staff-metric"><span>Effectif réel</span><strong>{staffPercent}</strong><small>{staffDetail}</small></div> : <small className="match-indicator-source">{value === null && pdf && id !== "injuries" ? "Indicateur absent du PDF" : detail}</small>}
              </article>
            </div>
          ))}
          {hasMercato && (
            <div className="match-indicator-slide mercato-indicator-slide" data-indicator="mercato" data-featured={position.first === cards.length ? "" : undefined} role="group" aria-roledescription="diapositive" aria-label={`Mercato, ${cards.length + 1} sur ${cards.length + 1}`}>
              <MercatoCarouselSection mercato={mercato} profiles={mercatoProfiles} />
            </div>
          )}
        </div>
      </div>
      <div className="match-indicators-index" aria-label="Accès aux indicateurs">
        {cards.map((card, index) => <button key={card.id} type="button" className={index >= position.first && index < position.first + position.centers ? "is-current" : ""} aria-label={`Afficher ${card.label}`} aria-current={index >= position.first && index < position.first + position.centers ? "true" : undefined} title={card.label} onClick={() => goRef.current(Math.min(index, lastNormal))} />)}
        {hasMercato && <button type="button" className={position.first === cards.length ? "is-current" : ""} aria-label="Afficher le Mercato" aria-current={position.first === cards.length ? "true" : undefined} title="Mercato" onClick={() => goRef.current(cards.length)} />}
      </div>
    </section>
  );
}
