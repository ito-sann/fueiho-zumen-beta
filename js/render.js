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
  };
  let currentLayer = 'plan';

  function setLayer(name) { if (LAYERS[name]) currentLayer = name; }
  function getLayer() { return currentLayer; }

  function worldToScreen(x, y) {
    return { x: x * view.zoom + view.offsetX, y: y * view.zoom + view.offsetY };
  }
  function screenToWorld(px, py) {
    return { x: (px - view.offsetX) / view.zoom, y: (py - view.offsetY) / view.zoom };
  }

  /* 全要素が収まるようにビューを合わせる(用紙枠の表示中は枠も含める) */
  function fitToView(project, canvas) {
    let bb = global.Geometry.boundingBox(project);
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
      ctx.globalAlpha = 0.55;
      ctx.fillStyle = r.color;
      ctx.fill();
      ctx.globalAlpha = 1;
    }
    ctx.lineWidth = opts.selected ? 3 : 2;
    ctx.strokeStyle = opts.selected ? '#d32f2f' : '#333';
    ctx.stroke();
    // ラベルは重心に置く
    const cx = pts.reduce((s, p) => s + p.x, 0) / pts.length;
    const cy = pts.reduce((s, p) => s + p.y, 0) / pts.length;
    ctx.fillStyle = '#222';
    ctx.font = '13px sans-serif';
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
    ctx.font = '11px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i], b = pts[(i + 1) % pts.length];
      // 辺の中点から重心の反対側(外側)に少し離して辺長を書く
      const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
      const ox = mx - cx, oy = my - cy;
      const d = Math.hypot(ox, oy) || 1;
      ctx.fillStyle = '#1565c0';
      ctx.fillText(edges[i].toFixed(2) + 'm', mx + (ox / d) * 14, my + (oy / d) * 14);
      // 頂点番号は頂点の外側に
      const vx = a.x - cx, vy = a.y - cy;
      const vd = Math.hypot(vx, vy) || 1;
      ctx.fillStyle = '#6a1b9a';
      ctx.fillText('P' + (i + 1), a.x + (vx / vd) * 12, a.y + (vy / vd) * 12);
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
      ctx.globalAlpha = 0.55;
      ctx.fillStyle = r.color;
      ctx.fill();
      ctx.globalAlpha = 1;
    }
    ctx.lineWidth = opts.selected ? 3 : 2;
    ctx.strokeStyle = opts.selected ? '#d32f2f' : '#333';
    ctx.stroke();
    // ラベル(符号つき)
    ctx.fillStyle = '#222';
    ctx.font = '13px sans-serif';
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
    const off = 14;
    ctx.save();
    ctx.translate(sc.x, sc.y);
    ctx.rotate((r.rotation || 0) * Math.PI / 180);
    ctx.strokeStyle = '#1565c0';
    ctx.fillStyle = '#1565c0';
    ctx.lineWidth = 1;
    ctx.font = '11px sans-serif';
    ctx.textAlign = 'center';
    // 底辺/幅(下辺の外側)
    const by = h / 2 + off;
    ctx.textBaseline = 'top';
    ctx.beginPath(); ctx.moveTo(-w / 2, by); ctx.lineTo(w / 2, by); ctx.stroke();
    tick(ctx, -w / 2, by); tick(ctx, w / 2, by);
    ctx.fillText(global.Geometry.fmtM(r.w) + 'm', 0, by + 2);
    // 高さ/奥行(左辺の外側)
    const wx = -w / 2 - off;
    ctx.textBaseline = 'bottom';
    ctx.beginPath(); ctx.moveTo(wx, -h / 2); ctx.lineTo(wx, h / 2); ctx.stroke();
    tick(ctx, wx, -h / 2); tick(ctx, wx, h / 2);
    ctx.save();
    ctx.translate(wx - 2, 0);
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
      ctx.fillText(global.Geometry.fmtM(r.w2 != null ? r.w2 : r.w) + 'm', 0, ty - 2);
    }
    ctx.restore();
  }
  function tick(ctx, x, y) {
    ctx.beginPath(); ctx.moveTo(x, y - 3); ctx.lineTo(x, y + 3); ctx.stroke();
  }

  function drawFurniture(ctx, f, opts) {
    const p = worldToScreen(f.x, f.y);
    const w = f.w * view.zoom, h = f.h * view.zoom;
    ctx.save();
    ctx.translate(p.x + w / 2, p.y + h / 2);
    ctx.rotate((f.rotation || 0) * Math.PI / 180);
    const over = typeof f.height === 'number' && f.height > global.Model.SIGHTLINE_LIMIT;
    ctx.fillStyle = over ? 'rgba(255,205,210,0.7)' : 'rgba(255,255,255,0.85)';
    ctx.fillRect(-w / 2, -h / 2, w, h);
    ctx.lineWidth = opts.selected ? 3 : 1.5;
    ctx.strokeStyle = opts.selected ? '#d32f2f' : (over ? '#c62828' : '#555');
    ctx.strokeRect(-w / 2, -h / 2, w, h);
    if (Math.min(w, h) > 22) {
      ctx.fillStyle = '#333';
      ctx.font = '10px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(f.label, 0, 0);
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
      ctx.font = '10px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      ctx.fillText('出入口', 0, h / 2 + 2);
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
    const r = 10;
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
    ctx.font = 'bold 9px sans-serif';
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
    const lineH = 17, pad = 9, iconW = 22;

    ctx.save();
    ctx.font = '11px sans-serif';
    let wMax = ctx.measureText(title).width;
    for (const t of rows) wMax = Math.max(wMax, iconW + ctx.measureText(t).width);
    for (const t of noteLines) wMax = Math.max(wMax, ctx.measureText(t).width);
    const w = wMax + pad * 2;
    const lines = 1 + rows.length + noteLines.length;
    const h = pad * 2 + lineH * lines;
    const x0 = canvas.width - w - 12;
    const y0 = canvas.height - h - 12;

    // 枠
    ctx.fillStyle = 'rgba(255,255,255,0.93)';
    ctx.strokeStyle = '#333';
    ctx.lineWidth = 1;
    ctx.fillRect(x0, y0, w, h);
    ctx.strokeRect(x0, y0, w, h);

    // タイトル
    ctx.fillStyle = '#222';
    ctx.font = 'bold 11px sans-serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    let y = y0 + pad + lineH / 2;
    ctx.fillText(title, x0 + pad, y);

    // 設備の行(アイコン + 名称・台数)
    ctx.font = '11px sans-serif';
    for (let i = 0; i < list.length; i++) {
      y += lineH;
      const cx = x0 + pad + 7, cy = y;
      ctx.beginPath();
      ctx.arc(cx, cy, 7, 0, Math.PI * 2);
      ctx.fillStyle = '#fff8e1';
      ctx.fill();
      ctx.strokeStyle = '#f9a825';
      ctx.stroke();
      ctx.fillStyle = '#5d4037';
      ctx.font = 'bold 7px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(list[i].symbol, cx, cy);
      ctx.fillStyle = '#222';
      ctx.font = '11px sans-serif';
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
    // 左上: 用紙の説明
    ctx.fillStyle = '#1d4ed8';
    ctx.font = '11px sans-serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'bottom';
    const orient = m.orientation === 'portrait' ? '縦' : '横';
    ctx.fillText(
      `用紙枠 ${m.paper}${orient}(この枠内 = ${(f.w / 1000).toFixed(2)} × ${(f.h / 1000).toFixed(2)} m)`,
      tl.x, tl.y - 4);
    // 右下: スケールバー(黒線の長さ = 図面上の1m)と縮尺表示
    const barLen = 1000 * view.zoom; // 1m分の画面上の長さ
    const bx2 = br.x - 12, bx1 = bx2 - barLen;
    const by = br.y - 26; // 下のラベルが枠線にかからない高さ
    ctx.strokeStyle = '#111';
    ctx.fillStyle = '#111';
    ctx.lineWidth = 2;
    // 本体の線
    ctx.beginPath(); ctx.moveTo(bx1, by); ctx.lineTo(bx2, by); ctx.stroke();
    // 両端の目盛(縦線)と中央(0.5m)の小さい目盛
    ctx.beginPath();
    ctx.moveTo(bx1, by - 6); ctx.lineTo(bx1, by + 6);
    ctx.moveTo(bx2, by - 6); ctx.lineTo(bx2, by + 6);
    ctx.moveTo((bx1 + bx2) / 2, by - 3); ctx.lineTo((bx1 + bx2) / 2, by + 3);
    ctx.stroke();
    // ラベル: 線の両端に 0 / 1m、上に縮尺
    ctx.font = 'bold 11px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.fillText('0', bx1, by + 8);
    ctx.fillText('1m', bx2, by + 8);
    ctx.textAlign = 'right';
    ctx.textBaseline = 'bottom';
    ctx.fillText(`縮尺 1/${m.scale}`, bx2, by - 8);
    ctx.restore();
  }

  /* 方位記号の中心位置(画面px)。用紙枠の表示中は枠内右上に置き、
   * 非表示なら従来どおり画面の右上に固定する。 */
  function northMarkCenter(canvas, project) {
    if (project.meta.showPaperFrame) {
      const f = paperFrameWorld(project);
      const s = worldToScreen(f.x + f.w, f.y);
      return { x: s.x - 40, y: s.y + 48 };
    }
    return { x: canvas.width - 40, y: 46 };
  }

  /* 方位記号の形状(中心・半径・Nの先端位置)。当たり判定にも使う。 */
  function getNorthMark(canvas, project) {
    const c = northMarkCenter(canvas, project);
    const r = 18;
    const a = (project.meta.northAngle || 0) * Math.PI / 180;
    // 角度0で真上。先端は円の外側(r+10)あたり。
    const tip = { x: c.x + Math.sin(a) * (r + 10), y: c.y - Math.cos(a) * (r + 10) };
    return { cx: c.x, cy: c.y, r, tip, angle: a };
  }

  /* 方位記号(北マーク)。Nの先端をドラッグすると360度回転できる。 */
  function drawNorthMark(ctx, canvas, project) {
    const n = getNorthMark(canvas, project);
    const { cx, cy, r } = n;
    ctx.save();
    ctx.strokeStyle = '#333'; ctx.fillStyle = '#333'; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.stroke();
    // 矢印(角度に追従して回転)
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(n.angle);
    ctx.beginPath();
    ctx.moveTo(0, -r - 6);
    ctx.lineTo(-6, 4);
    ctx.lineTo(0, -2);
    ctx.lineTo(6, 4);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
    // N の文字は先端の少し外側(文字自体は回転させず読みやすく)
    const lx = cx + Math.sin(n.angle) * (r + 16);
    const ly = cy - Math.cos(n.angle) * (r + 16);
    ctx.font = 'bold 12px sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('N', lx, ly);
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
        return { regionsFill: true, allRegions: false, regionTypes: ['kyakushitsu', 'chubo'],
                 furniture: false, fittings: false, fixtures: false, dims: true, table: 'kyakuchubo' };
      case 'lighting':
        return { regionsFill: true, allRegions: true, regionTypes: null,
                 furniture: false, fittings: false, fixtures: true, dims: false, table: 'fixtures' };
      default:
        return { regionsFill: true, allRegions: true, regionTypes: null,
                 furniture: true, fittings: true, fixtures: true, dims: true, table: false };
    }
  }

  function render(ctx, canvas, project, state) {
    const vis = visibility(currentLayer);
    clear(ctx, canvas);
    drawGrid(ctx, canvas);
    if (project.meta.showPaperFrame) {
      drawPaperFrame(ctx, project);
    }

    const regions = project.regions.filter((r) =>
      vis.allRegions || (vis.regionTypes && vis.regionTypes.indexOf(r.type) >= 0));

    for (const r of regions) {
      const code = global.Geometry.code(project.regions.indexOf(r) + 1); // 符号①②③…
      drawRegion(ctx, r, { fill: vis.regionsFill, selected: state.selectedId === r.id, code });
    }
    if (vis.dims) {
      for (const r of regions) drawDimension(ctx, r);
    }
    if (vis.fittings && project.fittings) {
      for (const g of project.fittings) {
        drawFitting(ctx, g, { selected: state.selectedId === g.id });
      }
    }
    if (vis.furniture) {
      for (const f of project.furniture) {
        drawFurniture(ctx, f, { selected: state.selectedId === f.id });
      }
    }
    if (vis.fixtures) {
      for (const x of project.fixtures) {
        drawFixture(ctx, x, { selected: state.selectedId === x.id });
      }
      drawFixtureLegend(ctx, canvas, project);
    }
    // 多角形の作図中なら下書きを最前面に描く
    if (state.draft && state.draft.points) {
      drawDraft(ctx, state.draft);
    }
    drawNorthMark(ctx, canvas, project);
  }

  global.Render = {
    view, LAYERS, setLayer, getLayer, visibility,
    worldToScreen, screenToWorld, fitToView, render,
    paperFrameWorld, getNorthMark,
  };
})(window);
