/** Fontsource's Latin and Cyrillic files are subsets, not fallback fonts. */
export function pdfTextWidth(
  pdf: PDFKit.PDFDocument,
  value: string,
  size: number,
  bold = false,
): number {
  return runs(value, bold).reduce(
    (width, run) => width + pdf.font(run.font).fontSize(size).widthOfString(run.text),
    0,
  );
}
export function pdfTextLine(
  pdf: PDFKit.PDFDocument,
  value: string,
  x: number,
  y: number,
  size: number,
  color: string,
  bold = false,
) {
  for (const run of runs(value, bold)) {
    pdf.font(run.font).fontSize(size).fillColor(color).text(run.text, x, y, { lineBreak: false });
    x += pdf.widthOfString(run.text);
  }
}
export function pdfWrappedLines(
  pdf: PDFKit.PDFDocument,
  value: string,
  width: number,
  size: number,
  bold = false,
): string[] {
  const lines: string[] = [];
  for (const paragraph of value.split(/\r?\n/u)) {
    let line = '';
    for (const word of paragraph.split(/\s+/u)) {
      if (!word) continue;
      const joined = line ? `${line} ${word}` : word;
      if (pdfTextWidth(pdf, joined, size, bold) <= width) {
        line = joined;
        continue;
      }
      if (line) {
        lines.push(line);
        line = '';
      }
      for (const character of word) {
        if (line && pdfTextWidth(pdf, line + character, size, bold) > width) {
          lines.push(line);
          line = '';
        }
        line += character;
      }
    }
    lines.push(line);
  }
  return lines;
}
function runs(value: string, bold: boolean) {
  return value
    .split(/([\u0400-\u04ff]+)/u)
    .filter(Boolean)
    .map((text) => ({
      text,
      font: /[\u0400-\u04ff]/u.test(text)
        ? bold
          ? 'VistaCyrillicBold'
          : 'VistaCyrillic'
        : bold
          ? 'VistaLatinBold'
          : 'VistaLatin',
    }));
}
