/*
 * 全局常量与默认设置（CommonJS + 浏览器双环境）
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Const = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const EQ_TYPES = [
    { code: 'chemical', label: '化学方程式', short: '化学' },
    { code: 'ionic', label: '离子方程式', short: '离子' },
    { code: 'ionization', label: '电离方程式', short: '电离' },
    { code: 'hydrolysis', label: '水解方程式', short: '水解' },
    { code: 'electrode', label: '电极反应式', short: '电极' },
    { code: 'thermochemical', label: '热化学方程式', short: '热化学' }
  ];
  const EQ_TYPE_MAP = {};
  EQ_TYPES.forEach(t => { EQ_TYPE_MAP[t.code] = t; });

  const QUESTION_TYPES = {
    B: '给反应物写产物并配平',
    C: '给文字描述写方程式',
    D: '部分空格补全',
    E: '配平题',
    H: '开放题'
  };

  const BLANK_STRATEGIES = {
    blankProducts: '缺全部生成物',
    blankOneProduct: '缺某一个生成物',
    blankOneReactant: '缺某一个反应物',
    blankCoefficients: '缺系数',
    blankCondition: '缺条件',
    custom: '自由点选挖空'
  };

  const CONDITION_PRESETS = [
    { code: 'ignite', text: '点燃' },
    { code: 'heat', text: '△' },
    { code: 'highTemperature', text: '高温' },
    { code: 'catalyst', text: '催化剂' },
    { code: 'electric', text: '通电' },
    { code: 'light', text: '光照' },
    { code: 'concH2SO4', text: '浓硫酸' },
    { code: 'roomTemperature', text: '常温' },
    { code: 'custom', text: '自定义' }
  ];

  const DIFFICULTIES = ['简单', '中等', '较难'];

  // 可选字体（卷面格式 / 默认卷面格式 / 导出图片共用；label=界面显示，value=font-family 名）
  // 字体栈规则：西文字体在前、中文字体在后 → 英文/数字/符号用西文字体，中文回退中文字体
  const ZH_FONTS = [
    { value: 'Microsoft YaHei', label: '微软雅黑' },
    { value: 'SimSun', label: '宋体' },
    { value: 'SimHei', label: '黑体' },
    { value: 'KaiTi', label: '楷体' },
    { value: 'FangSong', label: '仿宋' }
  ];
  const EN_FONTS = [
    { value: 'Times New Roman', label: 'Times New Roman' },
    { value: 'Arial', label: 'Arial' },
    { value: 'Cambria', label: 'Cambria' },
    { value: 'Georgia', label: 'Georgia' },
    { value: 'Calibri', label: 'Calibri' }
  ];

  // 界面主题预设（CSS 变量整体替换；success/warning/error/info 等语义色不随主题变）
  const THEME_PRESETS = {
    paper: {
      label: '米白纸（默认）',
      vars: {
        '--bg': '#F4F1E8', '--bg-card': '#FFFFFF', '--bg-secondary': '#EAE5D8',
        '--text': '#3B3A34', '--text-sub': '#7A7566', '--border': '#D8D1BE',
        '--btn': '#C9A85A', '--btn-hover': '#B8934A', '--btn-text': '#4A3814'
      }
    },
    warm: {
      label: '暖阳黄',
      vars: {
        '--bg': '#FFEDB9', '--bg-card': '#FFF8E1', '--bg-secondary': '#FFE9A8',
        '--text': '#5B4632', '--text-sub': '#8A6D3B', '--border': '#E8D5A3',
        '--btn': '#E8A24B', '--btn-hover': '#D98E32', '--btn-text': '#5B3A1E'
      }
    },
    jade: {
      label: '青瓷绿',
      vars: {
        '--bg': '#E2EDE5', '--bg-card': '#F4FAF6', '--bg-secondary': '#D3E6DA',
        '--text': '#2E4A38', '--text-sub': '#5A7263', '--border': '#BFD8C8',
        '--btn': '#6E9A7C', '--btn-hover': '#5E8A6C', '--btn-text': '#143024'
      }
    },
    dusk: {
      label: '暮山蓝',
      vars: {
        '--bg': '#E3E9F2', '--bg-card': '#F3F6FB', '--bg-secondary': '#D4DDEA',
        '--text': '#33415C', '--text-sub': '#5D6B85', '--border': '#BCC9DC',
        '--btn': '#7A8DB0', '--btn-hover': '#68799C', '--btn-text': '#1D2842'
      }
    }
  };

  const VERSION_STRATEGIES = {
    chemicalOnly: '只出化学方程式',
    ionicOnly: '只出离子方程式',
    preferChemical: '优先化学方程式',
    preferIonic: '优先离子方程式',
    allAvailable: '所有可用版本均可',
    custom: '教师指定版本类型'
  };

  // 纸张尺寸（mm）
  const PAPER_SIZES = {
    A4: { width: 210, height: 297 },
    A3: { width: 297, height: 420 },
    B5: { width: 176, height: 250 },
    '16K': { width: 195, height: 270 }
  };

  function paperSizeMm(paper) {
    if (paper.size === 'custom') {
      return { width: Number(paper.customWidthMm) || 210, height: Number(paper.customHeightMm) || 297 };
    }
    const s = PAPER_SIZES[paper.size] || PAPER_SIZES.A4;
    if (paper.orientation === 'landscape') return { width: s.height, height: s.width };
    return { width: s.width, height: s.height };
  }

  function parseCm(v) {
    const m = String(v || '').trim().match(/^([\d.]+)\s*(cm|mm|pt)?$/);
    if (!m) return 2;
    const n = parseFloat(m[1]);
    if (m[2] === 'mm') return n / 10;
    if (m[2] === 'pt') return n * 0.0352778 / 10;
    return n;
  }

  function defaultLayoutSettings() {
    return {
      paper: { size: 'A4', orientation: 'portrait', customWidthMm: 210, customHeightMm: 297 },
      margins: { top: '2cm', bottom: '2cm', left: '2cm', right: '2cm' },
      columns: 1,
      columnGapMm: 8,
      font: { chinese: 'SimSun', latin: 'Times New Roman', titleSizePt: 16, bodySizePt: 12, noteSizePt: 10.5 },
      spacing: { lineSpacing: 'single', customLineSpacingPt: 20, questionSpacingPt: 6 },
      answerLine: { enabled: false, defaultHeightPt: 24, thickness: 'thin', color: '#000000' },
      header: { enabled: false, text: '', useTitle: false },
      footer: { enabled: true, format: 'number' },
      title: '化学方程式作业',
      subtitle: '',
      note: '',
      studentInfo: { enabled: false, fields: ['姓名', '班级', '日期'] },
      fixedQuestionsPerPage: 0 // 0 = 关闭
    };
  }

  function defaultGenerationSettings() {
    return {
      scopes: {},
      exclude: {},
      totalCount: 10,
      questionTypeCounts: { B: 0, C: 0, D: 0, E: 0, H: 0 }, // 0 = 不指定
      difficultyMode: 'counts', // counts | ratios
      difficultyCounts: { simple: 0, medium: 0, hard: 0 },
      difficultyRatios: { simple: 0, medium: 0, hard: 0 },
      versionStrategy: 'chemicalOnly',
      allowedVersionTypes: ['chemical'],
      includeMustInclude: false,
      allowDuplicateEntry: false,
      allowSameEntryDifferentVersion: false,
      manualEntryIds: []
    };
  }

  function nowIso() { return new Date().toISOString(); }

  function uid(prefix) {
    return (prefix || 'id') + '_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }

  // 文件名时间戳：YYYY-MM-DD_HH-mm
  function timestampForFile(d) {
    d = d || new Date();
    const p = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_${p(d.getHours())}-${p(d.getMinutes())}`;
  }

  function fmtDateTime(iso) {
    if (!iso) return '—';
    const d = new Date(iso);
    if (isNaN(d)) return '—';
    const p = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
  }

  return {
    EQ_TYPES, EQ_TYPE_MAP, QUESTION_TYPES, BLANK_STRATEGIES, CONDITION_PRESETS,
    DIFFICULTIES, ZH_FONTS, EN_FONTS, THEME_PRESETS, VERSION_STRATEGIES, PAPER_SIZES,
    paperSizeMm, parseCm, defaultLayoutSettings, defaultGenerationSettings,
    nowIso, uid, timestampForFile, fmtDateTime
  };
});
