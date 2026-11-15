import React, { useEffect, useLayoutEffect, useRef, useState } from "react";
import { readGameLibraryDetails } from "../../services/gamePresentation.js";
import {
  LIBRARY_DISC,
  clampLibraryDiscIndex,
  placeLibraryDiscItem,
  readLibraryDiscGeometry,
  settleLibraryDiscIndex,
} from "../../services/libraryDisc.js";
import GameArtwork from "./GameArtwork.jsx";
import styles from "./LibraryDisc.module.scss";

/** Pixels of vertical drag that turn the disc by one game. */
const DRAG_PX_PER_GAME = 46;
/** Movement before a press becomes a drag, so taps still select names. */
const DRAG_START_PX = 6;
/** Wheel distance that steps one game. */
const WHEEL_PX_PER_GAME = 40;
const EASING = 0.2;

const KEY_STEPS = Object.freeze({ ArrowUp: -1, ArrowLeft: -1, ArrowDown: 1, ArrowRight: 1, PageUp: -5, PageDown: 5 });

/**
 * The selected game's art and details beside the disc.
 * @param {{game:object,disabled:boolean,onActivate:(path:string)=>void,onMore?:()=>void}} props
 * @returns {React.ReactElement}
 */
function DiscSpotlight({ game, disabled, onActivate, onMore }) {
  const details = readGameLibraryDetails(game);
  const meta = [details.playerLabel, ...details.controlLabels].join(" · ");
  // Spec rows replace the meta line in the Instrument style.
  const specs = [["Genre", details.genreLabel], ["Players", details.playerLabel], ["Input", details.controlLabels.join(" · ") || "—"]];
  return (
    <section className={styles.spotlight} style={{ "--game-accent": details.accentColor }} aria-labelledby="disc-selected-title" data-disc-spotlight={game.id}>
      <div className={styles.spotlightArt} data-launch-origin={game.id} key={`art-${game.id}`}>
        <GameArtwork coverUrl={details.capsuleUrl || details.coverUrl} contain={!details.capsuleUrl} className={styles.spotlightArtwork} eager />
        <span className={styles.spotlightGenre}>{details.genreLabel}</span>
      </div>
      <div className={styles.spotlightText} key={`text-${game.id}`}>
        <h2 id="disc-selected-title" className={styles.spotlightTitle}>{game.name}</h2>
        <p className={styles.spotlightMeta}>{meta}</p>
        <dl className={styles.spotlightSpecs}>
          {specs.map(([label, value]) => (
            <div key={label}><dt>{label}</dt><dd>{value}</dd></div>
          ))}
        </dl>
        {game.description && <p className={styles.spotlightDescription}>{game.description}</p>}
        {game.description && onMore && (
          <button type="button" className={styles.spotlightMore} onClick={onMore} aria-label={`More about ${game.name}`}>More</button>
        )}
      </div>
      <button
        type="button"
        className={styles.spotlightPlay}
        onClick={() => onActivate(game.path)}
        disabled={disabled || !game.path}
        aria-label={`Play ${game.name}`}
      >
        <span className={`material-symbols-outlined ${styles.spotlightPlayIcon}`} aria-hidden="true">play_arrow</span>
        <span>Play</span>
        <span className={`material-symbols-outlined ${styles.spotlightPlayArrow}`} aria-hidden="true">arrow_forward</span>
      </button>
    </section>
  );
}

/**
 * The portrait library: game names on the rim of a disc on the left (curved
 * edge facing left, hub off to the right) and the selected game's art and
 * description on the right. Drag, flick or wheel to turn the disc; arrow
 * keys and the console D-pad step one game; Enter plays. Names are library
 * cards (`data-library-card-id`), so selection, focus, sounds and launch
 * work as in the grid.
 * `discStyle` comes from the platform theme: "cinematic", "editorial",
 * "instrument", "classic" or "glass". Names curve along the rim, like print
 * on a real disc, in "classic" and "glass"; the others keep them upright.
 * @param {{games:object[],selectedIndex:number,loading:boolean,discStyle?:"glass"|"editorial"|"cinematic"|"instrument"|"classic",onSelectIndex:(index:number,focus?:boolean)=>void,onActivate:(path:string)=>void,onMore?:()=>void,registerCardRef?:(index:number,node:HTMLElement|null)=>void}} props
 * @returns {React.ReactElement}
 */
