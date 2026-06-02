/* =========================================================================
 * interactions.js — マウス操作(選択・移動・パン・ズーム)。
 * 移動時は 100mm(10cm)グリッドに吸着(スナップ)する。
 * ========================================================================= */
(function (global) {
  'use strict';

  const SNAP = 100; // mm
  function snap(v) { return Math.round(v / SNAP) * SNAP; }

  function hitTest(project, wx, wy) {
    // 上に描かれるもの(設備→備品→区画)を優先
    for (let i = project.fixtures.length - 1; i >= 0; i--) {
      const x = project.fixtures[i];
      const r = 12 / global.Render.view.zoom;
      if (Math.hypot(wx - x.x, wy - x.y) <= r) return x;
    }
    for (let i = project.furniture.length - 1; i >= 0; i--) {
      const f = project.furniture[i];
      if (wx >= f.x && wx <= f.x + f.w && wy >= f.y && wy <= f.y + f.h) return f;
    }
    for (let i = project.regions.length - 1; i >= 0; i--) {
      const r = project.regions[i];
      if (wx >= r.x && wx <= r.x + r.w && wy >= r.y && wy <= r.y + r.h) return r;
    }
    return null;
  }

  function attach(canvas, ctx, project, state, onChange, onSelect) {
    let mode = null; // 'drag' | 'pan'
    let last = null; // 直前のマウス位置(画面px)
    let dragTarget = null;
    let grabOffset = { x: 0, y: 0 }; // 要素原点とカーソルの差(mm)

    function pos(e) {
      const rect = canvas.getBoundingClientRect();
      return { x: e.clientX - rect.left, y: e.clientY - rect.top };
    }

    canvas.addEventListener('mousedown', (e) => {
      const p = pos(e);
      const w = global.Render.screenToWorld(p.x, p.y);
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
      if (!mode) return;
      const p = pos(e);
      if (mode === 'pan') {
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
      mode = null; dragTarget = null;
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

    // Delete キーで選択要素を削除
    window.addEventListener('keydown', (e) => {
      const tag = (e.target.tagName || '').toLowerCase();
      if (tag === 'input' || tag === 'textarea' || tag === 'select') return;
      if ((e.key === 'Delete' || e.key === 'Backspace') && state.selectedId) {
        global.Model.removeById(project, state.selectedId);
        state.selectedId = null;
        onSelect(null);
        onChange();
      }
    });
  }

  global.Interactions = { attach, snap, hitTest };
})(window);
