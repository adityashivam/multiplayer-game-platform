import { useCallback, useEffect, useRef, useState } from "react";

const SOUND_MUTED_KEY = "kaboom-sound-muted";
const MUSIC_VOLUME_KEY = "kaboom-music-volume";
const DEFAULT_MUSIC_VOLUME = 0.25;
const MUSIC_VOLUME_CURVE_EXPONENT = 2.2;
const AUTOPLAY_RETRY_EVENTS = ["pointerdown", "keydown", "touchstart"];

function clamp01(value) {
  return Math.min(1, Math.max(0, value));
}

function getStoredMusicVolume() {
  const stored = localStorage.getItem(MUSIC_VOLUME_KEY);
  if (stored == null || stored.trim() === "") return DEFAULT_MUSIC_VOLUME;
  const raw = Number(stored);
  if (!Number.isFinite(raw)) return DEFAULT_MUSIC_VOLUME;
  return clamp01(raw);
}

function toMusicGain(volumeSetting) {
  return Math.pow(clamp01(volumeSetting), MUSIC_VOLUME_CURVE_EXPONENT);
}

function resolveMusicTrackUrl(trackPath) {
  if (typeof trackPath !== "string") return null;

  const trimmed = trackPath.trim();
  if (!trimmed) return null;
  if (/^(https?:)?\/\//i.test(trimmed) || trimmed.startsWith("/")) return trimmed;

  const baseUrl = import.meta.env.BASE_URL || "/";
  const normalizedBase = baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`;
  const normalizedPath = trimmed.replace(/^\.\//, "");
  const prefixedPath = normalizedPath.startsWith("musics/") ? normalizedPath : `musics/${normalizedPath}`;
  return `${normalizedBase}${encodeURI(prefixedPath)}`;
}

export default function useLobbyAudio({ isGameView }) {
  const [muted, setMuted] = useState(() => localStorage.getItem(SOUND_MUTED_KEY) === "true");
  const [musicVolume, setMusicVolume] = useState(() => getStoredMusicVolume());
  const [musicTracks, setMusicTracks] = useState([]);

  const audioContextRef = useRef(null);
  const lobbyMusicRef = useRef(null);
  const musicFadeFrameRef = useRef(null);
  const wasGameViewRef = useRef(isGameView);
  const previousTrackIndexRef = useRef(-1);
  const mutedRef = useRef(muted);

  useEffect(() => {
    mutedRef.current = muted;
    localStorage.setItem(SOUND_MUTED_KEY, String(muted));
  }, [muted]);

  useEffect(() => {
    localStorage.setItem(MUSIC_VOLUME_KEY, String(musicVolume));
    const audio = lobbyMusicRef.current;
    if (audio) {
      audio.volume = toMusicGain(musicVolume);
    }
  }, [musicVolume]);

  useEffect(() => {
    if (typeof Audio === "undefined") return () => {};

    const audio = new Audio();
    audio.preload = "auto";
    audio.volume = toMusicGain(musicVolume);
    lobbyMusicRef.current = audio;

    return () => {
      if (musicFadeFrameRef.current) {
        cancelAnimationFrame(musicFadeFrameRef.current);
        musicFadeFrameRef.current = null;
      }

      audio.pause();
      audio.src = "";
      lobbyMusicRef.current = null;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function loadMusicPlaylist() {
      try {
        const baseUrl = import.meta.env.BASE_URL || "/";
        const normalizedBase = baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`;
        const response = await fetch(`${normalizedBase}musics/playlist.json`, {
          cache: "no-store",
        });

        if (!response.ok) throw new Error("Failed to fetch playlist");

        const payload = await response.json();
        const entries = Array.isArray(payload) ? payload : payload?.tracks;
        const tracks = (Array.isArray(entries) ? entries : [])
          .map((entry) => resolveMusicTrackUrl(entry))
          .filter(Boolean);

        if (!cancelled) {
          setMusicTracks(tracks);
        }
      } catch (error) {
        console.warn("Unable to load lobby music playlist", error);
        if (!cancelled) {
          setMusicTracks([]);
        }
      }
    }

    loadMusicPlaylist();
    return () => {
      cancelled = true;
    };
  }, []);

  const stopLobbyMusicFade = useCallback(() => {
    if (musicFadeFrameRef.current) {
      cancelAnimationFrame(musicFadeFrameRef.current);
      musicFadeFrameRef.current = null;
    }
  }, []);

  const fadeLobbyMusicIn = useCallback(
    (audio, targetVolume) => {
      const endVolume = clamp01(targetVolume);
      if (!audio || endVolume <= 0) {
        if (audio) audio.volume = 0;
        return;
      }

      stopLobbyMusicFade();

      const targetGain = toMusicGain(endVolume);
      const startTime = performance.now();
      const startVolume = 0.00001;
      const durationMs = 1400;
      audio.volume = startVolume;

      const tick = (now) => {
        const progress = Math.min((now - startTime) / durationMs, 1);
        const eased = 1 - Math.pow(1 - progress, 3);
        audio.volume = startVolume + (targetGain - startVolume) * eased;

        if (progress < 1 && !audio.paused) {
          musicFadeFrameRef.current = requestAnimationFrame(tick);
        } else {
          musicFadeFrameRef.current = null;
        }
      };

      musicFadeFrameRef.current = requestAnimationFrame(tick);
    },
    [stopLobbyMusicFade],
  );

  const pickRandomTrack = useCallback((tracks) => {
    if (!Array.isArray(tracks) || tracks.length === 0) return null;

    let nextIndex = Math.floor(Math.random() * tracks.length);
    if (tracks.length > 1 && nextIndex === previousTrackIndexRef.current) {
      nextIndex = (nextIndex + 1) % tracks.length;
    }

    previousTrackIndexRef.current = nextIndex;
    return tracks[nextIndex];
  }, []);

  const startLobbyMusic = useCallback(
    async (forceRandomTrack = false) => {
      const audio = lobbyMusicRef.current;
      if (!audio || musicTracks.length === 0) return false;

      if (!forceRandomTrack && audio.src && !audio.paused) {
        return true;
      }

      if (forceRandomTrack || !audio.src) {
        const nextTrack = pickRandomTrack(musicTracks);
        if (!nextTrack) return false;
        audio.src = nextTrack;
        audio.currentTime = 0;
      }

      try {
        await audio.play();
        fadeLobbyMusicIn(audio, musicVolume);
        return true;
      } catch {
        return false;
      }
    },
    [fadeLobbyMusicIn, musicTracks, musicVolume, pickRandomTrack],
  );

  useEffect(() => {
    const audio = lobbyMusicRef.current;
    if (!audio) return () => {};

    const handleTrackEnd = () => {
      if (isGameView || muted || musicVolume <= 0) return;
      void startLobbyMusic(true);
    };

    audio.addEventListener("ended", handleTrackEnd);
    return () => {
      audio.removeEventListener("ended", handleTrackEnd);
    };
  }, [isGameView, muted, musicVolume, startLobbyMusic]);

  useEffect(() => {
    const audio = lobbyMusicRef.current;
    if (!audio) return () => {};

    const returnedFromGame = wasGameViewRef.current && !isGameView;
    wasGameViewRef.current = isGameView;

    const shouldPlayLobbyMusic = !isGameView && !muted && musicVolume > 0 && musicTracks.length > 0;
    if (!shouldPlayLobbyMusic) {
      stopLobbyMusicFade();
      audio.pause();
      return () => {};
    }

    let disposed = false;
    let listenersBound = false;
    let forceRandomOnAttempt = returnedFromGame;

    const attemptPlayback = async () => {
      const started = await startLobbyMusic(forceRandomOnAttempt);
      if (started) {
        forceRandomOnAttempt = false;
      }
      return started;
    };

    const retryAfterGesture = () => {
      if (disposed) return;
      void attemptPlayback();
    };

    const ensurePlayback = async () => {
      const started = await attemptPlayback();
      if (started || disposed) return;

      listenersBound = true;
      AUTOPLAY_RETRY_EVENTS.forEach((eventName) => {
        window.addEventListener(eventName, retryAfterGesture, { once: true });
      });
    };

    void ensurePlayback();

    return () => {
      disposed = true;
      if (listenersBound) {
        AUTOPLAY_RETRY_EVENTS.forEach((eventName) => {
          window.removeEventListener(eventName, retryAfterGesture);
        });
      }
    };
  }, [isGameView, muted, musicVolume, musicTracks.length, startLobbyMusic, stopLobbyMusicFade]);

  const playNavSound = useCallback(() => {
    if (mutedRef.current) return;

    try {
      if (!audioContextRef.current) {
        audioContextRef.current = new (window.AudioContext || window.webkitAudioContext)();
      }

      const ctx = audioContextRef.current;
      if (ctx.state === "suspended") ctx.resume();

      const oscillator = ctx.createOscillator();
      const gain = ctx.createGain();

      oscillator.connect(gain);
      gain.connect(ctx.destination);

      oscillator.type = "square";
      oscillator.frequency.setValueAtTime(660, ctx.currentTime);
      oscillator.frequency.exponentialRampToValueAtTime(880, ctx.currentTime + 0.03);
      gain.gain.setValueAtTime(0.06, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.07);

      oscillator.start(ctx.currentTime);
      oscillator.stop(ctx.currentTime + 0.07);
    } catch {
      // Audio not available
    }
  }, []);

  const updateMusicVolume = useCallback((nextVolume) => {
    const normalized = clamp01(Number(nextVolume));
    if (!Number.isFinite(normalized)) return;
    setMusicVolume(normalized);
  }, []);

  const triggerHaptic = useCallback(() => {
    if (navigator.vibrate) navigator.vibrate(6);
  }, []);

  return {
    muted,
    setMuted,
    musicVolume,
    updateMusicVolume,
    startLobbyMusic,
    playNavSound,
    triggerHaptic,
  };
}
