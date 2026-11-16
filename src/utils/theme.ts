/** The visitor's colour theme: their device's setting, or a fixed choice. */
export type ThemeChoice = "system" | "light" | "dark";

export const THEME_STORAGE_KEY = "buzz-board-theme";

/**
 * Runs in <head> before the page paints, so the page never flashes the
 * wrong theme. Keep it tiny and dependency-free. Storage is read in its own
 * try so a blocked localStorage still follows the device setting.
 */
export const THEME_INIT_SCRIPT = `(function(){var c=null;try{c=localStorage.getItem("${THEME_STORAGE_KEY}")}catch(e){}try{var d=c==="dark"||(c!=="light"&&window.matchMedia("(prefers-color-scheme: dark)").matches);document.documentElement.classList.toggle("dark",d)}catch(e){}})();`;

export function resolveDark(choice: ThemeChoice, systemDark: boolean) {
  return choice === "dark" || (choice === "system" && systemDark);
}
