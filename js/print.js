/* =========================================================================
 * print.js — 提出用の印刷 / PDF 出力(ブラウザの「PDFに保存」を利用)。
 * 図枠・表題欄・求積表を組み立ててから window.print() を呼ぶ。
 * 1枚ずつの出力(printCurrent)と、届出に必要な全図面の一括出力(printAll)。
 * ========================================================================= */
(function (global) {
  'use strict';

  function tableHtml(title, table) {
    let rows = table.rows.map((r) =>
      `<tr><td>${r.code}</td><td>${escapeHtml(r.label)}</td><td>${r.expr}</td><td class="num">${r.area.toFixed(4)} ㎡</td></tr>`
    ).join('');
    return `
      <table class="kyuseki">
        <caption>${escapeHtml(title)}</caption>
        <thead><tr><th>符号</th><th>区画</th><th>計算式</th><th>面積(㎡)</th></tr></thead>
        <tbody>${rows}</tbody>
        <tfoot><tr><td colspan="3">合計(総面積)</td><td class="num">${table.total.toFixed(2)} ㎡</td></tr></tfoot>
      </table>`;
  }

  /* 照明・音響設備一覧表(照明・音響設備図に添付) */
  function fixtureTableHtml(project) {
    const list = global.Geometry.fixtureSummary(project);
    let rows = list.map((g) =>
      `<tr><td>${escapeHtml(g.symbol)}</td><td>${escapeHtml(g.label)}</td><td class="num">${g.count}</td><td>${escapeHtml(g.watt || '—')}</td></tr>`
    ).join('');
    if (!rows) rows = '<tr><td colspan="4">設備なし</td></tr>';
    return `
      <table class="kyuseki">
        <caption>照明・音響設備一覧表</caption>
        <thead><tr><th>記号</th><th>設備</th><th>数量</th><th>W数</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>`;
  }

  /* 多角形の座標求積表(頂点番号は図面の P1, P2 … と対応) */
  function coordTablesHtml(project, filterTypes) {
    const polys = project.regions.filter((r) => r.shape === 'polygon' &&
      (!filterTypes || filterTypes.indexOf(r.type) >= 0));
    return polys.map((r) => {
      const c = global.Geometry.polygonCalc(r);
      const rows = c.rows.map((row) =>
        `<tr><td>P${row.no}</td><td class="num">${row.x.toFixed(2)}</td><td class="num">${row.y.toFixed(2)}</td>
         <td class="num">${row.dy.toFixed(2)}</td><td class="num">${row.prod.toFixed(4)}</td></tr>`).join('');
      return `
      <table class="kyuseki">
        <caption>座標求積表(${escapeHtml(r.label)})</caption>
        <thead><tr><th>点</th><th>X(m)</th><th>Y(m)</th><th>Y次−Y前</th><th>X×(Y次−Y前)</th></tr></thead>
        <tbody>${rows}</tbody>
        <tfoot>
          <tr><td colspan="4">倍面積</td><td class="num">${c.doubleArea.toFixed(4)}</td></tr>
          <tr><td colspan="4">面積(倍面積÷2)</td><td class="num">${c.area4.toFixed(4)} ㎡</td></tr>
        </tfoot>
      </table>`;
    }).join('');
  }

  /* レイヤーに応じた添付表のHTML */
  function tablesForLayer(project, layer) {
    const vis = global.Render.visibility(layer);
    if (vis.table === 'all') {
      return tableHtml('営業所求積表', global.Geometry.buildTable(project, null)) +
             coordTablesHtml(project, null);
    }
    if (vis.table === 'kyakuchubo') {
      return tableHtml('客室求積表', global.Geometry.buildTable(project, ['kyakushitsu'])) +
             tableHtml('調理場求積表', global.Geometry.buildTable(project, ['chubo'])) +
             coordTablesHtml(project, ['kyakushitsu', 'chubo']);
    }
    if (vis.table === 'fixtures') {
      return fixtureTableHtml(project);
    }
    return '';
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

  /* 1枚分の図面シート(図 + 求積表 + 表題欄) */
  function sheetHtml(project, layer, img) {
    const drawingName = global.Render.LAYERS[layer].label;
    return `
<div class="sheet">
  <div class="head">
    <h1>${escapeHtml(drawingName)}</h1>
    <div class="scale">縮尺 1/${project.meta.scale}</div>
  </div>
  <div class="drawing"><img src="${img}"></div>
  <div class="bottom">
    <div style="flex:1">${tablesForLayer(project, layer)}</div>
    <div style="flex:1">${titleBlockHtml(project, drawingName)}</div>
  </div>
</div>`;
  }

  /* 印刷用ウィンドウの共通ガワ */
  function openWindow(project, title, bodyHtml) {
    const win = window.open('', '_blank');
    if (!win) {
      alert('ポップアップがブロックされました。ポップアップを許可してください。');
      return null;
    }
    const landscape = project.meta.orientation === 'landscape';
    const size = project.meta.paper + (landscape ? ' landscape' : ' portrait');

    win.document.write(`<!DOCTYPE html><html lang="ja"><head><meta charset="utf-8">
<title>${escapeHtml(title)}</title>
<style>
  @page { size: ${size}; margin: 8mm; }
  * { box-sizing: border-box; }
  body { font-family: -apple-system, "Hiragino Sans", sans-serif; margin: 0; color: #111; }
  .sheet { border: 2px solid #111; padding: 6mm; break-after: page; page-break-after: always; }
  .sheet:last-child { break-after: auto; page-break-after: auto; }
  .head { display: flex; justify-content: space-between; align-items: baseline; margin-bottom: 4mm; }
  .head h1 { font-size: 16pt; margin: 0; }
  .head .scale { font-size: 11pt; }
  .drawing { text-align: center; }
  .drawing img { max-width: 100%; max-height: 145mm; border: 1px solid #ccc; }
  .bottom { display: flex; gap: 6mm; margin-top: 4mm; align-items: flex-start; }
  table { border-collapse: collapse; font-size: 9pt; }
  .kyuseki { width: 100%; margin-bottom: 3mm; }
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
${bodyHtml}
</body></html>`);
    win.document.close();
    return win;
  }

  /* 指定レイヤーをオフスクリーンの canvas に描画して画像にする。
   * Render のビュー・レイヤーは共有状態なので、描画後に元へ戻す。 */
  function renderLayerImage(project, layer, w, h) {
    const R = global.Render;
    const prevLayer = R.getLayer();
    const v = R.view;
    const prev = { zoom: v.zoom, offsetX: v.offsetX, offsetY: v.offsetY };

    const cv = document.createElement('canvas');
    cv.width = w; cv.height = h;
    const ctx = cv.getContext('2d');
    R.setLayer(layer);
    R.fitToView(project, cv);
    R.render(ctx, cv, project, { selectedId: null });

    R.setLayer(prevLayer);
    v.zoom = prev.zoom; v.offsetX = prev.offsetX; v.offsetY = prev.offsetY;
    return cv.toDataURL('image/png');
  }

  /* 現在の図面(レイヤー)を印刷する */
  function printCurrent(project, canvas) {
    const layer = global.Render.getLayer();
    const drawingName = global.Render.LAYERS[layer].label;
    const img = canvas.toDataURL('image/png');
    const title = `${drawingName} - ${project.meta.storeName || ''}`;
    openWindow(project, title, sheetHtml(project, layer, img));
  }

  /* 届出に必要な全図面(平面図・営業所求積図・客室・調理場求積図・照明音響設備図)を
   * 1ファイルにまとめて出力する。1レイヤー = 1ページ。 */
  function printAll(project) {
    const layers = Object.keys(global.Render.LAYERS);
    const body = layers
      .map((layer) => sheetHtml(project, layer, renderLayerImage(project, layer, 1600, 1100)))
      .join('\n');
    const title = `図面一式 - ${project.meta.storeName || ''}`;
    openWindow(project, title, body);
  }

  global.Printer = { printCurrent, printAll };
})(window);
