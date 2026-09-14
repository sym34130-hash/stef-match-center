import { useEffect, useRef, useState, type CSSProperties, type PointerEvent } from "react";
import { Activity, ArrowDownToLine, ArrowUpFromLine, ChevronLeft, ChevronRight, Flag, Package, ShieldPlus, Thermometer, Users, Weight, type LucideIcon } from "lucide-react";
import type { Snapshot } from "./types";
import "./match-indicators.css";

type Props = {
  snapshot: Snapshot;
  performance: string;
  motivation: string;
  injuries: string;
  staffPercent: string;
  staffDetail: string;
};

const number = new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 2 });
const smooth = (value: number) => { const t = Math.max(0, Math.min(1, value)); return t * t * (3 - 2 * t); };

export function MatchIndicatorsCarousel({ snapshot, performance, motivation, injuries, staffPercent, staffDetail }: Props) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const trackRef = useRef<HTMLDivElement>(null);
  const geometry = useRef({ pitch: 296, width: 280, centers: 2, first: 0 });
  const drag = useRef<{ id: number; x: number; scroll: number; moved: boolean } | null>(null);
  const touching = useRef(false);
  const goRef = useRef<(index: number, instant?: boolean) => void>(() => {});
  const settleRef = useRef<() => void>(() => {});
  const [position, setPosition] = useState({ first: 0, centers: 2 });
  const pdf = snapshot.dailyIndicators;
  const punctuality = pdf?.punctuality;
  const pdfDetail = pdf?.referenceDate ? `PDF 106J · ${pdf.referenceDate}` : "PDF 106J";
  const metric = (value: number | undefined | null, unit: string) => typeof value === "number" && Number.isFinite(value) ? `${number.format(value)}${unit}` : null;
  const cards: Array<{ id: string; label: string; value: string | null; detail: string; icon: LucideIcon; accent: string; percent?: number }> = [
    { id: "performance", label: "Performance d'équipe", value: performance, detail: motivation, icon: Users, accent: "#91d7c0" },
    { id: "injuries", label: "NB DE BLESSURES (A.T)", value: injuries.trim() ? number.format(Number(injuries)) : null, detail: "Accidents du travail · saisie manuelle", icon: ShieldPlus, accent: "#e1c58e" },
    { id: "tonnage", label: "Tonnage", value: metric(pdf?.expedition.tonnage, " t"), detail: `Expédition · ${pdfDetail}`, icon: Weight, accent: "#98d6d6" },
    { id: "positions", label: "Positions", value: metric(snapshot.summary.positions, ""), detail: `Excel · plage ${snapshot.match.timeRangeLabel}`, icon: Package, accent: "#a8c9f0" },
    { id: "arrival", label: "Ponctualité arrivage", value: metric(punctuality?.arrivalPunctuality, "%"), detail: pdfDetail, icon: ArrowDownToLine, accent: "#a4cbee", percent: punctuality?.arrivalPunctuality },
    { id: "departure", label: "Ponctualité départ", value: metric(punctuality?.departurePunctuality, "%"), detail: pdfDetail, icon: ArrowUpFromLine, accent: "#b9c6ed", percent: punctuality?.departurePunctuality },
    { id: "destination", label: "Ponctualité destination", value: metric(punctuality?.destinationPunctuality, "%"), detail: pdfDetail, icon: Flag, accent: "#a4d5c8", percent: punctuality?.destinationPunctuality },
    { id: "temperature", label: "Température retour ramasse", value: metric(punctuality?.temperatureReturn, "%"), detail: pdfDetail, icon: Thermometer, accent: "#dcc0d7", percent: punctuality?.temperatureReturn },
  ];

  useEffect(() => {
    const viewport = viewportRef.current;
    const track = trackRef.current;
    if (!viewport || !track) return;
    const slides = Array.from(track.children) as HTMLElement[];
    const motion = window.matchMedia("(prefers-reduced-motion: reduce)");
    let frame = 0;
    let settleTimer = 0;
    let disposed = false;

    // Depth follows the actual scroll position; React only tracks the settled group.
    const paint = () => {
      frame = 0;
      const { pitch, width, centers } = geometry.current;
      const first = Math.max(0, Math.min(slides.length - centers, Math.round(viewport.scrollLeft / pitch)));
      geometry.current.first = first;
      setPosition((current) => current.first === first && current.centers === centers ? current : { first, centers });
      const core = (centers - 1) * pitch / 2;
      slides.forEach((slide, index) => {
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
      const { pitch, centers } = geometry.current;
      const next = Math.max(0, Math.min(slides.length - centers, requested));
      viewport.scrollTo({ left: next * pitch, behavior: instant || motion.matches ? "instant" : "smooth" });
      schedulePaint();
    };
    goRef.current = go;
    const layout = () => {
      const available = viewport.clientWidth;
      const centers = available >= 640 ? 2 : 1;
      const width = centers === 2 ? (available >= 1500 ? 260 : 280) : Math.min(320, available - 72);
      const padding = (available - centers * width - (centers - 1) * 16) / 2;
      const first = Math.min(geometry.current.first, slides.length - centers);
      geometry.current = { width, pitch: width + 16, centers, first };
      viewport.style.setProperty("--indicator-width", `${width}px`);
      viewport.style.setProperty("--indicator-padding", `${Math.max(0, padding)}px`);
      go(first, true);
      paint();
    };
    const settle = () => { if (!drag.current && !touching.current) go(Math.round(viewport.scrollLeft / geometry.current.pitch)); };
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
    layout();
    return () => {
      disposed = true;
      observer.disconnect();
      viewport.removeEventListener("scroll", onScroll);
      cancelAnimationFrame(frame);
      clearTimeout(settleTimer);
      settleRef.current = () => {};
    };
  }, []);

  const startDrag = (event: PointerEvent<HTMLDivElement>) => {
    if (event.pointerType !== "mouse" || event.button !== 0) return;
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
    if (moved) goRef.current(Math.round(event.currentTarget.scrollLeft / geometry.current.pitch));
  };
  const last = cards.length - position.centers;
  return (
    <section className="match-indicators" aria-label="Indicateurs du match" aria-roledescription="carrousel">
      <header className="match-indicators-heading">
        <span><Activity size={17} /> Le collectif en chiffres</span>
        <div className="match-indicators-navigation">
          <span aria-live="polite" aria-atomic="true">{position.first + 1}{position.centers === 2 ? `–${position.first + 2}` : ""} / {cards.length}</span>
          <button type="button" disabled={position.first === 0} aria-label="Indicateurs précédents" title="Indicateurs précédents" onClick={() => goRef.current(position.first - 1)}><ChevronLeft size={19} /></button>
          <button type="button" disabled={position.first === last} aria-label="Indicateurs suivants" title="Indicateurs suivants" onClick={() => goRef.current(position.first + 1)}><ChevronRight size={19} /></button>
        </div>
      </header>
      <div ref={viewportRef} className="match-indicators-viewport" tabIndex={0} role="group" aria-label="Défilement des indicateurs du match"
        onPointerDown={startDrag} onPointerMove={moveDrag} onPointerUp={endDrag} onPointerCancel={endDrag} onLostPointerCapture={endDrag}
        onTouchStart={() => { touching.current = true; }}
        onTouchEnd={(event) => { touching.current = event.touches.length > 0; settleRef.current(); }}
        onTouchCancel={() => { touching.current = false; settleRef.current(); }}
        onPointerLeave={() => { if (!drag.current?.moved) drag.current = null; }}
        onKeyDown={(event) => {
          if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
          event.preventDefault();
          goRef.current(event.key === "Home" ? 0 : event.key === "End" ? last : position.first + (event.key === "ArrowRight" ? 1 : -1));
        }}>
        <div className="match-indicators-track" ref={trackRef}>
          {cards.map(({ id, label, value, detail, icon: Icon, accent, percent }, index) => (
            <div className="match-indicator-slide" key={id} data-indicator={id} role="group" aria-roledescription="diapositive" aria-label={`${label}, ${index + 1} sur ${cards.length}`}>
              <article className={`match-indicator-card ${id === "performance" ? "is-performance" : ""}`} style={{ "--indicator-accent": accent } as CSSProperties}>
                <div className="match-indicator-title"><Icon size={21} /><h3>{label}</h3></div>
                <div className="match-indicator-body">
                  <strong className={`match-indicator-value ${value === null ? "is-empty" : ""}`}>{value ?? (id === "injuries" ? "À renseigner" : pdf ? "Indisponible" : "PDF à importer")}</strong>
                  {id === "performance" && <p className="team-motivation-message">{detail}</p>}
                  {typeof percent === "number" && Number.isFinite(percent) && <div className="match-indicator-meter" aria-hidden="true"><i style={{ width: `${Math.max(0, Math.min(100, percent))}%` }} /></div>}
                </div>
                {id === "performance" ? <div className="match-indicator-staff real-staff-metric"><span>Effectif réel</span><strong>{staffPercent}</strong><small>{staffDetail}</small></div> : <small className="match-indicator-source">{value === null && pdf && id !== "injuries" ? "Indicateur absent du PDF" : detail}</small>}
              </article>
            </div>
          ))}
        </div>
      </div>
      <div className="match-indicators-index" aria-label="Accès aux indicateurs">
        {cards.map((card, index) => <button key={card.id} type="button" className={index >= position.first && index < position.first + position.centers ? "is-current" : ""} aria-label={`Afficher ${card.label}`} aria-current={index >= position.first && index < position.first + position.centers ? "true" : undefined} title={card.label} onClick={() => goRef.current(Math.min(index, last))} />)}
      </div>
    </section>
  );
}
