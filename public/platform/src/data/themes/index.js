import defaultTheme from "./default.json";
import neonNights from "./neon-nights.json";
import forestGrove from "./forest-grove.json";
import industrialAlloy from "./industrial-alloy.json";
import glassUi from "./glass-ui.json";

export const builtInThemes = [defaultTheme, neonNights, forestGrove, industrialAlloy, glassUi];

export function getThemeById(id) {
  return builtInThemes.find((theme) => theme.id === id) || null;
}
