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
    /* t = カウンターの厚み(腕の幅)。L字は外形 w×h から右下を欠いた形。 */
    counterL: { label: 'L字カウンター', w: 2700, h: 1800, height: 1000, t: 600 },
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

  /* 照明・音響設備カタログ(点で配置)。symbol は図面上の記号(重複不可)。 */
  const FIXTURE_CATALOG = {
    downlight:   { label: 'ダウンライト',     symbol: 'DL' },
    pendant:     { label: 'ペンダントライト', symbol: 'PL' },
    ceiling:     { label: 'シーリングライト', symbol: 'CL' },
    spotlight:   { label: 'スポットライト',   symbol: 'SP' },
    floorstand:  { label: 'フロアスタンド',   symbol: 'FS' },
    footlight:   { label: 'フットライト',     symbol: 'FT' },
    chandelier:  { label: 'シャンデリア',     symbol: 'CH' },
    tablelight:  { label: 'テーブルライト',   symbol: 'TL' },
    bracket:     { label: 'ブラケット',       symbol: 'BR' },
    fluorescent: { label: '蛍光灯',           symbol: 'FL' },
    speaker:     { label: 'スピーカー',       symbol: 'SPK' },
    monitor:     { label: 'モニター',         symbol: 'MON' },
    karaoke:     { label: 'カラオケ',         symbol: 'KAR' },
  };

  /* 用紙サイズ(mm) */
  const PAPER_SIZES = {
    A4: { w: 297, h: 210 }, // 横向き基準
    A3: { w: 420, h: 297 },
  };

  /* 見通しを妨げるおそれがあると判定する高さのしきい値(mm) = 1m */
  const SIGHTLINE_LIMIT = 1000;

  /* 深夜酒類提供飲食店営業開始届出の必要書類チェックリスト。
   * corpOnly: 法人の場合のみ必要。 note: 補足。
   * 提出先: 営業所所在地を管轄する警察署(公安委員会宛て)。
   * 期限: 営業開始の10日前まで。詳細は都道府県警により異なる。 */
  const CHECKLIST_ITEMS = [
    { id: 'todokede',  label: '営業開始届出書(様式第47号)' },
    { id: 'houhou',    label: '営業の方法(様式第48号)' },
    { id: 'annaizu',   label: '営業所周辺の略図(案内図)', note: '住宅地図の写し等。本ツール対象外' },
    { id: 'heimenzu',  label: '営業所平面図' },
    { id: 'kyuseki_e', label: '営業所求積図・求積表' },
    { id: 'kyuseki_k', label: '客室・調理場求積図・求積表' },
    { id: 'shomei',    label: '照明・音響設備図(設備一覧表つき)' },
    { id: 'juminhyo',  label: '住民票の写し(本籍記載・マイナンバーなし)' },
    { id: 'teikan',    label: '定款の写し', corpOnly: true },
    { id: 'tokibo',    label: '登記事項証明書', corpOnly: true },
    { id: 'yakuin',    label: '役員全員の住民票の写し', corpOnly: true },
    { id: 'kyoka',     label: '飲食店営業許可証の写し', note: '署により' },
    { id: 'chintai',   label: '賃貸借契約書の写し・使用承諾書等', note: '署により' },
    { id: 'menu',      label: 'メニュー表の写し', note: '署により' },
    { id: 'ininjo',    label: '委任状', note: '行政書士が代理提出する場合' },
  ];

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
        lightingNote: '', // 照明・音響設備図の凡例に添える自由記入コメント
        showPaperFrame: true, // 用紙枠ガイド(用紙サイズ×縮尺の範囲)を表示するか
        northAngle: 0,        // 方位記号の角度(度)。0 = 真上が北
        showNorthMark: false, // 方位記号(N)を表示するか。既定は非表示
        fontScale: 100,       // 図面内ラベルの文字サイズ(%)。要素ごとの fontMm が優先
        /* 営業所求積の方式(警察署のローカルルールに合わせて選ぶ):
         *   'regions'    … 区画の合計(内法)
         *   'centerline' … 壁芯の外周(座標法)
         *   'both'       … 両方を併記 */
        premisesMethod: 'regions',
        /* 求積図の線色: 'mono'=黒 / 'police'=営業所:青・客室:赤・調理場:緑(慣行色) */
        colorMode: 'mono',
        /* 柱の面積を、柱が立っている区画(客室・調理場など)の面積から差し引くか */
        deductPillars: false,
      },
      /* 下絵(間取り図などの画像をなぞる用)。未設定なら null。
       *   src=画像(dataURL), x,y=左上(mm), w,h=実寸(mm), opacity=不透明度(0〜1) */
      underlay: null,
      /* 営業所外周(壁芯求積用)。多角形1つ + 壁厚。未作成なら null。
       *   measuredAt: 'inner'=内側の寸法で入力(壁芯線は壁厚/2だけ外側に自動生成)
       *               'center'=壁芯の寸法で入力(そのまま壁芯線になる) */
      premise: null,
      regions: [],
      furniture: [],
      fittings: [],
      fixtures: [],
      /* 必要書類チェックリストの状態。corp=法人かどうか, items={id: true} */
      checklist: { corp: false, items: {} },
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

  function addRegion(project, type, w, h, shape, w2) {
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
      shape: shape || 'rect',     // 'rect' | 'triangle' | 'trapezoid'
      w2: w2 != null ? w2 : Math.round(w / 2), // 台形の上底(mm)
      rotation: 0,
      color: t.color,
    };
    project.regions.push(region);
    return region;
  }

  /* 多角形の区画を追加する。pointsAbs は絶対座標(mm)の頂点列(3点以上)。
   * 内部では「左上を原点(x,y)とした相対座標」で持ち、移動は x,y だけ動かす。 */
  function addPolygonRegion(project, type, pointsAbs) {
    const number = nextRegionNumber(project, type);
    const t = REGION_TYPES[type];
    const minX = Math.min(...pointsAbs.map((p) => p.x));
    const minY = Math.min(...pointsAbs.map((p) => p.y));
    const region = {
      id: nextId(project, 'r'),
      type,
      number,
      label: type === 'kyakushitsu' ? `客室${number}` : t.label,
      x: minX,
      y: minY,
      w: 0,
      h: 0,
      shape: 'polygon',
      points: pointsAbs.map((p) => ({ x: p.x - minX, y: p.y - minY })),
      rotation: 0,
      color: t.color,
    };
    normalizePolygon(region);
    project.regions.push(region);
    return region;
  }

  /* 多角形の原点(x,y)を頂点の最小値に合わせ直し、w/h(外接サイズ)を更新する。
   * 頂点編集後に呼ぶことで、当たり判定・全体表示が正しく働く。 */
  function normalizePolygon(region) {
    if (region.shape !== 'polygon' || !region.points || !region.points.length) return;
    const minX = Math.min(...region.points.map((p) => p.x));
    const minY = Math.min(...region.points.map((p) => p.y));
    if (minX !== 0 || minY !== 0) {
      region.x += minX;
      region.y += minY;
      for (const p of region.points) { p.x -= minX; p.y -= minY; }
    }
    region.w = Math.max(...region.points.map((p) => p.x));
    region.h = Math.max(...region.points.map((p) => p.y));
  }

  /* 営業所外周を作成する。pointsAbs は絶対座標(mm)の頂点列(3点以上)。
   * 多角形区画と同じく「左上原点 + 相対頂点」で持ち、頂点ドラッグも共通で使える。 */
  function setPremise(project, pointsAbs, wallThickness, measuredAt) {
    const minX = Math.min(...pointsAbs.map((p) => p.x));
    const minY = Math.min(...pointsAbs.map((p) => p.y));
    project.premise = {
      id: 'premise',
      label: '営業所外周',
      shape: 'polygon',
      x: minX,
      y: minY,
      w: 0,
      h: 0,
      points: pointsAbs.map((p) => ({ x: p.x - minX, y: p.y - minY })),
      wallThickness: Math.max(10, wallThickness | 0) || 100,
      measuredAt: measuredAt === 'center' ? 'center' : 'inner',
    };
    normalizePolygon(project.premise);
    return project.premise;
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
    if (c.t) item.t = c.t; // L字カウンター等の厚み
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
    if (project.premise && project.premise.id === id) {
      project.premise = null;
      return true;
    }
    for (const key of ['regions', 'furniture', 'fittings', 'fixtures']) {
      const i = project[key].findIndex((e) => e.id === id);
      if (i >= 0) { project[key].splice(i, 1); return true; }
    }
    return false;
  }

  function findById(project, id) {
    if (project.premise && project.premise.id === id) {
      return { element: project.premise, kind: 'premise' };
    }
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
    project.premise = obj.premise || null;
    project.underlay = obj.underlay || null;
    project.checklist = Object.assign({ corp: false, items: {} }, obj.checklist || {});
    project.checklist.items = (obj.checklist && obj.checklist.items) || {};
    if (typeof project._seq !== 'number') {
      project._seq = 1 + project.regions.length + project.furniture.length +
                     project.fittings.length + project.fixtures.length;
    }
    return project;
  }

  global.Model = {
    REGION_TYPES, FURNITURE_CATALOG, FITTING_CATALOG, FIXTURE_CATALOG, PAPER_SIZES,
    SIGHTLINE_LIMIT, CHECKLIST_ITEMS,
    todayStr, defaultProject, nextId, nextRegionNumber,
    addRegion, addPolygonRegion, normalizePolygon, setPremise,
    addFurniture, addFitting, addFixture, removeById, findById,
    serialize, deserialize,
  };
})(window);
