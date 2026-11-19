// Writes rendered A4 pages (.doc-page elements) into a PDF as real text and
// vector shapes rather than as pictures, so the text can be selected, searched
// and read by applicant tracking systems, and links stay clickable.
//
// The browser has already laid the pages out; this reads where every line of
// text, background and border ended up and draws the same in the PDF. Text
// uses the PDF's built-in fonts (Helvetica, Times, Courier for the app's sans,
// serif and mono), each line spaced to the width it has on screen, so nothing
// overlaps even where the metrics differ a little.
import jsPDF from 'jspdf';

const A4_WIDTH_MM = 210;
const A4_HEIGHT_MM = 297;
const PT_PER_MM = 72 / 25.4;

// The built-in PDF fonts cover WinAnsi: Latin-1 plus a few typographic marks.
// Anything else (arrows, emoji, other scripts) is drawn as a picture.
const WIN_ANSI_EXTRAS = '€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ';
const isWinAnsi = (ch: string) => {
  const code = ch.codePointAt(0)!;
  return (
    (code >= 0x20 && code <= 0x7e) ||
    (code >= 0xa0 && code <= 0xff) ||
    code === 0x0a ||
    code === 0x09 ||
    WIN_ANSI_EXTRAS.includes(ch)
  );
};

type Rgb = [number, number, number];

/** `rgb(…)`/`rgba(…)` as RGB, or null when fully transparent. */
function parseColor(css: string): Rgb | null {
  const m = /rgba?\(([^)]+)\)/.exec(css);
  if (!m) return null;
  const [r, g, b, a = '1'] = m[1].split(/[\s,/]+/).filter(Boolean);
  if (parseFloat(a) === 0) return null;
  return [parseFloat(r), parseFloat(g), parseFloat(b)];
}

function pdfFont(style: CSSStyleDeclaration): [string, string] {
  const family = style.fontFamily.toLowerCase();
  const name = /mono|consolas|courier|menlo/.test(family)
    ? 'courier'
    : /georgia|times|serif/.test(family) && !/sans-serif/.test(family)
      ? 'times'
      : 'helvetica';
  const bold = parseInt(style.fontWeight, 10) >= 600;
  const italic = style.fontStyle === 'italic';
  return [name, bold && italic ? 'bolditalic' : bold ? 'bold' : italic ? 'italic' : 'normal'];
}

interface Page {
  pdf: jsPDF;
  origin: DOMRect;
  /** mm per CSS pixel. */
  k: number;
}

const x = (p: Page, px: number) => (px - p.origin.left) * p.k;
const y = (p: Page, px: number) => (px - p.origin.top) * p.k;

function isHidden(style: CSSStyleDeclaration) {
  return style.display === 'none' || style.visibility === 'hidden' || parseFloat(style.opacity) === 0;
}

function drawBox(p: Page, el: Element, style: CSSStyleDeclaration) {
  const r = el.getBoundingClientRect();
  if (r.width === 0 || r.height === 0) return;
  const bg = parseColor(style.backgroundColor);
  if (bg) {
    p.pdf.setFillColor(...bg);
    const radius = parseFloat(style.borderTopLeftRadius) * p.k;
    if (radius > 0) p.pdf.roundedRect(x(p, r.left), y(p, r.top), r.width * p.k, r.height * p.k, radius, radius, 'F');
    else p.pdf.rect(x(p, r.left), y(p, r.top), r.width * p.k, r.height * p.k, 'F');
  }
  const sides = [
    ['Top', r.left, r.top, r.width, null],
    ['Bottom', r.left, r.bottom, r.width, null],
    ['Left', r.left, r.top, null, r.height],
    ['Right', r.right, r.top, null, r.height],
  ] as const;
  for (const [side, left, top, w, h] of sides) {
    const width = parseFloat(style.getPropertyValue(`border-${side.toLowerCase()}-width`));
    const color = parseColor(style.getPropertyValue(`border-${side.toLowerCase()}-color`));
    if (!width || !color || style.getPropertyValue(`border-${side.toLowerCase()}-style`) === 'none') continue;
    p.pdf.setFillColor(...color);
    const t = width * p.k;
    // Each border as a thin filled rectangle along its side, inside the box.
    const bx = side === 'Right' ? x(p, left) - t : x(p, left);
    const by = side === 'Bottom' ? y(p, top) - t : y(p, top);
    p.pdf.rect(bx, by, w === null ? t : w * p.k, h === null ? t : h * p.k, 'F');
  }
}

