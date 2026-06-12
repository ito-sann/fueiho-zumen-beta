/* =========================================================================
 * forms.js — 深夜酒類提供飲食店営業開始届出(風営法33条)に添付する
 * 書類の下書きを生成・印刷するモジュール。
 *   1ページ目: 営業開始届出書(様式第47号に準拠した下書き)
 *   2ページ目: 営業の方法(様式第48号に準拠した下書き)
 * window.open で新しいウィンドウを開き、A4縦・各1ページで組み立てる。
 * 値は contenteditable で手修正できる。印刷は print.js と同様に
 * ブラウザの「印刷 / PDFに保存」を利用する。
 * ========================================================================= */
(function (global) {
  'use strict';

  /* HTMLエスケープ(print.js と同じ実装) */
  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => (
      { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
    ));
  }

  /* 編集可能フィールド(下線付き contenteditable)を生成する。
   * value     … 初期値(空でもよい)
   * minWidth  … 最低幅(mm 単位の文字列など)。未指定なら 30mm。 */
  function fill(value, minWidth) {
    const w = minWidth || '30mm';
    return `<span class="fill" contenteditable="true" style="min-width:${w}">${escapeHtml(value || '')}</span>`;
  }

  /* 今日の日付を「令和○年○月○日」形式で返す(届出年月日の初期値用) */
  function todayWareki() {
    const d = new Date();
    const y = d.getFullYear();
    // 令和元年 = 2019年。それ以前の日付は西暦のまま表記する。
    if (y >= 2019) {
      const r = y - 2018;
      return `令和${r === 1 ? '元' : r}年${d.getMonth() + 1}月${d.getDate()}日`;
    }
    return `${y}年${d.getMonth() + 1}月${d.getDate()}日`;
  }

  /* 客室数(type === 'kyakushitsu' の区画数)を数える */
  function countKyakushitsu(project) {
    return project.regions.filter((r) => r.type === 'kyakushitsu').length;
  }

  /* 各客室の床面積を「客室1: 9.72㎡」形式で列挙する */
  function kyakushitsuListText(project) {
    const table = global.Geometry.buildTable(project, ['kyakushitsu']);
    return table.rows.map((r) => `${r.label}: ${r.area.toFixed(2)}㎡`).join('、');
  }

  /* fixtures を指定した kind 群で絞り込み、種類ごとに
   * 「ダウンライト×4(60W)」のように集計した文字列を返す。
   * watt は空でない値を重複なく集めて併記する。該当なしなら空文字。 */
  function fixtureSummaryText(project, kinds) {
    const catalog = global.Model.FIXTURE_CATALOG;
    // kind → { count, watts(Set) } の集計
    const agg = {};
    for (const x of project.fixtures) {
      if (kinds.indexOf(x.kind) < 0) continue;
      if (!agg[x.kind]) agg[x.kind] = { count: 0, watts: [] };
      agg[x.kind].count++;
      const w = String(x.watt || '').trim();
      if (w && agg[x.kind].watts.indexOf(w) < 0) agg[x.kind].watts.push(w);
    }
    const parts = [];
    for (const kind of kinds) {
      const a = agg[kind];
      if (!a) continue;
      const label = (catalog[kind] || {}).label || kind;
      let text = `${label}×${a.count}`;
      if (a.watts.length) text += `(${a.watts.join('・')}W)`;
      parts.push(text);
    }
    return parts.join('、');
  }

  /* ---------------------------------------------------------------------
   * 1ページ目: 深夜における酒類提供飲食店営業営業開始届出書(様式第47号)
   * ------------------------------------------------------------------- */
  function form47Html(project) {
    const m = project.meta;
    const sum = global.Geometry.summary(project);

    // 音響設備(スピーカー・モニター・カラオケ)とそれ以外(=照明)に分けて集計する。
    // 照明はカタログから自動で拾うので、種類を追加してもここの修正は不要。
    const soundKinds = ['speaker', 'monitor', 'karaoke'];
    const lightKinds = Object.keys(global.Model.FIXTURE_CATALOG)
      .filter((k) => soundKinds.indexOf(k) < 0);
    const lighting = fixtureSummaryText(project, lightKinds);
    const sound = fixtureSummaryText(project, soundKinds);

    return `
<section class="page">
  <h1>深夜における酒類提供飲食店営業営業開始届出書</h1>

  <p class="addressee">${fill('', '20mm')}公安委員会 殿</p>
  <p class="date-line">届出年月日 ${fill(todayWareki(), '40mm')}</p>

  <div class="todokede-sha">
    <p class="todokede-title">届出者</p>
    <p>住　所 ${fill('', '90mm')}</p>
    <p>氏　名（法人にあっては名称及び代表者の氏名） ${fill('', '60mm')}</p>
    <p>電話番号 ${fill('', '50mm')}</p>
  </div>

  <p class="honbun">　風俗営業等の規制及び業務の適正化等に関する法律第33条第1項の規定により、深夜において酒類提供飲食店営業を営みたいので、次のとおり届出をします。</p>

  <table class="form-table">
    <tr>
      <th>営業所の名称<br><span class="small">（ふりがな）</span></th>
      <td>
        ${fill(m.storeName, '70mm')}<br>
        <span class="small">ふりがな: ${fill('', '70mm')}</span>
      </td>
    </tr>
    <tr>
      <th>営業所の所在地</th>
      <td>${fill(m.address, '100mm')}</td>
    </tr>
    <tr>
      <th>建物の構造</th>
      <td>${fill('', '100mm')}<br><span class="small">（例: 鉄筋コンクリート造○階建○階部分）</span></td>
    </tr>
    <tr>
      <th>建物内の営業所の位置</th>
      <td>${fill('', '100mm')}</td>
    </tr>
    <tr>
      <th>客室数</th>
      <td>${fill(String(countKyakushitsu(project)), '15mm')} 室</td>
    </tr>
    <tr>
      <th>営業所の床面積</th>
      <td>${fill(sum.premises.toFixed(2), '25mm')} ㎡</td>
    </tr>
    <tr>
      <th>客室の総床面積</th>
      <td>${fill(sum.kyakushitsu.toFixed(2), '25mm')} ㎡</td>
    </tr>
    <tr>
      <th>各客室の床面積</th>
      <td>${fill(kyakushitsuListText(project), '100mm')}</td>
    </tr>
    <tr>
      <th>照明設備の概要</th>
      <td>${fill(lighting, '100mm')}</td>
    </tr>
    <tr>
      <th>音響設備の概要</th>
      <td>${fill(sound, '100mm')}</td>
    </tr>
    <tr>
      <th>飲食店営業許可</th>
      <td>
        許可年月日: ${fill('', '40mm')}<br>
        許可番号: ${fill('', '40mm')}
      </td>
    </tr>
  </table>
</section>`;
  }

  /* ---------------------------------------------------------------------
   * 2ページ目: 営業の方法(様式第48号)
   * ------------------------------------------------------------------- */
  function form48Html(project) {
    const m = project.meta;

    // 主な提供飲食物の表(初期は空行4行)
    let menuRows = '';
    for (let i = 0; i < 4; i++) {
      menuRows += `<tr><td>${fill('', '60mm')}</td><td>${fill('', '40mm')}</td></tr>`;
    }

    return `
<section class="page">
  <h1>営業の方法</h1>

  <table class="form-table">
    <tr>
      <th>営業所の名称</th>
      <td>${fill(m.storeName, '90mm')}</td>
    </tr>
    <tr>
      <th>営業所の所在地</th>
      <td>${fill(m.address, '100mm')}</td>
    </tr>
    <tr>
      <th>営業時間</th>
      <td>${fill('午後6時から翌日午前2時まで', '90mm')}</td>
    </tr>
    <tr>
      <th>酒類の提供方法</th>
      <td>${fill('客の注文により座席で提供する', '100mm')}</td>
    </tr>
    <tr>
      <th>18歳未満の者の立入りに関する事項</th>
      <td>${fill('18歳未満の者は午後10時以降立ち入らせない', '100mm')}</td>
    </tr>
    <tr>
      <th>当該営業に従事する者の数</th>
      <td>${fill('', '15mm')} 名</td>
    </tr>
    <tr>
      <th>主な提供飲食物とその料金</th>
      <td class="menu-cell">
        <table class="menu-table">
          <thead><tr><th>品名</th><th>料金</th></tr></thead>
          <tbody>${menuRows}</tbody>
        </table>
      </td>
    </tr>
    <tr>
      <th>その他営業の方法に関し必要な事項</th>
      <td>${fill('', '100mm')}</td>
    </tr>
  </table>
</section>`;
  }

  /* ---------------------------------------------------------------------
   * 届出書一式を新しいウィンドウで開く(公開API)
   * ------------------------------------------------------------------- */
  function openForms(project) {
    const win = window.open('', '_blank');
    if (!win) {
      alert('ポップアップがブロックされました。ポップアップを許可してください。');
      return;
    }

    win.document.write(`<!DOCTYPE html><html lang="ja"><head><meta charset="utf-8">
<title>届出書類 - ${escapeHtml(project.meta.storeName || '')}</title>
<style>
  /* A4縦・余白15mmで各様式を1ページに収める */
  @page { size: A4 portrait; margin: 15mm; }
  * { box-sizing: border-box; }
  body {
    font-family: "Hiragino Mincho ProN", "Yu Mincho", "MS Mincho", serif;
    margin: 0; color: #000; font-size: 10.5pt; line-height: 1.7;
  }
  /* 各様式 = 1ページ。改ページで区切る */
  .page { page-break-after: always; break-after: page; padding: 4mm 0; }
  .page:last-of-type { page-break-after: auto; break-after: auto; }
  h1 { text-align: center; font-size: 14pt; font-weight: bold; margin: 0 0 8mm; letter-spacing: 2px; }
  .addressee { font-size: 11pt; margin: 0 0 2mm; }
  .date-line { text-align: right; margin: 0 0 2mm; }
  .todokede-sha { margin: 0 0 4mm 50%; }
  .todokede-sha p { margin: 1mm 0; }
  .todokede-title { font-weight: bold; }
  .honbun { margin: 0 0 5mm; text-indent: 0; }
  .small { font-size: 8pt; color: #333; }
  /* 黒罫線の様式表 */
  .form-table { width: 100%; border-collapse: collapse; }
  .form-table th, .form-table td { border: 1px solid #000; padding: 2mm 3mm; vertical-align: top; }
  .form-table th { width: 32%; font-weight: normal; text-align: left; background: #fff; }
  .menu-cell { padding: 0; }
  .menu-table { width: 100%; border-collapse: collapse; }
  .menu-table th, .menu-table td { border: 1px solid #000; padding: 1.5mm 3mm; }
  .menu-table th { text-align: center; font-weight: normal; }
  .menu-table tr > *:first-child { border-left: none; }
  .menu-table tr > *:last-child { border-right: none; }
  .menu-table thead th { border-top: none; }
  .menu-table tbody tr:last-child td { border-bottom: none; }
  /* 編集可能フィールド: 画面では薄い背景 + 下線、印刷では下線のみ残す */
  .fill {
    display: inline-block; min-height: 1.4em;
    border-bottom: 1px solid #000; background: #fdf6dc;
    padding: 0 1mm; vertical-align: bottom;
  }
  .fill:focus { outline: 1px dashed #888; background: #fff3c0; }
  /* 画面上部の操作ボタンと注意書き(印刷時は非表示) */
  .noprint { text-align: center; padding: 8px; font-family: -apple-system, "Hiragino Sans", sans-serif; }
  .noprint button { font-size: 13px; padding: 6px 16px; cursor: pointer; }
  .notice {
    margin: 6px auto 10px; max-width: 180mm; padding: 6px 10px;
    border: 1px solid #c00; color: #c00; font-size: 12px; text-align: left;
  }
  @media print {
    .noprint { display: none; }
    .fill { background: transparent; }
  }
</style></head><body>
<div class="noprint">
  <div class="notice">本書式は様式第47号・第48号に準拠した下書きです。提出先の警察署・都道府県警の最新様式を必ず確認してください。下線部はクリックして直接編集できます。</div>
  <button onclick="window.print()">印刷 / PDFに保存</button>
  <button onclick="window.close()">閉じる</button>
</div>
${form47Html(project)}
${form48Html(project)}
</body></html>`);
    win.document.close();
  }

  global.Forms = { openForms };
})(window);
