import React, { useEffect, useId, useRef, useState } from "react";
import classNames from "../../../utils/classNames.js";
import {
  BUILT_IN_PLATFORM_THEMES,
  PLATFORM_THEME_BACKGROUND_STYLES,
  PLATFORM_THEME_CARD_SHAPES,
  PLATFORM_THEME_DISC_STYLES,
  PLATFORM_THEME_FONTS,
  PLATFORM_THEME_MONO_FONTS,
  PLATFORM_THEME_ICON_STYLES,
  PLATFORM_THEME_ICON_WEIGHTS,
  PLATFORM_THEME_LIMITS,
  PLATFORM_THEME_PATTERNS,
  serializePlatformTheme,
} from "../../services/platformThemes.js";
import { prepareThemeBackgroundImage } from "../../services/themeBackgroundImage.js";
import { loadPlatformThemeFonts } from "../../hooks/usePlatformTheme.js";
import styles from "./ConfigPanel.module.scss";

/** @typedef {import("../../services/platformThemes.js").PlatformTheme} PlatformTheme */
/** @typedef {{ok:true,theme:PlatformTheme}|{ok:false,error:string}} ThemeChangeResult */
/** @typedef {{tone:"success"|"error",message:string}|null} ThemeStatus */

/**
 * A row of mutually exclusive choices drawn as one pill.
 * @param {{label:string,value:string,options:Record<string,string>,onChange:(value:string)=>void}} props
 * @returns {React.ReactElement}
 */
function SegmentedChoice({ label, value, options, onChange }) {
  return (
    <div className={styles.segmented} role="group" aria-label={label}>
      {Object.entries(options).map(([optionValue, optionLabel]) => (
        <button key={optionValue} type="button" aria-pressed={optionValue === value} onClick={() => onChange(optionValue)}>
          {optionLabel}
        </button>
      ))}
    </div>
  );
}

/**
 * One labelled customize row: the name on the left, its control on the right.
 * @param {{label:string,htmlFor?:string,children:React.ReactNode}} props
 * @returns {React.ReactElement}
 */
function CustomizeRow({ label, htmlFor, children }) {
  return (
    <div className={styles.customizeRow}>
      {htmlFor ? <label htmlFor={htmlFor}>{label}</label> : <span>{label}</span>}
      <div className={styles.customizeControl}>{children}</div>
    </div>
  );
}

/** @param {Record<string,{label:string}>} entries @returns {Record<string,string>} */
const readLabels = (entries) => Object.fromEntries(Object.entries(entries).map(([key, entry]) => [key, entry.label]));

/**
 * Edit the current theme's look. Every change saves as "My theme", which is
 * validated like an imported theme, so these controls can't make an unsafe
 * or unreadable theme.
 * @param {{theme:PlatformTheme,onCustomize:(changes:object)=>ThemeChangeResult,onReport:(status:ThemeStatus)=>void}} props
 * @returns {React.ReactElement}
 */
