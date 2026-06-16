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

  /* 各客室の床面積を「客室1: 9.72㎡」形式で列挙する(柱控除があれば控除後の面積) */
  function kyakushitsuListText(project) {
    const rooms = project.regions.filter((r) => r.type === 'kyakushitsu');
    if (rooms.length === 1) {
      return `${rooms[0].label}: ${global.Geometry.summary(project).kyakushitsu.toFixed(2)}㎡`;
    }
    return rooms
      .map((r) => `${r.label}: ${global.Geometry.regionNetAreaSqm(project, r).toFixed(2)}㎡`)
      .join('、');
  }

  /* 営業所の床面積。求積方式(壁芯/内法)に合わせた値を返す。 */
  function premisesAreaSqm(project) {
    const method = project.meta.premisesMethod || 'regions';
    if (method === 'centerline' && project.premise) {
      return global.Geometry.premiseCalc(project.premise).total;
    }
    return global.Geometry.summary(project).premises; // 内法(区画合計)
  }

  /* 全国47都道府県(所在地から公安委員会の宛先を自動推定するための一覧) */
  const PREFECTURES = [
    '北海道', '青森県', '岩手県', '宮城県', '秋田県', '山形県', '福島県',
    '茨城県', '栃木県', '群馬県', '埼玉県', '千葉県', '東京都', '神奈川県',
    '新潟県', '富山県', '石川県', '福井県', '山梨県', '長野県', '岐阜県',
    '静岡県', '愛知県', '三重県', '滋賀県', '京都府', '大阪府', '兵庫県',
    '奈良県', '和歌山県', '鳥取県', '島根県', '岡山県', '広島県', '山口県',
    '徳島県', '香川県', '愛媛県', '高知県', '福岡県', '佐賀県', '長崎県',
    '熊本県', '大分県', '宮崎県', '鹿児島県', '沖縄県',
  ];
  /* 所在地の文字列から先頭の都道府県名を取り出す(見つからなければ空) */
  function prefectureOf(address) {
    const a = String(address || '');
    return PREFECTURES.find((p) => a.indexOf(p) === 0) || '';
  }

  /* fixtures を指定した kind 群で絞り込み、種類ごとに
   * 「ダウンライト×4(60W)」のように集計した文字列を返す。
   * watt は空でない値を重複なく集めて併記する。該当なしなら空文字。 */
  function fixtureSummaryText(project, kinds) {
    const catalog = global.Model.FIXTURE_CATALOG;
    const summaries = global.Geometry.fixtureSummary(project)
      .filter((g) => kinds.indexOf(g.kind) >= 0);
    const agg = {};
    for (const g of summaries) {
      agg[g.kind] = {
        count: g.count,
        watts: String(g.watt || '').split(',').map((w) => w.trim()).filter(Boolean),
      };
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
    const t = m.todokede || {};
    const sum = global.Geometry.summary(project);
    const addressee = t.addressee || prefectureOf(m.address);

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

  <p class="date-line">届出年月日 ${fill(todayWareki(), '40mm')}</p>
  <p class="addressee">${fill(addressee, '30mm')}公安委員会 殿</p>

  <div class="todokede-sha">
    <p class="todokede-title">届出者</p>
    <div class="row"><span class="lbl">住　　所</span>${fill(t.applicantAddress, '70mm')}</div>
    <div class="row"><span class="lbl">氏　　名</span>${fill(t.applicantName, '70mm')}</div>
    <div class="note">（法人にあっては名称及び代表者の氏名）</div>
    ${t.corpRepName ? `<div class="row"><span class="lbl">代表者氏名</span>${fill(t.corpRepName, '50mm')}</div>` : ''}
    <div class="row"><span class="lbl">電話番号</span>${fill(t.phone, '50mm')}</div>
  </div>

  <p class="honbun">　風俗営業等の規制及び業務の適正化等に関する法律第33条第1項の規定により、深夜において酒類提供飲食店営業を営みたいので、次のとおり届出をします。</p>

  <table class="form-table">
    <tr>
      <th>営業所の名称<br><span class="small">（ふりがな）</span></th>
      <td>
        ${fill(m.storeName, '70mm')}<br>
        <span class="small">ふりがな: ${fill(t.applicantKana, '70mm')}</span>
      </td>
    </tr>
    <tr>
      <th>営業所の所在地</th>
      <td>${fill(m.address, '100mm')}</td>
    </tr>
    <tr>
      <th>建物の構造</th>
      <td>${fill(t.buildingStructure, '100mm')}<br><span class="small">（例: 鉄筋コンクリート造○階建○階部分）</span></td>
    </tr>
    <tr>
      <th>建物内の営業所の位置</th>
      <td>${fill(t.buildingPosition, '100mm')}</td>
    </tr>
    <tr>
      <th>客室数</th>
      <td>${fill(String(countKyakushitsu(project)), '15mm')} 室</td>
    </tr>
    <tr>
      <th>営業所の床面積</th>
      <td>${fill(premisesAreaSqm(project).toFixed(2), '25mm')} ㎡</td>
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
        許可年月日: ${fill(t.licenseDate, '40mm')}<br>
        許可番号: ${fill(t.licenseNumber, '40mm')}
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
    const t = m.todokede || {};

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
      <td>${fill(t.businessHours || '午後6時から翌日午前2時まで', '90mm')}</td>
    </tr>
    <tr>
      <th>酒類の提供方法</th>
      <td>${fill(t.alcoholMethod || '客の注文により座席で提供する', '100mm')}</td>
    </tr>
    <tr>
      <th>18歳未満の者の立入りに関する事項</th>
      <td>${fill(t.minorRule || '18歳未満の者は午後10時以降立ち入らせない', '100mm')}</td>
    </tr>
    <tr>
      <th>当該営業に従事する者の数</th>
      <td>${fill(t.staffCount, '15mm')} 名</td>
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
    margin: 0; color: #1a1a1a; font-size: 10.5pt; line-height: 1.9;
    background: #e9ebef; /* 画面では紙が浮かんで見える背景 */
  }
  /* 各様式 = 白い紙1枚として表示。印刷では1ページずつ改ページ */
  .page {
    background: #fff; width: 210mm; margin: 8mm auto;
    padding: 16mm 18mm; box-shadow: 0 2px 14px rgba(0,0,0,.18);
    page-break-after: always; break-after: page;
  }
  h1 {
    text-align: center; font-size: 15pt; font-weight: bold;
    letter-spacing: 3px; margin: 2mm 0 9mm;
  }
  .date-line { text-align: right; margin: 0 0 3mm; }
  .addressee { font-size: 11pt; margin: 0 0 6mm; }
  /* 届出者欄: 右半分にそろえて配置 */
  .todokede-sha { margin: 0 0 6mm auto; width: 100mm; }
  .todokede-title { font-weight: bold; margin: 0 0 1mm; }
  .todokede-sha .row { margin: 1.5mm 0; }
  .todokede-sha .lbl { display: inline-block; width: 22mm; }
  .todokede-sha .note { font-size: 8pt; color: #555; margin-left: 22mm; }
  .honbun { margin: 0 0 6mm; }
  .small { font-size: 8pt; color: #555; }
  /* 黒罫線の様式表。見出し列はうすい灰色で読みやすく */
  .form-table { width: 100%; border-collapse: collapse; }
  .form-table th, .form-table td {
    border: 1px solid #333; padding: 2.5mm 3.5mm; vertical-align: middle;
  }
  .form-table th {
    width: 30%; font-weight: normal; text-align: left;
    background: #f4f4f2; line-height: 1.6;
  }
  .menu-cell { padding: 0; }
  .menu-table { width: 100%; border-collapse: collapse; }
  .menu-table th, .menu-table td { border: 1px solid #333; padding: 2mm 3.5mm; }
  .menu-table th { text-align: center; font-weight: normal; background: #f4f4f2; }
  .menu-table tr > *:first-child { border-left: none; }
  .menu-table tr > *:last-child { border-right: none; }
  .menu-table thead th { border-top: none; }
  .menu-table tbody tr:last-child td { border-bottom: none; }
  /* 編集可能フィールド: 画面ではうすい水色 + 下線、印刷では下線のみ残す */
  .fill {
    display: inline-block; min-height: 1.5em;
    border-bottom: 1px solid #333; background: #eaf3fe;
    border-radius: 2px 2px 0 0;
    padding: 0 2mm; vertical-align: bottom;
  }
  .fill:focus { outline: none; background: #d8e9fd; }
  .fill:hover { background: #ddecfd; }
  /* 画面上部の操作バー(印刷時は非表示) */
  .toolbar {
    position: sticky; top: 0; z-index: 10;
    background: #fff; border-bottom: 1px solid #d6d9de;
    font-family: -apple-system, "Hiragino Sans", sans-serif;
    padding: 10px 16px; box-shadow: 0 1px 6px rgba(0,0,0,.08);
  }
  .toolbar .bar {
    display: flex; align-items: center; justify-content: space-between;
    max-width: 210mm; margin: 0 auto;
  }
  .toolbar .bar strong { font-size: 14px; color: #1f2937; }
  .toolbar button {
    font-size: 13px; padding: 7px 16px; cursor: pointer; margin-left: 8px;
    border: 1px solid #cbd5e1; border-radius: 6px; background: #fff; color: #1f2937;
  }
  .toolbar button:hover { background: #f1f5f9; }
  .toolbar button.primary { background: #2563eb; border-color: #2563eb; color: #fff; }
  .toolbar button.primary:hover { background: #1d4ed8; }
  .toolbar .notice {
    max-width: 210mm; margin: 8px auto 0; padding: 7px 12px;
    background: #fff8e1; border-left: 4px solid #f59e0b; border-radius: 4px;
    color: #7c4a03; font-size: 12px; line-height: 1.6;
  }
  @media print {
    body { background: #fff; }
    .toolbar { display: none; }
    .page {
      width: auto; margin: 0; padding: 0; box-shadow: none;
    }
    .page:last-of-type { page-break-after: auto; break-after: auto; }
    .fill { background: transparent; }
  }
</style></head><body>
<div class="toolbar">
  <div class="bar">
    <strong>届出書類の下書き(2枚) — 様式第47号・第48号</strong>
    <div>
      <button class="primary" onclick="window.print()">印刷 / PDFに保存</button>
      <button onclick="window.close()">閉じる</button>
    </div>
  </div>
  <div class="notice">水色の下線部はクリックしてそのまま編集できます(印刷時は色が消えます)。本書式は様式に準拠した下書きです。提出先の警察署・都道府県警の最新様式を必ず確認してください。</div>
</div>
${form47Html(project)}
${form48Html(project)}
</body></html>`);
    win.document.close();
  }

  global.Forms = { openForms };
})(window);
