/** The visitor's colour theme: their device's setting, or a fixed choice. */
export type ThemeChoice = "system" | "light" | "dark";

export const THEME_STORAGE_KEY = "buzz-board-theme";

/**
 * Set on <html> by the toggle: this page's choice. It outlives the toggle
 * across client navigations and works when storage is blocked.
 */
export const THEME_CHOICE_ATTRIBUTE = "data-theme-choice";

/**
 * Runs in <head> before the page paints, so the page never flashes the
 * wrong theme. Keep it tiny and dependency-free. It also follows device
 * theme changes for the whole page lifetime, whether or not a toggle is
 * mounted, using the in-page choice first and storage (if readable) second.
 */
export const THEME_INIT_SCRIPT = `(function(){var r=document.documentElement,m=null;try{m=window.matchMedia("(prefers-color-scheme: dark)")}catch(e){}function a(){var c=r.getAttribute("${THEME_CHOICE_ATTRIBUTE}");if(!c){try{c=localStorage.getItem("${THEME_STORAGE_KEY}")}catch(e){}}r.classList.toggle("dark",c==="dark"||(c!=="light"&&!!m&&m.matches))}a();try{m&&m.addEventListener("change",a)}catch(e){}})();`;

export function resolveDark(choice: ThemeChoice, systemDark: boolean) {
  return choice === "dark" || (choice === "system" && systemDark);
}
