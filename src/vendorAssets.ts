import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

const VENDOR_ASSETS = new Map<string, string>([
  ["/assets/vendor/xterm/xterm.css", require.resolve("xterm/css/xterm.css")],
  ["/assets/vendor/xterm/xterm.js", require.resolve("xterm/lib/xterm.js")],
  ["/assets/vendor/xterm/addon-fit.js", require.resolve("@xterm/addon-fit/lib/addon-fit.js")]
]);

export const XTERM_STYLESHEET_PATH = "/assets/vendor/xterm/xterm.css";
export const XTERM_SCRIPT_PATH = "/assets/vendor/xterm/xterm.js";
export const XTERM_FIT_ADDON_SCRIPT_PATH = "/assets/vendor/xterm/addon-fit.js";

export function resolveVendorAssetPath(pathname: string): string | null {
  return VENDOR_ASSETS.get(pathname) ?? null;
}