export default function LibraryDisc({ games, selectedIndex, loading, discStyle = "cinematic", onSelectIndex, onActivate, onMore, registerCardRef }) {
  const discRef = useRef(null);
  const sheenRef = useRef(null);
  const itemRefs = useRef(new Map());
  const motion = useRef({ position: selectedIndex, target: selectedIndex, frame: 0 });
  const dragRef = useRef(null);
  const wheelRef = useRef(0);
  const [geometry, setGeometry] = useState(() => readLibraryDiscGeometry({ width: 176, height: 440 }));
  const [columnWidth, setColumnWidth] = useState(176);
  const geometryRef = useRef(geometry);
  const count = games.length;
  const uprightNames = discStyle !== "glass" && discStyle !== "classic";
  const uprightRef = useRef(uprightNames);
  uprightRef.current = uprightNames;
  const selectedGame = games[selectedIndex] || games[0];

  // Paint is imperative: one transform per mounted name and one for the rim,
  // so turning the disc never re-renders React.
  const paint = () => {
    const { position } = motion.current;
    for (const [index, element] of itemRefs.current) {
      const placement = placeLibraryDiscItem(index - position, geometryRef.current);
      if (!placement.visible) {
        element.style.visibility = "hidden";
        continue;
      }
      element.style.visibility = "visible";
      const rotation = uprightRef.current ? 0 : placement.angleDeg;
      element.style.transform = `translate(${placement.x.toFixed(1)}px, ${placement.y.toFixed(1)}px) translateY(-50%) rotate(${rotation.toFixed(2)}deg) scale(${placement.scale.toFixed(3)})`;
      element.style.opacity = placement.opacity.toFixed(3);
    }
    // The CD sheen sweeps a little as the disc turns.
    if (sheenRef.current) sheenRef.current.style.transform = `rotate(${(position * LIBRARY_DISC.stepDeg * 0.8).toFixed(2)}deg)`;
  };
  const paintRef = useRef(paint);
  paintRef.current = paint;

  const animateToTarget = () => {
    const state = motion.current;
    const reducedMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    if (reducedMotion) {
      state.position = state.target;
      paintRef.current();
      return;
    }
    if (state.frame) return;
    const step = () => {
      const remaining = state.target - state.position;
      if (Math.abs(remaining) < 0.002) {
        state.position = state.target;
        state.frame = 0;
        paintRef.current();
        return;
      }
      state.position += remaining * EASING;
      paintRef.current();
      state.frame = requestAnimationFrame(step);
    };
    state.frame = requestAnimationFrame(step);
  };

  useLayoutEffect(() => {
    const disc = discRef.current;
    if (!disc) return undefined;
    const measure = () => {
      const next = readLibraryDiscGeometry({ width: disc.clientWidth, height: disc.clientHeight });
      geometryRef.current = next;
      setGeometry(next);
      setColumnWidth(disc.clientWidth);
      paintRef.current();
    };
    measure();
    const resizeObserver = new ResizeObserver(measure);
    resizeObserver.observe(disc);
    return () => {
      resizeObserver.disconnect();
      cancelAnimationFrame(motion.current.frame);
      motion.current.frame = 0;
    };
  }, []);

  // Follow the selection unless a drag is steering the disc directly.
  useLayoutEffect(() => {
    if (dragRef.current?.dragging) return;
    motion.current.target = selectedIndex;
    paintRef.current();
    animateToTarget();
  }, [selectedIndex]); // eslint-disable-line react-hooks/exhaustive-deps -- animation reads refs

  useLayoutEffect(() => {
    paintRef.current();
  });

  // The wheel steps one game per notch; ctrl/⌘ + wheel stays the card-size pinch.
  useEffect(() => {
    const disc = discRef.current;
    if (!disc) return undefined;
    const handleWheel = (event) => {
      if (event.ctrlKey || event.metaKey) return;
      event.preventDefault();
      wheelRef.current += event.deltaMode === 1 ? event.deltaY * 16 : event.deltaY;
      const steps = Math.trunc(wheelRef.current / WHEEL_PX_PER_GAME);
      if (!steps) return;
      wheelRef.current -= steps * WHEEL_PX_PER_GAME;
      onSelectIndex(clampLibraryDiscIndex(Math.round(motion.current.target) + steps, count));
    };
    disc.addEventListener("wheel", handleWheel, { passive: false });
    return () => disc.removeEventListener("wheel", handleWheel);
  }, [count, onSelectIndex]);

  function handlePointerDown(event) {
    if (event.button !== 0) return;
    dragRef.current = { pointerId: event.pointerId, startY: event.clientY, startPosition: motion.current.position, lastY: event.clientY, lastTime: event.timeStamp, velocity: 0, dragging: false };
  }

  function handlePointerMove(event) {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const deltaY = event.clientY - drag.startY;
    if (!drag.dragging) {
      if (Math.abs(deltaY) < DRAG_START_PX) return;
      drag.dragging = true;
      try {
        discRef.current?.setPointerCapture(event.pointerId);
      } catch {
        // The pointer already ended (a cancelled touch); the drag still works without capture.
      }
    }
    const elapsed = Math.max(1, event.timeStamp - drag.lastTime);
    drag.velocity = (-(event.clientY - drag.lastY) / DRAG_PX_PER_GAME) / (elapsed / 1000);
    drag.lastY = event.clientY;
    drag.lastTime = event.timeStamp;
    const position = Math.max(-0.35, Math.min(count - 0.65, drag.startPosition - deltaY / DRAG_PX_PER_GAME));
    cancelAnimationFrame(motion.current.frame);
    motion.current.frame = 0;
    motion.current.position = position;
    motion.current.target = position;
    paintRef.current();
    const nearest = clampLibraryDiscIndex(Math.round(position), count);
    if (nearest !== selectedIndex) onSelectIndex(nearest);
  }

  function handlePointerEnd(event) {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    dragRef.current = null;
    if (!drag.dragging) return;
    const settled = settleLibraryDiscIndex(motion.current.position, drag.velocity, count);
    motion.current.target = settled;
    animateToTarget();
    if (settled !== selectedIndex) onSelectIndex(settled);
  }

  function handleKeyDown(event) {
    if (loading) return;
    if (event.key === "Enter" && selectedGame) {
      event.preventDefault();
      onActivate(selectedGame.path);
      return;
    }
    let next = null;
    if (Object.hasOwn(KEY_STEPS, event.key)) next = selectedIndex + KEY_STEPS[event.key];
    if (event.key === "Home") next = 0;
    if (event.key === "End") next = count - 1;
    if (next === null) return;
    event.preventDefault();
    onSelectIndex(clampLibraryDiscIndex(next, count), true);
  }

  // Every game on the page stays mounted (pages are bounded), so each is a
  // reachable library card; names off the visible arc are hidden.
  const plateRadius = geometry.radius + 18;
  const plateLeft = geometry.centerX - plateRadius;
  // Where the plate meets the spotlight it fades out rather than ending in a cut.
  const plateFadeEnd = columnWidth - plateLeft;

  return (
    <div className={styles.discLayout} data-disc-style={discStyle}>
      <div
        className={styles.disc}
        ref={discRef}
        role="group"
        aria-label="Games. Turn the disc or use the arrow keys."
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerEnd}
        onPointerCancel={handlePointerEnd}
        onKeyDown={handleKeyDown}
        data-library-disc
      >
        <div
          className={styles.plate}
          style={{ left: plateLeft, top: geometry.centerY - plateRadius, width: plateRadius * 2, height: plateRadius * 2, "--plate-fade-start": `${Math.max(0, plateFadeEnd - 72)}px`, "--plate-fade-end": `${plateFadeEnd}px` }}
          aria-hidden="true"
        >
          <div className={styles.grooves} />
          <div className={styles.sheen} ref={sheenRef} />
        </div>
        <div className={styles.band} style={{ top: geometry.centerY }} aria-hidden="true" />
        <span className={styles.notch} style={{ top: geometry.centerY }} aria-hidden="true" />
        <span className={styles.discCounter} aria-hidden="true">SEL {String(selectedIndex + 1).padStart(2, "0")}/{String(count).padStart(2, "0")}</span>
        {games.map((game, index) => {
          const selected = index === selectedIndex;
          return (
            <button
              key={game.id}
              type="button"
              className={styles.discItem}
              data-library-card-id={game.id}
              aria-pressed={selected}
              aria-label={`Select ${game.name}`}
              aria-description="Press Enter to play."
              tabIndex={selected ? 0 : -1}
              disabled={loading}
              onClick={() => onSelectIndex(index)}
              onDoubleClick={() => onActivate(game.path)}
              ref={(node) => {
                if (node) itemRefs.current.set(index, node);
                else itemRefs.current.delete(index);
                registerCardRef?.(index, node);
              }}
            >
              <span className={styles.discNumber} aria-hidden="true">{String(index + 1).padStart(2, "0")}</span>
              <span className={styles.discName}>{game.name}</span>
            </button>
          );
        })}
      </div>
      {selectedGame && <DiscSpotlight game={selectedGame} disabled={loading} onActivate={onActivate} onMore={onMore} />}
    </div>
  );
}
