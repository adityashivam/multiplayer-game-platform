import React, { useEffect } from "react";
import { readGameLibraryDetails } from "../../services/gamePresentation.js";
import styles from "./GameLibrary.module.scss";

const LAUNCH_OVERLAY_MS = 1250;

/**
 * Opening a game grows its card into a full-screen title card that holds
 * while the game starts, then fades to reveal it. Decorative and click-through.
 * @param {{launch:{game:object,from:{top:number,right:number,bottom:number,left:number}|null,serial:number},onDone:()=>void}} props
 * @returns {React.ReactElement}
 */
export default function LaunchOverlay({ launch, onDone }) {
  const details = readGameLibraryDetails(launch.game);
  const art = details.backdropUrl || details.capsuleUrl || details.coverUrl;
  const from = launch.from;
  const fromClip = from
    ? `inset(${from.top}px ${from.right}px ${from.bottom}px ${from.left}px round 14px)`
    : "inset(42% 42% 42% 42% round 14px)";

  useEffect(() => {
    const doneTimer = window.setTimeout(onDone, LAUNCH_OVERLAY_MS);
    return () => window.clearTimeout(doneTimer);
  }, [launch.serial, onDone]);

  return (
    <div
      className={styles.launchOverlay}
      style={{ "--launch-from": fromClip, "--game-accent": details.accentColor }}
      aria-hidden="true"
      data-launch-overlay={launch.game.id}
    >
      {art && <img src={art} alt="" className={styles.launchArt} draggable={false} />}
      <div className={styles.launchShade} />
      <div className={styles.launchTitle}>
        <span>{launch.game.name}</span>
        <i className={styles.launchProgress} />
      </div>
    </div>
  );
}
