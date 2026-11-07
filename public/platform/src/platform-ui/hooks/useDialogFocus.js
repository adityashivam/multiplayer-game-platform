import { useEffect, useRef } from "react";

const openDialogPanels = [];
const FOCUSABLE_CONTROLS = "button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href], [tabindex]:not([tabindex='-1'])";

/**
 * Contain focus in the top platform dialog and restore it after that dialog closes.
 * Listeners and stack membership are removed on unmount; callbacks may change without refocusing.
 * @param {import("react").RefObject<HTMLElement|null>} panelRef Dialog's focus boundary.
 * @param {(() => void)|undefined} onClose Optional Escape action.
 * @param {import("react").RefObject<HTMLElement|null>|undefined} initialFocusRef Preferred initial control.
 * @returns {void}
 */
export default function useDialogFocus(panelRef, onClose, initialFocusRef) {
  const closeDialogRef = useRef(onClose);

  useEffect(() => {
    closeDialogRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    const dialogPanel = panelRef.current;
    if (!dialogPanel) return undefined;

    const previousFocus = document.activeElement;
    const readFocusTargets = () => [...dialogPanel.querySelectorAll(FOCUSABLE_CONTROLS)]
      .filter((control) => control.getClientRects().length > 0);
    const focusDialogControl = () => {
      const preferredControl = initialFocusRef?.current;
      const focusTarget = preferredControl && !preferredControl.disabled
        ? preferredControl : readFocusTargets()[0] || dialogPanel;
      focusTarget.focus({ preventScroll: true });
    };
    const isTopDialog = () => openDialogPanels.at(-1) === dialogPanel;
    const containDialogFocus = (event) => {
      if (isTopDialog() && !dialogPanel.contains(event.target)) focusDialogControl();
    };
    const handleDialogKeyDown = (event) => {
      if (!isTopDialog()) return;
      if (event.key === "Escape" && closeDialogRef.current) {
        event.preventDefault();
        event.stopPropagation();
        closeDialogRef.current();
        return;
      }
      if (event.key !== "Tab") return;

      const focusTargets = readFocusTargets();
      const firstTarget = focusTargets[0] || dialogPanel;
      const lastTarget = focusTargets.at(-1) || dialogPanel;
      const focusBoundary = event.shiftKey ? firstTarget : lastTarget;
      if (!dialogPanel.contains(document.activeElement) || document.activeElement === focusBoundary) {
        event.preventDefault();
        (event.shiftKey ? lastTarget : firstTarget).focus({ preventScroll: true });
      }
    };

    openDialogPanels.push(dialogPanel);
    document.addEventListener("focusin", containDialogFocus);
    document.addEventListener("keydown", handleDialogKeyDown, true);
    focusDialogControl();

    return () => {
      document.removeEventListener("focusin", containDialogFocus);
      document.removeEventListener("keydown", handleDialogKeyDown, true);
      openDialogPanels.splice(openDialogPanels.indexOf(dialogPanel), 1);

      const remainingDialog = openDialogPanels.at(-1);
      if (previousFocus instanceof HTMLElement && previousFocus.isConnected &&
          (!remainingDialog || remainingDialog.contains(previousFocus))) {
        previousFocus.focus({ preventScroll: true });
      } else if (remainingDialog) {
        (remainingDialog.querySelector(FOCUSABLE_CONTROLS) || remainingDialog).focus({ preventScroll: true });
      }
    };
  }, [panelRef, initialFocusRef]);
}