function ThemeCustomizer({ theme, onCustomize, onReport }) {
  const idPrefix = useId();
  const imageInputRef = useRef(null);
  const [preparingImage, setPreparingImage] = useState(false);

  function change(changes) {
    const result = onCustomize(changes);
    onReport(result.ok ? null : { tone: "error", message: result.error });
  }

  async function chooseBackgroundImage(event) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setPreparingImage(true);
    const prepared = await prepareThemeBackgroundImage(file);
    setPreparingImage(false);
    if (!prepared.ok) {
      onReport({ tone: "error", message: prepared.error });
      return;
    }
    change({ background: { style: "image", image: prepared.image, dim: Math.max(theme.background.dim, 0.35) } });
  }

  return (
    <div className={styles.customizer}>
      <CustomizeRow label="Accent" htmlFor={`${idPrefix}-accent`}>
        <input id={`${idPrefix}-accent`} type="color" className={styles.colorInput} value={theme.colors.accent} onChange={(event) => change({ colors: { accent: event.target.value } })} />
      </CustomizeRow>
      <CustomizeRow label="Base colour" htmlFor={`${idPrefix}-base`}>
        <input id={`${idPrefix}-base`} type="color" className={styles.colorInput} value={theme.colors.background} onChange={(event) => change({ colors: { background: event.target.value } })} />
      </CustomizeRow>
      <CustomizeRow label="Heading font" htmlFor={`${idPrefix}-heading`}>
        <select id={`${idPrefix}-heading`} className={styles.customizeSelect} value={theme.fonts.heading} onChange={(event) => change({ fonts: { heading: event.target.value } })}>
          {Object.entries(PLATFORM_THEME_FONTS).map(([fontId, font]) => <option key={fontId} value={fontId}>{font.label}</option>)}
        </select>
      </CustomizeRow>
      <CustomizeRow label="Body font" htmlFor={`${idPrefix}-body`}>
        <select id={`${idPrefix}-body`} className={styles.customizeSelect} value={theme.fonts.body} onChange={(event) => change({ fonts: { body: event.target.value } })}>
          {Object.entries(PLATFORM_THEME_FONTS).map(([fontId, font]) => <option key={fontId} value={fontId}>{font.label}</option>)}
        </select>
      </CustomizeRow>
      <CustomizeRow label="Mono font" htmlFor={`${idPrefix}-mono`}>
        <select id={`${idPrefix}-mono`} className={styles.customizeSelect} value={theme.fonts.mono} onChange={(event) => change({ fonts: { mono: event.target.value } })}>
          {Object.entries(PLATFORM_THEME_MONO_FONTS).map(([fontId, font]) => <option key={fontId} value={fontId}>{font.label}</option>)}
        </select>
      </CustomizeRow>
      <CustomizeRow label="Icons">
        <SegmentedChoice label="Icon style" value={theme.icons.style} options={readLabels(PLATFORM_THEME_ICON_STYLES)} onChange={(style) => change({ icons: { style } })} />
      </CustomizeRow>
      <CustomizeRow label="Icon weight" htmlFor={`${idPrefix}-weight`}>
        <select id={`${idPrefix}-weight`} className={styles.customizeSelect} value={theme.icons.weight} onChange={(event) => change({ icons: { weight: Number(event.target.value) } })}>
          {PLATFORM_THEME_ICON_WEIGHTS.map((weight) => <option key={weight} value={weight}>{weight === 400 ? "Regular" : weight < 400 ? `Light ${weight}` : `Bold ${weight}`}</option>)}
        </select>
        <label className={styles.inlineSwitch}>
          <input type="checkbox" checked={theme.icons.fill} onChange={(event) => change({ icons: { fill: event.target.checked } })} />
          Filled
        </label>
      </CustomizeRow>
      <CustomizeRow label="Card shape">
        <SegmentedChoice label="Card shape" value={theme.cards.shape} options={readLabels(PLATFORM_THEME_CARD_SHAPES)} onChange={(shape) => change({ cards: { shape } })} />
      </CustomizeRow>
      <CustomizeRow label="Disc style">
        <SegmentedChoice label="Disc style" value={theme.disc.style} options={PLATFORM_THEME_DISC_STYLES} onChange={(style) => change({ disc: { style } })} />
      </CustomizeRow>
      <CustomizeRow label="Corners" htmlFor={`${idPrefix}-radius`}>
        <input id={`${idPrefix}-radius`} type="range" className={styles.customizeRange} min="0" max="1.5" step="0.05" value={theme.radius} onChange={(event) => change({ radius: Number(event.target.value) })} />
      </CustomizeRow>
      <CustomizeRow label="Glass" htmlFor={`${idPrefix}-glass`}>
        <input id={`${idPrefix}-glass`} type="range" className={styles.customizeRange} min="0.3" max="0.95" step="0.01" value={theme.glass} onChange={(event) => change({ glass: Number(event.target.value) })} />
      </CustomizeRow>
      <CustomizeRow label="Background">
        <SegmentedChoice
          label="Background style"
          value={theme.background.style}
          options={PLATFORM_THEME_BACKGROUND_STYLES}
          onChange={(style) => (style === "image" && !theme.background.image ? imageInputRef.current?.click() : change({ background: { style } }))}
        />
      </CustomizeRow>
      {theme.background.style === "pattern" && (
        <CustomizeRow label="Pattern">
          <SegmentedChoice label="Pattern" value={theme.background.pattern} options={PLATFORM_THEME_PATTERNS} onChange={(pattern) => change({ background: { pattern } })} />
        </CustomizeRow>
      )}
      {theme.background.style === "image" && (
        <CustomizeRow label="Image">
          <button type="button" className={styles.quietAction} onClick={() => imageInputRef.current?.click()} disabled={preparingImage}>
            <span className="material-symbols-outlined" aria-hidden="true">image</span>{preparingImage ? "Preparing…" : "Choose image"}
          </button>
        </CustomizeRow>
      )}
      <CustomizeRow label="Dim" htmlFor={`${idPrefix}-dim`}>
        <input id={`${idPrefix}-dim`} type="range" className={styles.customizeRange} min="0" max="0.9" step="0.05" value={theme.background.dim} onChange={(event) => change({ background: { dim: Number(event.target.value) } })} />
      </CustomizeRow>
      <CustomizeRow label="Blur" htmlFor={`${idPrefix}-blur`}>
        <input id={`${idPrefix}-blur`} type="range" className={styles.customizeRange} min="0" max="24" step="1" value={theme.background.blur} onChange={(event) => change({ background: { blur: Number(event.target.value) } })} />
      </CustomizeRow>
      <input ref={imageInputRef} type="file" accept="image/png,image/jpeg,image/webp,image/gif,image/avif" hidden onChange={chooseBackgroundImage} />
      <p className={styles.customizeNote}>Changes save as “My theme” on this device. Images stay on this device and are embedded when you export.</p>
    </div>
  );
}