/** Writes one line of text at the place and width it has on screen. */
function drawLine(
  p: Page,
  text: string,
  left: number,
  top: number,
  width: number,
  height: number,
  style: CSSStyleDeclaration,
) {
  const [font, variant] = pdfFont(style);
  const fontSizeMm = parseFloat(style.fontSize) * p.k;
  p.pdf.setFont(font, variant);
  p.pdf.setFontSize(fontSizeMm * PT_PER_MM);
  p.pdf.setTextColor(...(parseColor(style.color) ?? [0, 0, 0]));
  const natural = p.pdf.getTextWidth(text);
  const target = width * p.k;
  // Spread (or tighten) the letters so the line has its on-screen width.
  const charSpace =
    text.length > 1
      ? Math.max(-0.3 * fontSizeMm, Math.min(0.5 * fontSizeMm, (target - natural) / (text.length - 1)))
      : 0;
  // The line box of the glyphs is roughly 80 % above and 20 % below the baseline.
  const baseline = y(p, top) + height * p.k * 0.8;
  p.pdf.text(text, x(p, left), baseline, { charSpace, baseline: 'alphabetic' });
}

interface Glyph {
  ch: string;
  left: number;
  right: number;
}

interface Line {
  glyphs: Glyph[];
  top: number;
  bottom: number;
}

/** Splits a text node into its rendered lines, with each character's horizontal place. */
function lines(node: Text, style: CSSStyleDeclaration): Line[] {
  const range = document.createRange();
  const out: Line[] = [];
  const collapse = !/^pre/.test(style.whiteSpace);
  const upper = style.textTransform === 'uppercase';
  const data = node.data;
  let current: Line | null = null;
  for (let i = 0; i < data.length; i++) {
    range.setStart(node, i);
    range.setEnd(node, i + 1);
    const rects = range.getClientRects();
    const rect = rects[rects.length - 1];
    const ch = data[i];
    // Collapsed or wrapped whitespace takes no room; it still separates words.
    if (!rect || rect.width === 0) {
      const last = current?.glyphs.at(-1);
      if (last && /\s/.test(ch) && last.ch !== ' ')
        current!.glyphs.push({ ch: ' ', left: last.right, right: last.right });
      continue;
    }
    const startsLine =
      !current || rect.top >= current.bottom - 1 || rect.left < (current.glyphs.at(-1)?.right ?? 0) - rect.width - 1;
    if (startsLine) {
      current = { glyphs: [], top: rect.top, bottom: rect.bottom };
      out.push(current);
    }
    const line = current!;
    if (collapse && /\s/.test(ch) && (line.glyphs.length === 0 || line.glyphs.at(-1)!.ch === ' ')) continue;
    line.glyphs.push({
      ch: collapse && /\s/.test(ch) ? ' ' : upper ? ch.toUpperCase() : ch,
      left: rect.left,
      right: rect.right,
    });
    line.top = Math.min(line.top, rect.top);
    line.bottom = Math.max(line.bottom, rect.bottom);
  }
  for (const line of out) while (line.glyphs.at(-1)?.ch === ' ') line.glyphs.pop();
  return out.filter((line) => line.glyphs.length > 0);
}

/**
 * Characters the PDF's fonts can't write (arrows, emoji) as a small picture of
 * themselves, drawn by the browser in the page's own font and colour.
 */
