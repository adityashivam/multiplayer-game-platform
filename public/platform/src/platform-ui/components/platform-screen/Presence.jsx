import React, { useEffect, useRef, useState } from "react";

const EXIT_MS = 160;

/**
 * Keep content mounted briefly after `when` turns false so it can animate
 * out (see `.platform-presence` in global.scss) instead of vanishing. While
 * leaving it is inert: no focus, clicks or keyboard reach it.
 * @param {{when:boolean,children:React.ReactNode,exitMs?:number}} props
 * @returns {React.ReactElement|null}
 */
export default function Presence({ when, children, exitMs = EXIT_MS }) {
  const [mounted, setMounted] = useState(when);
  const lastChildrenRef = useRef(children);
  if (when) lastChildrenRef.current = children;

  useEffect(() => {
    if (when) {
      setMounted(true);
      return undefined;
    }
    if (!mounted) return undefined;
    const reducedMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    const exitTimer = window.setTimeout(() => {
      setMounted(false);
    }, reducedMotion ? 0 : exitMs);
    return () => window.clearTimeout(exitTimer);
  }, [when, mounted, exitMs]);

  if (!when && !mounted) return null;
  return (
    <div className="platform-presence" data-presence={when ? "enter" : "exit"} style={{ display: "contents" }} inert={!when}>
      {when ? children : lastChildrenRef.current}
    </div>
  );
}
