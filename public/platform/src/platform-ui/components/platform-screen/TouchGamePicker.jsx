import React, { useRef, useState } from "react";
import useCustomizableGames from "../../hooks/useCustomizableGames.js";
import PlatformDialog from "./PlatformDialog.jsx";
import styles from "./TouchControlSettings.module.scss";

/** Search developer-enabled games without fetching the full platform catalog. */
export default function TouchGamePicker({ selectedGameId, onSelect, onClose }) {
  const [searchText, setSearchText] = useState("");
  const [page, setPage] = useState(1);
  const searchRef = useRef(null);
  const { catalogPage, loading, offline } = useCustomizableGames(searchText, page);

  return (
    <PlatformDialog
      label="Choose a game for touch controls"
      title="Choose a game"
      description="Games appear here when their developers allow custom controls."
      eyebrow="Game controls"
      icon="sports_esports"
      onClose={onClose}
      initialFocusRef={searchRef}
    >
      <label className={styles.pickerSearch}>
        <span className="material-symbols-outlined" aria-hidden="true">search</span>
        <input
          ref={searchRef}
          value={searchText}
          onChange={(event) => { setSearchText(event.target.value); setPage(1); }}
          placeholder="Find a game"
          aria-label="Search games with customizable controls"
          maxLength={120}
        />
      </label>
      <div className={styles.pickerList} aria-busy={loading}>
        {loading && <p className={styles.emptyMessage}>Finding games…</p>}
        {!loading && catalogPage.games.map((game) => (
          <button className={styles.pickerGame} key={game.id} type="button" onClick={() => onSelect(game)} aria-pressed={game.id === selectedGameId}>
            {game.presentation?.coverUrl && <img src={game.presentation.coverUrl} alt="" loading="lazy" />}
            <span><strong>{game.name}</strong><small>{game.touchControls?.allowedPresets?.length || 0} layouts available</small></span>
            <span className="material-symbols-outlined" aria-hidden="true">{game.id === selectedGameId ? "check_circle" : "chevron_right"}</span>
          </button>
        ))}
        {!loading && !catalogPage.games.length && <p className={styles.emptyMessage}>{searchText ? "No matching games. Try a different search." : "No games with custom controls are available yet."}</p>}
      </div>
      <div className={styles.pickerPagination}>
        <button type="button" disabled={loading || catalogPage.page <= 1} onClick={() => setPage((current) => current - 1)} aria-label="Previous game page">Previous</button>
        <span>{catalogPage.page} / {catalogPage.totalPages}</span>
        <button type="button" disabled={loading || catalogPage.page >= catalogPage.totalPages} onClick={() => setPage((current) => current + 1)} aria-label="Next game page">Next</button>
      </div>
      {offline && <p className={styles.deviceNote}>Showing games available on this device.</p>}
    </PlatformDialog>
  );
}
