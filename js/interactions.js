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

  /* 寸法線の作図を開始する。1点目をクリック→2点目をクリックで確定。
   * 確定すると onDone(x1,y1,x2,y2) が呼ばれる。Esc で中止。 */
  function beginMeasure(state, onDone) {
    state.measure = { p1: null, cursor: null, onDone };
  }
  function cancelMeasure(state) {
    state.measure = null;
  }
  function finishDraft(state) {
    const d = state.draft;
    state.draft = null;
    if (!d) return;
    // ダブルクリック等で入る連続した重複点を取り除く
    const pts = d.points.filter((p, i, a) =>
      i === 0 || p.x !== a[i - 1].x || p.y !== a[i - 1].y);
    // 先頭と末尾が同じ点なら末尾を落とす(閉じるクリックの取りこぼし対策)
    if (pts.length >= 2 &&
        pts[0].x === pts[pts.length - 1].x && pts[0].y === pts[pts.length - 1].y) {
      pts.pop();
    }
    if (pts.length >= 3) d.onDone(pts);
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

  /* 点と線分の距離(mm)。営業所外周は「線の近く」だけつかめるようにする。 */
  function distToSegment(wx, wy, ax, ay, bx, by) {
    const dx = bx - ax, dy = by - ay;
    const len2 = dx * dx + dy * dy;
    const t = len2 ? Math.max(0, Math.min(1, ((wx - ax) * dx + (wy - ay) * dy) / len2)) : 0;
    return Math.hypot(wx - (ax + dx * t), wy - (ay + dy * t));
  }

  /* 営業所外周の輪郭線の近く(壁厚 or 12px相当のどちらか大きい方)なら true。
   * 内側全体を当たりにすると、店内の空きクリック(パン)を奪ってしまうため線だけにする。 */
  function nearPremiseEdge(project, wx, wy) {
    const pr = project.premise;
    if (!pr || (pr.points || []).length < 3) return false;
    const tol = Math.max(pr.wallThickness || 100, 12 / global.Render.view.zoom);
    const pts = pr.points;
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i], b = pts[(i + 1) % pts.length];
      if (distToSegment(wx, wy, pr.x + a.x, pr.y + a.y, pr.x + b.x, pr.y + b.y) <= tol) return true;
    }
    return false;
  }

  /* メモ(文字の箱)の当たり判定。箱の大きさは描画時に Render が覚えている。 */
  function noteAt(project, wx, wy) {
    const notes = project.notes || [];
    for (let i = notes.length - 1; i >= 0; i--) {
      const n = notes[i];
      if ((n.layer || 'plan') !== global.Render.getLayer()) continue;
      const b = global.Render.noteBox(n.id);
      if (wx >= n.x && wx <= n.x + b.w && wy >= n.y && wy <= n.y + b.h) return n;
    }
    return null;
  }

  /* 手動寸法線の当たり判定(線の近くをつかめる) */
  function dimAt(project, wx, wy) {
    const dims = project.dimensions || [];
    const tol = Math.max(120, 8 / global.Render.view.zoom);
    for (let i = dims.length - 1; i >= 0; i--) {
      const d = dims[i];
      if ((d.layer || 'plan') !== global.Render.getLayer()) continue;
      if (distToSegment(wx, wy, d.x1, d.y1, d.x2, d.y2) <= tol) return d;
    }
    return null;
  }

  function hitTest(project, wx, wy) {
    // 最前面のメモを最優先
    const note = noteAt(project, wx, wy);
    if (note) return note;
    // 手動寸法線(線の近く)
    const dim = dimAt(project, wx, wy);
    if (dim) return dim;
    // 上に描かれるもの(設備→備品→区画)を優先
    for (let i = project.fixtures.length - 1; i >= 0; i--) {
      const x = project.fixtures[i];
      // アイコン実寸(半径220mm)+余裕。縮小表示中でも最低12px分はつかめるようにする
      const r = Math.max(280, 12 / global.Render.view.zoom);
      if (Math.hypot(wx - x.x, wy - x.y) <= r) return x;
    }
    const fittings = project.fittings || [];
    for (let i = fittings.length - 1; i >= 0; i--) {
      if (inRotatedRect(wx, wy, fittings[i])) return fittings[i];
    }
    for (let i = project.furniture.length - 1; i >= 0; i--) {
      const f = project.furniture[i];
      const hit = f.shape === 'polygon' ? inPolygon(wx, wy, f) : inRotatedRect(wx, wy, f);
      if (hit) return f;
    }
    for (let i = project.regions.length - 1; i >= 0; i--) {
      const r = project.regions[i];
      const hit = r.shape === 'polygon' ? inPolygon(wx, wy, r) : inRotatedRect(wx, wy, r);
      if (hit) return r;
    }
    // 営業所外周は一番下(輪郭線の近くだけ)
    if (nearPremiseEdge(project, wx, wy)) return project.premise;
    return null;
  }

  function attach(canvas, ctx, project, state, onChange, onSelect) {
    // 再アタッチ時(新規・読み込み)は前回の監視を外す。
    // 外さないとイベントが二重に処理され、頂点の重複追加や矢印キーの2倍移動が起きる。
    if (canvas._detachInteractions) canvas._detachInteractions();

    let mode = null; // 'drag' | 'pan' | 'vertex' | 'north' | 'notetip' | 'underlay' | 'dimpt'
    let last = null; // 直前のマウス位置(画面px)
    let dragTarget = null;
    let grabOffset = { x: 0, y: 0 }; // 要素原点とカーソルの差(mm)
    let vertexIndex = -1; // 頂点ドラッグ中の頂点番号
    let dimSpan = { dx: 0, dy: 0 };  // 寸法線を動かすときの2点間ベクトル
    let dimEnd = 1;                  // 寸法線の端点ドラッグ中の端(1 or 2)

    function pos(e) {
      const rect = canvas.getBoundingClientRect();
      return { x: e.clientX - rect.left, y: e.clientY - rect.top };
    }

    /* render と同じ CSS px 基準のキャンバスサイズ(方位記号の当たり判定用) */
    function cssCanvas() {
      return { width: canvas._cssW || canvas.width, height: canvas._cssH || canvas.height };
    }

    /* 選択中の多角形(区画・営業所外周)の頂点のうち、画面上で近い(8px以内)ものを探す */
    function findVertexAt(p) {
      if (!state.selectedId) return null;
      const found = global.Model.findById(project, state.selectedId);
      if (!found || found.element.shape !== 'polygon' ||
          (found.kind !== 'regions' && found.kind !== 'premise' && found.kind !== 'furniture')) return null;
      const r = found.element;
      for (let i = 0; i < r.points.length; i++) {
        const s = global.Render.worldToScreen(r.x + r.points[i].x, r.y + r.points[i].y);
        if (Math.hypot(p.x - s.x, p.y - s.y) <= 8) return { region: r, index: i };
      }
      return null;
    }

    /* 選択中の寸法線の端点(画面8px以内)を探す */
    function findDimEndAt(p) {
      if (!state.selectedId) return null;
      const found = global.Model.findById(project, state.selectedId);
      if (!found || found.kind !== 'dimensions') return null;
      const d = found.element;
      const ends = [[1, d.x1, d.y1], [2, d.x2, d.y2]];
      for (const [no, wx, wy] of ends) {
        const s = global.Render.worldToScreen(wx, wy);
        if (Math.hypot(p.x - s.x, p.y - s.y) <= 8) return { dim: d, end: no };
      }
      return null;
    }

    const onMouseDown = (e) => {
      const p = pos(e);
      const w = global.Render.screenToWorld(p.x, p.y);

      // 寸法線の作図中: 1点目→2点目をクリックで確定(Escで中止)
      if (state.measure) {
        const sp = { x: snap(w.x), y: snap(w.y) };
        if (!state.measure.p1) {
          state.measure.p1 = sp;
        } else {
          const m = state.measure;
          state.measure = null;
          m.onDone(m.p1.x, m.p1.y, sp.x, sp.y);
        }
        onChange();
        return;
      }

      // 選択中のメモの矢印の先端をつかんだら、先端の移動モード(どの図面でも)
      if (state.selectedId && !state.draft) {
        const found = global.Model.findById(project, state.selectedId);
        if (found && found.kind === 'notes' && found.element.leader !== false) {
          const s = global.Render.worldToScreen(found.element.tx, found.element.ty);
          if (Math.hypot(p.x - s.x, p.y - s.y) <= 10) {
            mode = 'notetip';
            dragTarget = found.element;
            last = p;
            return;
          }
        }
      }

      // 選択中の寸法線の端点をつかんだら端点ドラッグ
      const de = findDimEndAt(p);
      if (de) {
        mode = 'dimpt';
        dragTarget = de.dim;
        dimEnd = de.end;
        last = p;
        return;
      }

      // 備品姿図: メモのドラッグ → 備品カードのドラッグ → それ以外はパン
      if (global.Render.getLayer() === 'furnviews' && !state.draft) {
        const n = noteAt(project, w.x, w.y);
        if (n) {
          mode = 'drag';
          dragTarget = n;
          grabOffset = { x: w.x - n.x, y: w.y - n.y };
          state.selectedId = n.id;
          onSelect(n);
          onChange();
        } else {
          // 各備品の姿図カードはドラッグで好きな位置へ動かせる
          const card = global.Render.furnCardAt(project, w.x, w.y);
          if (card) {
            mode = 'furncard';
            dragTarget = card; // { key, x, y, ... }
            grabOffset = { x: w.x - card.x, y: w.y - card.y };
          } else {
            mode = 'pan';
          }
        }
        last = p;
        return;
      }

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

      // 「下絵を動かす」モード中はどこをドラッグしても下絵の移動になる
      if (state.underlayMove && project.underlay) {
        mode = 'underlay';
        grabOffset = { x: w.x - project.underlay.x, y: w.y - project.underlay.y };
        last = p;
        return;
      }

      // 方位記号の先端(N)をつかんだら回転モード(非表示中はつかめない)
      if (project.meta.showNorthMark) {
        const nm = global.Render.getNorthMark(cssCanvas(), project);
        const grabR = Math.max(12, 300 * global.Render.view.zoom);
        if (Math.hypot(p.x - nm.tip.x, p.y - nm.tip.y) <= grabR) {
          mode = 'north';
          last = p;
          return;
        }
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
        if (hit.x1 !== undefined) {
          // 寸法線は2点まとめて動かす(つかんだ位置を基準にする)
          grabOffset = { x: w.x - hit.x1, y: w.y - hit.y1 };
          dimSpan = { dx: hit.x2 - hit.x1, dy: hit.y2 - hit.y1 };
        } else {
          grabOffset = { x: w.x - hit.x, y: w.y - hit.y };
        }
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
    };

    const onMouseMove = (e) => {
      const p0 = pos(e);
      // 作図中はカーソル位置までのプレビュー線を更新する
      if (state.draft) {
        const w = global.Render.screenToWorld(p0.x, p0.y);
        state.draft.cursor = { x: snap(w.x), y: snap(w.y) };
        onChange();
        return;
      }
      // 寸法線の作図中(1点目を置いた後)はプレビュー線を更新する
      if (state.measure) {
        if (state.measure.p1) {
          const w = global.Render.screenToWorld(p0.x, p0.y);
          state.measure.cursor = { x: snap(w.x), y: snap(w.y) };
          onChange();
        }
        return;
      }
      if (!mode) return;
      const p = p0;
      if (mode === 'north') {
        // 方位記号の中心から見たカーソルの向き = 北の向き(360度)
        const nm = global.Render.getNorthMark(cssCanvas(), project);
        const deg = Math.atan2(p.x - nm.cx, -(p.y - nm.cy)) * 180 / Math.PI;
        project.meta.northAngle = Math.round((deg + 360) % 360);
        onChange();
      } else if (mode === 'vertex' && dragTarget) {
        // 頂点を動かして形を修正する(スナップあり・Shiftで自由)
        const w = global.Render.screenToWorld(p.x, p.y);
        let nx = w.x, ny = w.y;
        if (!e.shiftKey) { nx = snap(nx); ny = snap(ny); }
        dragTarget.points[vertexIndex] = { x: nx - dragTarget.x, y: ny - dragTarget.y };
        global.Model.normalizePolygon(dragTarget);
        onChange();
        onSelect(dragTarget);
      } else if (mode === 'dimpt' && dragTarget) {
        // 寸法線の片方の端点を動かす
        const w = global.Render.screenToWorld(p.x, p.y);
        let nx = w.x, ny = w.y;
        if (!e.shiftKey) { nx = snap(nx); ny = snap(ny); }
        if (dimEnd === 1) { dragTarget.x1 = nx; dragTarget.y1 = ny; }
        else { dragTarget.x2 = nx; dragTarget.y2 = ny; }
        onChange();
        onSelect(dragTarget);
      } else if (mode === 'notetip' && dragTarget) {
        // 引き出し線の先端(指す場所)を動かす
        const w = global.Render.screenToWorld(p.x, p.y);
        let nx = w.x, ny = w.y;
        if (!e.shiftKey) { nx = snap(nx); ny = snap(ny); }
        dragTarget.tx = nx;
        dragTarget.ty = ny;
        onChange();
      } else if (mode === 'furncard' && dragTarget) {
        // 備品姿図のカードを動かす(動かした位置を meta に記録)。スナップあり・Shiftで自由
        const w = global.Render.screenToWorld(p.x, p.y);
        let nx = w.x - grabOffset.x, ny = w.y - grabOffset.y;
        if (!e.shiftKey) { nx = snap(nx); ny = snap(ny); }
        if (!project.meta.furnViewPos) project.meta.furnViewPos = {};
        project.meta.furnViewPos[dragTarget.key] = { x: nx, y: ny };
        onChange();
      } else if (mode === 'underlay' && project.underlay) {
        // 下絵の移動(スナップあり・Shiftで自由)
        const w = global.Render.screenToWorld(p.x, p.y);
        let nx = w.x - grabOffset.x;
        let ny = w.y - grabOffset.y;
        if (!e.shiftKey) { nx = snap(nx); ny = snap(ny); }
        project.underlay.x = nx;
        project.underlay.y = ny;
        onChange();
      } else if (mode === 'pan') {
        global.Render.view.offsetX += p.x - last.x;
        global.Render.view.offsetY += p.y - last.y;
        onChange();
      } else if (mode === 'drag' && dragTarget) {
        const w = global.Render.screenToWorld(p.x, p.y);
        let nx = w.x - grabOffset.x;
        let ny = w.y - grabOffset.y;
        if (!e.shiftKey) { nx = snap(nx); ny = snap(ny); }
        if (dragTarget.x1 !== undefined) {
          // 寸法線は2点まとめて平行移動する
          dragTarget.x1 = nx; dragTarget.y1 = ny;
          dragTarget.x2 = nx + dimSpan.dx; dragTarget.y2 = ny + dimSpan.dy;
        } else {
          dragTarget.x = nx;
          dragTarget.y = ny;
        }
        onChange();
        onSelect(dragTarget); // プロパティ欄の座標も更新
      }
      last = p;
    };

    const onMouseUp = () => {
      mode = null; dragTarget = null; vertexIndex = -1;
    };

    // ダブルクリックでも多角形を確定できる(3点以上)
    const onDblClick = () => {
      if (state.draft && state.draft.points.length >= 3) {
        finishDraft(state);
        onChange();
      }
    };

    const onWheel = (e) => {
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
    };

    // Delete キーで削除 / 矢印キーで微調整(1単位ぶん、Shiftで10倍)
    const ARROWS = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
    const onKeyDown = (e) => {
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
      // 寸法線の作図中: Esc で中止
      if (state.measure) {
        if (e.key === 'Escape') { cancelMeasure(state); onChange(); }
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
    };

    canvas.addEventListener('mousedown', onMouseDown);
    canvas.addEventListener('dblclick', onDblClick);
    canvas.addEventListener('wheel', onWheel, { passive: false });
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
    window.addEventListener('keydown', onKeyDown);

    // 次回の attach で外せるように覚えておく
    canvas._detachInteractions = () => {
      canvas.removeEventListener('mousedown', onMouseDown);
      canvas.removeEventListener('dblclick', onDblClick);
      canvas.removeEventListener('wheel', onWheel);
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
      window.removeEventListener('keydown', onKeyDown);
      canvas._detachInteractions = null;
    };
  }

  global.Interactions = {
    attach, snap, setSnap, getSnap, hitTest,
    beginPolygon, cancelPolygon, finishPolygon: finishDraft,
    beginMeasure, cancelMeasure,
  };
})(window);
