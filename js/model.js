/* =========================================================================
 * model.js — データモデル・カタログ・保存/読み込み
 * すべての寸法は「ミリメートル(mm)」を内部単位として扱う。
 * ========================================================================= */
(function (global) {
  'use strict';

  /* 区画(部屋)の種類 */
  const REGION_TYPES = {
    kyakushitsu: { label: '客室',   color: '#ffe0b2' },
    chubo:       { label: '厨房',   color: '#b2dfdb' },
    toilet:      { label: 'トイレ', color: '#c5cae9' },
    tsuro:       { label: '通路',   color: '#f0f4c3' },
    soko:        { label: '倉庫',   color: '#d7ccc8' },
    other:       { label: 'その他', color: '#eeeeee' },
  };

  /* 備品カタログ(mm)。height は見通し規制の判定に使う高さ。 */
  const FURNITURE_CATALOG = {
    table:    { label: 'テーブル',   w: 600,  h: 600, height: 700  },
    chair:    { label: '椅子',       w: 450,  h: 450, height: 800  },
    counter:  { label: 'カウンター', w: 3200, h: 600, height: 1000 },
    sofa:     { label: 'ソファ',     w: 1800, h: 700, height: 800  },
    shelf:    { label: '棚',         w: 900,  h: 400, height: 1800 },
    fridge:   { label: '冷蔵庫',     w: 600,  h: 600, height: 1800 },
    sink:     { label: 'シンク',     w: 600,  h: 600, height: 850  },
    tsuitate: { label: 'つい立て',   w: 900,  h: 40,  height: 1500 },
  };

  /* 建具・設備カタログ(壁に沿って配置する線状の部品。mm) */
  const FITTING_CATALOG = {
    entrance: { label: '出入口', w: 1200, h: 120 },
    door:     { label: '扉',     w: 800,  h: 120 },
    window:   { label: '窓',     w: 1650, h: 120 },
    wall:     { label: '壁',     w: 2000, h: 120 },
    pillar:   { label: '柱',     w: 300,  h: 300 },
  };

  /* 照明・音響設備カタログ(点で配置) */
  const FIXTURE_CATALOG = {
    downlight:   { label: 'ダウンライト', symbol: 'DL' },
    fluorescent: { label: '蛍光灯',       symbol: 'FL' },
    spotlight:   { label: 'スポットライト', symbol: 'SP' },
    speaker:     { label: 'スピーカー',   symbol: 'SPK' },
    monitor:     { label: 'モニター',     symbol: 'MON' },
    karaoke:     { label: 'カラオケ',     symbol: 'KAR' },
  };

  /* 用紙サイズ(mm) */
  const PAPER_SIZES = {
    A4: { w: 297, h: 210 }, // 横向き基準
    A3: { w: 420, h: 297 },
  };

  /* 見通しを妨げるおそれがあると判定する高さのしきい値(mm) = 1m */
  const SIGHTLINE_LIMIT = 1000;

  function todayStr() {
    const d = new Date();
    const p = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  }

  function defaultProject() {
    return {
      meta: {
        storeName: '',
        address: '',
        scale: 50,            // 1/50
        paper: 'A4',
        orientation: 'landscape',
        date: todayStr(),
        author: '',
      },
      regions: [],
      furniture: [],
      fittings: [],
      fixtures: [],
      _seq: 1,
    };
  }

  function nextId(project, prefix) {
    return `${prefix}-${project._seq++}`;
  }

  /* 種類ごとの通し番号(客室1, 客室2 ...)を採番 */
  function nextRegionNumber(project, type) {
    let max = 0;
    for (const r of project.regions) {
      if (r.type === type && typeof r.number === 'number') {
        max = Math.max(max, r.number);
      }
    }
    return max + 1;
  }

  function addRegion(project, type, w, h) {
    const number = nextRegionNumber(project, type);
    const t = REGION_TYPES[type];
    const region = {
      id: nextId(project, 'r'),
      type,
      number,
      label: type === 'kyakushitsu' ? `客室${number}` : t.label,
      x: 1000,
      y: 1000,
      w: w,
      h: h,
      rotation: 0,
      color: t.color,
    };
    project.regions.push(region);
    return region;
  }

  function addFurniture(project, kind) {
    const c = FURNITURE_CATALOG[kind];
    const item = {
      id: nextId(project, 'f'),
      kind,
      label: c.label,
      x: 1500,
      y: 1500,
      w: c.w,
      h: c.h,
      rotation: 0,
      height: c.height,
    };
    project.furniture.push(item);
    return item;
  }

  function addFitting(project, kind) {
    const c = FITTING_CATALOG[kind];
    const item = {
      id: nextId(project, 'g'),
      kind,
      label: c.label,
      x: 1500,
      y: 1500,
      w: c.w,
      h: c.h,
      rotation: 0,
    };
    project.fittings.push(item);
    return item;
  }

  function addFixture(project, kind) {
    const c = FIXTURE_CATALOG[kind];
    const item = {
      id: nextId(project, 'x'),
      kind,
      label: c.label,
      x: 1500,
      y: 1500,
      watt: '',
      model: '',
    };
    project.fixtures.push(item);
    return item;
  }

  function removeById(project, id) {
    for (const key of ['regions', 'furniture', 'fittings', 'fixtures']) {
      const i = project[key].findIndex((e) => e.id === id);
      if (i >= 0) { project[key].splice(i, 1); return true; }
    }
    return false;
  }

  function findById(project, id) {
    for (const key of ['regions', 'furniture', 'fittings', 'fixtures']) {
      const e = project[key].find((e) => e.id === id);
      if (e) return { element: e, kind: key };
    }
    return null;
  }

  /* --- 保存 / 読み込み(JSON) --- */
  function serialize(project) {
    return JSON.stringify(project, null, 2);
  }

  function deserialize(text) {
    const obj = JSON.parse(text);
    // 最低限の妥当性チェックと補完
    const base = defaultProject();
    const project = Object.assign(base, obj);
    project.meta = Object.assign(base.meta, obj.meta || {});
    project.regions = obj.regions || [];
    project.furniture = obj.furniture || [];
    project.fittings = obj.fittings || [];
    project.fixtures = obj.fixtures || [];
    if (typeof project._seq !== 'number') {
      project._seq = 1 + project.regions.length + project.furniture.length +
                     project.fittings.length + project.fixtures.length;
    }
    return project;
  }

  global.Model = {
    REGION_TYPES, FURNITURE_CATALOG, FITTING_CATALOG, FIXTURE_CATALOG, PAPER_SIZES,
    SIGHTLINE_LIMIT,
    todayStr, defaultProject, nextId, nextRegionNumber,
    addRegion, addFurniture, addFitting, addFixture, removeById, findById,
    serialize, deserialize,
  };
})(window);
