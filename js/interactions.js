/* =========================================================================
 * interactions.js — マウス操作(選択・移動・パン・ズーム)。
 * 移動時は指定の単位(既定 10mm=1cm)に吸着(スナップ)する。
 * ========================================================================= */
(function (global) {
  'use strict';

  let snapMm = 10; // 吸着の単位(mm)。既定は 1cm。
  function setSnap(mm) { snapMm = Math.max(1, mm | 0); }
  function getSnap() { return snapMm; }
  function snap(v) { return Math.round(v / snapMm) * snapMm; }

  /* 多角形の内側判定(レイキャスティング法)。座標は絶対mm。 */
  function inPolygon(wx, wy, region) {
    const pts = region.points || [];
    let inside = false;
    for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
      const xi = region.x + pts[i].x, yi = region.y + pts[i].y;
      const xj = region.x + pts[j].x, yj = region.y + pts[j].y;
      if ((yi > wy) !== (yj > wy) &&
          wx < (xj - xi) * (wy - yi) / (yj - yi) + xi) {
        inside = !inside;
      }
    }
    return inside;
  }

  /* 多角形の作図を開始する。クリックで頂点を置き、最初の点をクリック
   * (またはダブルクリック / Enter)で確定、Esc で中止。
   * 確定すると onDone(絶対mm座標の頂点列) が呼ばれる。 */
  function beginPolygon(state, onDone) {
    state.draft = { points: [], cursor: null, onDone };
  }
  function cancelPolygon(state) {
    state.draft = null;
  }
  function finishDraft(state) {
    const d = state.draft;
    state.draft = null;
    if (d && d.points.length >= 3) d.onDone(d.points);
  }

  /* 回転した長方形の内側判定。要素の中心まわりに -rotation だけ戻して矩形判定する。 */
  function inRotatedRect(wx, wy, el) {
    const cx = el.x + el.w / 2, cy = el.y + el.h / 2;
    const a = -(el.rotation || 0) * Math.PI / 180;
    const dx = wx - cx, dy = wy - cy;
    const lx = dx * Math.cos(a) - dy * Math.sin(a);
    const ly = dx * Math.sin(a) + dy * Math.cos(a);
    return Math.abs(lx) <= el.w / 2 && Math.abs(ly) <= el.h / 2;
  }

  function hitTest(project, wx, wy) {
    // 上に描かれるもの(設備→備品→区画)を優先
    for (let i = project.fixtures.length - 1; i >= 0; i--) {
      const x = project.fixtures[i];
      const r = 12 / global.Render.view.zoom;
      if (Math.hypot(wx - x.x, wy - x.y) <= r) return x;
    }
    const fittings = project.fittings || [];
    for (let i = fittings.length - 1; i >= 0; i--) {
      if (inRotatedRect(wx, wy, fittings[i])) return fittings[i];
    }
    for (let i = project.furniture.length - 1; i >= 0; i--) {
      if (inRotatedRect(wx, wy, project.furniture[i])) return project.furniture[i];
    }
    for (let i = project.regions.length - 1; i >= 0; i--) {
      const r = project.regions[i];
      const hit = r.shape === 'polygon' ? inPolygon(wx, wy, r) : inRotatedRect(wx, wy, r);
      if (hit) return r;
    }
    return null;
  }

  function attach(canvas, ctx, project, state, onChange, onSelect) {
    let mode = null; // 'drag' | 'pan' | 'vertex'
    let last = null; // 直前のマウス位置(画面px)
    let dragTarget = null;
    let grabOffset = { x: 0, y: 0 }; // 要素原点とカーソルの差(mm)
    let vertexIndex = -1; // 頂点ドラッグ中の頂点番号

    function pos(e) {
      const rect = canvas.getBoundingClientRect();
      return { x: e.clientX - rect.left, y: e.clientY - rect.top };
    }

    /* 選択中の多角形の頂点のうち、画面上で近い(8px以内)ものを探す */
    function findVertexAt(p) {
      if (!state.selectedId) return null;
      const found = global.Model.findById(project, state.selectedId);
      if (!found || found.kind !== 'regions' || found.element.shape !== 'polygon') return null;
      const r = found.element;
      for (let i = 0; i < r.points.length; i++) {
        const s = global.Render.worldToScreen(r.x + r.points[i].x, r.y + r.points[i].y);
        if (Math.hypot(p.x - s.x, p.y - s.y) <= 8) return { region: r, index: i };
      }
      return null;
    }

    canvas.addEventListener('mousedown', (e) => {
      const p = pos(e);
      const w = global.Render.screenToWorld(p.x, p.y);

      // 多角形の作図中: クリックで頂点を置く。最初の点の近く(10px)なら閉じて確定。
      if (state.draft) {
        const pts = state.draft.points;
        if (pts.length >= 3) {
          const first = global.Render.worldToScreen(pts[0].x, pts[0].y);
          if (Math.hypot(p.x - first.x, p.y - first.y) <= 10) {
            finishDraft(state);
            onChange();
            return;
          }
        }
        pts.push({ x: snap(w.x), y: snap(w.y) });
        onChange();
        return;
      }

      // 選択中の多角形の頂点をつかんだら、頂点の移動モード
      const v = findVertexAt(p);
      if (v) {
        mode = 'vertex';
        dragTarget = v.region;
        vertexIndex = v.index;
        last = p;
        return;
      }

      const hit = hitTest(project, w.x, w.y);
      if (hit) {
        mode = 'drag';
        dragTarget = hit;
        grabOffset = { x: w.x - hit.x, y: w.y - hit.y };
        state.selectedId = hit.id;
        onSelect(hit);
        onChange();
      } else {
        mode = 'pan';
        state.selectedId = null;
        onSelect(null);
        onChange();
      }
      last = p;
    });

    window.addEventListener('mousemove', (e) => {
      const p0 = pos(e);
      // 作図中はカーソル位置までのプレビュー線を更新する
      if (state.draft) {
        const w = global.Render.screenToWorld(p0.x, p0.y);
        state.draft.cursor = { x: snap(w.x), y: snap(w.y) };
        onChange();
        return;
      }
      if (!mode) return;
      const p = p0;
      if (mode === 'vertex' && dragTarget) {
        // 頂点を動かして形を修正する(スナップあり・Shiftで自由)
        const w = global.Render.screenToWorld(p.x, p.y);
        let nx = w.x, ny = w.y;
        if (!e.shiftKey) { nx = snap(nx); ny = snap(ny); }
        dragTarget.points[vertexIndex] = { x: nx - dragTarget.x, y: ny - dragTarget.y };
        global.Model.normalizePolygon(dragTarget);
        onChange();
        onSelect(dragTarget);
      } else if (mode === 'pan') {
        global.Render.view.offsetX += p.x - last.x;
        global.Render.view.offsetY += p.y - last.y;
        onChange();
      } else if (mode === 'drag' && dragTarget) {
        const w = global.Render.screenToWorld(p.x, p.y);
        let nx = w.x - grabOffset.x;
        let ny = w.y - grabOffset.y;
        if (!e.shiftKey) { nx = snap(nx); ny = snap(ny); }
        dragTarget.x = nx;
        dragTarget.y = ny;
        onChange();
        onSelect(dragTarget); // プロパティ欄の座標も更新
      }
      last = p;
    });

    window.addEventListener('mouseup', () => {
      mode = null; dragTarget = null; vertexIndex = -1;
    });

    // ダブルクリックでも多角形を確定できる(3点以上)
    canvas.addEventListener('dblclick', () => {
      if (state.draft && state.draft.points.length >= 3) {
        finishDraft(state);
        onChange();
      }
    });

    canvas.addEventListener('wheel', (e) => {
      e.preventDefault();
      const p = pos(e);
      const before = global.Render.screenToWorld(p.x, p.y);
      const factor = e.deltaY < 0 ? 1.1 : 1 / 1.1;
      global.Render.view.zoom *= factor;
      global.Render.view.zoom = Math.max(0.005, Math.min(0.5, global.Render.view.zoom));
      // カーソル位置を中心にズーム
      const after = global.Render.worldToScreen(before.x, before.y);
      global.Render.view.offsetX += p.x - after.x;
      global.Render.view.offsetY += p.y - after.y;
      onChange();
    }, { passive: false });

    // Delete キーで削除 / 矢印キーで微調整(1単位ぶん、Shiftで10倍)
    const ARROWS = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
    window.addEventListener('keydown', (e) => {
      const tag = (e.target.tagName || '').toLowerCase();
      if (tag === 'input' || tag === 'textarea' || tag === 'select') return;
      // 作図中: Enter で確定 / Esc で中止
      if (state.draft) {
        if (e.key === 'Enter' && state.draft.points.length >= 3) {
          finishDraft(state);
          onChange();
        } else if (e.key === 'Escape') {
          cancelPolygon(state);
          onChange();
        }
        return;
      }
      if ((e.key === 'Delete' || e.key === 'Backspace') && state.selectedId) {
        global.Model.removeById(project, state.selectedId);
        state.selectedId = null;
        onSelect(null);
        onChange();
        return;
      }
      if (ARROWS[e.key] && state.selectedId) {
        const found = global.Model.findById(project, state.selectedId);
        if (!found) return;
        e.preventDefault();
        const step = snapMm * (e.shiftKey ? 10 : 1); // 既定 1cm、Shiftで10cm
        const [dx, dy] = ARROWS[e.key];
        found.element.x += dx * step;
        found.element.y += dy * step;
        onChange();
        onSelect(found.element);
      }
    });
  }

  global.Interactions = { attach, snap, setSnap, getSnap, hitTest, beginPolygon, cancelPolygon };
})(window);
