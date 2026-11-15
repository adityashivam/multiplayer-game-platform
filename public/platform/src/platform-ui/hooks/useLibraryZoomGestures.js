import { useEffect, useRef } from "react";
import { scaleLibraryZoomByFactor } from "../services/libraryZoom.js";

/** How strongly one wheel pixel (a trackpad pinch arrives as ctrl+wheel) zooms. */
const WHEEL_ZOOM_PER_PIXEL = 0.01;
const LINE_HEIGHT_PX = 16;
/** A mouse-wheel notch (~100px) would leap across the range; cap it to one smooth step. */
const MAX_WHEEL_PIXELS_PER_EVENT = 24;

/**
 * Continuous card zoom from a trackpad pinch (ctrl/⌘ + wheel), Safari's
 * gesture events, or a two-finger touch pinch on the element. Changes are
 * folded into one update per animation frame.
 * @param {{current:HTMLElement|null}} targetRef Element that receives the gestures.
 * @param {((update:(scale:number)=>number)=>void)|undefined} onScaleChange Receives an updater of the current scale.
 */
export default function useLibraryZoomGestures(targetRef, onScaleChange) {
  const onScaleChangeRef = useRef(onScaleChange);
  onScaleChangeRef.current = onScaleChange;

  useEffect(() => {
    const target = targetRef.current;
    if (!target) return undefined;

    let pendingFactor = 1;
    let frame = 0;
    let lastPinchDistance = 0;
    let lastGestureScale = 1;
    let gestureActive = false;
    // iOS reports one pinch as both touches and gestures; count it once.
    const gesturesSupported = typeof window !== "undefined" && "ongesturechange" in window;

    const queueFactor = (factor) => {
      if (!Number.isFinite(factor) || factor <= 0) return;
      pendingFactor *= factor;
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        const factorThisFrame = pendingFactor;
        pendingFactor = 1;
        onScaleChangeRef.current?.((current) => scaleLibraryZoomByFactor(current, factorThisFrame));
      });
    };

    const handleWheel = (event) => {
      if (!event.ctrlKey && !event.metaKey) return;
      event.preventDefault();
      if (gestureActive) return;
      const pixels = event.deltaMode === 1 ? event.deltaY * LINE_HEIGHT_PX : event.deltaY;
      const cappedPixels = Math.max(-MAX_WHEEL_PIXELS_PER_EVENT, Math.min(MAX_WHEEL_PIXELS_PER_EVENT, pixels));
      queueFactor(Math.exp(-cappedPixels * WHEEL_ZOOM_PER_PIXEL));
    };

    const readPinchDistance = (touches) => Math.hypot(touches[0].clientX - touches[1].clientX, touches[0].clientY - touches[1].clientY);
    const handleTouchStart = (event) => {
      if (gesturesSupported) return;
      lastPinchDistance = event.touches.length === 2 ? readPinchDistance(event.touches) : 0;
    };
    const handleTouchMove = (event) => {
      if (event.touches.length !== 2 || !lastPinchDistance) return;
      const distance = readPinchDistance(event.touches);
      queueFactor(distance / lastPinchDistance);
      lastPinchDistance = distance;
    };
    const handleTouchEnd = (event) => {
      if (event.touches.length < 2) lastPinchDistance = 0;
    };

    // Safari reports trackpad and touch pinches as gesture events instead.
    const handleGestureStart = (event) => {
      event.preventDefault();
      gestureActive = true;
      lastGestureScale = 1;
    };
    const handleGestureEnd = () => {
      gestureActive = false;
    };
    const handleGestureChange = (event) => {
      event.preventDefault();
      queueFactor(event.scale / lastGestureScale);
      lastGestureScale = event.scale;
    };

    target.addEventListener("wheel", handleWheel, { passive: false });
    target.addEventListener("touchstart", handleTouchStart, { passive: true });
    target.addEventListener("touchmove", handleTouchMove, { passive: true });
    target.addEventListener("touchend", handleTouchEnd, { passive: true });
    target.addEventListener("touchcancel", handleTouchEnd, { passive: true });
    target.addEventListener("gesturestart", handleGestureStart);
    target.addEventListener("gesturechange", handleGestureChange);
    target.addEventListener("gestureend", handleGestureEnd);
    return () => {
      cancelAnimationFrame(frame);
      target.removeEventListener("wheel", handleWheel);
      target.removeEventListener("touchstart", handleTouchStart);
      target.removeEventListener("touchmove", handleTouchMove);
      target.removeEventListener("touchend", handleTouchEnd);
      target.removeEventListener("touchcancel", handleTouchEnd);
      target.removeEventListener("gesturestart", handleGestureStart);
      target.removeEventListener("gesturechange", handleGestureChange);
      target.removeEventListener("gestureend", handleGestureEnd);
    };
  }, [targetRef]);
}
