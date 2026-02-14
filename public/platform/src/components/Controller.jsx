import React, { useCallback, useEffect, useRef } from "react";
import classNames from "../utils/classNames.js";
import styles from "../App.module.scss";

function Controller({ onDirectional, onAction, disabled }) {
  const dirHandler = disabled ? undefined : onDirectional;
  const actionHandler = disabled ? undefined : onAction;
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
      if (!dirHandler) return;
      if (event.pointerType === "mouse" && event.button !== 0) return;
      event.preventDefault();

      suppressNextClickRef.current = true;
      clearDirectionalHold();
      dirHandler(direction);

      let repeatCount = 0;
      const scheduleRepeat = () => {
        // Accelerate: start at 160ms, ramp down to 60ms over ~8 presses
        const interval = Math.max(60, 160 - repeatCount * 14);
        holdRepeatRef.current = setTimeout(() => {
          dirHandler(direction);
          repeatCount++;
          scheduleRepeat();
        }, interval);
      };

      holdTimeoutRef.current = setTimeout(() => {
        scheduleRepeat();
      }, 200);
    },
    [clearDirectionalHold, dirHandler],
  );

  const stopDirectionalHold = useCallback(() => {
    clearDirectionalHold();
  }, [clearDirectionalHold]);

  const handleDirectionalClick = useCallback(
    (direction) => {
      if (!dirHandler) return;
      if (suppressNextClickRef.current) {
        suppressNextClickRef.current = false;
        return;
      }
      dirHandler(direction);
    },
    [dirHandler],
  );

  return (
    <div
      className={styles.controllerSection}
      onContextMenu={(event) => event.preventDefault()}
      onDragStart={(event) => event.preventDefault()}
    >
      <div className={styles.controllerTopBar} aria-hidden="true">
        <span className={styles.controllerTopSegment} />
        <span className={classNames(styles.controllerTopSegment, styles.controllerTopSegmentActive)} />
        <span className={styles.controllerTopSegment} />
      </div>

      <div className={styles.controllerGrid}>
        <div className={styles.dpadShell}>
          <div className={styles.dpadHalo} aria-hidden="true" />
          <div className={styles.dpadCross}>
            <div className={styles.dpadVertical} aria-hidden="true" />
            <div className={styles.dpadHorizontal} aria-hidden="true" />
            <div className={styles.dpadCenter} aria-hidden="true" />
            <button
              type="button"
              className={classNames(styles.dpadArea, styles.dpadUp)}
              data-dir="up"
              onPointerDown={(event) => startDirectionalHold("up", event)}
              onPointerUp={stopDirectionalHold}
              onPointerLeave={stopDirectionalHold}
              onPointerCancel={stopDirectionalHold}
              onClick={() => handleDirectionalClick("up")}
            />
            <button
              type="button"
              className={classNames(styles.dpadArea, styles.dpadDown)}
              data-dir="down"
              onPointerDown={(event) => startDirectionalHold("down", event)}
              onPointerUp={stopDirectionalHold}
              onPointerLeave={stopDirectionalHold}
              onPointerCancel={stopDirectionalHold}
              onClick={() => handleDirectionalClick("down")}
            />
            <button
              type="button"
              className={classNames(styles.dpadArea, styles.dpadLeft)}
              data-dir="left"
              onPointerDown={(event) => startDirectionalHold("left", event)}
              onPointerUp={stopDirectionalHold}
              onPointerLeave={stopDirectionalHold}
              onPointerCancel={stopDirectionalHold}
              onClick={() => handleDirectionalClick("left")}
            />
            <button
              type="button"
              className={classNames(styles.dpadArea, styles.dpadRight)}
              data-dir="right"
              onPointerDown={(event) => startDirectionalHold("right", event)}
              onPointerUp={stopDirectionalHold}
              onPointerLeave={stopDirectionalHold}
              onPointerCancel={stopDirectionalHold}
              onClick={() => handleDirectionalClick("right")}
            />
            <span
              className={classNames("material-symbols-outlined", styles.dpadHint, styles.dpadHintUp)}
              aria-hidden="true"
            >
              arrow_drop_up
            </span>
            <span
              className={classNames("material-symbols-outlined", styles.dpadHint, styles.dpadHintDown)}
              aria-hidden="true"
            >
              arrow_drop_down
            </span>
            <span
              className={classNames("material-symbols-outlined", styles.dpadHint, styles.dpadHintLeft)}
              aria-hidden="true"
            >
              arrow_left
            </span>
            <span
              className={classNames("material-symbols-outlined", styles.dpadHint, styles.dpadHintRight)}
              aria-hidden="true"
            >
              arrow_right
            </span>
          </div>
        </div>

        <div className={styles.selectStart}>
          <div className={styles.selectStartGroup}>
            <button
              type="button"
              className={styles.miniButton}
              data-action="home"
              onClick={() => actionHandler?.("home")}
              aria-label="Home"
            />
            <span className={styles.miniLabel}>HOME</span>
          </div>
          <div className={styles.selectStartGroup}>
            <button
              type="button"
              className={styles.miniButton}
              data-action="start"
              onClick={() => actionHandler?.("start")}
            />
            <span className={styles.miniLabel}>START</span>
          </div>
        </div>

        <div className={styles.actionShell}>
          <div className={styles.actionHalo} aria-hidden="true" />
          <div className={styles.actionPad}>
            <button
              type="button"
              className={classNames(styles.actionButton, styles.actionButtonY)}
              data-action="y"
              onClick={() => actionHandler?.("y")}
            >
              <span className={styles.actionLetter}>Y</span>
            </button>
            <button
              type="button"
              className={classNames(styles.actionButton, styles.actionButtonA)}
              data-action="a"
              onClick={() => actionHandler?.("a")}
            >
              <span className={styles.actionLetter}>A</span>
            </button>
            <button
              type="button"
              className={classNames(styles.actionButton, styles.actionButtonX)}
              data-action="x"
              onClick={() => actionHandler?.("x")}
            >
              <span className={styles.actionLetter}>X</span>
            </button>
            <button
              type="button"
              className={classNames(styles.actionButton, styles.actionButtonB)}
              data-action="b"
              onClick={() => actionHandler?.("b")}
            >
              <span className={styles.actionLetter}>B</span>
            </button>
          </div>
        </div>
      </div>

      <div className={styles.controllerDeco} aria-hidden="true">
        <span />
        <span />
        <span />
        <span />
        <span />
      </div>
    </div>
  );
}

export default Controller;
