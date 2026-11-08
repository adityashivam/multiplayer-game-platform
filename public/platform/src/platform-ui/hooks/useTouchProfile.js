import { useCallback, useEffect, useMemo, useState } from "react";
import {
  loadTouchProfile,
  saveTouchProfile,
  subscribeTouchProfile,
} from "../../../frontend-engine/touchControlSettings.js";

/** @typedef {import("../../../shared/touchControls.js").TouchProfile} TouchProfile */
/** @typedef {import("../../../shared/touchControls.js").TouchOrientation} TouchOrientation */
/** @typedef {{id:string,touchControls?:import("../../../shared/touchControls.js").TouchControlsDescriptor}} TouchGameMetadata */
/** @typedef {TouchProfile|((currentProfile:TouchProfile)=>TouchProfile)} TouchProfileUpdate */

/** @param {string} query CSS media condition. @returns {boolean} Current matching state. */
function useMediaCondition(query) {
  const [matches, setMatches] = useState(() => window.matchMedia(query).matches);
  useEffect(() => {
    const mediaCondition = window.matchMedia(query);
    const updateCondition = () => setMatches(mediaCondition.matches);
    updateCondition();
    mediaCondition.addEventListener("change", updateCondition);
    return () => mediaCondition.removeEventListener("change", updateCondition);
  }, [query]);
  return matches;
}

/**
 * Keep a developer-approved local profile scoped to its game and orientation.
 * A stale profile is never shown while another game's settings are loading.
 * @param {TouchGameMetadata|null} game Catalog metadata containing optional touchControls.
 * @param {{orientation?: "portrait"|"landscape"}} [options]
 */
export default function useTouchProfile(game, { orientation: requestedOrientation } = {}) {
  const portrait = useMediaCondition("(orientation: portrait)");
  const touchDevice = useMediaCondition("(pointer: coarse)");
  const orientation = requestedOrientation || (portrait ? "portrait" : "landscape");
  const descriptor = game?.touchControls;
  const profileKey = descriptor ? `${game.id}:${orientation}` : null;
  const descriptorSignature = descriptor ? JSON.stringify(descriptor) : "";
  const [profileState, setProfileState] = useState({ key: null, profile: null, status: "" });
  const initialProfile = useMemo(() => descriptor ? loadTouchProfile(game.id, descriptor, orientation) : null,
    [game?.id, descriptorSignature, orientation]);

  useEffect(() => {
    if (!descriptor || !profileKey) return undefined;
    const loadedProfile = loadTouchProfile(game.id, descriptor, orientation);
    setProfileState({ key: profileKey, profile: loadedProfile, status: "" });
    return subscribeTouchProfile(game.id, descriptor, orientation, (profileUpdate) => {
      const updatedProfile = profileUpdate.profile || profileUpdate;
      setProfileState({ key: profileKey, profile: updatedProfile, status: "" });
    });
  }, [game?.id, descriptorSignature, orientation, profileKey]);

  /** @param {TouchProfileUpdate} nextProfile @param {TouchOrientation} [targetOrientation] */
  const saveProfile = useCallback((nextProfile, targetOrientation = orientation) => {
    if (!descriptor) return null;
    const currentProfile = loadTouchProfile(game.id, descriptor, targetOrientation);
    const requestedProfile = typeof nextProfile === "function" ? nextProfile(currentProfile) : nextProfile;
    const savedProfile = saveTouchProfile(game.id, descriptor, targetOrientation, requestedProfile);
    const orientationLabel = targetOrientation === "portrait" ? "Portrait" : "Landscape";
    let saveStatus = "Applied for this session. Device storage is unavailable.";
    if (savedProfile.persisted) {
      saveStatus = targetOrientation === orientation ? "Saved on this device" : `${orientationLabel} layout saved on this device`;
    }
    setProfileState({
      key: profileKey,
      profile: targetOrientation === orientation ? savedProfile.profile : loadTouchProfile(game.id, descriptor, orientation),
      status: saveStatus,
    });
    return savedProfile;
  }, [game?.id, descriptorSignature, orientation, profileKey]);

  const profile = profileState.key === profileKey ? profileState.profile || initialProfile : initialProfile;
  const enabled = Boolean(descriptor && profile && (profile.mode === "on" || (profile.mode === "auto" && touchDevice)));

  return {
    profile,
    orientation,
    touchDevice,
    enabled,
    expanded: Boolean(enabled && profile?.hideShell),
    saveProfile,
    status: profileState.key === profileKey ? profileState.status : "",
  };
}
