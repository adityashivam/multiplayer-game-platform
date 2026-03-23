import { useCallback, useEffect, useRef } from "react";

export default function useDirectionalHold(onDirectional, disabled) {
  const holdTimeoutRef = useRef(null);
  const holdRepeatRef = useRef(null);
  const suppressNextClickRef = useRef(false);

  const clearDirectionalHold = useCallback(() => {
    if (holdTimeoutRef.current) {
      clearTimeout(holdTimeoutRef.current);
      holdTimeoutRef.current = null;
    }

    if (holdRepeatRef.current) {
      clearTimeout(holdRepeatRef.current);
      holdRepeatRef.current = null;
    }
  }, []);

  useEffect(() => {
    return () => {
      clearDirectionalHold();
    };
  }, [clearDirectionalHold]);

  const startDirectionalHold = useCallback(
    (direction, event) => {
      if (disabled || typeof onDirectional !== "function") return;
      if (event.pointerType === "mouse" && event.button !== 0) return;

      event.preventDefault();
      suppressNextClickRef.current = true;
      clearDirectionalHold();
      onDirectional(direction);

      let repeatCount = 0;

      const scheduleRepeat = () => {
        const interval = Math.max(60, 160 - repeatCount * 14);
        holdRepeatRef.current = setTimeout(() => {
          onDirectional(direction);
          repeatCount++;
          scheduleRepeat();
        }, interval);
      };

      holdTimeoutRef.current = setTimeout(() => {
        scheduleRepeat();
      }, 200);
    },
    [clearDirectionalHold, disabled, onDirectional],
  );

  const stopDirectionalHold = useCallback(() => {
    clearDirectionalHold();
  }, [clearDirectionalHold]);

  const handleDirectionalClick = useCallback(
    (direction) => {
      if (disabled || typeof onDirectional !== "function") return;
      if (suppressNextClickRef.current) {
        suppressNextClickRef.current = false;
        return;
      }

      onDirectional(direction);
    },
    [disabled, onDirectional],
  );

  return {
    startDirectionalHold,
    stopDirectionalHold,
    handleDirectionalClick,
  };
}

