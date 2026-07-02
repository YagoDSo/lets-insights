// Port fiel do repairJSON() dos nós "Parse" do WF-02.
// Limpa aspas tipográficas, travessões, reticências e caracteres de controle,
// e escapa aspas internas não escapadas linha a linha, antes do JSON.parse.
export function repairJSON(str) {
  let s = str.replace(/```json/g, '').replace(/```/g, '').trim();
  s = s.replace(/[“”„‟]/g, "'");
  s = s.replace(/[‘’‚‛]/g, "'");
  s = s.replace(/[–—―]/g, '-');
  s = s.replace(/…/g, '...');
  // eslint-disable-next-line no-control-regex
  s = s.replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, '');
  const lines = s.split('\n');
  const fixed = lines.map((line) => {
    const m = line.match(/^(\s*"[^"]*"\s*:\s*)"(.*)"(\s*,?\s*)$/);
    if (m) {
      const value = m[2].replace(/(?<!\\)"/g, '\\"');
      return m[1] + '"' + value + '"' + m[3];
    }
    return line;
  });
  return fixed.join('\n');
}
