import React from "react";
import classNames from "../utils/classNames.js";
import styles from "../App.module.scss";

function Controller({ onDirectional, onAction, disabled }) {
  const dirHandler = disabled ? undefined : onDirectional;
  const actionHandler = disabled ? undefined : onAction;

  return (
    <div className={styles.controllerSection}>
      <div className={styles.controllerGrid}>
        <div className={styles.dpadWrap}>
          <div className={styles.dpad}>
            <button type="button" data-dir="up" className={styles.dpadButton} onClick={() => dirHandler?.("up")} />
            <button
              type="button"
              data-dir="down"
              className={styles.dpadButton}
              onClick={() => dirHandler?.("down")}
            />
            <button
              type="button"
              data-dir="left"
              className={styles.dpadButton}
              onClick={() => dirHandler?.("left")}
            />
            <button
              type="button"
              data-dir="right"
              className={styles.dpadButton}
              onClick={() => dirHandler?.("right")}
            />
            <div className={styles.dpadCenter} />
            <span className={classNames("material-symbols-outlined", styles.dpadHint, styles.up)} aria-hidden="true">
              arrow_drop_up
            </span>
            <span
              className={classNames("material-symbols-outlined", styles.dpadHint, styles.down)}
              aria-hidden="true"
            >
              arrow_drop_down
            </span>
            <span
              className={classNames("material-symbols-outlined", styles.dpadHint, styles.left)}
              aria-hidden="true"
            >
              arrow_left
            </span>
            <span
              className={classNames("material-symbols-outlined", styles.dpadHint, styles.right)}
              aria-hidden="true"
            >
              arrow_right
            </span>
          </div>
        </div>

        <div>
          <div className={styles.selectStart}>
            <div>
              <button
                type="button"
                data-action="select"
                className={styles.miniButton}
                onClick={() => actionHandler?.("select")}
              />
              <div className={styles.miniLabel}>SELECT</div>
            </div>
            <div>
              <button
                type="button"
                data-action="start"
                className={styles.miniButton}
                onClick={() => actionHandler?.("start")}
              />
              <div className={styles.miniLabel}>START</div>
            </div>
          </div>
        </div>

        <div className={styles.actionWrap}>
          <div className={styles.actionPad}>
            <button
              type="button"
              data-action="back"
              className={styles.actionButton}
              onClick={() => actionHandler?.("back")}
            >
              <span className={styles.actionLetter}>B</span>
            </button>
            <button
              type="button"
              data-action="confirm"
              className={styles.actionButton}
              onClick={() => actionHandler?.("confirm")}
            >
              <span className={styles.actionLetter}>A</span>
            </button>
          </div>
        </div>
      </div>

      <div className={styles.controllerDeco}>
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
