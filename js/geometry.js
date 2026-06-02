/* =========================================================================
 * geometry.js — 求積(面積計算)と求積表データの生成
 * mm を ㎡ に変換し、計算式つきの行データを作る。
 * ========================================================================= */
(function (global) {
  'use strict';

  /* mm → m(小数2桁) */
  function mmToM(mm) {
    return Math.round(mm / 10) / 100; // 1cm 単位で丸めて m 表記(0.01m=1cm)
  }

  function fmtM(mm) {
    return mmToM(mm).toFixed(2);
  }

  /* 長方形区画の面積(㎡)。小数2桁で丸める。 */
  function regionAreaSqm(region) {
    const a = (region.w / 1000) * (region.h / 1000);
    return Math.round(a * 100) / 100;
  }

  /* 1区画 → 求積表の1行 */
  function regionRow(region) {
    const wM = fmtM(region.w);
    const hM = fmtM(region.h);
    const area = regionAreaSqm(region);
    return {
      id: region.id,
      label: region.label,
      type: region.type,
      formula: `${wM} × ${hM} = ${area.toFixed(2)} ㎡`,
      w: wM, h: hM,
      area,
    };
  }

  /* 種類でフィルタした求積表(行 + 合計) */
  function buildTable(project, filterTypes) {
    const rows = [];
    let total = 0;
    for (const r of project.regions) {
      if (filterTypes && filterTypes.indexOf(r.type) < 0) continue;
      const row = regionRow(r);
      rows.push(row);
      total += row.area;
    }
    total = Math.round(total * 100) / 100;
    return { rows, total };
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
