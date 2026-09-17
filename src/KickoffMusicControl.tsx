import { useEffect, useState } from "react";
import { Music2, X } from "lucide-react";

const VIDEO_ID = "ttjGFkand7s";
const YOUTUBE_URL = `https://www.youtube.com/watch?v=${VIDEO_ID}`;

export function KickoffMusicControl({ active }: { active: boolean }) {
  const [playerOpen, setPlayerOpen] = useState(false);

  useEffect(() => {
    if (!active) setPlayerOpen(false);
  }, [active]);

  if (!active) return null;

  return (
    <div className="kickoff-music-dock">
      <div className="kickoff-music-wrap">
        <button
          className={`secondary-on-dark kickoff-music-control${playerOpen ? " is-open" : ""}`}
          type="button"
          onClick={() => setPlayerOpen((open) => !open)}
          aria-label={playerOpen ? "Fermer le lecteur YouTube" : "Écouter la musique sur YouTube"}
          aria-expanded={playerOpen}
          title="Musique de lancement - lecteur YouTube"
        >
          {playerOpen ? <X size={18} /> : <Music2 size={18} />}
          <span>{playerOpen ? "Fermer le lecteur" : "Écouter la musique"}</span>
        </button>
        {playerOpen && (
          <div className="kickoff-music-player">
            <iframe
              src={`https://www.youtube-nocookie.com/embed/${VIDEO_ID}?autoplay=1&controls=1&loop=1&playlist=${VIDEO_ID}&playsinline=1&rel=0`}
              title="Musique de lancement sur YouTube"
              allow="autoplay; encrypted-media; picture-in-picture; web-share"
              referrerPolicy="strict-origin-when-cross-origin"
              allowFullScreen
            />
            <div className="kickoff-music-source">
              <span>Lecteur YouTube</span>
              <a href={YOUTUBE_URL} target="_blank" rel="noreferrer">
                Ouvrir la vidéo sur YouTube
              </a>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
