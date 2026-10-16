import { useCallback, useEffect, useId, useRef, useState } from "react";
import { Info, X } from "lucide-react";
import { describeQualificationReason, NON_QUALIFIABLE_NOTICE } from "./qualification-reasons";

export function QualificationReason({ reason, position }: { reason: string | null; position: string }) {
  const id = useId();
  const trigger = useRef<HTMLButtonElement>(null);
  const popover = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const description = describeQualificationReason(reason);
  const reposition = useCallback(() => {
    const panel = popover.current, button = trigger.current;
    if (!panel || !button || !panel.matches(":popover-open")) return;
    const anchor = button.getBoundingClientRect(), box = panel.getBoundingClientRect();
    const margin = 12, gap = 8;
    const left = Math.max(margin, Math.min(anchor.left, innerWidth - box.width - margin));
    const below = anchor.bottom + gap;
    const top = below + box.height <= innerHeight - margin ? below : anchor.top - box.height - gap;
    panel.style.left = `${left}px`;
    panel.style.top = `${Math.max(margin, Math.min(top, innerHeight - box.height - margin))}px`;
  }, []);
  const close = () => {
    popover.current?.hidePopover();
    trigger.current?.focus({ preventScroll: true });
  };
  useEffect(() => {
    if (!open) return;
    window.addEventListener("resize", reposition);
    document.addEventListener("scroll", reposition, true);
    return () => {
      window.removeEventListener("resize", reposition);
      document.removeEventListener("scroll", reposition, true);
    };
  }, [open, reposition]);
  return <><span className="qualification-reason">
    {description.label}
    <button ref={trigger} type="button" className="qualification-help-trigger"
      aria-label={`Comprendre le motif ${description.label} pour la position ${position}`}
      title="Pourquoi cette position est-elle non qualifiable ?" aria-haspopup="dialog" aria-expanded={open} aria-controls={id}
      onClick={() => {
        if (popover.current?.matches(":popover-open")) { close(); return; }
        popover.current?.showPopover();
        reposition();
        popover.current?.querySelector<HTMLButtonElement>("button")?.focus({ preventScroll: true });
      }}><Info size={14} aria-hidden="true" /></button></span>
    <div ref={popover} id={id} popover="auto" role="dialog" aria-label={`Comprendre : ${description.label}`}
      className="qualification-help-popover" onToggle={event => setOpen(event.currentTarget.matches(":popover-open"))}
      onKeyDown={event => {
        if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); close(); }
      }}>
      <header><strong>{description.label}</strong><button className="icon-button" type="button" aria-label="Fermer l’explication" title="Fermer l’explication" onClick={close}><X size={16} aria-hidden="true" /></button></header>
      <p>{description.explanation}</p>
      <p><strong>{NON_QUALIFIABLE_NOTICE}</strong></p>
    </div>
  </>;
}
