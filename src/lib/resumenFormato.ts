// Resalta el nombre del capítulo ("Etiqueta: contenido. Otra etiqueta: contenido.") en el resumen
// del Informe Semanal / reporte Súper compacto — pedido del usuario (2026-09-05): los nombres de
// capítulo deben distinguirse del resto. Una etiqueta = principio de oración + hasta ~60 caracteres
// sin ':' + ": ". Sin lookbehind (Safari viejo). La misma regex alimenta el PDF (runs de pdfmake)
// y el editor (HTML con <strong>), para que no se desincronicen.

const ETIQUETA_RE = /(^|[.?!…]\s+)([\p{Lu}][^:\n]{1,60}?:)(\s)/gu;

/** Runs `{ text, bold? }` listos para el `text` de pdfmake. */
export function resumenARuns(texto: string): Array<{ text: string; bold?: boolean }> {
  const runs: Array<{ text: string; bold?: boolean }> = [];
  let ultimo = 0;
  for (const m of texto.matchAll(ETIQUETA_RE)) {
    const inicioEtiqueta = (m.index ?? 0) + m[1].length;
    if (inicioEtiqueta > ultimo) runs.push({ text: texto.slice(ultimo, inicioEtiqueta) });
    runs.push({ text: m[2], bold: true });
    runs.push({ text: m[3] });
    ultimo = inicioEtiqueta + m[2].length + m[3].length;
  }
  if (ultimo < texto.length) runs.push({ text: texto.slice(ultimo) });
  return runs.length ? runs : [{ text: texto }];
}

/** HTML con las etiquetas en `<strong>` — para el div `contentEditable` del editor. Escapa el
 * texto primero. */
export function resumenAHtml(texto: string): string {
  const esc = texto.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return esc.replace(ETIQUETA_RE, (_m, pre, etiqueta, post) => `${pre}<strong>${etiqueta}</strong>${post}`);
}
