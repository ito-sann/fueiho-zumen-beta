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
    $('btnSave').onclick = saveFile;
    $('btnLoad').onclick = () => $('fileInput').click();
    $('fileInput').onchange = loadFile;
    $('btnPdf').onclick = () => { draw(); P.printCurrent(project, canvas); };
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
    $('metaStore').oninput = (e) => m.storeName = e.target.value;
    $('metaAddr').oninput  = (e) => m.address = e.target.value;
    $('metaAuthor').oninput= (e) => m.author = e.target.value;
    $('metaScale').onchange = (e) => m.scale = parseInt(e.target.value, 10);
    $('metaPaper').onchange = (e) => m.paper = e.target.value;
    $('metaOrient').onchange= (e) => m.orientation = e.target.value;
  }

  /* ---- 描画と再計算 ---- */
  function draw() {
    R.render(ctx, canvasCss(), project, state);
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

  function renderKyuseki() {
    const layer = R.getLayer();
    let types = null, title = '営業所求積表';
    if (layer === 'kyakushitsu') { types = ['kyakushitsu']; title = '客室求積表'; }
    const t = G.buildTable(project, types);
    let rows = t.rows.map((r) =>
      `<tr><td>${r.code}</td><td>${esc(r.label)}</td><td>${r.expr}</td><td>${r.area.toFixed(4)}</td></tr>`).join('');
    if (!rows) rows = '<tr><td colspan="4" class="muted">区画がありません</td></tr>';
    $('kyusekiBox').innerHTML = `
      <div class="kyuseki-title">${title}</div>
      <table class="kyuseki">
        <thead><tr><th>符号</th><th>区画</th><th>計算式</th><th>面積(㎡)</th></tr></thead>
        <tbody>${rows}</tbody>
        <tfoot><tr><td colspan="3">合計(総面積)</td><td>${t.total.toFixed(2)} ㎡</td></tr></tfoot>
      </table>`;
  }

  function renderWarnings() {
    const w = G.sightlineWarnings(project);
    const box = $('warnBox');
    if (!w.length) {
      box.innerHTML = '<p class="ok">高さ1mを超える設備はありません。</p>';
      return;
    }
    box.innerHTML = '<p class="ng">客室の見通しを妨げるおそれ(高さ1m超):</p><ul>' +
      w.map((x) => `<li>${esc(x.label)}(${(x.height / 1000).toFixed(2)}m)</li>`).join('') +
      '</ul><p class="muted">深夜酒類では客室を見通せる必要があります。配置・高さを確認してください。</p>';
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
      const wLabel = shape === 'rect' ? '幅(mm)' : shape === 'triangle' ? '底辺(mm)' : '下底(mm)';
      const hLabel = shape === 'rect' ? '奥行(mm)' : '高さ(mm)';
      html += `<div class="prop-row"><span>形</span><b>${shapeLabel(shape)}</b></div>`;
      html += propNum(wLabel, 'w', el.w);
      if (shape === 'trapezoid') {
        html += propNum('上底(mm)', 'w2', el.w2 != null ? el.w2 : el.w);
      }
      html += propNum(hLabel, 'h', el.h);
      html += propNum('角度(度)', 'rotation', el.rotation || 0);
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
    $('btnDel').onclick = () => {
      M.removeById(project, el.id);
      state.selectedId = null;
      refresh(); showProps(null);
    };
  }

  function shapeLabel(shape) {
    return { rect: '長方形', triangle: '三角形', trapezoid: '台形' }[shape] || '長方形';
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
