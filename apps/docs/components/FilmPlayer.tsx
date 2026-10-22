import { useEffect, useRef } from "react";
import {
  VideoPlayer,
  VideoPlayerContent,
  VideoPlayerControlBar,
  VideoPlayerMuteButton,
  VideoPlayerPlayButton,
  VideoPlayerSeekBackwardButton,
  VideoPlayerSeekForwardButton,
  VideoPlayerTimeDisplay,
  VideoPlayerTimeRange,
  VideoPlayerVolumeRange,
} from "./video-player";

export interface FilmPlayerProps {
  readonly src: string;
  readonly poster: string;
  readonly label: string;
  readonly describedBy: string;
}

// Plays muted while at least half the film is on screen and pauses when it scrolls away. A pause
// the viewer makes themself ends autoplay, and reduced-motion viewers start it by hand.
export function FilmPlayer({ src, poster, label, describedBy }: FilmPlayerProps) {
  const ref = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const video = ref.current;
    if (!video || matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    let autoplay = true;
    let observerPaused = false;
    const onPause = () => {
      if (observerPaused) observerPaused = false;
      else autoplay = false;
    };
    video.addEventListener("pause", onPause);

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!autoplay || !entry) return;
        if (entry.isIntersecting) {
          video.muted = true;
          video.play().catch(() => {});
        } else if (!video.paused) {
          observerPaused = true;
          video.pause();
        }
      },
      { threshold: 0.5 },
    );
    observer.observe(video);

    return () => {
      observer.disconnect();
      video.removeEventListener("pause", onPause);
    };
  }, []);

  return (
    <VideoPlayer className="film-player">
      <VideoPlayerContent
        aria-describedby={describedBy}
        aria-label={label}
        height={1080}
        loop
        muted
        playsInline
        poster={poster}
        preload="metadata"
        ref={ref}
        slot="media"
        width={1920}
      >
        <source src={src} type="video/mp4" />
        <a href={src}>Download the DomainKit intro film</a>
      </VideoPlayerContent>
      <VideoPlayerControlBar>
        <VideoPlayerPlayButton />
        <VideoPlayerSeekBackwardButton />
        <VideoPlayerSeekForwardButton />
        <VideoPlayerTimeRange />
        <VideoPlayerTimeDisplay showDuration />
        <VideoPlayerMuteButton />
        <VideoPlayerVolumeRange />
      </VideoPlayerControlBar>
    </VideoPlayer>
  );
}
