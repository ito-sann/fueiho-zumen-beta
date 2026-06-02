/* =========================================================================
 * print.js — 提出用の印刷 / PDF 出力(ブラウザの「PDFに保存」を利用)。
 * 図枠・表題欄・求積表を組み立ててから window.print() を呼ぶ。
 * ========================================================================= */
(function (global) {
  'use strict';

  function tableHtml(title, table) {
    let rows = table.rows.map((r) =>
      `<tr><td>${escapeHtml(r.label)}</td><td>${r.expr}</td><td class="num">${r.area.toFixed(4)} ㎡</td></tr>`
    ).join('');
    return `
      <table class="kyuseki">
        <caption>${escapeHtml(title)}</caption>
        <thead><tr><th>区画</th><th>計算式</th><th>面積(㎡)</th></tr></thead>
        <tbody>${rows}</tbody>
        <tfoot><tr><td colspan="2">合計(総面積)</td><td class="num">${table.total.toFixed(2)} ㎡</td></tr></tfoot>
      </table>`;
  }

  function titleBlockHtml(project, drawingName) {
    const m = project.meta;
    return `
      <table class="titleblock">
        <tr><th>店舗名</th><td>${escapeHtml(m.storeName || '—')}</td>
            <th>図面名</th><td>${escapeHtml(drawingName)}</td></tr>
        <tr><th>所在地</th><td>${escapeHtml(m.address || '—')}</td>
            <th>縮尺</th><td>1/${m.scale}</td></tr>
        <tr><th>作成日</th><td>${escapeHtml(m.date || '—')}</td>
            <th>作成者</th><td>${escapeHtml(m.author || '—')}</td></tr>
      </table>`;
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => (
      { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
    ));
  }

  /* 現在の図面(レイヤー)を印刷する */
  function printCurrent(project, canvas) {
    const layer = global.Render.getLayer();
    const drawingName = global.Render.LAYERS[layer].label;
    const vis = global.Render.visibility(layer);

    const img = canvas.toDataURL('image/png');
    let tablesHtml = '';
    if (vis.table === 'all') {
      tablesHtml = tableHtml('営業所求積表', global.Geometry.buildTable(project, null));
    } else if (vis.table === 'kyakushitsu') {
      tablesHtml = tableHtml('客室求積表', global.Geometry.buildTable(project, ['kyakushitsu']));
    }

    const win = window.open('', '_blank');
    if (!win) {
      alert('ポップアップがブロックされました。ポップアップを許可してください。');
      return;
    }
    const landscape = project.meta.orientation === 'landscape';
    const size = project.meta.paper + (landscape ? ' landscape' : ' portrait');

    win.document.write(`<!DOCTYPE html><html lang="ja"><head><meta charset="utf-8">
<title>${escapeHtml(drawingName)} - ${escapeHtml(project.meta.storeName || '')}</title>
<style>
  @page { size: ${size}; margin: 8mm; }
  * { box-sizing: border-box; }
  body { font-family: -apple-system, "Hiragino Sans", sans-serif; margin: 0; color: #111; }
  .sheet { border: 2px solid #111; padding: 6mm; }
  .head { display: flex; justify-content: space-between; align-items: baseline; margin-bottom: 4mm; }
  .head h1 { font-size: 16pt; margin: 0; }
  .head .scale { font-size: 11pt; }
  .drawing { text-align: center; }
  .drawing img { max-width: 100%; max-height: 150mm; border: 1px solid #ccc; }
  .bottom { display: flex; gap: 6mm; margin-top: 4mm; align-items: flex-start; }
  table { border-collapse: collapse; font-size: 9pt; }
  .kyuseki { width: 100%; }
  .kyuseki caption { text-align: left; font-weight: bold; margin-bottom: 2mm; }
  .kyuseki th, .kyuseki td { border: 1px solid #333; padding: 2px 6px; }
  .kyuseki .num { text-align: right; }
  .kyuseki tfoot td { font-weight: bold; }
  .titleblock { width: 100%; }
  .titleblock th, .titleblock td { border: 1px solid #333; padding: 3px 6px; font-size: 9pt; }
  .titleblock th { background: #f2f2f2; white-space: nowrap; text-align: left; }
  @media print { .noprint { display: none; } }
  .noprint { text-align: center; padding: 8px; }
  .noprint button { font-size: 13px; padding: 6px 16px; cursor: pointer; }
</style></head><body>
<div class="noprint">
  <button onclick="window.print()">印刷 / PDFに保存</button>
  <button onclick="window.close()">閉じる</button>
</div>
<div class="sheet">
  <div class="head">
    <h1>${escapeHtml(drawingName)}</h1>
    <div class="scale">縮尺 1/${project.meta.scale}</div>
  </div>
  <div class="drawing"><img src="${img}"></div>
  <div class="bottom">
    <div style="flex:1">${tablesHtml}</div>
    <div style="flex:1">${titleBlockHtml(project, drawingName)}</div>
  </div>
</div>
</body></html>`);
    win.document.close();
  }

  global.Printer = { printCurrent };
})(window);
