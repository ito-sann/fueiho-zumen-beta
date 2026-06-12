/* =========================================================================
 * render.js — Canvas 描画。座標は mm(ワールド)→ px(画面)に変換する。
 * 図面の種類(レイヤー)ごとに表示内容を切り替える。
 * ========================================================================= */
(function (global) {
  'use strict';

  /* ビュー(パン・ズーム)。zoom = px/mm */
  const view = { zoom: 0.05, offsetX: 40, offsetY: 40 };

  /* レイヤー(図面の種類)。届出に添付する図面の単位と一致させている。 */
  const LAYERS = {
    plan:      { label: '平面図' },
    premises:  { label: '営業所求積図' },
    kyakushitsu: { label: '客室・調理場求積図' },
    lighting:  { label: '照明・音響設備図' },
    furnviews: { label: '備品姿図' },
  };
  let currentLayer = 'plan';

  function setLayer(name) { if (LAYERS[name]) currentLayer = name; }
  function getLayer() { return currentLayer; }

  function worldToScreen(x, y) {
    return { x: x * view.zoom + view.offsetX, y: y * view.zoom + view.offsetY };
  }

  /* 実寸(mm)を画面pxに変換する。文字や記号の大きさを「図面に対して固定」に
   * するために使う。ズームしても部屋との比率が変わらず、PDFでも常に同じ大きさになる。 */
  function wpx(mm) {
    return mm * view.zoom;
  }

  /* 文字サイズの倍率(図面情報の「文字サイズ」設定)。render() の最初に更新する。 */
  let fontScale = 1;

  /* ラベル文字のサイズ(px)を求める。
   *   defaultMm … 既定の実寸(mm)
   *   el        … 要素。el.fontSize(サイズ番号: 15=標準)が指定されていれば
   *               全体設定より優先する。旧形式の el.fontMm(実寸mm)も互換で残す。 */
  function fontPx(defaultMm, el) {
    if (el && el.fontSize > 0) return wpx(defaultMm * el.fontSize / 15);
    if (el && el.fontMm > 0) return wpx(el.fontMm); // 旧データ互換
    return wpx(defaultMm * fontScale);
  }
  function screenToWorld(px, py) {
    return { x: (px - view.offsetX) / view.zoom, y: (py - view.offsetY) / view.zoom };
  }

  /* 全要素が収まるようにビューを合わせる(用紙枠の表示中は枠も含める) */
  function fitToView(project, canvas) {
    let bb = currentLayer === 'furnviews'
      ? furnViewLayout(project).bounds
      : global.Geometry.boundingBox(project);
    if (project.meta.showPaperFrame) {
      const f = paperFrameWorld(project);
      const minX = Math.min(bb.x, f.x), minY = Math.min(bb.y, f.y);
      const maxX = Math.max(bb.x + bb.w, f.x + f.w);
      const maxY = Math.max(bb.y + bb.h, f.y + f.h);
      bb = { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
    }
    const margin = 60;
    const pad = Math.max(bb.w, bb.h) * 0.12 + 500;
    const w = bb.w + pad * 2, h = bb.h + pad * 2;
    const zx = (canvas.width - margin * 2) / w;
    const zy = (canvas.height - margin * 2) / h;
    view.zoom = Math.min(zx, zy);
    view.offsetX = margin - (bb.x - pad) * view.zoom;
    view.offsetY = margin - (bb.y - pad) * view.zoom;
  }

  function clear(ctx, canvas) {
    ctx.save();
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.restore();
  }

  /* 10cm(100mm)グリッド */
  function drawGrid(ctx, canvas) {
    const step = 1000; // 1m ごとに線、太線
    const sub = 100;    // 10cm
    const tl = screenToWorld(0, 0);
    const br = screenToWorld(canvas.width, canvas.height);
    ctx.save();
    ctx.lineWidth = 1;
    // 10cm 細線(ズームが十分なときだけ)
    if (view.zoom > 0.03) {
      ctx.strokeStyle = '#f0f0f0';
      for (let x = Math.floor(tl.x / sub) * sub; x < br.x; x += sub) {
        const s = worldToScreen(x, 0);
        ctx.beginPath(); ctx.moveTo(s.x, 0); ctx.lineTo(s.x, canvas.height); ctx.stroke();
      }
      for (let y = Math.floor(tl.y / sub) * sub; y < br.y; y += sub) {
        const s = worldToScreen(0, y);
        ctx.beginPath(); ctx.moveTo(0, s.y); ctx.lineTo(canvas.width, s.y); ctx.stroke();
      }
    }
    // 1m 太線
    ctx.strokeStyle = '#e0e0e0';
    for (let x = Math.floor(tl.x / step) * step; x < br.x; x += step) {
      const s = worldToScreen(x, 0);
      ctx.beginPath(); ctx.moveTo(s.x, 0); ctx.lineTo(s.x, canvas.height); ctx.stroke();
    }
    for (let y = Math.floor(tl.y / step) * step; y < br.y; y += step) {
      const s = worldToScreen(0, y);
      ctx.beginPath(); ctx.moveTo(0, s.y); ctx.lineTo(canvas.width, s.y); ctx.stroke();
    }
    ctx.restore();
  }

  /* ---- 下絵(間取り図のトレース用画像) ----
   * 画像の読み込みは非同期なので、読み込み完了時に再描画してもらうための
   * コールバックを main.js から登録する。 */
  let redrawCb = null;
  function setRedrawCallback(fn) { redrawCb = fn; }
  const ulCache = { src: null, img: null, ready: false };
  function underlayImage(src) {
    if (ulCache.src !== src) {
      ulCache.src = src;
      ulCache.ready = false;
      const img = new Image();
      img.onload = () => { ulCache.ready = true; if (redrawCb) redrawCb(); };
      img.src = src;
      ulCache.img = img;
    }
    return ulCache.ready ? ulCache.img : null;
  }

  /* 下絵をグリッドの上・図面要素の下に薄く描く。印刷(PDF)には含めない。 */
  function drawUnderlay(ctx, project) {
    const u = project.underlay;
    if (!u || !u.src || u.visible === false) return;
    const img = underlayImage(u.src);
    if (!img) return;
    const tl = worldToScreen(u.x, u.y);
    ctx.save();
    ctx.globalAlpha = Math.min(1, Math.max(0.05, u.opacity != null ? u.opacity : 0.5));
    ctx.drawImage(img, tl.x, tl.y, u.w * view.zoom, u.h * view.zoom);
    ctx.restore();
  }

  /* 形ごとの頂点(中心原点・画面px)。w,h,w2 は px。 */
  function shapePoints(shape, w, h, w2) {
    if (shape === 'triangle') {
      // 直角三角形(直角=左下)。底辺=下、高さ=左。
      return [[-w / 2, h / 2], [w / 2, h / 2], [-w / 2, -h / 2]];
    }
    if (shape === 'trapezoid') {
      const t = w2 / 2; // 上底の半幅
      return [[-w / 2, h / 2], [w / 2, h / 2], [t, -h / 2], [-t, -h / 2]];
    }
    return [[-w / 2, -h / 2], [w / 2, -h / 2], [w / 2, h / 2], [-w / 2, h / 2]];
  }

  function tracePoly(ctx, pts) {
    ctx.beginPath();
    ctx.moveTo(pts[0][0], pts[0][1]);
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
    ctx.closePath();
  }

  /* 多角形区画の頂点を画面座標で返す */
  function polygonScreenPts(r) {
    return (r.points || []).map((p) => worldToScreen(r.x + p.x, r.y + p.y));
  }

  /* 多角形区画を描く(塗り・輪郭・ラベル・選択時は頂点ハンドル) */
  function drawPolygonRegion(ctx, r, opts) {
    const pts = polygonScreenPts(r);
    if (pts.length < 3) return;
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
    ctx.closePath();
    if (opts.fill) {
      ctx.globalAlpha = opts.muted ? 0.15 : 0.55; // 強調対象外は薄く塗る
      ctx.fillStyle = r.color;
      ctx.fill();
      ctx.globalAlpha = 1;
    }
    ctx.lineWidth = opts.selected ? 3 : 2;
    ctx.strokeStyle = opts.selected ? '#d32f2f' : (opts.muted ? '#9aa0a6' : (opts.stroke || '#333'));
    ctx.stroke();
    // ラベルは重心に置く(既定320mm相当・全体設定・個別指定で調整可)
    const cx = pts.reduce((s, p) => s + p.x, 0) / pts.length;
    const cy = pts.reduce((s, p) => s + p.y, 0) / pts.length;
    ctx.fillStyle = opts.muted ? '#8a8f94' : '#222';
    ctx.font = `${fontPx(320, r)}px sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText((opts.code ? opts.code + ' ' : '') + r.label, cx, cy);
    // 選択中は頂点ハンドル(ドラッグで形を修正できる)
    if (opts.selected) {
      for (const p of pts) {
        ctx.fillStyle = '#fff';
        ctx.strokeStyle = '#d32f2f';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.rect(p.x - 4, p.y - 4, 8, 8);
        ctx.fill(); ctx.stroke();
      }
    }
    ctx.restore();
  }

  /* 多角形の寸法表示: 各辺の長さ(m)と頂点番号(P1, P2 …)。
   * 頂点番号は座標求積表の「点」列と対応する。 */
  function drawPolygonDims(ctx, r) {
    const pts = polygonScreenPts(r);
    if (pts.length < 3) return;
    const edges = global.Geometry.polygonEdgesM(r);
    const cx = pts.reduce((s, p) => s + p.x, 0) / pts.length;
    const cy = pts.reduce((s, p) => s + p.y, 0) / pts.length;
    ctx.save();
    ctx.font = `${fontPx(240)}px sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i], b = pts[(i + 1) % pts.length];
      // 辺の中点から重心の反対側(外側)に少し離して辺長を書く
      const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
      const ox = mx - cx, oy = my - cy;
      const d = Math.hypot(ox, oy) || 1;
      ctx.fillStyle = '#1565c0';
      ctx.fillText(edges[i].toFixed(2) + 'm', mx + (ox / d) * wpx(300), my + (oy / d) * wpx(300));
      // 頂点番号は頂点の外側に
      const vx = a.x - cx, vy = a.y - cy;
      const vd = Math.hypot(vx, vy) || 1;
      ctx.fillStyle = '#6a1b9a';
      ctx.fillText('P' + (i + 1), a.x + (vx / vd) * wpx(260), a.y + (vy / vd) * wpx(260));
    }
    ctx.restore();
  }

  /* 作図中の多角形(下書き)を描く */
  function drawDraft(ctx, draft) {
    const pts = draft.points.map((p) => worldToScreen(p.x, p.y));
    if (!pts.length) return;
    ctx.save();
    ctx.strokeStyle = '#2563eb';
    ctx.lineWidth = 2;
    ctx.setLineDash([6, 4]);
    ctx.beginPath();
    ctx.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
    if (draft.cursor) {
      const c = worldToScreen(draft.cursor.x, draft.cursor.y);
      ctx.lineTo(c.x, c.y);
    }
    ctx.stroke();
    ctx.setLineDash([]);
    // 置いた頂点(最初の点は閉じる目印として大きめ)
    pts.forEach((p, i) => {
      ctx.beginPath();
      ctx.arc(p.x, p.y, i === 0 ? 6 : 4, 0, Math.PI * 2);
      ctx.fillStyle = i === 0 ? '#fff' : '#2563eb';
      ctx.strokeStyle = '#2563eb';
      ctx.lineWidth = 2;
      ctx.fill(); ctx.stroke();
    });
    ctx.restore();
  }

  function drawRegion(ctx, r, opts) {
    if (r.shape === 'polygon') { drawPolygonRegion(ctx, r, opts); return; }
    const sc = worldToScreen(r.x + r.w / 2, r.y + r.h / 2); // 中心
    const w = r.w * view.zoom, h = r.h * view.zoom;
    const w2 = (r.w2 != null ? r.w2 : r.w) * view.zoom;
    const pts = shapePoints(r.shape || 'rect', w, h, w2);
    ctx.save();
    ctx.translate(sc.x, sc.y);
    ctx.rotate((r.rotation || 0) * Math.PI / 180);
    tracePoly(ctx, pts);
    if (opts.fill) {
      ctx.globalAlpha = opts.muted ? 0.15 : 0.55; // 強調対象外は薄く塗る
      ctx.fillStyle = r.color;
      ctx.fill();
      ctx.globalAlpha = 1;
    }
    ctx.lineWidth = opts.selected ? 3 : 2;
    ctx.strokeStyle = opts.selected ? '#d32f2f' : (opts.muted ? '#9aa0a6' : (opts.stroke || '#333'));
    ctx.stroke();
    // ラベル(符号つき)。既定は実寸320mm相当(全体設定・個別指定で調整可)
    ctx.fillStyle = opts.muted ? '#8a8f94' : '#222';
    ctx.font = `${fontPx(320, r)}px sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const label = (opts.code ? opts.code + ' ' : '') + r.label;
    ctx.fillText(label, 0, 0);
    ctx.restore();
  }

  /* 寸法線(底辺=下、高さ=左、台形は上底=上)。区画の回転に追従する。 */
  function drawDimension(ctx, r) {
    if (r.shape === 'polygon') { drawPolygonDims(ctx, r); return; }
    const sc = worldToScreen(r.x + r.w / 2, r.y + r.h / 2);
    const w = r.w * view.zoom, h = r.h * view.zoom;
    const shape = r.shape || 'rect';
    const off = wpx(300); // 寸法線の離れ(実寸300mm相当)
    ctx.save();
    ctx.translate(sc.x, sc.y);
    ctx.rotate((r.rotation || 0) * Math.PI / 180);
    ctx.strokeStyle = '#1565c0';
    ctx.fillStyle = '#1565c0';
    ctx.lineWidth = 1;
    ctx.font = `${fontPx(240)}px sans-serif`;
    ctx.textAlign = 'center';
    // 底辺/幅(下辺の外側)
    const by = h / 2 + off;
    ctx.textBaseline = 'top';
    ctx.beginPath(); ctx.moveTo(-w / 2, by); ctx.lineTo(w / 2, by); ctx.stroke();
    tick(ctx, -w / 2, by); tick(ctx, w / 2, by);
    ctx.fillText(global.Geometry.fmtM(r.w) + 'm', 0, by + wpx(50));
    // 高さ/奥行(左辺の外側)
    const wx = -w / 2 - off;
    ctx.textBaseline = 'bottom';
    ctx.beginPath(); ctx.moveTo(wx, -h / 2); ctx.lineTo(wx, h / 2); ctx.stroke();
    tick(ctx, wx, -h / 2); tick(ctx, wx, h / 2);
    ctx.save();
    ctx.translate(wx - wpx(50), 0);
    ctx.rotate(-Math.PI / 2);
    ctx.fillText(global.Geometry.fmtM(r.h) + 'm', 0, 0);
    ctx.restore();
    // 台形のみ:上底(上辺の外側)
    if (shape === 'trapezoid') {
      const w2 = (r.w2 != null ? r.w2 : r.w) * view.zoom;
      const ty = -h / 2 - off;
      ctx.textBaseline = 'bottom';
      ctx.beginPath(); ctx.moveTo(-w2 / 2, ty); ctx.lineTo(w2 / 2, ty); ctx.stroke();
      tick(ctx, -w2 / 2, ty); tick(ctx, w2 / 2, ty);
      ctx.fillText(global.Geometry.fmtM(r.w2 != null ? r.w2 : r.w) + 'm', 0, ty - wpx(50));
    }
    ctx.restore();
  }
  function tick(ctx, x, y) {
    const t = wpx(70); // 目盛の長さ(実寸70mm相当)
    ctx.beginPath(); ctx.moveTo(x, y - t); ctx.lineTo(x, y + t); ctx.stroke();
  }

  function drawFurniture(ctx, f, opts) {
    const p = worldToScreen(f.x, f.y);
    const w = f.w * view.zoom, h = f.h * view.zoom;
    ctx.save();
    ctx.translate(p.x + w / 2, p.y + h / 2);
    ctx.rotate((f.rotation || 0) * Math.PI / 180);
    const over = typeof f.height === 'number' && f.height > global.Model.SIGHTLINE_LIMIT;
    ctx.fillStyle = over ? 'rgba(255,205,210,0.7)' : 'rgba(255,255,255,0.85)';
    ctx.lineWidth = opts.selected ? 3 : 1.5;
    ctx.strokeStyle = opts.selected ? '#d32f2f' : (over ? '#c62828' : '#555');
    const isL = f.kind === 'counterL';
    if (isL) {
      // L字: 外形 w×h から右下を欠いた形。上辺が横の腕、左辺が縦の腕。
      const t = Math.min(f.t || 600, f.w, f.h) * view.zoom;
      ctx.beginPath();
      ctx.moveTo(-w / 2, -h / 2);          // 左上
      ctx.lineTo(w / 2, -h / 2);           // 右上
      ctx.lineTo(w / 2, -h / 2 + t);       // 右上から厚み分下へ
      ctx.lineTo(-w / 2 + t, -h / 2 + t);  // 内側の角
      ctx.lineTo(-w / 2 + t, h / 2);       // 左の腕の内側を下へ
      ctx.lineTo(-w / 2, h / 2);           // 左下
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
    } else {
      ctx.fillRect(-w / 2, -h / 2, w, h);
      ctx.strokeRect(-w / 2, -h / 2, w, h);
    }
    // ラベルは既定200mm相当(調整可)。文字より小さい備品(つい立て等)には描かない
    // 番号(①②…)はサイズ違いの区別用(同じ種類・同じ寸法なら同じ番号)
    const fpx = fontPx(200, f);
    // L字はくり抜き部分を避けて上の腕の中央にラベルを置く
    const labelY = isL ? -h / 2 + Math.min(f.t || 600, f.w, f.h) * view.zoom / 2 : 0;
    const fitH = isL ? Math.min(f.t || 600, f.w, f.h) * view.zoom : h;
    if (Math.min(w, fitH) > fpx * 1.7) {
      const num = opts.num ? global.Geometry.code(opts.num) : '';
      ctx.fillStyle = '#333';
      ctx.font = `${fpx}px sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(f.label + num, 0, labelY);
    }
    ctx.restore();
  }

  /* 建具・設備(出入口・扉・窓・壁・柱)を製図記号で描く */
  function drawFitting(ctx, g, opts) {
    const sc = worldToScreen(g.x + g.w / 2, g.y + g.h / 2);
    const w = g.w * view.zoom, h = g.h * view.zoom;
    const sel = opts.selected;
    ctx.save();
    ctx.translate(sc.x, sc.y);
    ctx.rotate((g.rotation || 0) * Math.PI / 180);
    ctx.lineWidth = sel ? 3 : 1.5;
    const line = sel ? '#d32f2f' : '#37474f';

    if (g.kind === 'wall') {
      ctx.fillStyle = sel ? 'rgba(211,47,47,.85)' : '#546e7a';
      ctx.fillRect(-w / 2, -h / 2, w, h);
    } else if (g.kind === 'pillar') {
      ctx.fillStyle = sel ? 'rgba(211,47,47,.85)' : '#455a64';
      ctx.fillRect(-w / 2, -h / 2, w, h);
      ctx.strokeStyle = '#263238';
      ctx.strokeRect(-w / 2, -h / 2, w, h);
    } else if (g.kind === 'window') {
      // 枠 + 二重線(ガラス)
      ctx.strokeStyle = sel ? '#d32f2f' : '#1565c0';
      ctx.strokeRect(-w / 2, -h / 2, w, h);
      ctx.beginPath();
      ctx.moveTo(-w / 2, -h * 0.16); ctx.lineTo(w / 2, -h * 0.16);
      ctx.moveTo(-w / 2, h * 0.16);  ctx.lineTo(w / 2, h * 0.16);
      ctx.stroke();
    } else if (g.kind === 'door') {
      // 開口の下枠 + 扉の葉 + 開閉軌跡(円弧)
      const hx = -w / 2; // ヒンジ(左端)
      ctx.strokeStyle = line;
      ctx.beginPath(); ctx.moveTo(-w / 2, 0); ctx.lineTo(w / 2, 0); ctx.stroke(); // 開口
      ctx.beginPath(); ctx.moveTo(hx, 0); ctx.lineTo(hx, -w); ctx.stroke();       // 葉(開いた状態)
      ctx.beginPath(); ctx.arc(hx, 0, w, -Math.PI / 2, 0); ctx.stroke();          // 軌跡
    } else if (g.kind === 'entrance') {
      // 開口(両端のジャム)+ 出入りの両矢印 + ラベル
      ctx.strokeStyle = line;
      ctx.beginPath();
      ctx.moveTo(-w / 2, -h / 2); ctx.lineTo(-w / 2, h / 2);
      ctx.moveTo(w / 2, -h / 2);  ctx.lineTo(w / 2, h / 2);
      ctx.stroke();
      arrow(ctx, -w / 2 + 2, 0, w / 2 - 2, 0); // 両矢印
      ctx.fillStyle = line;
      ctx.font = `${fontPx(200, g)}px sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      ctx.fillText('出入口', 0, h / 2 + wpx(50));
    }
    ctx.restore();
  }

  /* 簡易の両矢印(始点・終点に三角) */
  function arrow(ctx, x1, y1, x2, y2) {
    const a = Math.atan2(y2 - y1, x2 - x1);
    const head = 5;
    ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
    const tip = (x, y, dir) => {
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x - head * Math.cos(a - 0.4) * dir, y - head * Math.sin(a - 0.4) * dir);
      ctx.moveTo(x, y);
      ctx.lineTo(x - head * Math.cos(a + 0.4) * dir, y - head * Math.sin(a + 0.4) * dir);
      ctx.stroke();
    };
    tip(x2, y2, 1); tip(x1, y1, -1);
  }

  function drawFixture(ctx, x, opts) {
    const p = worldToScreen(x.x, x.y);
    const r = wpx(220); // アイコン半径(実寸220mm相当・図面に対して固定)
    const sym = (global.Model.FIXTURE_CATALOG[x.kind] || {}).symbol || '?';
    ctx.save();
    ctx.beginPath();
    ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
    ctx.fillStyle = opts.selected ? '#ffe082' : '#fff8e1';
    ctx.fill();
    ctx.lineWidth = opts.selected ? 3 : 1.5;
    ctx.strokeStyle = opts.selected ? '#d32f2f' : '#f9a825';
    ctx.stroke();
    ctx.fillStyle = '#5d4037';
    ctx.font = `bold ${wpx(170)}px sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(sym, p.x, p.y);
    // 名称は図面下部の凡例にまとめるため、アイコンには記号だけを表示する
    ctx.restore();
  }

  /* 凡例(図面右下): 使われている設備の記号・名称・台数・W数と、
   * 自由記入のコメント(meta.lightingNote)をまとめて表示する。 */
  function drawFixtureLegend(ctx, canvas, project) {
    const list = global.Geometry.fixtureSummary(project);
    const note = (project.meta.lightingNote || '').trim();
    if (!list.length && !note) return;

    const rows = list.map((g) =>
      `${g.label} ${g.count}台${g.watt ? `(${g.watt}W)` : ''}`);
    const noteLines = note ? note.split('\n') : [];
    const title = '凡例(照明・音響設備)';
    // 大きさはすべて実寸基準(図面に対して固定サイズ)
    const lineH = wpx(380), pad = wpx(200), iconW = wpx(500);
    const fontN = `${wpx(250)}px sans-serif`;
    const fontB = `bold ${wpx(250)}px sans-serif`;

    ctx.save();
    ctx.font = fontN;
    let wMax = ctx.measureText(title).width;
    for (const t of rows) wMax = Math.max(wMax, iconW + ctx.measureText(t).width);
    for (const t of noteLines) wMax = Math.max(wMax, ctx.measureText(t).width);
    const w = wMax + pad * 2;
    const lines = 1 + rows.length + noteLines.length;
    const h = pad * 2 + lineH * lines;
    const x0 = canvas.width - w - wpx(280);
    const y0 = canvas.height - h - wpx(280);

    // 枠
    ctx.fillStyle = 'rgba(255,255,255,0.93)';
    ctx.strokeStyle = '#333';
    ctx.lineWidth = 1;
    ctx.fillRect(x0, y0, w, h);
    ctx.strokeRect(x0, y0, w, h);

    // タイトル
    ctx.fillStyle = '#222';
    ctx.font = fontB;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    let y = y0 + pad + lineH / 2;
    ctx.fillText(title, x0 + pad, y);

    // 設備の行(アイコン + 名称・台数)
    const iconR = wpx(160);
    for (let i = 0; i < list.length; i++) {
      y += lineH;
      const cx = x0 + pad + iconR, cy = y;
      ctx.beginPath();
      ctx.arc(cx, cy, iconR, 0, Math.PI * 2);
      ctx.fillStyle = '#fff8e1';
      ctx.fill();
      ctx.strokeStyle = '#f9a825';
      ctx.stroke();
      ctx.fillStyle = '#5d4037';
      ctx.font = `bold ${wpx(150)}px sans-serif`;
      ctx.textAlign = 'center';
      ctx.fillText(list[i].symbol, cx, cy);
      ctx.fillStyle = '#222';
      ctx.font = fontN;
      ctx.textAlign = 'left';
      ctx.fillText(rows[i], x0 + pad + iconW, y);
    }

    // 自由記入のコメント
    ctx.fillStyle = '#444';
    for (const t of noteLines) {
      y += lineH;
      ctx.fillText(t, x0 + pad, y);
    }
    ctx.restore();
  }

  /* 用紙枠(用紙サイズ×縮尺がカバーする実寸範囲)をワールド座標で返す。
   * 例: A4横・1/50 → 297mm×50 = 14850mm ×、210mm×50 = 10500mm。原点は(0,0)。 */
  function paperFrameWorld(project) {
    const m = project.meta;
    const p = global.Model.PAPER_SIZES[m.paper] || global.Model.PAPER_SIZES.A4;
    const landscape = m.orientation !== 'portrait';
    return {
      x: 0, y: 0,
      w: (landscape ? p.w : p.h) * m.scale,
      h: (landscape ? p.h : p.w) * m.scale,
    };
  }

  /* 用紙枠ガイドを描く。枠の右下に縮尺を自動表示する。 */
  function drawPaperFrame(ctx, project) {
    const f = paperFrameWorld(project);
    const tl = worldToScreen(f.x, f.y);
    const br = worldToScreen(f.x + f.w, f.y + f.h);
    const m = project.meta;
    ctx.save();
    // 枠(青の破線)
    ctx.strokeStyle = '#1d4ed8';
    ctx.lineWidth = 2;
    ctx.setLineDash([10, 6]);
    ctx.strokeRect(tl.x, tl.y, br.x - tl.x, br.y - tl.y);
    ctx.setLineDash([]);
    // 左上: 用紙の説明(実寸240mm相当の固定サイズ)
    ctx.fillStyle = '#1d4ed8';
    ctx.font = `${wpx(240)}px sans-serif`;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'bottom';
    const orient = m.orientation === 'portrait' ? '縦' : '横';
    ctx.fillText(
      `用紙枠 ${m.paper}${orient}(この枠内 = ${(f.w / 1000).toFixed(2)} × ${(f.h / 1000).toFixed(2)} m)`,
      tl.x, tl.y - wpx(90));
    // 右下: スケールバー(黒線の長さ = 図面上の1m)と縮尺表示。各部も実寸基準
    const barLen = wpx(1000); // 1m分の画面上の長さ
    const bx2 = br.x - wpx(280), bx1 = bx2 - barLen;
    const by = br.y - wpx(620); // 下のラベルが枠線にかからない高さ
    ctx.strokeStyle = '#111';
    ctx.fillStyle = '#111';
    ctx.lineWidth = 2;
    // 本体の線
    ctx.beginPath(); ctx.moveTo(bx1, by); ctx.lineTo(bx2, by); ctx.stroke();
    // 両端の目盛(縦線)と中央(0.5m)の小さい目盛
    const tk = wpx(130), tkS = wpx(65);
    ctx.beginPath();
    ctx.moveTo(bx1, by - tk); ctx.lineTo(bx1, by + tk);
    ctx.moveTo(bx2, by - tk); ctx.lineTo(bx2, by + tk);
    ctx.moveTo((bx1 + bx2) / 2, by - tkS); ctx.lineTo((bx1 + bx2) / 2, by + tkS);
    ctx.stroke();
    // ラベル: 線の両端に 0 / 1m、上に縮尺
    ctx.font = `bold ${wpx(240)}px sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.fillText('0', bx1, by + wpx(180));
    ctx.fillText('1m', bx2, by + wpx(180));
    ctx.textAlign = 'right';
    ctx.textBaseline = 'bottom';
    ctx.fillText(`縮尺 1/${m.scale}`, bx2, by - wpx(180));
    ctx.restore();
  }

  /* 方位記号の中心位置(画面px)。用紙枠の表示中は枠内右上に置き、
   * 非表示なら従来どおり画面の右上に固定する。 */
  function northMarkCenter(canvas, project) {
    if (project.meta.showPaperFrame) {
      const f = paperFrameWorld(project);
      const s = worldToScreen(f.x + f.w, f.y);
      return { x: s.x - wpx(950), y: s.y + wpx(1100) };
    }
    return { x: canvas.width - 40, y: 46 };
  }

  /* 方位記号の形状(中心・半径・Nの先端位置)。当たり判定にも使う。
   * 大きさは実寸基準(半径400mm相当)で、図面に対して固定サイズ。 */
  function getNorthMark(canvas, project) {
    const c = northMarkCenter(canvas, project);
    const r = wpx(400);
    const a = (project.meta.northAngle || 0) * Math.PI / 180;
    // 角度0で真上。先端は円の外側(r+220mm相当)あたり。
    const tipR = r + wpx(220);
    const tip = { x: c.x + Math.sin(a) * tipR, y: c.y - Math.cos(a) * tipR };
    return { cx: c.x, cy: c.y, r, tip, angle: a };
  }

  /* 方位記号(北マーク)。Nの先端をドラッグすると360度回転できる。 */
  function drawNorthMark(ctx, canvas, project) {
    const n = getNorthMark(canvas, project);
    const { cx, cy, r } = n;
    ctx.save();
    ctx.strokeStyle = '#333'; ctx.fillStyle = '#333'; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.stroke();
    // 矢印(角度に追従して回転。各部は半径に比例)
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(n.angle);
    ctx.beginPath();
    ctx.moveTo(0, -r * 1.33);
    ctx.lineTo(-r * 0.33, r * 0.22);
    ctx.lineTo(0, -r * 0.11);
    ctx.lineTo(r * 0.33, r * 0.22);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
    // N の文字は先端の少し外側(文字自体は回転させず読みやすく)
    const lr = r + wpx(380);
    const lx = cx + Math.sin(n.angle) * lr;
    const ly = cy - Math.cos(n.angle) * lr;
    ctx.font = `bold ${wpx(280)}px sans-serif`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('N', lx, ly);
    ctx.restore();
  }

  /* ---- 営業所外周(壁)の描画 ---- */

  /* 平面系のレイヤーに壁を二重線で描く。壁厚ぶんの帯を塗り、内外の輪郭線を引く。
   * 選択中は赤くし、入力した頂点(ドラッグで編集できる点)にハンドルを出す。 */
  function drawPremiseWalls(ctx, project, opts) {
    const pr = project.premise;
    if (!pr || (pr.points || []).length < 3) return;
    const wp = global.Geometry.premiseWallPolysAbs(pr);
    const inner = wp.inner.map((p) => worldToScreen(p.x, p.y));
    const outer = wp.outer.map((p) => worldToScreen(p.x, p.y));
    ctx.save();
    // 壁の帯(外側の輪郭と内側の輪郭で囲まれた部分)
    ctx.beginPath();
    ctx.moveTo(outer[0].x, outer[0].y);
    for (let i = 1; i < outer.length; i++) ctx.lineTo(outer[i].x, outer[i].y);
    ctx.closePath();
    ctx.moveTo(inner[0].x, inner[0].y);
    for (let i = 1; i < inner.length; i++) ctx.lineTo(inner[i].x, inner[i].y);
    ctx.closePath();
    ctx.globalAlpha = opts.muted ? 0.25 : 0.8;
    ctx.fillStyle = '#b0bec5';
    ctx.fill('evenodd');
    ctx.globalAlpha = 1;
    // 内外の輪郭線
    ctx.lineWidth = opts.selected ? 2.5 : 1.5;
    ctx.strokeStyle = opts.selected ? '#d32f2f' : (opts.muted ? '#9aa0a6' : '#37474f');
    for (const poly of [outer, inner]) {
      ctx.beginPath();
      ctx.moveTo(poly[0].x, poly[0].y);
      for (let i = 1; i < poly.length; i++) ctx.lineTo(poly[i].x, poly[i].y);
      ctx.closePath();
      ctx.stroke();
    }
    // ラベル(外周の左上の外側)
    if (!opts.muted) {
      const top = outer.reduce((a, p) => (p.y < a.y ? p : a), outer[0]);
      ctx.fillStyle = '#37474f';
      ctx.font = `${fontPx(240)}px sans-serif`;
      ctx.textAlign = 'left';
      ctx.textBaseline = 'bottom';
      ctx.fillText(`営業所外周(壁厚${pr.wallThickness}mm)`, top.x, top.y - wpx(120));
    }
    // 選択中: 入力頂点のハンドル(ドラッグで形を修正できる)
    if (opts.selected) {
      for (const p of pr.points) {
        const s = worldToScreen(pr.x + p.x, pr.y + p.y);
        ctx.fillStyle = '#fff';
        ctx.strokeStyle = '#d32f2f';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.rect(s.x - 4, s.y - 4, 8, 8);
        ctx.fill(); ctx.stroke();
      }
    }
    ctx.restore();
  }

  /* 営業所求積図: 壁芯線(実線)と辺長・頂点番号を描く。
   * 頂点番号(P1, P2 …)は壁芯の座標求積表と対応する。 */
  function drawPremiseCenterline(ctx, project) {
    const pr = project.premise;
    if (!pr || (pr.points || []).length < 3) return;
    const rl = global.Geometry.premiseRegionLike(pr);
    const pts = rl.points.map((p) => worldToScreen(rl.x + p.x, rl.y + p.y));
    const police = project.meta.colorMode === 'police';
    ctx.save();
    ctx.strokeStyle = police ? '#1d4ed8' : '#111';
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
    ctx.closePath();
    ctx.stroke();
    ctx.restore();
    drawPolygonDims(ctx, rl); // 辺長(m)と P1, P2 … を共通処理で付ける
    // 凡例的なラベル
    const top = pts.reduce((a, p) => (p.y < a.y ? p : a), pts[0]);
    ctx.save();
    ctx.fillStyle = police ? '#1d4ed8' : '#111';
    ctx.font = `bold ${fontPx(260)}px sans-serif`;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'bottom';
    ctx.fillText('壁芯線(営業所求積)', top.x + wpx(300), top.y - wpx(420));
    ctx.restore();
  }

  /* ---- 備品姿図(正面図・側面図) ---- */

  /* 同寸法グループごとのセル配置を計算する(ワールドmm)。
   * 1セル = ラベル + 正面図(幅×高さ) + 側面図(奥行×高さ) + 寸法。 */
  function furnViewLayout(project) {
    const groups = global.Geometry.furnitureGroups(project);
    const LABEL_H = 700, DIM_H = 900, GAP = 1500, CELL_GAP = 2600, ROW_GAP = 1600;
    const MAX_W = 14000; // 1行の最大幅(mm)。超えたら折り返す
    const cells = [];
    let x = 0, rowTop = 1000, rowMaxH = 0, row = [];
    const rows = [];
    const flushRow = () => {
      if (!row.length) return;
      // 行内で床の高さ(ベースライン)を揃える
      const floorY = rowTop + LABEL_H + rowMaxH;
      for (const c of row) c.floorY = floorY;
      rows.push({ top: rowTop, floorY, right: x });
      rowTop = floorY + DIM_H + ROW_GAP;
      x = 0; rowMaxH = 0; row = [];
    };
    for (const g of groups) {
      const cellW = g.w + GAP + g.h + 1800; // 正面 + 側面 + 高さ寸法の余白
      if (x > 0 && x + cellW > MAX_W) flushRow();
      const cell = { g, x: x + 1000, cellW };
      row.push(cell); cells.push(cell);
      rowMaxH = Math.max(rowMaxH, g.height);
      x += cellW + CELL_GAP;
    }
    flushRow();
    const maxRight = rows.reduce((m, r) => Math.max(m, r.right), 6000);
    const bottom = rows.length ? rows[rows.length - 1].floorY + DIM_H : 4000;
    return { cells, rows, bounds: { x: 0, y: 0, w: maxRight + 2000, h: bottom + 1000 } };
  }

  /* 備品姿図を描く。グループごとに正面図と側面図を並べ、寸法と番号を付ける。
   * 床から1mの位置に基準線を引き、見通し規制(高さ1m)と見比べられるようにする。 */
  function drawFurnViews(ctx, canvas, project) {
    const layout = furnViewLayout(project);
    const G = global.Geometry;
    ctx.save();
    // タイトル
    const t0 = worldToScreen(1000, 300);
    ctx.fillStyle = '#222';
    ctx.font = `bold ${fontPx(360)}px sans-serif`;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillText('備品姿図(正面図・側面図) — 基準線は床から1m(見通し規制)', t0.x, t0.y);
    if (!layout.cells.length) {
      ctx.font = `${fontPx(300)}px sans-serif`;
      ctx.fillStyle = '#777';
      ctx.fillText('備品がありません。平面図で備品を追加してください。', t0.x, t0.y + wpx(700));
      ctx.restore();
      return;
    }
    for (const r of layout.rows) {
      // 床線(行ごと)
      const f1 = worldToScreen(600, r.floorY), f2 = worldToScreen(r.right + 600, r.floorY);
      ctx.strokeStyle = '#333';
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(f1.x, f1.y); ctx.lineTo(f2.x, f2.y); ctx.stroke();
      // 1m 基準線(赤の破線)
      const m1 = worldToScreen(600, r.floorY - 1000), m2 = worldToScreen(r.right + 600, r.floorY - 1000);
      ctx.strokeStyle = '#c62828';
      ctx.lineWidth = 1.5;
      ctx.setLineDash([8, 5]);
      ctx.beginPath(); ctx.moveTo(m1.x, m1.y); ctx.lineTo(m2.x, m2.y); ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = '#c62828';
      ctx.font = `${fontPx(220)}px sans-serif`;
      ctx.textAlign = 'left';
      ctx.textBaseline = 'bottom';
      ctx.fillText('1m', m2.x + wpx(100), m2.y);
    }
    for (const c of layout.cells) {
      const g = c.g;
      const over = g.over;
      const line = over ? '#c62828' : '#333';
      const fill = over ? 'rgba(255,205,210,0.5)' : 'rgba(250,250,250,0.9)';
      // ラベル(品名 + サイズ番号 + 台数)
      const name = `${g.label}${G.code(g.number)}(${g.count}台)` + (over ? ' ⚠高さ1m超' : '');
      const lp = worldToScreen(c.x, c.floorY - g.height - 250);
      ctx.fillStyle = over ? '#c62828' : '#222';
      ctx.font = `bold ${fontPx(260)}px sans-serif`;
      ctx.textAlign = 'left';
      ctx.textBaseline = 'bottom';
      ctx.fillText(name, lp.x, lp.y);
      // 正面図(幅 × 高さ) と 側面図(奥行 × 高さ)
      const views = [
        { x0: c.x, w: g.w, cap: '正面', dim: g.w },
        { x0: c.x + g.w + 1500, w: g.h, cap: '側面', dim: g.h },
      ];
      for (const v of views) {
        const tl = worldToScreen(v.x0, c.floorY - g.height);
        const br = worldToScreen(v.x0 + v.w, c.floorY);
        ctx.fillStyle = fill;
        ctx.fillRect(tl.x, tl.y, br.x - tl.x, br.y - tl.y);
        ctx.strokeStyle = line;
        ctx.lineWidth = 1.5;
        ctx.strokeRect(tl.x, tl.y, br.x - tl.x, br.y - tl.y);
        // 下に「正面 幅0.60m」のように寸法を書く
        ctx.fillStyle = '#1565c0';
        ctx.font = `${fontPx(220)}px sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'top';
        const label = v.cap === '正面' ? `正面 幅${G.fmtM(v.dim)}m` : `側面 奥行${G.fmtM(v.dim)}m`;
        ctx.fillText(label, (tl.x + br.x) / 2, br.y + wpx(150));
      }
      // 高さ寸法(側面図の右側に縦書き)
      const hx = worldToScreen(c.x + g.w + 1500 + g.h + 400, c.floorY - g.height / 2);
      ctx.save();
      ctx.translate(hx.x, hx.y);
      ctx.rotate(-Math.PI / 2);
      ctx.fillStyle = over ? '#c62828' : '#1565c0';
      ctx.font = `${fontPx(220)}px sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(`高さ${G.fmtM(g.height)}m`, 0, 0);
      ctx.restore();
    }
    ctx.restore();
  }

  /* どのレイヤーで何を表示するか */
  function visibility(layer) {
    switch (layer) {
      case 'plan':
        return { regionsFill: true, allRegions: true, regionTypes: null,
                 furniture: true, fittings: true, fixtures: false, dims: true, table: false };
      case 'premises':
        return { regionsFill: false, allRegions: true, regionTypes: null,
                 furniture: false, fittings: false, fixtures: false, dims: true, table: 'all' };
      case 'kyakushitsu':
        // 全区画を表示して間取りがわかるようにし、客室・調理場だけ強調(色+寸法)
        return { regionsFill: true, allRegions: true, regionTypes: null,
                 highlightTypes: ['kyakushitsu', 'chubo'],
                 furniture: false, fittings: false, fixtures: false, dims: true, table: 'kyakuchubo' };
      case 'lighting':
        return { regionsFill: true, allRegions: true, regionTypes: null,
                 furniture: false, fittings: false, fixtures: true, dims: false, table: 'fixtures' };
      case 'furnviews':
        // 備品姿図: 間取りは描かず、備品の正面図・側面図だけを並べる
        return { regionsFill: false, allRegions: false, regionTypes: [],
                 furniture: false, fittings: false, fixtures: false, dims: false, table: 'furniture' };
      default:
        return { regionsFill: true, allRegions: true, regionTypes: null,
                 furniture: true, fittings: true, fixtures: true, dims: true, table: false };
    }
  }

  /* 求積図の線色(色分けモード時)。営業所=青・客室=赤・調理場=緑の慣行色。 */
  function strokeFor(r, project) {
    if (project.meta.colorMode !== 'police') return null;
    if (currentLayer === 'kyakushitsu') {
      if (r.type === 'kyakushitsu') return '#e53935';
      if (r.type === 'chubo') return '#2e7d32';
    }
    return null;
  }

  function render(ctx, canvas, project, state, opts) {
    const vis = visibility(currentLayer);
    fontScale = (project.meta.fontScale || 100) / 100; // 全体の文字サイズ設定を反映
    clear(ctx, canvas);
    drawGrid(ctx, canvas);
    if (project.meta.showPaperFrame) {
      drawPaperFrame(ctx, project);
    }

    // 備品姿図は間取りを描かず、姿図シートだけを描いて終わる
    if (currentLayer === 'furnviews') {
      drawFurnViews(ctx, canvas, project);
      return;
    }

    // 下絵(トレース用)。画面での作図補助なので、印刷・PDF出力には含めない
    if (!(opts && opts.print)) {
      drawUnderlay(ctx, project);
    }

    // 営業所外周(壁)。平面図・営業所求積図でははっきり、その他では薄く描く
    if (project.premise) {
      drawPremiseWalls(ctx, project, {
        muted: currentLayer !== 'plan' && currentLayer !== 'premises',
        selected: state.selectedId === 'premise',
      });
    }

    const regions = project.regions.filter((r) =>
      vis.allRegions || (vis.regionTypes && vis.regionTypes.indexOf(r.type) >= 0));

    // highlightTypes がある図面では、対象の区画だけ強調し、他は薄く描いて間取りを示す
    const isMain = (r) => !vis.highlightTypes || vis.highlightTypes.indexOf(r.type) >= 0;

    for (const r of regions) {
      const code = global.Geometry.code(project.regions.indexOf(r) + 1); // 符号①②③…
      drawRegion(ctx, r, {
        fill: vis.regionsFill,
        muted: !isMain(r),
        selected: state.selectedId === r.id,
        stroke: strokeFor(r, project),
        code,
      });
    }
    if (vis.dims) {
      // 寸法は強調対象(求積する区画)にだけ付けて、図面が混み合わないようにする
      for (const r of regions) { if (isMain(r)) drawDimension(ctx, r); }
    }
    if (vis.fittings && project.fittings) {
      for (const g of project.fittings) {
        drawFitting(ctx, g, { selected: state.selectedId === g.id });
      }
    }
    if (vis.furniture) {
      const nums = global.Geometry.furnitureNumberMap(project);
      for (const f of project.furniture) {
        drawFurniture(ctx, f, { selected: state.selectedId === f.id, num: nums[f.id] });
      }
    }
    if (vis.fixtures) {
      for (const x of project.fixtures) {
        drawFixture(ctx, x, { selected: state.selectedId === x.id });
      }
      drawFixtureLegend(ctx, canvas, project);
    }
    // 営業所求積図では壁芯線(求積の根拠になる線)を最前面側に描く
    if (currentLayer === 'premises' && project.premise) {
      drawPremiseCenterline(ctx, project);
    }
    // 多角形の作図中なら下書きを最前面に描く
    if (state.draft && state.draft.points) {
      drawDraft(ctx, state.draft);
    }
    if (project.meta.showNorthMark) {
      drawNorthMark(ctx, canvas, project);
    }
  }

  global.Render = {
    view, LAYERS, setLayer, getLayer, visibility,
    worldToScreen, screenToWorld, fitToView, render,
    paperFrameWorld, getNorthMark, setRedrawCallback,
  };
})(window);
