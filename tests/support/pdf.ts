import PDFDocument from "pdfkit";

/** Petit PDF pour les tests : du texte, ou rien (comme un PDF scanné). */
export function samplePdf(lines: string[]): Promise<Buffer> {
  const doc = new PDFDocument({ size: "A4" });
  const chunks: Buffer[] = [];
  doc.on("data", (c: Buffer) => chunks.push(c));
  const done = new Promise<Buffer>((resolve) =>
    doc.on("end", () => resolve(Buffer.concat(chunks))),
  );
  if (lines.length === 0) doc.rect(50, 50, 200, 100).fill("#999999");
  for (const l of lines) doc.fontSize(12).text(l);
  doc.end();
  return done;
}
