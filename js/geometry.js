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

  /* 1区画(長方形)の求積計算
   *   辺(第2位) × 辺(第2位) = 部屋の面積(第4位) */
  function regionCalc(region) {
    const wM = mmToM(region.w);          // 例: 3.25
    const hM = mmToM(region.h);          // 例: 4.51
    const area4 = round4(wM * hM);       // 部屋の面積: 第4位まで(例 14.6575)
    return { wM, hM, area4 };
  }

  /* 長方形区画の面積(㎡・小数第4位) */
  function regionAreaSqm(region) {
    return regionCalc(region).area4;
  }

  /* 1区画 → 求積表の1行 */
  function regionRow(region) {
    const c = regionCalc(region);
    const wStr = c.wM.toFixed(2);
    const hStr = c.hM.toFixed(2);
    return {
      id: region.id,
      label: region.label,
      type: region.type,
      w: wStr, h: hStr,
      expr: `${wStr} × ${hStr}`,            // 計算式(辺×辺)
      formula: `${wStr} × ${hStr} = ${c.area4.toFixed(4)}`,
      area: c.area4,        // 部屋の面積(第4位)
    };
  }

  /* 種類でフィルタした求積表(行 + 合計)
   * 各部屋は第4位。合計は第4位の値を足し込み、最後に第2位へ丸める(総面積)。 */
  function buildTable(project, filterTypes) {
    const rows = [];
    let totalCalc = 0;
    for (const r of project.regions) {
      if (filterTypes && filterTypes.indexOf(r.type) < 0) continue;
      const row = regionRow(r);
      rows.push(row);
      totalCalc += row.area;
    }
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

  /* 見通し規制(高さ1m超)に触れる備品の一覧 */
  function sightlineWarnings(project) {
    const limit = global.Model.SIGHTLINE_LIMIT;
    return project.furniture
      .filter((f) => typeof f.height === 'number' && f.height > limit)
      .map((f) => ({ id: f.id, label: f.label, height: f.height }));
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
    mmToM, fmtM, regionAreaSqm, regionRow, buildTable,
    summary, sightlineWarnings, boundingBox,
  };
})(window);
