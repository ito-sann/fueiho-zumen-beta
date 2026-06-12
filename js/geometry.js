/* =========================================================================
 * geometry.js — 求積(面積計算)と求積表データの生成
 * mm を ㎡ に変換し、計算式つきの行データを作る。
 * ========================================================================= */
(function (global) {
  'use strict';

  /* 求積のルール:
   *   ・寸法(辺の長さ)は m 表記・小数第2位(cm 単位)
   *   ・各部屋(基本図形)の面積は小数第4位まで
   *   ・最後の合計(総面積)だけ小数第2位
   */
  function round4(n) { return Math.round(n * 10000) / 10000; }
  function round2(n) { return Math.round(n * 100) / 100; }

  /* mm → m(小数第2位・cm 単位に丸め) */
  function mmToM(mm) {
    return Math.round(mm / 10) / 100;
  }

  function fmtM(mm) {
    return mmToM(mm).toFixed(2);
  }

  /* 符号(①②③…)。20まで丸囲み数字、それ以降は (21) 形式。 */
  function code(n) {
    if (n >= 1 && n <= 20) return String.fromCharCode(0x245F + n);
    return `(${n})`;
  }

  /* 多角形の頂点を m(小数第2位=cm 単位)に変換した配列を返す。
   * 座標求積表の表示値と面積計算を一致させるため、必ず丸めた値を使う。 */
  function polygonPointsM(region) {
    return (region.points || []).map((p) => ({ x: mmToM(p.x), y: mmToM(p.y) }));
  }

  /* 座標法(測量と同じ計算)による多角形の求積。
   *   倍面積 = Σ Xi × (Y(i+1) − Y(i−1))   → 面積 = |倍面積| ÷ 2
   * 行データ(座標求積表)と面積(第4位)を返す。 */
  function polygonCalc(region) {
    const pts = polygonPointsM(region);
    const n = pts.length;
    const rows = [];
    let sum = 0;
    for (let i = 0; i < n; i++) {
      const prev = pts[(i - 1 + n) % n];
      const next = pts[(i + 1) % n];
      const dy = round4(next.y - prev.y);
      const prod = round4(pts[i].x * dy);
      sum += prod;
      rows.push({ no: i + 1, x: pts[i].x, y: pts[i].y, dy, prod });
    }
    const doubleArea = round4(Math.abs(sum));
    return { rows, doubleArea, area4: round4(doubleArea / 2) };
  }

  /* 多角形の各辺の長さ(m・第2位)。図面の辺長表示に使う。 */
  function polygonEdgesM(region) {
    const pts = polygonPointsM(region);
    const n = pts.length;
    const edges = [];
    for (let i = 0; i < n; i++) {
      const a = pts[i], b = pts[(i + 1) % n];
      edges.push(round2(Math.hypot(b.x - a.x, b.y - a.y)));
    }
    return edges;
  }

  /* 1区画の求積計算(形ごと)
   *   長方形 : 幅 × 奥行
   *   三角形 : 底辺 × 高さ ÷ 2
   *   台形   : (上底 + 下底) × 高さ ÷ 2
   *   多角形 : 座標法(倍面積÷2)
   * いずれも面積は第4位まで。 */
  function regionCalc(region) {
    const wM = mmToM(region.w);
    const hM = mmToM(region.h);
    const shape = region.shape || 'rect';
    let area4, expr;
    if (shape === 'polygon') {
      const c = polygonCalc(region);
      area4 = c.area4;
      expr = `座標法(${(region.points || []).length}点)`;
      return { wM, hM, area4, expr, shape };
    }
    if (shape === 'triangle') {
      area4 = round4(wM * hM / 2);
      expr = `${wM.toFixed(2)} × ${hM.toFixed(2)} ÷ 2`;
    } else if (shape === 'trapezoid') {
      const w2M = mmToM(region.w2 != null ? region.w2 : region.w);
      area4 = round4((w2M + wM) * hM / 2);
      expr = `(${w2M.toFixed(2)} + ${wM.toFixed(2)}) × ${hM.toFixed(2)} ÷ 2`;
    } else {
      area4 = round4(wM * hM);
      expr = `${wM.toFixed(2)} × ${hM.toFixed(2)}`;
    }
    return { wM, hM, area4, expr, shape };
  }

  /* 区画の面積(㎡・小数第4位) */
  function regionAreaSqm(region) {
    return regionCalc(region).area4;
  }

  /* 1区画 → 求積表の1行 */
  function regionRow(region) {
    const c = regionCalc(region);
    return {
      id: region.id,
      label: region.label,
      type: region.type,
      w: c.wM.toFixed(2), h: c.hM.toFixed(2),
      expr: c.expr,
      formula: `${c.expr} = ${c.area4.toFixed(4)}`,
      area: c.area4,        // 部屋の面積(第4位)
    };
  }

  /* 種類でフィルタした求積表(行 + 合計)
   * 各部屋は第4位。合計は第4位の値を足し込み、最後に第2位へ丸める(総面積)。
   * 符号は project.regions 全体での並び順(①②③…)。 */
  function buildTable(project, filterTypes) {
    const rows = [];
    let totalCalc = 0;
    project.regions.forEach((r, i) => {
      if (filterTypes && filterTypes.indexOf(r.type) < 0) return;
      const row = regionRow(r);
      row.code = code(i + 1);
      rows.push(row);
      totalCalc += row.area;
    });
    return { rows, total: round2(totalCalc) };
  }

  /* 主要な面積サマリー */
  function summary(project) {
    const all = buildTable(project, null);
    const kyaku = buildTable(project, ['kyakushitsu']);
    const chubo = buildTable(project, ['chubo']);
    const toilet = buildTable(project, ['toilet']);
    const other = buildTable(project, ['tsuro', 'soko', 'other']);
    return {
      premises: all.total,   // 営業所面積(全区画合計)
      kyakushitsu: kyaku.total,
      chubo: chubo.total,
      toilet: toilet.total,
      other: other.total,
    };
  }

  /* 見通し規制(高さ概ね1m以上)に触れる備品の一覧 */
  function sightlineWarnings(project) {
    const limit = global.Model.SIGHTLINE_LIMIT;
    return project.furniture
      .filter((f) => typeof f.height === 'number' && f.height > limit)
      .map((f) => ({ id: f.id, label: f.label, height: f.height }));
  }

  /* 客室の床面積要件(風営法施行規則):
   *   客室が2室以上ある場合、1室の床面積は 9.5㎡ 以上が必要。
   *   客室が1室のみの場合はこの制限はない。
   * 9.5㎡ 未満の客室の一覧を返す(1室のみなら常に空)。 */
  const KYAKUSHITSU_MIN_SQM = 9.5;
  function kyakushitsuSizeWarnings(project) {
    const rooms = project.regions.filter((r) => r.type === 'kyakushitsu');
    if (rooms.length <= 1) return [];
    return rooms
      .map((r) => ({ id: r.id, label: r.label, area: regionAreaSqm(r) }))
      .filter((x) => x.area < KYAKUSHITSU_MIN_SQM);
  }

  /* 照明・音響設備の一覧表(種類ごとに数量・ワット数を集計)。
   * 照明・音響設備図に添える「設備一覧表」のデータになる。 */
  function fixtureSummary(project) {
    const cat = global.Model.FIXTURE_CATALOG;
    const map = new Map();
    for (const x of project.fixtures) {
      if (!map.has(x.kind)) {
        const c = cat[x.kind] || {};
        map.set(x.kind, { kind: x.kind, label: c.label || x.label, symbol: c.symbol || '?', count: 0, watts: new Set() });
      }
      const g = map.get(x.kind);
      g.count++;
      if (x.watt) g.watts.add(String(x.watt));
    }
    return Array.from(map.values()).map((g) => ({
      kind: g.kind, label: g.label, symbol: g.symbol, count: g.count,
      watt: Array.from(g.watts).join(', '),
    }));
  }

  /* 全要素のバウンディングボックス(mm)。空なら既定値。 */
  function boundingBox(project) {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    const consider = (x, y) => {
      minX = Math.min(minX, x); minY = Math.min(minY, y);
      maxX = Math.max(maxX, x); maxY = Math.max(maxY, y);
    };
    for (const r of project.regions) {
      consider(r.x, r.y); consider(r.x + r.w, r.y + r.h);
    }
    for (const f of project.furniture) {
      consider(f.x, f.y); consider(f.x + f.w, f.y + f.h);
    }
    for (const g of (project.fittings || [])) {
      consider(g.x, g.y); consider(g.x + g.w, g.y + g.h);
    }
    for (const x of project.fixtures) {
      consider(x.x, x.y);
    }
    if (!isFinite(minX)) {
      return { x: 0, y: 0, w: 8000, h: 6000 };
    }
    return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
  }

  global.Geometry = {
    mmToM, fmtM, code, regionCalc, regionAreaSqm, regionRow, buildTable,
    polygonCalc, polygonEdgesM, polygonPointsM,
    summary, sightlineWarnings, kyakushitsuSizeWarnings, KYAKUSHITSU_MIN_SQM,
    fixtureSummary, boundingBox,
  };
})(window);
