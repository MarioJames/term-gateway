export const TERM_FONT_STYLESHEET_PATH = "/assets/fonts/term-fonts.css";

export const TERM_FONT_FAMILY = "Sarasa Term SC Nerd";

const quoteFontFamily = (fontFamily: string): string => `"${fontFamily}"`;

export const TERM_FONT_STACK = [
  quoteFontFamily(TERM_FONT_FAMILY),
  "ui-monospace",
  '"SFMono-Regular"',
  "Menlo",
  "Consolas",
  '"Liberation Mono"',
  "monospace"
].join(", ");

export const TERM_XTERM_FONT_STACK = TERM_FONT_STACK;