/**
 * Pick a platform theme, customize it, import one from a JSON file or pasted
 * text, export the current one, or remove an imported one. Imports and edits
 * are validated by the theme service; this component reports the outcome.
 * @param {{themes:PlatformTheme[],builtInCount:number,selectedTheme:PlatformTheme,onSelectTheme:(themeId:string)=>void,onImportTheme:(text:string)=>ThemeChangeResult,onCustomizeTheme:(changes:object)=>ThemeChangeResult,onRemoveTheme:(themeId:string)=>void}} props
 * @returns {React.ReactElement}
 */
export default function ThemeSettings({ themes, builtInCount, selectedTheme, onSelectTheme, onImportTheme, onCustomizeTheme, onRemoveTheme }) {
  const titleId = useId();
  const pasteId = useId();
  const customizeId = useId();
  const fileInputRef = useRef(null);
  const [pasteOpen, setPasteOpen] = useState(false);
  const [customizeOpen, setCustomizeOpen] = useState(false);
  const [pasteText, setPasteText] = useState("");
  /** @type {[ThemeStatus, React.Dispatch<React.SetStateAction<ThemeStatus>>]} */
  const [status, setStatus] = useState(null);

  // Tiles show each built-in theme's heading font.
  useEffect(() => {
    BUILT_IN_PLATFORM_THEMES.forEach(loadPlatformThemeFonts);
  }, []);

  function reportImport(result) {
    if (result.ok) {
      setStatus({ tone: "success", message: `Imported "${result.theme.name}".` });
      setPasteOpen(false);
      setPasteText("");
    } else {
      setStatus({ tone: "error", message: result.error });
    }
  }

  async function importThemeFile(event) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    if (file.size > PLATFORM_THEME_LIMITS.maxBytes) {
      setStatus({ tone: "error", message: "The theme file is too large (800 KB maximum)." });
      return;
    }
    reportImport(onImportTheme(await file.text()));
  }

  function exportSelectedTheme() {
    const fileName = `${selectedTheme.id}.kaboom-theme.json`;
    const fileUrl = URL.createObjectURL(new Blob([serializePlatformTheme(selectedTheme)], { type: "application/json" }));
    const link = document.createElement("a");
    link.href = fileUrl;
    link.download = fileName;
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(fileUrl), 1000);
    setStatus({ tone: "success", message: `Saved ${fileName}.` });
  }

  return (
    <section className={styles.settingsCard} aria-labelledby={titleId} data-settings-section="theme">
      <div className={styles.cardIntro}>
        <span className={classNames("material-symbols-outlined", styles.cardIcon)} aria-hidden="true">palette</span>
        <div>
          <h2 id={titleId}>Theme</h2>
          <p>Colours, fonts, icons, cards and background.</p>
        </div>
      </div>

      <div className={styles.themeGrid} role="group" aria-label="Platform themes">
        {themes.map((theme, index) => {
          const imported = index >= builtInCount;
          const swatch = {
            "--swatch-background": theme.colors.background,
            "--swatch-surface": theme.colors.surface,
            "--swatch-accent": theme.colors.accent,
            "--swatch-text": theme.colors.text,
            "--swatch-muted": theme.colors.textMuted,
            "--swatch-font": `"${PLATFORM_THEME_FONTS[theme.fonts.heading].family}", sans-serif`,
            "--swatch-radius": `${Math.round(7 * theme.radius)}px`,
            "--swatch-aspect": PLATFORM_THEME_CARD_SHAPES[theme.cards.shape].aspect,
            ...(theme.background.style === "image" && theme.background.image ? { "--swatch-image": `url("${theme.background.image}")` } : {}),
          };
          return (
            <div key={theme.id} className={styles.themeTileWrap}>
              <button
                type="button"
                className={styles.themeTile}
                aria-pressed={theme.id === selectedTheme.id}
                onClick={() => onSelectTheme(theme.id)}
                style={swatch}
              >
                <span className={styles.themeSwatch} data-background={theme.background.style} data-pattern={theme.background.pattern} aria-hidden="true">
                  <span className={styles.swatchPanel}><i /><i /></span>
                  <span className={styles.swatchCard} />
                  <span className={styles.swatchPill} />
                </span>
                <span className={styles.themeName}>{theme.name}</span>
                <span className={styles.themeMeta}>{imported ? `${theme.author === "You" ? "Yours" : "Imported"}${theme.author && theme.author !== "You" ? ` · ${theme.author}` : ""}` : "Built-in"}</span>
              </button>
              {imported && (
                <button
                  type="button"
                  className={styles.themeRemove}
                  aria-label={`Remove ${theme.name}`}
                  onClick={() => {
                    onRemoveTheme(theme.id);
                    setStatus({ tone: "success", message: `Removed "${theme.name}".` });
                  }}
                >
                  <span className="material-symbols-outlined" aria-hidden="true">close</span>
                </button>
              )}
            </div>
          );
        })}
      </div>

      <div className={styles.themeActions}>
        <button type="button" className={styles.quietAction} aria-expanded={customizeOpen} aria-controls={customizeId} onClick={() => setCustomizeOpen((open) => !open)}>
          <span className="material-symbols-outlined" aria-hidden="true">tune</span>Customize
        </button>
        <button type="button" className={styles.quietAction} onClick={() => fileInputRef.current?.click()}>
          <span className="material-symbols-outlined" aria-hidden="true">upload_file</span>Import file
        </button>
        <button type="button" className={styles.quietAction} aria-expanded={pasteOpen} aria-controls={pasteId} onClick={() => setPasteOpen((open) => !open)}>
          <span className="material-symbols-outlined" aria-hidden="true">data_object</span>Paste JSON
        </button>
        <button type="button" className={styles.quietAction} onClick={exportSelectedTheme}>
          <span className="material-symbols-outlined" aria-hidden="true">download</span>Export
        </button>
        <input ref={fileInputRef} type="file" accept="application/json,.json" hidden onChange={importThemeFile} />
      </div>

      {customizeOpen && (
        <div id={customizeId}>
          <ThemeCustomizer theme={selectedTheme} onCustomize={onCustomizeTheme} onReport={setStatus} />
        </div>
      )}

      {pasteOpen && (
        <div className={styles.themePaste} id={pasteId}>
          <textarea
            aria-label="Theme JSON"
            spellCheck={false}
            placeholder='{ "format": "kaboom-theme", "version": 2, ... }'
            value={pasteText}
            onChange={(event) => setPasteText(event.target.value)}
          />
          <button type="button" className={styles.applyAction} onClick={() => reportImport(onImportTheme(pasteText))} disabled={!pasteText.trim()}>
            Apply theme
          </button>
        </div>
      )}

      <p className={classNames(styles.themeStatus, status?.tone === "error" && styles.themeStatusError)} role="status">{status?.message ?? ""}</p>
    </section>
  );
}
