/* =========================================================================
 * main.js — 画面の組み立てと全体の配線。
 * ========================================================================= */
(function (global) {
  'use strict';
  const M = global.Model, G = global.Geometry, R = global.Render,
        I = global.Interactions, P = global.Printer;

  let project = M.defaultProject();
  const state = { selectedId: null };

  const $ = (id) => document.getElementById(id);
  const canvas = $('canvas');
  const ctx = canvas.getContext('2d');

  /* ---- 初期化 ---- */
  function init() {
    buildSelects();
    buildLayerTabs();
    bindToolbar();
    bindMeta();
    resizeCanvas();
    window.addEventListener('resize', () => { resizeCanvas(); draw(); });

    I.attach(canvas, ctx, project, state, draw, showProps);

    // サンプルの最小構成を1つ置いておく(手応え確認用)
    const r = M.addRegion(project, 'kyakushitsu', 4500, 3200);
    r.x = 1000; r.y = 1000;
    const k = M.addRegion(project, 'chubo', 2000, 3200);
    k.x = 5500; k.y = 1000;

    // レイアウト確定後に全体表示へ合わせる(初回描画のサイズ取りこぼし対策)
    requestAnimationFrame(() => {
      resizeCanvas();
      R.fitToView(project, canvasCss());
      refresh();
    });
    refresh();
  }

  function resizeCanvas() {
    const wrap = canvas.parentElement;
    const ratio = global.devicePixelRatio || 1;
    canvas.width = wrap.clientWidth * ratio;
    canvas.height = wrap.clientHeight * ratio;
    canvas.style.width = wrap.clientWidth + 'px';
    canvas.style.height = wrap.clientHeight + 'px';
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    // ※ 描画座標は CSS px 基準にしたいので、render 側の canvas.width 参照を補正
    canvas._cssW = wrap.clientWidth;
    canvas._cssH = wrap.clientHeight;
  }

  /* ---- セレクトボックスの中身 ---- */
  function buildSelects() {
    const rt = $('regionType');
    for (const [key, v] of Object.entries(M.REGION_TYPES)) {
      rt.add(new Option(v.label, key));
    }
    const fk = $('furnKind');
    for (const [key, v] of Object.entries(M.FURNITURE_CATALOG)) {
      fk.add(new Option(`${v.label}(${v.w}×${v.h})`, key));
    }
    const gk = $('fittingKind');
    for (const [key, v] of Object.entries(M.FITTING_CATALOG)) {
      gk.add(new Option(v.label, key));
    }
    const xk = $('fixKind');
    for (const [key, v] of Object.entries(M.FIXTURE_CATALOG)) {
      xk.add(new Option(v.label, key));
    }
  }

  function buildLayerTabs() {
    const box = $('layerTabs');
    box.innerHTML = '';
    for (const [key, v] of Object.entries(R.LAYERS)) {
      const b = document.createElement('button');
      b.className = 'layer-tab' + (R.getLayer() === key ? ' active' : '');
      b.textContent = v.label;
      b.onclick = () => {
        R.setLayer(key);
        buildLayerTabs();
        refresh();
      };
      box.appendChild(b);
    }
  }

  /* ---- ツールバー配線 ---- */
  function bindToolbar() {
    $('btnAddRegion').onclick = () => {
      const type = $('regionType').value;
      const shape = $('regionShape').value;
      const w = clampSize($('regionW').value);
      const h = clampSize($('regionH').value);
      const w2 = shape === 'trapezoid' ? clampSize($('regionW2').value) : undefined;
      const r = M.addRegion(project, type, w, h, shape, w2);
      placeAtViewCenter(r);
      state.selectedId = r.id;
      refresh(); showProps(r);
    };
    // 台形のときだけ「上底」入力欄を表示
    $('regionShape').onchange = (e) => {
      $('regionW2Row').style.display = e.target.value === 'trapezoid' ? '' : 'none';
    };
    // 多角形の作図モード(クリックで頂点を置いて囲う)。もう一度押すと中止。
    $('btnDrawPoly').onclick = () => {
      if (state.draft) {
        I.cancelPolygon(state);
        setDraftUi(false);
        draw();
        return;
      }
      const type = $('regionType').value;
      I.beginPolygon(state, (pts) => {
        const r = M.addPolygonRegion(project, type, pts);
        state.selectedId = r.id;
        setDraftUi(false);
        refresh(); showProps(r);
      });
      setDraftUi(true);
      draw();
    };
    $('btnAddFurn').onclick = () => {
      const f = M.addFurniture(project, $('furnKind').value);
      placeAtViewCenter(f);
      state.selectedId = f.id;
      refresh(); showProps(f);
    };
    $('btnAddFitting').onclick = () => {
      const g = M.addFitting(project, $('fittingKind').value);
      placeAtViewCenter(g);
      state.selectedId = g.id;
      refresh(); showProps(g);
    };
    $('btnAddFix').onclick = () => {
      const x = M.addFixture(project, $('fixKind').value);
      placeFixtureAtViewCenter(x);
      state.selectedId = x.id;
      refresh(); showProps(x);
    };
    $('btnFit').onclick = () => { R.fitToView(project, canvasCss()); draw(); };
    $('btnNew').onclick = () => {
      if (!confirm('現在の図面を消して新規作成します。よろしいですか?')) return;
      project = M.defaultProject();
      state.selectedId = null;
      I.attach(canvas, ctx, project, state, draw, showProps);
      bindMeta();
      R.fitToView(project, canvasCss());
      refresh(); showProps(null);
    };
    $('snapSelect').onchange = (e) => I.setSnap(parseInt(e.target.value, 10));
    $('btnSave').onclick = saveFile;
    $('btnLoad').onclick = () => $('fileInput').click();
    $('fileInput').onchange = loadFile;
    $('btnPdf').onclick = () => { draw(); P.printCurrent(project, canvas); };
    $('btnPdfAll').onclick = () => { P.printAll(project); draw(); };
    $('btnForms').onclick = () => global.Forms.openForms(project);
    $('btnChecklist').onclick = openChecklist;
    $('btnChecklistClose').onclick = closeChecklist;
    $('checklistModal').onclick = (e) => {
      if (e.target.id === 'checklistModal') closeChecklist(); // 背景クリックで閉じる
    };
    $('checkCorp').onchange = (e) => {
      project.checklist.corp = e.target.checked;
      renderChecklist();
    };
  }

  /* ---- 必要書類チェックリスト ---- */
  function openChecklist() {
    $('checkCorp').checked = !!project.checklist.corp;
    renderChecklist();
    $('checklistModal').hidden = false;
  }
  function closeChecklist() {
    $('checklistModal').hidden = true;
  }
  function renderChecklist() {
    const cl = project.checklist;
    const items = M.CHECKLIST_ITEMS.filter((it) => !it.corpOnly || cl.corp);
    const done = items.filter((it) => cl.items[it.id]).length;
    let html = `<p class="check-progress">${done} / ${items.length} 件 そろっています</p><ul class="checklist">`;
    for (const it of items) {
      const checked = cl.items[it.id] ? ' checked' : '';
      const corp = it.corpOnly ? '<span class="badge">法人</span>' : '';
      const note = it.note ? `<span class="muted">(${esc(it.note)})</span>` : '';
      html += `<li><label><input type="checkbox" data-check="${it.id}"${checked}> ${esc(it.label)} ${corp} ${note}</label></li>`;
    }
    html += '</ul>';
    const box = $('checklistBody');
    box.innerHTML = html;
    box.querySelectorAll('[data-check]').forEach((inp) => {
      inp.onchange = (e) => {
        cl.items[e.target.dataset.check] = e.target.checked;
        renderChecklist(); // 進捗表示を更新
      };
    });
  }

  /* 作図モード中のボタン表示とヒント文を切り替える */
  const HINT_DEFAULT = '空きをドラッグで移動 / ホイールで拡大縮小 / 要素をドラッグで配置(既定1cm吸着・Shiftで自由)/ 矢印キーで微調整(Shiftで10倍)/ Deleteで削除';
  const HINT_DRAFT = '多角形の作図中: クリックで角を置く / 最初の点をクリック・ダブルクリック・Enterで確定 / Escで中止';
  function setDraftUi(drafting) {
    $('btnDrawPoly').textContent = drafting ? '作図を中止(Esc)' : '多角形で描く';
    $('btnDrawPoly').classList.toggle('danger', drafting);
    $('hint').textContent = drafting ? HINT_DRAFT : HINT_DEFAULT;
  }

  function clampSize(v) {
    let n = parseInt(v, 10);
    if (!isFinite(n) || n < 100) n = 100;
    return Math.round(n / 100) * 100;
  }

  // 追加するたびに少しずつ位置をずらし、要素どうしが完全に重ならないようにする
  let cascadeStep = 0;
  function cascade() {
    const d = (cascadeStep % 8) * 300; // 0〜2100mm を斜めに展開
    cascadeStep++;
    return d;
  }
  function placeAtViewCenter(el) {
    const c = canvasCss();
    const center = R.screenToWorld(c.width / 2, c.height / 2);
    const d = cascade();
    el.x = I.snap(center.x - el.w / 2 + d);
    el.y = I.snap(center.y - el.h / 2 + d);
  }
  function placeFixtureAtViewCenter(el) {
    const c = canvasCss();
    const center = R.screenToWorld(c.width / 2, c.height / 2);
    const d = cascade();
    el.x = I.snap(center.x + d);
    el.y = I.snap(center.y + d);
  }

  /* render は canvas.width(px)を見るので CSS px に差し替えた擬似オブジェクトを渡す */
  function canvasCss() {
    return { width: canvas._cssW || canvas.width, height: canvas._cssH || canvas.height };
  }

  /* ---- メタ情報 ---- */
  function bindMeta() {
    const m = project.meta;
    $('metaStore').value = m.storeName;
    $('metaAddr').value = m.address;
    $('metaScale').value = m.scale;
    $('metaPaper').value = m.paper;
    $('metaOrient').value = m.orientation;
    $('metaAuthor').value = m.author;
    $('fixNote').value = m.lightingNote || '';
    $('metaStore').oninput = (e) => m.storeName = e.target.value;
    $('metaAddr').oninput  = (e) => m.address = e.target.value;
    $('metaAuthor').oninput= (e) => m.author = e.target.value;
    $('metaScale').onchange = (e) => m.scale = parseInt(e.target.value, 10);
    $('metaPaper').onchange = (e) => m.paper = e.target.value;
    $('metaOrient').onchange= (e) => m.orientation = e.target.value;
    // 設備図コメントは凡例に即時反映させるため、入力のたびに再描画する
    $('fixNote').oninput = (e) => { m.lightingNote = e.target.value; draw(); };
  }

  /* ---- 描画と再計算 ---- */
  function draw() {
    R.render(ctx, canvasCss(), project, state);
    setDraftUi(!!state.draft); // Escで中止された場合もボタン・ヒントを戻す
  }
  function refresh() {
    draw();
    renderSummary();
    renderKyuseki();
    renderWarnings();
  }

  function renderSummary() {
    const s = G.summary(project);
    $('summaryTable').innerHTML = `
      <tr><th>営業所面積</th><td>${s.premises.toFixed(2)} ㎡</td></tr>
      <tr><th>客室面積</th><td>${s.kyakushitsu.toFixed(2)} ㎡</td></tr>
      <tr><th>厨房面積</th><td>${s.chubo.toFixed(2)} ㎡</td></tr>
      <tr><th>トイレ面積</th><td>${s.toilet.toFixed(2)} ㎡</td></tr>
      <tr><th>その他面積</th><td>${s.other.toFixed(2)} ㎡</td></tr>`;
  }

  function kyusekiTableHtml(title, t) {
    let rows = t.rows.map((r) =>
      `<tr><td>${r.code}</td><td>${esc(r.label)}</td><td>${r.expr}</td><td>${r.area.toFixed(4)}</td></tr>`).join('');
    if (!rows) rows = '<tr><td colspan="4" class="muted">区画がありません</td></tr>';
    return `
      <div class="kyuseki-title">${title}</div>
      <table class="kyuseki">
        <thead><tr><th>符号</th><th>区画</th><th>計算式</th><th>面積(㎡)</th></tr></thead>
        <tbody>${rows}</tbody>
        <tfoot><tr><td colspan="3">合計(総面積)</td><td>${t.total.toFixed(2)} ㎡</td></tr></tfoot>
      </table>`;
  }

  /* 照明・音響設備一覧表(設備図に添える) */
  function fixtureTableHtml() {
    const list = G.fixtureSummary(project);
    let rows = list.map((g) =>
      `<tr><td>${esc(g.symbol)}</td><td>${esc(g.label)}</td><td>${g.count}</td><td>${esc(g.watt || '—')}</td></tr>`).join('');
    if (!rows) rows = '<tr><td colspan="4" class="muted">設備がありません</td></tr>';
    return `
      <div class="kyuseki-title">照明・音響設備一覧表</div>
      <table class="kyuseki">
        <thead><tr><th>記号</th><th>設備</th><th>数量</th><th>W数</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>`;
  }

  /* 多角形1つ分の座標求積表(頂点番号は図面の P1, P2 … と対応) */
  function coordTableHtml(r) {
    const c = G.polygonCalc(r);
    const rows = c.rows.map((row) =>
      `<tr><td>P${row.no}</td><td>${row.x.toFixed(2)}</td><td>${row.y.toFixed(2)}</td>
       <td>${row.dy.toFixed(2)}</td><td>${row.prod.toFixed(4)}</td></tr>`).join('');
    return `
      <div class="kyuseki-title">座標求積表(${esc(r.label)})</div>
      <table class="kyuseki coord">
        <thead><tr><th>点</th><th>X(m)</th><th>Y(m)</th><th>Y次−Y前</th><th>X×(Y次−Y前)</th></tr></thead>
        <tbody>${rows}</tbody>
        <tfoot>
          <tr><td colspan="4">倍面積</td><td>${c.doubleArea.toFixed(4)}</td></tr>
          <tr><td colspan="4">面積(倍面積÷2)</td><td>${c.area4.toFixed(4)} ㎡</td></tr>
        </tfoot>
      </table>`;
  }

  /* 指定の種類に含まれる多角形すべての座標求積表 */
  function coordTablesHtml(filterTypes) {
    return project.regions
      .filter((r) => r.shape === 'polygon' &&
        (!filterTypes || filterTypes.indexOf(r.type) >= 0))
      .map(coordTableHtml).join('');
  }

  function renderKyuseki() {
    const layer = R.getLayer();
    let html;
    if (layer === 'kyakushitsu') {
      // 客室・調理場求積図: 客室と調理場の求積表を別々に出す
      html = kyusekiTableHtml('客室求積表', G.buildTable(project, ['kyakushitsu'])) +
             kyusekiTableHtml('調理場求積表', G.buildTable(project, ['chubo'])) +
             coordTablesHtml(['kyakushitsu', 'chubo']);
    } else if (layer === 'lighting') {
      html = fixtureTableHtml();
    } else {
      html = kyusekiTableHtml('営業所求積表', G.buildTable(project, null)) +
             coordTablesHtml(null);
    }
    $('kyusekiBox').innerHTML = html;
  }

  function renderWarnings() {
    const box = $('warnBox');
    let html = '';

    // 1) 見通し規制(高さ概ね1m以上の設備)
    const w = G.sightlineWarnings(project);
    if (w.length) {
      html += '<p class="ng">客室の見通しを妨げるおそれ(高さ1m超):</p><ul>' +
        w.map((x) => `<li>${esc(x.label)}(${(x.height / 1000).toFixed(2)}m)</li>`).join('') +
        '</ul>';
    } else {
      html += '<p class="ok">見通し: 高さ1mを超える設備はありません。</p>';
    }

    // 2) 客室の床面積要件(2室以上のとき各室9.5㎡以上)
    const rooms = project.regions.filter((r) => r.type === 'kyakushitsu');
    const small = G.kyakushitsuSizeWarnings(project);
    if (small.length) {
      html += `<p class="ng">客室が2室以上の場合、1室 ${G.KYAKUSHITSU_MIN_SQM}㎡ 以上が必要です:</p><ul>` +
        small.map((x) => `<li>${esc(x.label)}(${x.area.toFixed(4)}㎡)</li>`).join('') +
        '</ul>';
    } else if (rooms.length >= 2) {
      html += `<p class="ok">客室面積: 全室 ${G.KYAKUSHITSU_MIN_SQM}㎡ 以上を満たしています。</p>`;
    } else if (rooms.length === 1) {
      html += '<p class="ok">客室面積: 客室1室のみのため面積の下限はありません。</p>';
    }

    // 3) 構造・設備の固定リマインダー(図面からは判定できない要件)
    html += `
      <details class="reminder">
        <summary>構造・設備の要件メモ(クリックで開く)</summary>
        <ul class="muted-list">
          <li>客室の出入口に施錠設備を設けない(外部に直接面する出入口を除く)</li>
          <li>営業所内の照度を20ルクス以下としない(調光器(スライダック)は不可)</li>
          <li>騒音・振動は条例の数値基準に適合させる</li>
          <li>善良の風俗を害するおそれのある写真・装飾等を設けない</li>
        </ul>
      </details>`;

    box.innerHTML = html;
  }

  /* ---- プロパティ編集 ---- */
  function showProps(el) {
    const box = $('props');
    if (!el) { box.innerHTML = '<p class="muted">要素を選ぶと編集できます。</p>'; return; }
    const found = M.findById(project, el.id);
    if (!found) { box.innerHTML = '<p class="muted">—</p>'; return; }
    const kind = found.kind;
    let html = `<div class="prop-row"><span>種別</span><b>${kindLabel(el, kind)}</b></div>`;
    html += propText('ラベル', 'label', el.label);
    html += propNum('X位置(mm)', 'x', el.x);
    html += propNum('Y位置(mm)', 'y', el.y);
    if (kind === 'furniture' || kind === 'fittings') {
      html += propNum(kind === 'fittings' ? '長さ(mm)' : '幅(mm)', 'w', el.w);
      html += propNum(kind === 'fittings' ? '厚み(mm)' : '奥行(mm)', 'h', el.h);
      html += propNum('角度(度)', 'rotation', el.rotation || 0);
    }
    if (kind === 'furniture') {
      html += propNum('高さ(mm)', 'height', el.height || 0);
    }
    if (kind === 'fixtures') {
      html += propText('ワット数', 'watt', el.watt || '');
      html += propText('型番メモ', 'model', el.model || '');
    }
    if (kind === 'regions') {
      const shape = el.shape || 'rect';
      html += `<div class="prop-row"><span>形</span><b>${shapeLabel(shape)}</b></div>`;
      if (shape === 'polygon') {
        // 頂点の座標(絶対mm)を1点ずつ編集できる。キャンバス上のドラッグでも修正可。
        html += '<p class="muted">頂点はキャンバス上でドラッグでも動かせます。</p>';
        el.points.forEach((p, i) => {
          html += `<div class="prop-row vertex-row"><span>P${i + 1}</span>
            <input type="number" step="10" data-vx="${i}" value="${el.x + p.x}" title="X(mm)">
            <input type="number" step="10" data-vy="${i}" value="${el.y + p.y}" title="Y(mm)"></div>`;
        });
      } else {
        const wLabel = shape === 'rect' ? '幅(mm)' : shape === 'triangle' ? '底辺(mm)' : '下底(mm)';
        const hLabel = shape === 'rect' ? '奥行(mm)' : '高さ(mm)';
        html += propNum(wLabel, 'w', el.w);
        if (shape === 'trapezoid') {
          html += propNum('上底(mm)', 'w2', el.w2 != null ? el.w2 : el.w);
        }
        html += propNum(hLabel, 'h', el.h);
        html += propNum('角度(度)', 'rotation', el.rotation || 0);
      }
      const area = G.regionAreaSqm(el);
      html += `<div class="prop-row"><span>面積</span><b id="propArea">${area.toFixed(4)} ㎡</b></div>`;
    }
    html += `<button class="btn small danger" id="btnDel">この要素を削除</button>`;
    box.innerHTML = html;

    box.querySelectorAll('[data-field]').forEach((inp) => {
      inp.addEventListener('input', (e) => {
        const f = e.target.dataset.field;
        let v = e.target.value;
        if (e.target.type === 'number') v = parseFloat(v) || 0;
        el[f] = v;
        refresh();
        // 面積表示を即時に更新(幅・奥行の変更に追従)
        const areaEl = box.querySelector('#propArea');
        if (areaEl) areaEl.textContent = G.regionAreaSqm(el).toFixed(4) + ' ㎡';
      });
    });
    // 多角形の頂点座標の編集(原点の取り直しがあるため change で確定時に反映)
    box.querySelectorAll('[data-vx], [data-vy]').forEach((inp) => {
      inp.addEventListener('change', (e) => {
        const isX = 'vx' in e.target.dataset;
        const i = parseInt(isX ? e.target.dataset.vx : e.target.dataset.vy, 10);
        const v = parseFloat(e.target.value) || 0;
        if (isX) el.points[i].x = v - el.x;
        else el.points[i].y = v - el.y;
        M.normalizePolygon(el);
        refresh(); showProps(el);
      });
    });
    $('btnDel').onclick = () => {
      M.removeById(project, el.id);
      state.selectedId = null;
      refresh(); showProps(null);
    };
  }

  function shapeLabel(shape) {
    return { rect: '長方形', triangle: '三角形', trapezoid: '台形', polygon: '多角形' }[shape] || '長方形';
  }

  function kindLabel(el, kind) {
    if (kind === 'regions') return (M.REGION_TYPES[el.type] || {}).label || '区画';
    if (kind === 'furniture') return '備品';
    if (kind === 'fittings') return '建具・設備';
    return '照明・音響';
  }
  function propText(label, field, val) {
    return `<label class="prop-row"><span>${label}</span>
      <input type="text" data-field="${field}" value="${esc(val)}"></label>`;
  }
  function propNum(label, field, val) {
    return `<label class="prop-row"><span>${label}</span>
      <input type="number" step="10" data-field="${field}" value="${val}"></label>`;
  }

  /* ---- 保存 / 読み込み ---- */
  function saveFile() {
    const text = M.serialize(project);
    const blob = new Blob([text], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const name = (project.meta.storeName || 'zumen').replace(/\s/g, '_');
    a.href = url; a.download = `${name}_${project.meta.date}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }
  function loadFile(e) {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        project = M.deserialize(reader.result);
        state.selectedId = null;
        I.attach(canvas, ctx, project, state, draw, showProps);
        bindMeta();
        R.fitToView(project, canvasCss());
        refresh(); showProps(null);
      } catch (err) {
        alert('読み込みに失敗しました: ' + err.message);
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  }

  function esc(s) {
    return String(s).replace(/[&<>"']/g, (c) => (
      { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  document.addEventListener('DOMContentLoaded', init);
})(window);
