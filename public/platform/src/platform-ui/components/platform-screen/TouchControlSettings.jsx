import React, { useEffect, useState } from "react";
import useCustomizableGames from "../../hooks/useCustomizableGames.js";
import useTouchProfile from "../../hooks/useTouchProfile.js";
import { TouchLayoutEditor, TouchLayoutPreview } from "../touch-controls/index.js";
import TouchGamePicker from "./TouchGamePicker.jsx";
import styles from "./TouchControlSettings.module.scss";

const PRESET_DETAILS = Object.freeze({
  "two-thumb": { title: "Two thumbs", description: "Thumbs handle movement and actions", fingers: "2" },
  "three-finger": { title: "Three fingers", description: "One index finger for actions", fingers: "3" },
  "four-finger": { title: "Four fingers", description: "Both index fingers for actions", fingers: "4" },
});

/** Configure only opted-in games, with a shared visual editor and device-local saves. */
export default function TouchControlSettings({ onDialogChange }) {
  const { catalogPage, loading } = useCustomizableGames();
  const [chosenGame, setChosenGame] = useState(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [editorOpen, setEditorOpen] = useState(false);
  const [previewOrientation, setPreviewOrientation] = useState("landscape");
  const game = chosenGame || catalogPage.games[0] || null;
  const { profile, saveProfile, status } = useTouchProfile(game, { orientation: previewOrientation });

  useEffect(() => { setEditorOpen(false); }, [game?.id, previewOrientation]);
  useEffect(() => {
    onDialogChange?.(pickerOpen || editorOpen);
    return () => onDialogChange?.(false);
  }, [pickerOpen, editorOpen, onDialogChange]);

  function selectGame(nextGame) {
    setChosenGame(nextGame);
    setPickerOpen(false);
  }

  function updatePreferences(changes) {
    saveProfile((currentProfile) => ({ ...currentProfile, ...changes }));
  }

  return (
    <section className={styles.settingsSection} aria-labelledby="touch-settings-title">
      <div className={styles.sectionIntro}>
        <span className={styles.sectionNumber}>01</span>
        <h2 id="touch-settings-title">Game controls</h2>
        <p>Adjust controls for each game.</p>
        <span className={styles.deviceNote}><span className="material-symbols-outlined" aria-hidden="true">devices</span>This device</span>
      </div>
      <div className={styles.settingsBody}>
        <div className={styles.gameRow}>
          <div className={styles.selectedGame}>
            {game?.presentation?.coverUrl && <img src={game.presentation.coverUrl} alt="" />}
            <div><small>Game</small><strong>{game?.name || (loading ? "Loading games…" : "No supported games")}</strong></div>
          </div>
          <button type="button" className={styles.quietButton} onClick={() => setPickerOpen(true)} aria-label="Choose game for touch controls">Change game<span className="material-symbols-outlined" aria-hidden="true">expand_more</span></button>
        </div>
        {game?.touchControls?.customizable && profile ? (
          <div className={styles.workspace}>
            <div className={styles.preferences}>
              <fieldset className={styles.presets} style={{ "--touch-preset-count": game.touchControls.allowedPresets.length }}>
                <legend>Layout type</legend>
                {game.touchControls.allowedPresets.map((presetId) => (
                  <button key={presetId} type="button" className={styles.presetButton} aria-pressed={profile.presetId === presetId} onClick={() => updatePreferences({ presetId })}>
                    <span className={styles.presetFingers}>{PRESET_DETAILS[presetId].fingers}<span className="material-symbols-outlined" aria-hidden="true">touch_app</span></span>
                    <strong>{PRESET_DETAILS[presetId].title}</strong>
                    <small>{PRESET_DETAILS[presetId].description}</small>
                  </button>
                ))}
              </fieldset>
              <div className={styles.preferenceRow}>
                <div><label htmlFor="touch-control-mode">Show touch controls</label><p>Automatic shows controls on touch devices.</p></div>
                <select id="touch-control-mode" value={profile.mode} onChange={(event) => updatePreferences({ mode: event.target.value })}>
                  <option value="auto">Automatic</option><option value="on">Always</option><option value="off">Off</option>
                </select>
              </div>
              <div className={styles.preferenceRow}>
                <div><label htmlFor="touch-expanded">Expanded play area</label><p>Use the full play area without the console frame.</p></div>
                <input id="touch-expanded" className={styles.switch} type="checkbox" checked={profile.hideShell} onChange={(event) => updatePreferences({ hideShell: event.target.checked })} />
              </div>
              <p className={styles.saveStatus} role="status">{status || `${previewOrientation === "landscape" ? "Landscape" : "Portrait"} settings · Portrait and landscape save separately`}</p>
            </div>
            <aside className={styles.previewColumn} aria-label="Touch layout preview">
              <div className={styles.previewHeader}>
                <div className={styles.orientationTabs} role="group" aria-label="Layout orientation">
                  <button type="button" onClick={() => setPreviewOrientation("landscape")} aria-pressed={previewOrientation === "landscape"}>Landscape</button>
                  <button type="button" onClick={() => setPreviewOrientation("portrait")} aria-pressed={previewOrientation === "portrait"}>Portrait</button>
                </div>
                <button type="button" className={styles.editButton} onClick={() => setEditorOpen(true)}><span className="material-symbols-outlined" aria-hidden="true">edit</span>Edit layout</button>
              </div>
              <div className={styles.previewFrame}><TouchLayoutPreview game={game} profile={profile} orientation={previewOrientation} /></div>
            </aside>
          </div>
        ) : <p className={styles.emptyMessage}>{loading ? "Loading control settings…" : "Custom layouts are available for games that allow control editing."}</p>}
      </div>
      {pickerOpen && <TouchGamePicker selectedGameId={game?.id} onSelect={selectGame} onClose={() => setPickerOpen(false)} />}
      {editorOpen && game && profile && <TouchLayoutEditor game={game} profile={profile} orientation={previewOrientation} inGame={false} onCancel={() => setEditorOpen(false)} onSave={(nextProfile) => { saveProfile(nextProfile); setEditorOpen(false); }} />}
    </section>
  );
}
