export const TERM_FONT_STYLESHEET_PATH = "/assets/fonts/term-fonts.css";

export const TERM_PRIMARY_FONT_FAMILY = "JetBrains Mono";
export const TERM_SYMBOL_FONT_FAMILY = "Symbols Nerd Font Mono";
export const TERM_CJK_FONT_FAMILY = "Sarasa Mono SC";

const quoteFontFamily = (fontFamily: string): string => `"${fontFamily}"`;

export const TERM_FONT_STACK = [
  quoteFontFamily(TERM_PRIMARY_FONT_FAMILY),
  quoteFontFamily(TERM_SYMBOL_FONT_FAMILY),
  quoteFontFamily(TERM_CJK_FONT_FAMILY),
  "monospace"
].join(", ");

export const TERM_XTERM_FONT_STACK = TERM_FONT_STACK;
