/* =========================================================================
 * render.js — Canvas 描画。座標は mm(ワールド)→ px(画面)に変換する。
 * 図面の種類(レイヤー)ごとに表示内容を切り替える。
 * ========================================================================= */
(function (global) {
  'use strict';

  /* ビュー(パン・ズーム)。zoom = px/mm */
  const view = { zoom: 0.05, offsetX: 40, offsetY: 40 };

  /* レイヤー(図面の種類) */
  const LAYERS = {
    plan:      { label: '平面図' },
    premises:  { label: '営業所求積図' },
    kyakushitsu: { label: '客室求積図' },
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

  /* 全要素が収まるようにビューを合わせる */
  function fitToView(project, canvas) {
    const bb = global.Geometry.boundingBox(project);
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

  function drawRegion(ctx, r, opts) {
    const p = worldToScreen(r.x, r.y);
    const w = r.w * view.zoom, h = r.h * view.zoom;
    ctx.save();
    ctx.fillStyle = opts.fill ? r.color : 'rgba(0,0,0,0)';
    ctx.globalAlpha = opts.fill ? 0.55 : 1;
    ctx.fillRect(p.x, p.y, w, h);
    ctx.globalAlpha = 1;
    ctx.lineWidth = opts.selected ? 3 : 2;
    ctx.strokeStyle = opts.selected ? '#d32f2f' : '#333';
    ctx.strokeRect(p.x, p.y, w, h);
    // ラベル
    ctx.fillStyle = '#222';
    ctx.font = '13px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(r.label, p.x + w / 2, p.y + h / 2);
    ctx.restore();
  }

  /* 寸法線(区画の上辺=幅、左辺=奥行) */
  function drawDimension(ctx, r) {
    const tl = worldToScreen(r.x, r.y);
    const tr = worldToScreen(r.x + r.w, r.y);
    const bl = worldToScreen(r.x, r.y + r.h);
    const off = 14;
    ctx.save();
    ctx.strokeStyle = '#1565c0';
    ctx.fillStyle = '#1565c0';
    ctx.lineWidth = 1;
    ctx.font = '11px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'bottom';
    // 幅(上辺の外側)
    const wy = tl.y - off;
    ctx.beginPath(); ctx.moveTo(tl.x, wy); ctx.lineTo(tr.x, wy); ctx.stroke();
    tick(ctx, tl.x, wy); tick(ctx, tr.x, wy);
    ctx.fillText(global.Geometry.fmtM(r.w) + 'm', (tl.x + tr.x) / 2, wy - 2);
    // 奥行(左辺の外側)
    const wx = tl.x - off;
    ctx.beginPath(); ctx.moveTo(wx, tl.y); ctx.lineTo(wx, bl.y); ctx.stroke();
    tick(ctx, wx, tl.y); tick(ctx, wx, bl.y);
    ctx.save();
    ctx.translate(wx - 2, (tl.y + bl.y) / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.fillText(global.Geometry.fmtM(r.h) + 'm', 0, 0);
    ctx.restore();
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
    // ラベル
    ctx.fillStyle = '#555';
    ctx.font = '10px sans-serif';
    ctx.textBaseline = 'top';
    let lab = x.label;
    if (x.watt) lab += ' ' + x.watt + 'W';
    ctx.fillText(lab, p.x, p.y + r + 1);
    ctx.restore();
  }

  /* 方位記号(北マーク)を右上に描く */
  function drawNorthMark(ctx, canvas) {
    const cx = canvas.width - 40, cy = 46, r = 18;
    ctx.save();
    ctx.strokeStyle = '#333'; ctx.fillStyle = '#333'; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(cx, cy - r - 6);
    ctx.lineTo(cx - 6, cy + 4);
    ctx.lineTo(cx, cy - 2);
    ctx.lineTo(cx + 6, cy + 4);
    ctx.closePath();
    ctx.fill();
    ctx.font = 'bold 12px sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('N', cx, cy - r - 14);
    ctx.restore();
  }

  /* どのレイヤーで何を表示するか */
  function visibility(layer) {
    switch (layer) {
      case 'plan':
        return { regionsFill: true, allRegions: true, regionTypes: null,
                 furniture: true, fixtures: false, dims: true, table: false };
      case 'premises':
        return { regionsFill: false, allRegions: true, regionTypes: null,
                 furniture: false, fixtures: false, dims: true, table: 'all' };
      case 'kyakushitsu':
        return { regionsFill: true, allRegions: false, regionTypes: ['kyakushitsu'],
                 furniture: false, fixtures: false, dims: true, table: 'kyakushitsu' };
      case 'lighting':
        return { regionsFill: true, allRegions: true, regionTypes: null,
                 furniture: false, fixtures: true, dims: false, table: false };
      default:
        return { regionsFill: true, allRegions: true, regionTypes: null,
                 furniture: true, fixtures: true, dims: true, table: false };
    }
  }

  function render(ctx, canvas, project, state) {
    const vis = visibility(currentLayer);
    clear(ctx, canvas);
    drawGrid(ctx, canvas);

    const regions = project.regions.filter((r) =>
      vis.allRegions || (vis.regionTypes && vis.regionTypes.indexOf(r.type) >= 0));

    for (const r of regions) {
      drawRegion(ctx, r, { fill: vis.regionsFill, selected: state.selectedId === r.id });
    }
    if (vis.dims) {
      for (const r of regions) drawDimension(ctx, r);
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
    }
    drawNorthMark(ctx, canvas);
  }

  global.Render = {
    view, LAYERS, setLayer, getLayer, visibility,
    worldToScreen, screenToWorld, fitToView, render,
  };
})(window);
