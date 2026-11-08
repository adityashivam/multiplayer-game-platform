import React, { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import { resolveTouchLayout, sanitizeTouchProfile, TOUCH_CONTROL_LIMITS, updateTouchControl } from "../../../../shared/touchControls.js";
import useDialogFocus from "../../hooks/useDialogFocus.js";
import GameArtwork from "../platform-screen/GameArtwork.jsx";
import PlatformDialog from "../platform-screen/PlatformDialog.jsx";
import dialogStyles from "../platform-screen/PlatformDialog.module.scss";
import TouchControlVisual, { TOUCH_PRESET_LABELS, TouchLookZone } from "./TouchControlVisual.jsx";
import {
  clampTouchControlPosition,
  createTouchControlStyle,
  moveTouchControlByPixels,
  resetTouchLayoutControl,
  resetTouchLayoutPreset,
  TOUCH_CONTROL_TOOLBAR_INSET_PX,
} from "./touchLayoutGeometry.js";
import styles from "./TouchControls.module.scss";

/**
 * @typedef {object} TouchLayoutEditorProps
 * @property {{id:string,name:string,presentation?:{coverUrl?:string},touchControls?:import("../../../../shared/touchControls.js").TouchControlsDescriptor}} game
 * @property {import("../../../../shared/touchControls.js").TouchProfile} profile
 * @property {import("../../../../shared/touchControls.js").TouchOrientation} orientation
 * @property {boolean} [inGame]
 * @property {(profile:import("../../../../shared/touchControls.js").TouchProfile,orientation:import("../../../../shared/touchControls.js").TouchOrientation)=>void|Promise<void>} onSave Owns persistence and closing the editor.
 * @property {()=>void} onCancel Closes without committing the draft.
 */

/**
 * Refuse editing when the game's developer has not explicitly enabled it.
 * The game key starts a new draft. Its orientation remains fixed during device rotation.
 * @param {TouchLayoutEditorProps} props
 * @returns {React.ReactElement}
 */
export default function TouchLayoutEditor(props) {
  if (props.game?.touchControls?.customizable !== true) {
    return (
      <div className={styles.unavailableEditor}>
        <PlatformDialog
          label="Touch controls unavailable"
          title="These controls are fixed"
          description="The game developer has not enabled layout editing for this game."
          icon="lock"
          onClose={props.onCancel}
        >
          <div className={dialogStyles.actions}>
            <button type="button" className={dialogStyles.primaryAction} onClick={props.onCancel}>Close</button>
          </div>
        </PlatformDialog>
      </div>
    );
  }

  return <EditableTouchLayout key={props.game.id} {...props} />;
}

/**
 * Edit a local draft over the same mounted arena. Pointer capture owns one drag;
 * no gameplay input or persistence is emitted until the parent accepts Save.
 * @param {TouchLayoutEditorProps} props
 * @returns {React.ReactElement}
 */
function EditableTouchLayout({ game, profile: requestedProfile, orientation: requestedOrientation, inGame = false, onSave, onCancel }) {
  const editorTargetRef = useRef({ profile: requestedProfile, orientation: requestedOrientation });
  const { profile, orientation } = editorTargetRef.current;
  const descriptor = game.touchControls;
  const editorId = useId();
  const editorRef = useRef(null);
  const headerRef = useRef(null);
  const footerRef = useRef(null);
  const inspectorRef = useRef(null);
  const cancelButtonRef = useRef(null);
  const dragRef = useRef(null);
  const dialogKeysRef = useRef(new Set());
  const [draftProfile, setDraftProfile] = useState(() => sanitizeTouchProfile(descriptor, profile));
  const [selectedId, setSelectedId] = useState(() => descriptor.controls.find(
    (control) => control.type !== "look" && control.editable !== false,
  )?.id || null);
  const [draggingId, setDraggingId] = useState(null);
  const [inspectorCollapsed, setInspectorCollapsed] = useState(false);
  const [feedback, setFeedback] = useState("");
  const [saveError, setSaveError] = useState("");
  const [saving, setSaving] = useState(false);
  const [dimensions, setDimensions] = useState({ width: 0, height: 0, topInset: TOUCH_CONTROL_TOOLBAR_INSET_PX });
  const layout = useMemo(
    () => resolveTouchLayout(descriptor, draftProfile, orientation),
    [descriptor, draftProfile, orientation],
  );
  const selectedControl = layout.find((control) => control.id === selectedId);
  const savedProfile = useMemo(() => sanitizeTouchProfile(descriptor, profile), [descriptor, profile]);
  const hasChanges = JSON.stringify(draftProfile) !== JSON.stringify(savedProfile);
  const displayedSelectedPosition = selectedControl ? clampTouchControlPosition(selectedControl, dimensions) : null;
  const inspectorOnLeft = displayedSelectedPosition ? displayedSelectedPosition.x >= 0.5 : false;
  const selectedCenterY = displayedSelectedPosition ? displayedSelectedPosition.y * dimensions.height : 0;
  const inspectorSpaceAbove = selectedControl ? selectedCenterY - selectedControl.size / 2 - dimensions.topInset - 16 : 0;
  const inspectorSpaceBelow = selectedControl ? dimensions.height - (dimensions.bottomInset || 50) - selectedCenterY - selectedControl.size / 2 - 16 : 0;
  const inspectorOnTop = inspectorSpaceAbove >= inspectorSpaceBelow;

  useDialogFocus(editorRef, onCancel, cancelButtonRef);

  useLayoutEffect(() => {
    const editorPanel = editorRef.current;
    const editorHeader = headerRef.current;
    if (!editorPanel || !editorHeader) {
      return undefined;
    }

    const measureEditorSurface = () => {
      const surfaceBounds = editorPanel.getBoundingClientRect();
      const headerBounds = editorHeader.getBoundingClientRect();
      const topInset = Math.max(TOUCH_CONTROL_TOOLBAR_INSET_PX, headerBounds.bottom - surfaceBounds.top + 10);
      const bottomInset = (footerRef.current?.getBoundingClientRect().height || 42) + 8;
      const surfaceStyles = getComputedStyle(editorPanel);
      const leftInset = Math.max(12, Number.parseFloat(surfaceStyles.getPropertyValue("--touch-safe-left")) || 0);
      const rightInset = Math.max(12, Number.parseFloat(surfaceStyles.getPropertyValue("--touch-safe-right")) || 0);
      const nextDimensions = { width: surfaceBounds.width, height: surfaceBounds.height, topInset, leftInset, rightInset, bottomInset };
      editorPanel.style.setProperty("--touch-top-inset", `${topInset}px`);
      editorPanel.style.setProperty("--touch-bottom-inset", `${bottomInset}px`);
      setDimensions((previous) => previous.width === nextDimensions.width &&
        previous.height === nextDimensions.height && previous.topInset === nextDimensions.topInset &&
        previous.leftInset === nextDimensions.leftInset && previous.rightInset === nextDimensions.rightInset &&
        previous.bottomInset === nextDimensions.bottomInset
        ? previous : nextDimensions);
    };
    measureEditorSurface();

    const resizeObserver = new ResizeObserver(measureEditorSurface);
    resizeObserver.observe(editorPanel);
    resizeObserver.observe(editorHeader);
    if (footerRef.current) {
      resizeObserver.observe(footerRef.current);
    }

    return () => resizeObserver.disconnect();
  }, []);

  useEffect(() => {
    const cancelControlDrag = () => {
      dragRef.current = null;
      setDraggingId(null);
    };
    window.addEventListener("blur", cancelControlDrag);

    return () => window.removeEventListener("blur", cancelControlDrag);
  }, []);

  useLayoutEffect(() => {
    if (dimensions.width <= 0 || dimensions.width > 510 || !inspectorRef.current) {
      return;
    }

    const inspectorHeight = inspectorRef.current.getBoundingClientRect().height;
    if (Math.max(inspectorSpaceAbove, inspectorSpaceBelow) < inspectorHeight) {
      setInspectorCollapsed(true);
    }
  }, [dimensions.width, dimensions.height, dimensions.topInset, dimensions.bottomInset,
    selectedId, selectedControl?.x, selectedControl?.y, selectedControl?.size]);

  const changeControlLayout = (controlId, patch) => {
    const controlDescriptor = descriptor.controls.find((control) => control.id === controlId);
    if (!controlDescriptor || controlDescriptor.type === "look" || controlDescriptor.editable === false) {
      return;
    }

    setDraftProfile((previous) => sanitizeTouchProfile(descriptor, updateTouchControl(previous, controlId, patch)));
    setSaveError("");
  };

  const beginControlDrag = (event, control) => {
    if (event.button !== 0 || dragRef.current || control.editable === false) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.focus({ preventScroll: true });
    event.currentTarget.setPointerCapture(event.pointerId);
    setSelectedId(control.id);
    setDraggingId(control.id);
    dragRef.current = {
      controlId: control.id,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      control: { ...control, ...clampTouchControlPosition(control, dimensions) },
    };
  };

  const dragControl = (event) => {
    const controlDrag = dragRef.current;
    if (!controlDrag || controlDrag.pointerId !== event.pointerId) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    changeControlLayout(controlDrag.controlId, moveTouchControlByPixels(
      controlDrag.control,
      event.clientX - controlDrag.startX,
      event.clientY - controlDrag.startY,
      dimensions,
    ));
  };

  const endControlDrag = (event) => {
    if (dragRef.current?.pointerId !== event.pointerId) {
      return;
    }

    dragRef.current = null;
    setDraggingId(null);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };

  const nudgeControl = (control, deltaX, deltaY) => {
    setSelectedId(control.id);
    changeControlLayout(control.id, moveTouchControlByPixels(control, deltaX, deltaY, dimensions));
  };

  const adjustControlWithKeyboard = (event, control) => {
    const nudgeDistance = event.shiftKey ? 10 : 1;
    const keyboardDirections = {
      ArrowLeft: [-nudgeDistance, 0],
      ArrowRight: [nudgeDistance, 0],
      ArrowUp: [0, -nudgeDistance],
      ArrowDown: [0, nudgeDistance],
    };
    const direction = keyboardDirections[event.key];
    if (!direction) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    nudgeControl(control, ...direction);
  };

  const changeSelectedSize = (size) => {
    if (!selectedControl) {
      return;
    }

    changeControlLayout(selectedControl.id, {
      size,
      ...clampTouchControlPosition({ ...selectedControl, size }, dimensions),
    });
  };

  const resetSelectedControl = () => {
    if (!selectedControl || selectedControl.editable === false) {
      return;
    }

    setDraftProfile((previous) => resetTouchLayoutControl(previous, selectedControl.id));
    setFeedback(`${selectedControl.label} reset. Save to apply.`);
  };

  const resetCurrentLayout = () => {
    setDraftProfile((previous) => resetTouchLayoutPreset(previous));
    setFeedback("Layout reset. Save to apply.");
  };

  const saveDraftLayout = async () => {
    if (saving) {
      return;
    }

    setSaving(true);
    setSaveError("");
    try {
      await onSave(sanitizeTouchProfile(descriptor, draftProfile), orientation);
    } catch {
      setSaveError("Could not save this layout. Try again.");
    } finally {
      setSaving(false);
    }
  };

  const containDialogKeyDown = (event) => {
    if (!event.repeat) {
      dialogKeysRef.current.add(event.code || event.key);
    }
    event.stopPropagation();
  };

  return (
    <section
      ref={editorRef}
      className={`${styles.editor} ${inGame ? styles.editorInGame : ""}`}
      role="dialog"
      aria-modal="true"
      aria-labelledby={`${editorId}-title`}
      aria-describedby={`${editorId}-description`}
      tabIndex={-1}
      data-orientation={orientation}
      onKeyDown={containDialogKeyDown}
      onKeyPress={(event) => event.stopPropagation()}
      onKeyUp={(event) => {
        if (dialogKeysRef.current.delete(event.code || event.key)) {
          event.stopPropagation();
        }
      }}
    >
      {!inGame && <GameArtwork coverUrl={game.presentation?.coverUrl || null} className={styles.editorArtwork} eager />}
      <div className={styles.editorScrim} aria-hidden="true" />
      <div className={styles.canvasGrid} aria-hidden="true" />

      <div className={styles.editingCanvas} aria-label="Control positions">
        {layout.map((control) => {
          if (control.type === "look") {
            return <TouchLookZone key={control.id} control={control} editing />;
          }

          const locked = control.editable === false;
          const selected = control.id === selectedId;
          return (
            <button
              key={control.id}
              type="button"
              className={`${styles.controlButton} ${styles.editorControl}`}
              style={createTouchControlStyle(control)}
              data-control-role={control.role}
              data-control-type={control.type}
              data-selected={selected ? "true" : "false"}
              data-dragging={draggingId === control.id ? "true" : "false"}
              data-locked={locked ? "true" : "false"}
              aria-label={`${control.label}${locked ? ", fixed control" : ", drag or use arrow keys to move"}`}
              aria-pressed={locked ? undefined : selected}
              aria-describedby={locked ? undefined : `${editorId}-keyboard`}
              disabled={locked}
              onFocus={() => setSelectedId(control.id)}
              onClick={() => setSelectedId(control.id)}
              onPointerDown={(event) => beginControlDrag(event, control)}
              onPointerMove={dragControl}
              onPointerUp={endControlDrag}
              onPointerCancel={endControlDrag}
              onLostPointerCapture={endControlDrag}
              onKeyDown={(event) => adjustControlWithKeyboard(event, control)}
              onContextMenu={(event) => event.preventDefault()}
            >
              <TouchControlVisual control={control} locked={locked} />
              {selected && <span className={styles.selectionLabel}>{control.label}</span>}
              {locked && <span className={styles.lockedLabel}>Fixed</span>}
            </button>
          );
        })}
      </div>

      <header className={styles.editorHeader} ref={headerRef}>
        <div className={styles.editorHeading}>
          <p>{game.name} · {orientation === "portrait" ? "Portrait" : "Landscape"}</p>
          <h2 id={`${editorId}-title`}>Edit controls</h2>
        </div>

        <div className={styles.layoutChoices}>
          <label className={styles.presetPicker}>
            <span className={styles.visuallyHidden}>Finger preset</span>
            <span className="material-symbols-outlined" aria-hidden="true">back_hand</span>
            <select
              value={draftProfile.presetId}
              onChange={(event) => {
                const presetId = event.target.value;
                dragRef.current = null;
                setDraggingId(null);
                setDraftProfile((previous) => sanitizeTouchProfile(descriptor, { ...previous, presetId }));
                setFeedback(`${TOUCH_PRESET_LABELS[presetId]} selected. Save to apply.`);
              }}
            >
              {descriptor.allowedPresets.map((presetId) => (
                <option key={presetId} value={presetId}>{TOUCH_PRESET_LABELS[presetId]}</option>
              ))}
            </select>
            <span className={`material-symbols-outlined ${styles.presetChevron}`} aria-hidden="true">expand_more</span>
          </label>

          <details className={styles.editorOptions}>
            <summary aria-label="Touch control options">
              <span className="material-symbols-outlined" aria-hidden="true">tune</span>
              <span>Options</span>
            </summary>
            <div className={styles.optionsPanel}>
              <label htmlFor={`${editorId}-mode`}>Touch controls</label>
              <select
                id={`${editorId}-mode`}
                value={draftProfile.mode}
                onChange={(event) => setDraftProfile((previous) => ({ ...previous, mode: event.target.value }))}
              >
                <option value="auto">Auto · follow device</option>
                <option value="on">Always on</option>
                <option value="off">Off</option>
              </select>
              <label className={styles.expandedOption}>
                <input
                  type="checkbox"
                  checked={draftProfile.hideShell}
                  onChange={(event) => setDraftProfile((previous) => ({ ...previous, hideShell: event.target.checked }))}
                />
                <span>Expanded play area<small>Give the game more room on touch devices.</small></span>
              </label>
              <p>Options apply when you save.</p>
            </div>
          </details>
        </div>

        <div className={styles.editorActions}>
          <button
            type="button"
            ref={cancelButtonRef}
            className={`${dialogStyles.secondaryAction} ${styles.cancelAction}`}
            onClick={onCancel}
          >Cancel</button>
          <button
            type="button"
            className={`${dialogStyles.primaryAction} ${styles.saveAction}`}
            onClick={saveDraftLayout}
            disabled={saving}
          >{saving ? "Saving…" : "Save"}</button>
        </div>

        <p className={styles.editorDescription} id={`${editorId}-description`}>
          <span className={`material-symbols-outlined ${inGame ? styles.liveIcon : ""}`} aria-hidden="true">
            {inGame ? "radio_button_checked" : "drag_pan"}
          </span>
          {inGame ? "Match continues while editing." : "Drag a control to place it."}
          <span className={styles.draftStatus}>{hasChanges ? "Unsaved changes" : "This device"}</span>
        </p>
      </header>

      {selectedControl ? (
        <aside
          ref={inspectorRef}
          className={styles.inspector}
          data-left={inspectorOnLeft ? "true" : "false"}
          data-top={inspectorOnTop ? "true" : "false"}
          data-collapsed={inspectorCollapsed ? "true" : "false"}
          aria-label={`${selectedControl.label} settings`}
        >
          <button
            type="button"
            className={styles.inspectorToggle}
            aria-expanded={!inspectorCollapsed}
            aria-controls={`${editorId}-inspector`}
            onClick={() => setInspectorCollapsed((previous) => !previous)}
          >
            <span className={styles.inspectorHeading}>
              <span className={`material-symbols-outlined ${styles.selectedIcon}`} aria-hidden="true">
                {selectedControl.icon || (selectedControl.type === "stick" ? "joystick" : "touch_app")}
              </span>
              <span>{selectedControl.label}<small>Selected control</small></span>
            </span>
            <span className="material-symbols-outlined" aria-hidden="true">{inspectorCollapsed ? "expand_more" : "expand_less"}</span>
          </button>

          <div className={styles.inspectorBody} id={`${editorId}-inspector`} hidden={inspectorCollapsed}>
            <label className={styles.rangeLabel} htmlFor={`${editorId}-size`}>
              <span>Size</span><output>{Math.round(selectedControl.size)} px</output>
            </label>
            <input
              id={`${editorId}-size`}
              className={styles.rangeInput}
              type="range"
              min={TOUCH_CONTROL_LIMITS.size.min}
              max={TOUCH_CONTROL_LIMITS.size.max}
              step="1"
              value={selectedControl.size}
              aria-label={`${selectedControl.label} size`}
              onChange={(event) => changeSelectedSize(Number(event.target.value))}
            />

            <label className={styles.rangeLabel} htmlFor={`${editorId}-opacity`}>
              <span>Opacity</span><output>{Math.round(selectedControl.opacity * 100)}%</output>
            </label>
            <input
              id={`${editorId}-opacity`}
              className={styles.rangeInput}
              type="range"
              min={TOUCH_CONTROL_LIMITS.opacity.min}
              max={TOUCH_CONTROL_LIMITS.opacity.max}
              step="0.05"
              value={selectedControl.opacity}
              aria-label={`${selectedControl.label} opacity`}
              onChange={(event) => changeControlLayout(selectedControl.id, { opacity: Number(event.target.value) })}
            />

            <div className={styles.positionLabel}>
              <span>Position</span>
              <span>X {Math.round(selectedControl.x * 100)} · Y {Math.round(selectedControl.y * 100)}</span>
            </div>
            <div className={styles.nudgeControls}>
              <NudgeButton label="Move left" icon="arrow_back" onNudge={(step) => nudgeControl(selectedControl, -step, 0)} />
              <NudgeButton label="Move up" icon="arrow_upward" onNudge={(step) => nudgeControl(selectedControl, 0, -step)} />
              <NudgeButton label="Move down" icon="arrow_downward" onNudge={(step) => nudgeControl(selectedControl, 0, step)} />
              <NudgeButton label="Move right" icon="arrow_forward" onNudge={(step) => nudgeControl(selectedControl, step, 0)} />
            </div>
            <p className={styles.keyboardHint} id={`${editorId}-keyboard`}>Arrow keys: 1 px · Shift: 10 px</p>
            <button type="button" className={styles.resetControl} onClick={resetSelectedControl}>
              <span className="material-symbols-outlined" aria-hidden="true">restart_alt</span>
              Reset selected
            </button>
          </div>
        </aside>
      ) : (
        <p className={styles.emptySelection}>All controls are fixed by the game developer.</p>
      )}

      <footer className={styles.editorFooter} ref={footerRef}>
        <span className={styles.editorFeedback} role="status">{saveError || feedback}</span>
        <button type="button" className={styles.resetLayout} onClick={resetCurrentLayout} disabled={!selectedControl}>
          <span className="material-symbols-outlined" aria-hidden="true">restart_alt</span>
          Reset layout
        </button>
      </footer>
    </section>
  );
}

/**
 * @param {{label:string,icon:string,onNudge:(step:number)=>void}} props
 * @returns {React.ReactElement}
 */
function NudgeButton({ label, icon, onNudge }) {
  return (
    <button type="button" title={`${label} 1 px`} aria-label={`${label} 1 pixel`} onClick={(event) => onNudge(event.shiftKey ? 10 : 1)}>
      <span className="material-symbols-outlined" aria-hidden="true">{icon}</span>
    </button>
  );
}