function drawGlyphImage(
  p: Page,
  text: string,
  left: number,
  top: number,
  width: number,
  height: number,
  style: CSSStyleDeclaration,
) {
  const scale = 6;
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.ceil(width * scale));
  canvas.height = Math.max(1, Math.ceil(height * scale));
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  ctx.scale(scale, scale);
  ctx.font = `${style.fontStyle} ${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
  ctx.fillStyle = style.color;
  ctx.textBaseline = 'alphabetic';
  ctx.fillText(text, 0, height * 0.8);
  p.pdf.addImage(canvas.toDataURL('image/png'), 'PNG', x(p, left), y(p, top), width * p.k, height * p.k);
}

/** Draws a line as runs of text, with any characters the fonts lack as pictures. */
function drawGlyphs(p: Page, line: Line, style: CSSStyleDeclaration) {
  let run: Glyph[] = [];
  const flush = () => {
    if (!run.length) return;
    const text = run.map((g) => g.ch).join('');
    const left = run[0].left;
    const width = run.at(-1)!.right - left;
    if (isWinAnsi(run[0].ch)) {
      if (text.trim()) drawLine(p, text, left, line.top, width, line.bottom - line.top, style);
    } else {
      drawGlyphImage(p, text, left, line.top, width, line.bottom - line.top, style);
    }
    run = [];
  };
  for (const glyph of line.glyphs) {
    if (run.length && isWinAnsi(run[0].ch) !== isWinAnsi(glyph.ch)) flush();
    run.push(glyph);
  }
  flush();
}

/** A `::before` marker such as a list item's dash, drawn where the element's first line starts. */
function drawBefore(p: Page, el: Element) {
  const before = getComputedStyle(el, '::before');
  const content = before.content;
  if (!content || content === 'none' || content === 'normal') return;
  const text = content.replace(/^["']|["']$/g, '');
  if (!text.trim()) return;
  // The marker sits on the element's first line of text.
  const range = document.createRange();
  range.selectNodeContents(el);
  const firstLine = range.getClientRects()[0];
  if (!firstLine) return;
  const left = el.getBoundingClientRect().left + (parseFloat(before.left) || 0);
  p.pdf.setFont(...pdfFont(before));
  p.pdf.setFontSize(parseFloat(before.fontSize) * p.k * PT_PER_MM);
  const width = p.pdf.getTextWidth(text) / p.k;
  drawLine(p, text, left, firstLine.top, width, firstLine.height, before);
}

function drawElement(p: Page, el: Element) {
  const style = getComputedStyle(el);
  if (isHidden(style)) return;
  drawBox(p, el, style);
  drawBefore(p, el);
  for (const child of el.childNodes) {
    if (child.nodeType === Node.TEXT_NODE) {
      for (const line of lines(child as Text, style)) drawGlyphs(p, line, style);
    } else if (child.nodeType === Node.ELEMENT_NODE) {
      drawElement(p, child as Element);
    }
  }
  if (el instanceof HTMLAnchorElement && el.href) {
    for (const r of el.getClientRects())
      p.pdf.link(x(p, r.left), y(p, r.top), r.width * p.k, r.height * p.k, { url: el.href });
  }
}

/** The pages, already laid out at A4 size, as a PDF with real text. */
export function pagesToTextPdf(pages: HTMLElement[]): Blob {
  const pdf = new jsPDF({ unit: 'mm', format: 'a4', compress: true });
  pages.forEach((page, i) => {
    if (i > 0) pdf.addPage();
    const origin = page.getBoundingClientRect();
    const p: Page = { pdf, origin, k: A4_WIDTH_MM / origin.width };
    // White paper first, in case the page itself has no background.
    pdf.setFillColor(255, 255, 255);
    pdf.rect(0, 0, A4_WIDTH_MM, A4_HEIGHT_MM, 'F');
    drawElement(p, page);
  });
  return pdf.output('blob');
}
