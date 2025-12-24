import React from "react";
import classNames from "../utils/classNames.js";
import styles from "../App.module.scss";

function Controller({ onDirectional, onAction, disabled }) {
  const dirHandler = disabled ? undefined : onDirectional;
  const actionHandler = disabled ? undefined : onAction;

  return (
    <div className={styles.controllerSection}>
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
              onClick={() => dirHandler?.("up")}
            />
            <button
              type="button"
              className={classNames(styles.dpadArea, styles.dpadDown)}
              onClick={() => dirHandler?.("down")}
            />
            <button
              type="button"
              className={classNames(styles.dpadArea, styles.dpadLeft)}
              onClick={() => dirHandler?.("left")}
            />
            <button
              type="button"
              className={classNames(styles.dpadArea, styles.dpadRight)}
              onClick={() => dirHandler?.("right")}
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
            <button type="button" className={styles.miniButton} onClick={() => actionHandler?.("select")} />
            <span className={styles.miniLabel}>SELECT</span>
          </div>
          <div className={styles.selectStartGroup}>
            <button type="button" className={styles.miniButton} onClick={() => actionHandler?.("start")} />
            <span className={styles.miniLabel}>START</span>
          </div>
        </div>

        <div className={styles.actionShell}>
          <div className={styles.actionHalo} aria-hidden="true" />
          <div className={styles.actionPad}>
            <button
              type="button"
              className={classNames(styles.actionButton, styles.actionButtonY)}
              onClick={() => actionHandler?.("start")}
            >
              <span className={styles.actionLetter}>Y</span>
            </button>
            <button
              type="button"
              className={classNames(styles.actionButton, styles.actionButtonA)}
              onClick={() => actionHandler?.("confirm")}
            >
              <span className={styles.actionLetter}>A</span>
            </button>
            <button
              type="button"
              className={classNames(styles.actionButton, styles.actionButtonX)}
              onClick={() => actionHandler?.("select")}
            >
              <span className={styles.actionLetter}>X</span>
            </button>
            <button
              type="button"
              className={classNames(styles.actionButton, styles.actionButtonB)}
              onClick={() => actionHandler?.("back")}
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
