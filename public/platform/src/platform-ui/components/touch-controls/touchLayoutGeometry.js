export const TOUCH_CONTROL_GUTTER_PX = 12;
export const TOUCH_CONTROL_TOOLBAR_INSET_PX = 56;

/**
 * @typedef {{x:number,y:number,size:number}} TouchControlPosition
 * @typedef {{width:number,height:number,topInset?:number,leftInset?:number,rightInset?:number,bottomInset?:number}} TouchSurfaceDimensions
 */

/**
 * Keep a control's center within the usable play surface, reserving its toolbar.
 * The returned position is owned; a very small surface centers oversized targets.
 * @param {TouchControlPosition} controlPosition
 * @param {TouchSurfaceDimensions} dimensions
 * @returns {{x:number,y:number}}
 */
export function clampTouchControlPosition(controlPosition, dimensions) {
  const {
    width, height, topInset = TOUCH_CONTROL_TOOLBAR_INSET_PX,
    leftInset = TOUCH_CONTROL_GUTTER_PX, rightInset = TOUCH_CONTROL_GUTTER_PX,
    bottomInset = TOUCH_CONTROL_GUTTER_PX,
  } = dimensions;
  const halfSize = controlPosition.size / 2;
  const minimumX = (halfSize + leftInset) / Math.max(1, width);
  const maximumX = (width - halfSize - rightInset) / Math.max(1, width);
  const minimumY = (halfSize + topInset) / Math.max(1, height);
  const maximumY = (height - halfSize - bottomInset) / Math.max(1, height);

  return {
    x: minimumX > maximumX ? 0.5 : Math.max(minimumX, Math.min(maximumX, controlPosition.x)),
    y: minimumY > maximumY ? 0.5 : Math.max(minimumY, Math.min(maximumY, controlPosition.y)),
  };
}

/**
 * Move a control in CSS pixels while preserving normalized storage coordinates.
 * @param {TouchControlPosition} controlPosition
 * @param {number} deltaX
 * @param {number} deltaY
 * @param {TouchSurfaceDimensions} dimensions
 * @returns {{x:number,y:number}}
 */
export function moveTouchControlByPixels(controlPosition, deltaX, deltaY, dimensions) {
  return clampTouchControlPosition({
    ...controlPosition,
    x: controlPosition.x + deltaX / Math.max(1, dimensions.width),
    y: controlPosition.y + deltaY / Math.max(1, dimensions.height),
  }, dimensions);
}

/**
 * Remove one control's current preset override without mutating the saved profile.
 * @template {{presetId:string,layouts:Object<string,Object<string,object>>}} Profile
 * @param {Profile} profile
 * @param {string} controlId
 * @returns {Profile}
 */
export function resetTouchLayoutControl(profile, controlId) {
  const presetLayout = { ...profile.layouts[profile.presetId] };
  delete presetLayout[controlId];

  return {
    ...profile,
    layouts: { ...profile.layouts, [profile.presetId]: presetLayout },
  };
}

/**
 * Reset only the draft's current preset, keeping all other presets and preferences.
 * @template {{presetId:string,layouts:Object<string,Object<string,object>>}} Profile
 * @param {Profile} profile
 * @returns {Profile}
 */
export function resetTouchLayoutPreset(profile) {
  return {
    ...profile,
    layouts: { ...profile.layouts, [profile.presetId]: {} },
  };
}

/**
 * Share CSS positioning between runtime, preview, and editor without DOM reads.
 * Safe areas and toolbar space are part of the surface, not game simulation space.
 * @param {{x:number,y:number,size:number,opacity:number}} controlLayout
 * @returns {import("react").CSSProperties}
 */
export function createTouchControlStyle(controlLayout) {
  return {
    "--touch-x": `${controlLayout.x * 100}%`,
    "--touch-y": `${controlLayout.y * 100}%`,
    "--touch-control-size": `${controlLayout.size}px`,
    "--touch-control-opacity": controlLayout.opacity,
  };
}
