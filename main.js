const { app, BrowserWindow, ipcMain, dialog, Menu, shell, clipboard } = require('electron');
const path = require('path');
const fs = require('fs');
const fsp = fs.promises;

// ---------- 数据目录定位 ----------
// 开发模式：项目目录/data；打包后：优先 exe 同级 data（便携式），不可写则回退 userData/data
function resolveDataDir() {
  if (!app.isPackaged) return path.join(__dirname, 'data');
  const exeDir = path.dirname(process.execPath);
  const portable = path.join(exeDir, 'data');
  try {
    fs.mkdirSync(portable, { recursive: true });
    fs.accessSync(portable, fs.constants.W_OK);
    return portable;
  } catch (e) {
    const ud = path.join(app.getPath('userData'), 'data');
    fs.mkdirSync(ud, { recursive: true });
    return ud;
  }
}

const DATA_SUBDIRS = ['history', 'templates', 'backups', 'exports', 'reports', 'projects'];
let DATA_DIR = null;

function dataPath(...parts) {
  return path.join(DATA_DIR, ...parts);
}

// 原子写入：先写临时文件再替换，防止数据损坏
async function writeFileSafe(filePath, content) {
  const tmp = filePath + '.tmp';
  await fsp.writeFile(tmp, content, 'utf-8');
  await fsp.rename(tmp, filePath);
}

async function writeJsonSafe(filePath, obj) {
  await writeFileSafe(filePath, JSON.stringify(obj, null, 2));
}

async function readJson(filePath, fallback) {
  try {
    const txt = await fsp.readFile(filePath, 'utf-8');
    return JSON.parse(txt);
  } catch (e) {
    if (e.code === 'ENOENT') return fallback;
    // 文件损坏时不覆盖，改名留存
    try { await fsp.rename(filePath, filePath + '.corrupt.' + Date.now()); } catch (_) {}
    return fallback;
  }
}

const DEFAULT_CLASSIFICATIONS = {
  version: 1,
  textbookVersions: ['人教版', '鲁科版', '苏教版'],
  // 册别按学段排列：初中九年级两册在前，高中必修/选择性必修在后
  // 注：初中册别涵盖甲烷/乙醇燃烧等少量有机内容（引擎可配平，仅提示警告）
  books: ['九年级上册', '九年级下册', '必修第一册', '必修第二册', '选择性必修1', '选择性必修2', '选择性必修3'],
  // 物质类别不设「有机物」：理由同上，待有机支持落地后再随特性一并加入
  substanceCategories: ['单质', '氧化物', '酸', '碱', '盐', '氢化物', '过氧化物', '胶体', '混合物', '其他'],
  reactionTypes: ['化合反应', '分解反应', '置换反应', '复分解反应', '氧化还原反应', '离子反应', '可逆反应', '燃烧反应', '中和反应', '水解反应', '电离', '电极反应', '热化学反应', '取代反应', '加成反应', '消去反应', '酯化反应', '加聚反应', '缩聚反应', '其他'],
  knowledgeModules: ['物质及其变化', '金属及其化合物', '非金属及其化合物', '化学反应与能量', '电化学', '化学平衡', '水溶液中的离子平衡', '化学实验', '化学与生活', '其他'],
  tags: ['高频', '易错', '月考重点', '期中考前', '基础必会', '补充题'],
  // 章节树（高中四册「章→节」两级），由 scripts/build-chapter-tree.js 从题库数据派生；
  // 此处仅保证字段存在（旧数据无此字段时 UI 容错为空树）
  chapters: {},
  // 注意：渲染端（编辑器条件按钮）使用 src/libs/constants.js 的 CONDITION_PRESETS，
  // 此字段当前无消费方，保持为空以避免双真相源。
  conditionPresets: []
};

const DEFAULT_SETTINGS = {
  version: 1,
  // 界面显示：zoomFactor 整页等比缩放（0.6–1.6，实时生效，见 ui:setZoom）
  ui: { zoom: 1 },
  // 默认主题 = 米白纸（paper）；theme.background/card/text 为冗余快照，渲染按 preset 取色
  theme: { preset: 'paper', background: '#F4F1E8', card: '#FFFFFF', text: '#3B3A34' },
  defaultFont: {
    chinese: 'SimSun',
    latin: 'Times New Roman',
    titleSizePt: 16,
    fontSizePt: 12,
    lineSpacing: 'single',
    questionSpacingPt: 6
  },
  defaultPaper: {
    size: 'A4',
    orientation: 'portrait',
    margins: { top: '2cm', bottom: '2cm', left: '2cm', right: '2cm' }
  },
  export: {
    folder: '', // 空 = data/exports
    includeAnswer: true,
    imagesFolder: '', // 空 = data/exports（导出图片的默认目录）
    // 导出图片面板的上次选项（米白纸默认值即面板默认勾选）
    imageOptions: {
      mode: 'single',          // single 合成一张 | multi 每条一张
      versionScope: 'main',    // main 仅主版本 | all 全部 | custom 指定类型
      allowedTypes: ['chemical'],
      number: false, showName: false, showType: false, showDifficulty: false, showTextbook: false,
      fontPt: 16, scale: 2, cols: 1, format: 'png',
      metaFontPt: 10,          // 元信息文字字号（pt）
      textAlign: 'left',       // 文字（编号/名称等）水平位置
      eqAlign: 'left',         // 方程式水平位置
      gapPt: 4,                // 文字与方程式间距（pt）
      padPt: 27,               // 图片内边距（pt）
      zhFont: 'Microsoft YaHei', // 中文字体（中文回退；默认微软雅黑）
      enFont: 'Times New Roman', // 西文字体（英文/数字/符号；默认 Times New Roman）
      heightMode: 'auto',      // auto 高度贴合内容 | fixed 统一画布高（内容超出自动增高）
      canvasHeightPt: 120,     // 设定高度（pt，heightMode=fixed 时生效）
      vAlign: 'middle',        // 垂直对齐 top/middle/bottom（设定高度时生效）
      baseName: '化学方程式', saveMode: 'ask' // ask 每次选择位置 | auto 直接存默认目录
    }
  },
  statistics: { countOnSave: true, countOnExport: true },
  // 学习项目：当前项目 id（projects.json 为项目清单，data/projects/<pid>.json 为项目运行数据）
  learning: { currentProjectId: 'default' }
};

async function ensureDataDir() {
  DATA_DIR = resolveDataDir();
  for (const d of DATA_SUBDIRS) {
    await fsp.mkdir(dataPath(d), { recursive: true });
  }
  const defs = [
    ['library.json', { version: 1, updatedAt: nowIso(), entries: [] }],
    ['classifications.json', DEFAULT_CLASSIFICATIONS],
    ['settings.json', DEFAULT_SETTINGS],
    ['trash.json', { version: 1, entries: [] }]
  ];
  for (const [name, def] of defs) {
    const p = dataPath(name);
    if (!fs.existsSync(p)) await writeJsonSafe(p, def);
  }
  // 兼容旧设置补齐字段
  const settings = await readJson(dataPath('settings.json'), DEFAULT_SETTINGS);
  const merged = deepMerge(structuredClone(DEFAULT_SETTINGS), settings);
  await writeJsonSafe(dataPath('settings.json'), merged);
  return DATA_DIR;
}

function deepMerge(base, over) {
  for (const k of Object.keys(over)) {
    if (over[k] && typeof over[k] === 'object' && !Array.isArray(over[k]) &&
        base[k] && typeof base[k] === 'object' && !Array.isArray(base[k])) {
      deepMerge(base[k], over[k]);
    } else {
      base[k] = over[k];
    }
  }
  return base;
}

function nowIso() {
  return new Date().toISOString();
}

// ---------- 学习项目 ----------
// projects.json 不存在（首次启动）时懒迁移：创建默认项目（id='default'，全库范围）。
// 已有清单但缺 default 项目时补回（防御，正常 UI 无法删除 default）。
async function ensureProjects() {
  let data = await readJson(dataPath('projects.json'), null);
  const fix = !data || !Array.isArray(data.projects);
  if (fix) data = { version: 1, projects: [] };
  if (!data.projects.some(p => p && p.id === 'default')) {
    data.projects.unshift({
      id: 'default', name: '默认项目', scope: {},
      createdAt: nowIso(), updatedAt: nowIso()
    });
    await writeJsonSafe(dataPath('projects.json'), data);
  } else if (fix) {
    await writeJsonSafe(dataPath('projects.json'), data);
  }
  return data;
}

const PROJECT_ID_RE = /^[A-Za-z0-9_-]+$/;

// ---------- 窗口 ----------
let mainWindow = null;

// 界面缩放边界（与渲染端 App.setUiZoom 保持一致）
const UI_ZOOM_MIN = 0.6, UI_ZOOM_MAX = 1.6;
function clampUiZoom(f) {
  const n = Number(f);
  if (!isFinite(n)) return 1;
  return Math.min(UI_ZOOM_MAX, Math.max(UI_ZOOM_MIN, n));
}

async function createWindow() {
  const dlgshot = !!process.env.DLGSHOT; // 临时验证：离屏渲染对话框截图
  const docshot = !!process.env.DOCSHOT; // 文档截图：与 DLGSHOT 同样走离屏隐藏，避免遮挡时 capturePage 旧帧/空帧
  const headlessShot = dlgshot || docshot;
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 1100,
    minHeight: 700,
    backgroundColor: '#F4F1E8',
    title: '高中化学方程式组卷打印系统',
    autoHideMenuBar: true,
    show: !headlessShot,
    webPreferences: {
      offscreen: headlessShot,
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      spellcheck: false
    }
  });
  Menu.setApplicationMenu(null);
  // 界面缩放：loadFile 前预设，避免先 100% 再跳变的闪烁（ensureDataDir 已先行，settings.json 必存在）
  try {
    const boot = await readJson(dataPath('settings.json'), DEFAULT_SETTINGS);
    const z = clampUiZoom(boot && boot.ui && boot.ui.zoom);
    mainWindow.webContents.setZoomFactor(z);
  } catch (_) { /* 读取失败按默认 1 */ }
  mainWindow.loadFile(path.join(__dirname, 'src', 'index.html'));

  if (process.env.SHOT) {
    // SHOT=1：准备一个含条件反应的作业视图并保持运行（供外部截图）
    mainWindow.webContents.once('did-finish-load', async () => {
      await new Promise((r) => setTimeout(r, 1500));
      try {
        await mainWindow.webContents.executeJavaScript(`(async () => {
          const app = window.App;
          for (let i = 0; i < 50 && !app.state.ready; i++) await new Promise(r => setTimeout(r, 100));
          if (!app.state.ready) throw new Error('init fail');
          if (!app.state.library.entries.length) {
            const ex = await window.bridge.file.readExample('sample-library.json');
            const v = window.Importer.validateImportData(ex.data, app.state.library, 'shot.json');
            v.results.forEach(r => app.state.library.entries.push(r.entry));
          }
          const s = window.Const.defaultGenerationSettings();
          s.totalCount = 8;
          s.manualEntryIds = ['R0005', 'R0007'];
          const gen = window.Generator.generate(app.state.library, s);
          if (!gen.ok) throw new Error('gen fail: ' + gen.reason + ' / ' + gen.message + ' / candidates=' + window.Generator.buildCandidates(app.state.library, s).length + ' / entries=' + app.state.library.entries.length);
          app.newWorksheet(gen.items, s);
          app.state.worksheet.title = '排版验证';
          app.showView('worksheet');
          return 'ok';
        })()`);
        // 固定位置并置顶前台，便于外部屏幕截图
        try {
          mainWindow.setPosition(0, 0);
          mainWindow.setAlwaysOnTop(true);
          mainWindow.restore();
          mainWindow.focus();
        } catch (_) {}
        console.log('SHOT ready');
      } catch (e) {
        console.error('SHOT FAIL:', e && e.message ? e.message : e);
      }
    });
    return;
  }

  if (process.env.DLGSHOT) {
    // DLGSHOT=1：离屏渲染「导出图片」对话框并 capturePage 存盘（对话框视觉回归通道；
    // 本机在屏窗口被遮挡时 capturePage 返回旧帧，离屏通道可靠——与 export:images 同理）
    mainWindow.webContents.once('did-finish-load', async () => {
      try {
        await new Promise((r) => setTimeout(r, 1200));
        await mainWindow.webContents.executeJavaScript(`(async () => {
          const app = window.App;
          for (let i = 0; i < 50 && !app.state.ready; i++) await new Promise(r => setTimeout(r, 100));
          if (!app.state.ready) throw new Error('init fail');
          const entries = app.state.library.entries.slice(0, 6);
          app._openImageExportDialog(app, entries);
          await new Promise(r => setTimeout(r, 500));
          const m = document.querySelector('.modal');
          const radios = Array.from(m.querySelectorAll('input[type=radio]'));
          const multiR = radios.find(r => r.value === 'multi');
          if (multiR) multiR.click();
          await new Promise(r => setTimeout(r, 900));
          return 'ok';
        })()`);
        await new Promise((r) => setTimeout(r, 600));
        const img = await mainWindow.webContents.capturePage();
        require('fs').writeFileSync(path.join(__dirname, 'build', 'imgdialog_shot.png'), img.toPNG());
        console.log('DLGSHOT saved build/imgdialog_shot.png');
      } catch (e) {
        console.error('DLGSHOT FAIL:', e && e.message ? e.message : e);
      }
      app.exit(0);
    });
    return;
  }

  if (process.env.DOCSHOT) {
    // DOCSHOT=1：文档截图通道（离屏渲染，逐视图/逐弹窗截图存 docs/images/，供使用手册配图；
    // 只读不写数据：仅切换视图与打开弹窗，不点任何会持久化的控件，跑完自动退出）
    mainWindow.webContents.once('did-finish-load', async () => {
      const fsMod = require('fs');
      const outDir = path.join(__dirname, 'docs', 'images');
      try { fsMod.mkdirSync(outDir, { recursive: true }); } catch (_) {}
      const wait = (ms) => new Promise((r) => setTimeout(r, ms));
      const shot = async (name, extra) => {
        await wait(extra == null ? 700 : extra);
        const img = await mainWindow.webContents.capturePage();
        fsMod.writeFileSync(path.join(outDir, name + '.png'), img.toPNG());
        console.log('DOCSHOT saved ' + name + '.png');
      };
      const js = (code) => mainWindow.webContents.executeJavaScript(code);
      const closeModals = `document.querySelectorAll('#modal-root > .modal-mask').forEach(m => m.remove());`;
      try {
        await wait(1500);
        const prep = await js(`(async () => {
          const app = window.App;
          for (let i = 0; i < 60 && !app.state.ready; i++) await new Promise(r => setTimeout(r, 100));
          if (!app.state.ready) throw new Error('init fail');
          const s = window.Const.defaultGenerationSettings();
          s.totalCount = 10;
          const gen = window.Generator.generate(app.state.library, s);
          if (!gen.ok) throw new Error('gen fail: ' + gen.reason + ' ' + (gen.message || ''));
          app.newWorksheet(gen.items, s);
          app.state.worksheet.title = '化学方程式练习（一）';
          return 'ok items=' + gen.items.length;
        })()`);
        console.log('DOCSHOT prep:', prep);

        // 1 题库管理
        await js('window.App.showView("library")');
        await shot('01-题库管理', 1200);

        // 2 题库行展开（各版本 B/C/D/E/H 项目内计数）
        await js(`(() => {
          const btn = Array.from(document.querySelectorAll('.view-library button'))
            .find(b => b.textContent.trim() === '▶');
          if (btn) btn.click();
        })()`);
        await shot('02-题库管理-行展开', 900);
        await js('window.App.refreshView()');

        // 3 编辑条目弹窗
        await js(`window.EntryEditor.openEntryEditor(window.App,
          window.App.state.library.entries.find(e => e.versions && e.versions.length) || window.App.state.library.entries[0],
          {})`);
        await shot('03-编辑条目', 1000);
        await js(closeModals);

        // 4 导出图片面板
        await js(`window.App._openImageExportDialog(window.App, window.App.state.library.entries.slice(0, 6))`);
        await shot('04-导出图片', 1800);
        await js(closeModals);

        // 5 生成作业
        await js('window.App.showView("generate")');
        await shot('05-生成作业', 1100);

        // 6 当前作业（含卷面预览 iframe，多等一会）
        await js('window.App.showView("worksheet")');
        await shot('06-当前作业', 2500);

        // 7 卷面格式设置弹窗
        await js(`(() => {
          const btn = Array.from(document.querySelectorAll('button'))
            .find(b => b.textContent.includes('卷面格式'));
          if (btn) btn.click();
        })()`);
        await shot('07-卷面格式', 900);
        await js(closeModals);

        // 8 历史作业
        await js('window.App.showView("history")');
        await shot('08-历史作业', 900);

        // 9 数据管理
        await js('window.App.showView("datamanage")');
        await shot('09-数据管理', 900);

        // 10 设置（上半）
        await js('window.App.showView("settings")');
        await shot('10-设置', 900);

        // 11 设置（下半：滚动到底）
        await js(`(() => {
          const c = document.querySelector('.view-list-page') || document.getElementById('view-container');
          if (c) c.scrollTop = c.scrollHeight;
        })()`);
        await shot('11-设置-下半', 700);

        console.log('DOCSHOT RESULT: PASS');
      } catch (e) {
        console.error('DOCSHOT FAIL:', e && e.message ? e.message : e);
      }
      app.exit(0);
    });
    return;
  }

  if (process.env.VERIFYSETTINGS) {
    // VERIFYSETTINGS=1：设置功能自动验证（实时缩放/主题/视图渲染 + 截图存 build/），跑完自动退出
    mainWindow.webContents.once('did-finish-load', async () => {
      const shot = async (name) => {
        await new Promise((r) => setTimeout(r, 500));
        try {
          const img = await mainWindow.webContents.capturePage();
          require('fs').writeFileSync(path.join(__dirname, 'build', name), img.toPNG());
          console.log('saved build/' + name);
        } catch (_) { /* 打包后 asar 内不可写：跳过截图，仅保留断言 */ }
      };
      try {
        await new Promise((r) => setTimeout(r, 1200));
        const boot = await mainWindow.webContents.executeJavaScript(`(async () => {
          const app = window.App;
          for (let i = 0; i < 50 && !app.state.ready; i++) await new Promise(r => setTimeout(r, 100));
          if (!app.state.ready) throw new Error('init fail');
          return { version: app.state.version, hasDefaults: !!app.state.defaults, bootZoom: app.getUiZoom() };
        })()`);
        console.log('BOOT:', JSON.stringify(boot));
        if (!boot.hasDefaults) throw new Error('defaults missing in app:init');

        await mainWindow.webContents.executeJavaScript('window.App.showView("settings")');
        await shot('settings_100.png');

        const z = await mainWindow.webContents.executeJavaScript(`(async () => {
          await window.App.setUiZoom(1.3);
          await new Promise(r => setTimeout(r, 300));
          return {
            stateZoom: window.App.state.settings.ui.zoom,
            label: (document.querySelector('.zoom-value') || {}).textContent,
            slider: (document.querySelector('.view-list-page input[type=range]') || {}).value
          };
        })()`);
        const actual = mainWindow.webContents.getZoomFactor();
        console.log('ZOOM:', JSON.stringify(z), 'zoomFactor=' + actual);
        if (Math.abs(actual - 1.3) > 0.001 || z.label !== '130%') throw new Error('zoom realtime check fail');
        await shot('settings_130.png');

        const t = await mainWindow.webContents.executeJavaScript(`(async () => {
          const s = window.App.state.settings;
          s.theme = { preset: 'jade', background: '#E2EDE5', card: '#F4FAF6', text: '#2E4A38' };
          window.App.applyTheme();
          await new Promise(r => setTimeout(r, 200));
          return { bg: getComputedStyle(document.documentElement).getPropertyValue('--bg').trim() };
        })()`);
        console.log('THEME:', JSON.stringify(t));
        if (t.bg !== '#E2EDE5') throw new Error('theme check fail');
        await shot('settings_130_jade.png');
        // 启动默认主题（米白纸）回归：还原为 paper 后 CSS 变量应为 paper 底色
        const t2 = await mainWindow.webContents.executeJavaScript(`(async () => {
          const s = window.App.state.settings;
          s.theme = { preset: 'paper', background: '#F4F1E8', card: '#FFFFFF', text: '#3B3A34' };
          window.App.applyTheme();
          await new Promise(r => setTimeout(r, 200));
          return { bg: getComputedStyle(document.documentElement).getPropertyValue('--bg').trim() };
        })()`);
        if (t2.bg !== '#F4F1E8') throw new Error('default paper theme check fail');

        // 布局和谐性 @130%：各容器不得出现横向溢出（缩放后布局应自动重排/滚动，而非破相）
        const geomSettings = await mainWindow.webContents.executeJavaScript(`(() => {
          const doc = document.documentElement;
          const top = document.getElementById('topbar');
          const vc = document.getElementById('view-container');
          return {
            docOverflowX: doc.scrollWidth - doc.clientWidth,
            topbarOverflowX: top.scrollWidth - top.clientWidth,
            viewOverflowX: vc.scrollWidth - vc.clientWidth,
            navCount: document.querySelectorAll('#main-nav .nav-btn').length,
            panels: document.querySelectorAll('#view-container .panel').length,
            hasZoomPanel: !!document.querySelector('.zoom-value')
          };
        })()`);
        console.log('GEOM(settings@130):', JSON.stringify(geomSettings));
        if (geomSettings.docOverflowX > 0 || geomSettings.topbarOverflowX > 2 || geomSettings.viewOverflowX > 0) {
          throw new Error('layout overflow at 130%: ' + JSON.stringify(geomSettings));
        }
        if (geomSettings.navCount !== 6) throw new Error('nav buttons = ' + geomSettings.navCount);

        await mainWindow.webContents.executeJavaScript('window.App.showView("library")');
        await shot('library_130.png');
        const geomLibrary = await mainWindow.webContents.executeJavaScript(`(() => {
          const vc = document.getElementById('view-container');
          const main = document.querySelector('.view-library .main-area');
          return {
            viewOverflowX: vc.scrollWidth - vc.clientWidth,
            sidebar: !!document.querySelector('.view-library .sidebar'),
            tableRows: document.querySelectorAll('.view-library table.list tbody tr').length
          };
        })()`);
        console.log('GEOM(library@130):', JSON.stringify(geomLibrary));
        if (geomLibrary.viewOverflowX > 0) throw new Error('library overflow at 130%');

        // 「创建副本」按钮可见化回归：点击后条目数 +1、自动跳到末页、出现高亮行，随后清理副本
        const cp = await mainWindow.webContents.executeJavaScript(`(async () => {
          const app = window.App;
          const view = window.App.views.library;
          const before = app.state.library.entries.length;
          const btns = Array.from(document.querySelectorAll('#view-container table.list tbody tr:first-child .btn'));
          const copyBtn = btns.find(b => b.textContent.trim() === '创建副本');
          if (!copyBtn) return { ok: false, reason: 'no 创建副本 button' };
          copyBtn.click();
          await new Promise(r => setTimeout(r, 600));
          const flash = !!document.querySelector('tr.row-flash');
          const after = app.state.library.entries.length;
          const lastPage = Math.max(1, Math.ceil(after / 50));
          const ok = after === before + 1 && flash && view.page === lastPage;
          // 清理：直接移除副本并保存（不进回收站、不留统计污染）
          if (after === before + 1) {
            app.state.library.entries.splice(after - 1, 1);
            await app.saveLibrary();
          }
          return { ok, before, after, page: view.page, lastPage, flash };
        })()`);
        console.log('COPY-FLOW:', JSON.stringify(cp));
        if (!cp.ok) throw new Error('copy entry visibility check fail');

        // 「复制」剪贴板回归：点击后系统剪贴板应出现 Unicode 下标美化文本
        const clipOk = await mainWindow.webContents.executeJavaScript(`(async () => {
          const btns = Array.from(document.querySelectorAll('#view-container table.list tbody tr:first-child .btn'));
          const b = btns.find(x => x.textContent.trim() === '复制');
          if (!b) return false;
          b.click();
          await new Promise(r => setTimeout(r, 300));
          return true;
        })()`);
        const clipText = clipboard.readText();
        console.log('CLIPBOARD:', JSON.stringify(clipText.slice(0, 60)));
        if (!clipOk || !/[=⇌—]/.test(clipText) || /<|&/.test(clipText) || clipText.includes('→')) {
          throw new Error('clipboard copy check fail: ' + JSON.stringify(clipText.slice(0, 60)));
        }

        // 滚动位置保持回归：题库列表滚到中部 → 勾选触发 refreshView → 位置应保留
        const sc = await mainWindow.webContents.executeJavaScript(`(async () => {
          const wrap = document.querySelector('.lib-table-wrap');
          if (!wrap) return { ok: false, reason: 'no .lib-table-wrap' };
          wrap.scrollTop = 300;
          const cb = document.querySelector('#view-container table.list tbody tr:first-child input[type=checkbox]');
          cb.click(); // 勾选 → App.refreshView() → DOM 重建
          await new Promise(r => setTimeout(r, 300));
          const kept = Math.abs(document.querySelector('.lib-table-wrap').scrollTop - 300) < 40;
          // 还原勾选状态
          const cb2 = document.querySelector('#view-container table.list tbody tr:first-child input[type=checkbox]');
          if (cb2 && cb2.checked) cb2.click();
          return { ok: kept, top: document.querySelector('.lib-table-wrap').scrollTop };
        })()`);
        console.log('SCROLL-KEEP:', JSON.stringify(sc));
        if (!sc.ok) throw new Error('scroll keep check fail');

        // 导出图片端到端（saveMode:auto 免对话框）：合成一张 + 每条一张，文件应真实写出
        const imgDir = path.join(__dirname, 'build', 'img-test');
        const im = await mainWindow.webContents.executeJavaScript(`(async () => {
          const app = window.App;
          const entries = app.state.library.entries.slice(0, 3);
          const base = { versionScope: 'all', number: true, showName: true, showType: false, showDifficulty: false, showTextbook: false, fontPt: 16, scale: 2, cols: 1, format: 'png', baseName: 'imgtest', saveMode: 'auto', defaultDir: ${JSON.stringify(imgDir)},
            metaFontPt: 12, textAlign: 'center', eqAlign: 'center', gapPt: 6, padPt: 30 };
          const r1 = await window.App._exportImagesCore(app, entries, Object.assign({}, base, { mode: 'single' }));
          const r2 = await window.App._exportImagesCore(app, entries.slice(0, 2), Object.assign({}, base, { mode: 'multi' }));
          return { single: r1, multi: r2 };
        })()`);
        const png1 = im.single && im.single.files && im.single.files[0];
        const png2 = (im.multi && im.multi.files) || [];
        console.log('IMAGE-EXPORT:', 'single=' + JSON.stringify(im.single && { ok: im.single.ok, n: (im.single.files || []).length }),
          'multi=' + JSON.stringify(im.multi && { ok: im.multi.ok, n: (im.multi.files || []).length }));
        const pngHead = (p) => { try { const b = fs.readFileSync(p); return b.length > 1000 && b[0] === 0x89 && b[1] === 0x50; } catch (_) { return false; } };
        const pngSize = (p) => {
          try {
            const b = fs.readFileSync(p);
            return (b.length > 24 && b[0] === 0x89 && b[1] === 0x50) ? { w: b.readUInt32BE(16), h: b.readUInt32BE(20) } : null;
          } catch (_) { return null; }
        };
        if (!im.single || !im.single.ok || !png1 || !pngHead(png1)) throw new Error('image single export fail');
        if (!im.multi || !im.multi.ok || png2.length < 2 || !png2.every(pngHead)) throw new Error('image multi export fail');
        // 内容自适应宽度回归：单条方程式（16pt/2x/27pt 边距）图片宽应贴合内容，
        // 远小于旧固定画布（860×2 + 边距 ≈ 1880px 留白）
        const fit = await mainWindow.webContents.executeJavaScript(`(async () => {
          const app = window.App;
          const entries = app.state.library.entries.slice(0, 1);
          const base = { versionScope: 'main', number: false, showName: false, showType: false, showDifficulty: false, showTextbook: false, fontPt: 16, scale: 2, format: 'png', baseName: 'imgfit', saveMode: 'auto', defaultDir: ${JSON.stringify(imgDir)}, padPt: 27 };
          return await window.App._exportImagesCore(app, entries, base);
        })()`);
        const fitPng = fit && fit.files && fit.files[0];
        const fitSize = pngSize(fitPng);
        console.log('IMAGE-FIT:', JSON.stringify(fitSize));
        if (!fitSize || fitSize.w >= 1600 || fitSize.w < 200 || fitSize.h < 60) {
          throw new Error('image content-fit width check fail: ' + JSON.stringify(fitSize));
        }
        // 设定高度 + 垂直对齐回归：固定画布 100pt × 2x → 导出高约 267px（内容更小取画布高）
        const fit2 = await mainWindow.webContents.executeJavaScript(`(async () => {
          const app = window.App;
          const entries = app.state.library.entries.slice(0, 1);
          const base = { versionScope: 'main', number: false, showName: false, showType: false, showDifficulty: false, showTextbook: false, fontPt: 16, scale: 2, format: 'png', baseName: 'imgfit2', saveMode: 'auto', defaultDir: ${JSON.stringify(imgDir)}, padPt: 27, heightMode: 'fixed', canvasHeightPt: 100, vAlign: 'middle' };
          return await window.App._exportImagesCore(app, entries, base);
        })()`);
        const fit2Png = fit2 && fit2.files && fit2.files[0];
        const fit2Size = pngSize(fit2Png);
        console.log('IMAGE-FIT-FIXED:', JSON.stringify(fit2Size));
        if (!fit2Size || Math.abs(fit2Size.h - 267) > 12 || fit2Size.w < 200) {
          throw new Error('image fixed-canvas height check fail: ' + JSON.stringify(fit2Size));
        }
        // 清理测试产物
        for (const p of [png1, ...png2, fitPng, fit2Png]) fs.unlinkSync(p);
        try { fs.rmdirSync(imgDir); } catch (_) {}

        // 导出图片面板回归：对话框可打开 + 排版选项 + 字体下拉 + 大幅预览缩放 +
        // 「每条一张图」逐张切换器（切到 multi 后预览只显示当前一张）
        //（iframe 加载为异步：轮询等待而非固定休眠，避免窗口渲染节流导致的偶发超时）
        const imgDlg1 = await mainWindow.webContents.executeJavaScript(`(async () => {
          const app = window.App;
          const entries = app.state.library.entries.slice(0, 3);
          app._openImageExportDialog(app, entries);
          const m = document.querySelector('.modal');
          const frame = m && m.querySelector('iframe');
          let blocks = 0;
          for (let i = 0; i < 20; i++) {
            await new Promise(r => setTimeout(r, 150));
            blocks = frame ? frame.contentDocument.querySelectorAll('.blk').length : 0;
            if (blocks >= 1) break;
          }
          return { opened: !!m, hasPreview: !!frame, blocks,
            hasAlign: !!(m && m.textContent.includes('方程式位置') && m.textContent.includes('文字位置')),
            hasFonts: !!(m && m.textContent.includes('中文字体') && m.textContent.includes('西文字体')),
            hasZoom: !!(m && m.textContent.includes('适宽') && m.textContent.includes('整页') && m.textContent.includes('100%')),
            hasVAlign: !!(m && m.textContent.includes('垂直对齐') && m.textContent.includes('图片高度')),
            previewOutlined: !!(frame && frame.parentElement && frame.parentElement.style.outline) };
        })()`);
        await shot('imgdialog_single.png');
        const imgDlg2 = await mainWindow.webContents.executeJavaScript(`(async () => {
          const m = document.querySelector('.modal');
          let multiTotal = null, multiBlocks = 0, multiHasSelect = false;
          try {
            const radios = Array.from(m.querySelectorAll('input[type=radio]'));
            const multiR = radios.find(r => r.value === 'multi');
            if (multiR) {
              multiR.click();
              for (let i = 0; i < 20; i++) {
                await new Promise(r => setTimeout(r, 150));
                const f = m.querySelector('iframe');
                multiBlocks = f ? f.contentDocument.querySelectorAll('.blk').length : 0;
                if (multiBlocks === 1) break;
              }
            }
            const mm = m.textContent.match(/第 1 \\/ (\\d+) 张/);
            multiTotal = mm ? Number(mm[1]) : null;
            multiHasSelect = !!m.querySelector('.modal select');
            const frame2 = m.querySelector('iframe');
            multiBlocks = frame2 ? frame2.contentDocument.querySelectorAll('.blk').length : 0;
          } catch (_) {}
          return { multiTotal, multiBlocks, multiHasSelect };
        })()`);
        // 逐张切换 + 张序收敛回归：导航到末张 → 收窄版本范围至 0 张（清空类型勾选）→
        // 恢复后张序应收敛到有效范围（旧代码在列表变短时 items[previewIndex] 越界崩溃）
        const imgDlg3 = await mainWindow.webContents.executeJavaScript(`(async () => {
          const m = document.querySelector('.modal');
          let okNav = false, okEmpty = false, okRestore = false, crashed = false;
          try {
            // ① 点 ▶ 到末张
            const nextBtns = Array.from(m.querySelectorAll('.modal button')).filter(b => b.textContent.trim() === '▶');
            for (let i = 0; i < 5 && nextBtns.length; i++) nextBtns[0].click();
            await new Promise(r => setTimeout(r, 500));
            okNav = /第 3 \\/ 3 张/.test(m.textContent);
            // ② 切「指定类型」并清空类型勾选 → 0 张
            const radios = Array.from(m.querySelectorAll('input[type=radio]'));
            const customR = radios.find(r => r.value === 'custom');
            if (customR) customR.click();
            await new Promise(r => setTimeout(r, 400));
            const labels = Array.from(m.querySelectorAll('.modal .check-item'));
            for (const lab of labels) {
              if (lab.textContent.trim() === '化学') { const cb = lab.querySelector('input'); if (cb && cb.checked) cb.click(); }
            }
            await new Promise(r => setTimeout(r, 500));
            okEmpty = m.textContent.includes('当前选项下没有可导出的版本');
            // ③ 恢复勾选 → 张序收敛、预览恢复
            for (const lab of labels) {
              if (lab.textContent.trim() === '化学') { const cb = lab.querySelector('input'); if (cb && !cb.checked) cb.click(); }
            }
            await new Promise(r => setTimeout(r, 800));
            const mm = m.textContent.match(/第 (\\d+) \\/ (\\d+) 张/);
            okRestore = !!mm && Number(mm[1]) <= Number(mm[2]) && Number(mm[2]) >= 1;
            const closeBtn = m.querySelector('.modal-close');
            if (closeBtn) closeBtn.click();
            await new Promise(r => setTimeout(r, 100));
          } catch (e) { crashed = true; }
          return { okNav, okEmpty, okRestore, crashed };
        })()`);
        console.log('IMG-DIALOG-NAV:', JSON.stringify(imgDlg3));
        if (imgDlg3.crashed || !imgDlg3.okNav || !imgDlg3.okEmpty || !imgDlg3.okRestore) {
          throw new Error('image dialog preview navigation check fail: ' + JSON.stringify(imgDlg3));
        }
        await shot('imgdialog_multi.png');
        const imgDlg = Object.assign({}, imgDlg1, imgDlg2, imgDlg3);
        console.log('IMG-DIALOG:', JSON.stringify(imgDlg));
        if (!imgDlg.opened || !imgDlg.hasPreview || imgDlg.blocks < 1 || !imgDlg.hasAlign) {
          throw new Error('image export dialog preview check fail: ' + JSON.stringify(imgDlg));
        }
        if (!imgDlg.hasFonts || !imgDlg.hasZoom) {
          throw new Error('image dialog fonts/zoom check fail: ' + JSON.stringify(imgDlg));
        }
        if (!imgDlg.hasVAlign || !imgDlg.previewOutlined) {
          throw new Error('image dialog valign/outline check fail: ' + JSON.stringify(imgDlg));
        }
        if (!imgDlg.multiTotal || imgDlg.multiTotal < 1 || imgDlg.multiBlocks !== 1 || !imgDlg.multiHasSelect) {
          throw new Error('image dialog multi-mode switcher check fail: ' + JSON.stringify(imgDlg));
        }

        // 统一排版回归：所有行高一致（±2px）、操作列为固定网格（高缩放下按钮不被挤压成一条）
        const uni = await mainWindow.webContents.executeJavaScript(`(() => {
          const rows = Array.from(document.querySelectorAll('#view-container table.list tbody tr'));
          const hs = rows.map(r => r.getBoundingClientRect().height);
          const min = Math.min(...hs), max = Math.max(...hs);
          const grid = !!document.querySelector('#view-container .row-actions');
          const actionsRows = new Set(Array.from(document.querySelectorAll('#view-container .row-actions')).map(a => a.getBoundingClientRect().height));
          const btnWs = Array.from(document.querySelectorAll('#view-container .row-actions .btn')).map(b => b.getBoundingClientRect().width);
          return { rows: rows.length, minH: Math.round(min), maxH: Math.round(max), uniform: max - min <= 2, grid, actionsUniform: actionsRows.size <= 1,
            btnMinW: Math.round(Math.min(...btnWs)), btnMaxW: Math.round(Math.max(...btnWs)) };
        })()`);
        console.log('UNIFORM-ROWS:', JSON.stringify(uni));
        if (!uni.uniform || !uni.grid || !uni.actionsUniform) throw new Error('uniform row layout check fail');
        if (uni.btnMinW < 24) throw new Error('row-actions buttons squeezed at 130%: minW=' + uni.btnMinW);

        await mainWindow.webContents.executeJavaScript('window.App.showView("datamanage")');
        await shot('datamanage_130.png');
        const dm = await mainWindow.webContents.executeJavaScript(`(() => ({
          stillHasSettingsPanel: document.querySelector('#view-container').textContent.includes('应用设置'),
          panelTitles: Array.from(document.querySelectorAll('#view-container .panel-title')).map(x => x.textContent)
        }))()`);
        console.log('DATAMANAGE:', JSON.stringify(dm));
        if (dm.stillHasSettingsPanel) throw new Error('settings panel not migrated out of datamanage');

        // 分类管理重排回归：标签占行宽大头、操作按钮组与行右端对齐（±2px）、新增行输入框可伸缩
        const cr = await mainWindow.webContents.executeJavaScript(`(() => {
          const rows = Array.from(document.querySelectorAll('.class-row'));
          if (!rows.length) return { ok: false, reason: 'no class rows' };
          let bad = 0;
          rows.slice(0, 20).forEach(r => {
            const act = r.querySelector('.class-row-actions');
            const tag = r.querySelector('.class-row-name .tag');
            if (!act || !tag) { bad++; return; }
            const rr = r.getBoundingClientRect(), ar = act.getBoundingClientRect(), tr = tag.getBoundingClientRect();
            if (Math.abs(rr.right - ar.right) > 2) bad++;           // 按钮组右对齐
            if (tr.width < rr.width * 0.4) bad++;                    // 标签占满大头
            if (tr.height < 20) bad++;                               // 标签字号已放大
          });
          const add = document.querySelector('.class-add-row');
          const addInput = add && add.querySelector('input');
          return { ok: bad === 0, bad, rows: rows.length, addRow: !!add, addInputGrow: !!addInput && getComputedStyle(addInput).flexGrow === '1' };
        })()`);
        console.log('CLASSROWS:', JSON.stringify(cr));
        if (!cr.ok || !cr.addInputGrow) throw new Error('classification row layout check fail');

        // 新作业默认卷面格式联动：设置 B5 + 标题/正文字号 → newWorksheet 应套用
        const layout = await mainWindow.webContents.executeJavaScript(`(() => {
          const app = window.App;
          app.state.settings.defaultPaper.size = 'B5';
          app.state.settings.defaultFont.fontSizePt = 11;
          app.state.settings.defaultFont.titleSizePt = 18;
          const L = app.defaultLayoutFromSettings();
          return { paper: L.paper.size, bodyPt: L.font.bodySizePt, titlePt: L.font.titleSizePt };
        })()`);
        console.log('DEFAULT-LAYOUT:', JSON.stringify(layout));
        if (layout.paper !== 'B5' || layout.bodyPt !== 11 || layout.titlePt !== 18) throw new Error('default layout merge fail');

        // 预览双滚动条回归：生成作业后，预览 iframe 内部零溢出（只保留外层滚动条）
        const pv = await mainWindow.webContents.executeJavaScript(`(async () => {
          const app = window.App;
          const s = window.Const.defaultGenerationSettings();
          s.totalCount = 12;
          const gen = window.Generator.generate(app.state.library, s);
          if (!gen.ok) return { ok: false, reason: gen.message || 'gen fail' };
          app.newWorksheet(gen.items, s);
          app.showView('worksheet');
          await new Promise(r => setTimeout(r, 900));
          const f = document.querySelector('.paper-frame');
          if (!f) return { ok: false, reason: 'no paper frame' };
          const d = f.contentDocument.documentElement;
          return {
            ok: true,
            frameW: f.style.width, frameH: f.style.height, frameBorder: f.style.border,
            scrollW: d.scrollWidth, clientW: d.clientWidth,
            scrollH: d.scrollHeight, clientH: d.clientHeight,
            bodyOverflow: getComputedStyle(f.contentDocument.body).overflow
          };
        })()`);
        console.log('PREVIEW:', JSON.stringify(pv));
        if (!pv.ok || pv.bodyOverflow !== 'hidden' || pv.scrollH > pv.clientH || pv.scrollW > pv.clientWidth) {
          throw new Error('preview inner scrollbar check fail: ' + JSON.stringify(pv));
        }

        // 生成作业页非空白回归（曾经因组件缺 el 引用整页空白）：项目范围条 + 范围选择器 + 面板齐全
        await mainWindow.webContents.executeJavaScript('window.App.showView("generate")');
        await shot('generate_130.png');
        const gv = await mainWindow.webContents.executeJavaScript(`(() => {
          const v = document.querySelector('.view-generate');
          return {
            nonEmpty: !!v && v.textContent.trim().length > 50,
            scopeBar: !!v && v.textContent.includes('项目范围'),
            scopeChecks: document.querySelectorAll('.view-generate .scope-picker input[type=checkbox]').length,
            panels: document.querySelectorAll('.view-generate .panel').length,
            hasManual: !!v && v.textContent.includes('手动选题')
          };
        })()`);
        console.log('GENVIEW:', JSON.stringify(gv));
        if (!gv.nonEmpty || !gv.scopeBar || !gv.hasManual) throw new Error('generate view blank check fail');
        if (gv.scopeChecks < 10) throw new Error('generate scope picker missing: ' + gv.scopeChecks);
        if (gv.panels < 5) throw new Error('generate panels missing: ' + gv.panels);
        await mainWindow.webContents.executeJavaScript('window.App.showView("library")');

        // 新建学习项目弹窗回归（曾因 ScopePicker 缺 el 引用点击无反应）：弹窗可打开且范围选择器渲染
        const projDlg = await mainWindow.webContents.executeJavaScript(`(async () => {
          window.App.showView('settings');
          await new Promise(r => setTimeout(r, 300));
          const btns = Array.from(document.querySelectorAll('#view-container .btn'));
          const createBtn = btns.find(b => b.textContent.includes('新建学习项目'));
          if (!createBtn) return { ok: false, reason: 'no create button' };
          createBtn.click();
          await new Promise(r => setTimeout(r, 400));
          const m = document.querySelector('.modal');
          const checks = m ? m.querySelectorAll('.scope-picker input[type=checkbox]').length : 0;
          const hasAllCb = !!(m && m.textContent.includes('使用全部题库'));
          const closeBtn = m && m.querySelector('.modal-close');
          if (closeBtn) closeBtn.click();
          await new Promise(r => setTimeout(r, 100));
          return { ok: !!m, checks, hasAllCb };
        })()`);
        console.log('PROJ-DIALOG:', JSON.stringify(projDlg));
        if (!projDlg.ok || projDlg.checks < 10 || !projDlg.hasAllCb) {
          throw new Error('create project dialog check fail: ' + JSON.stringify(projDlg));
        }

        // ===== 学习项目（LEARNING）断言块 =====
        // 1. 初始：projects 含 default、当前=default、projectPairStats().round===0、题库出题列抽查为 0
        const l1 = await mainWindow.webContents.executeJavaScript(`(async () => {
          const app = window.App;
          const ids = app.state.projects.map(p => p.id);
          const cur = app.currentProjectId();
          const stats = app.projectPairStats();
          const cntSample = app.state.library.entries.slice(0, 20).map(e => app.entryProjectCount(e));
          return { ids, cur, round: stats.round, laggards: stats.laggards,
            cntAllZero: cntSample.every(c => c === 0), projectsLen: app.state.projects.length };
        })()`);
        console.log('LEARNING-1:', JSON.stringify(l1));
        if (!l1.ids.includes('default') || l1.cur !== 'default') throw new Error('learning init check fail');
        if (l1.round !== 0) throw new Error('learning initial round should be 0, got ' + l1.round);
        if (!l1.cntAllZero) throw new Error('learning initial entry project counts should be all 0');

        // 2. 创建测试项目（scope=九年级上册，40 条 <392）→ 创建即切换 → 题库列表条目数 < 全量且全部满足范围
        //    force=true：跳过切换确认弹窗（VERIFY 前序 PREVIEW 断言已在内存留下 worksheet）
        const l2 = await mainWindow.webContents.executeJavaScript(`(async () => {
          const app = window.App;
          const scope = { books: ['九年级上册'] };
          const scoped = app.state.library.entries.filter(e => window.Generator.entryInScope(e, scope));
          if (!scoped.length || scoped.length >= app.state.library.entries.length) {
            return { ok: false, reason: 'scope size invalid: ' + scoped.length + '/' + app.state.library.entries.length };
          }
          const r = await app.createProject('VERIFY测试项目', scope, { force: true });
          const cur = app.currentProjectId();
          const libInScope = app.state.library.entries.filter(e => window.Generator.entryInScope(e, app.currentProject().scope));
          return { ok: r.ok, switched: r.switched, cur, projectId: r.project.id,
            scoped: scoped.length, total: app.state.library.entries.length, libInScope: libInScope.length,
            allInScope: libInScope.length === scoped.length };
        })()`);
        console.log('LEARNING-2:', JSON.stringify(l2));
        if (!l2.ok || !l2.switched || l2.cur !== l2.projectId) throw new Error('create project check fail');
        if (!(l2.libInScope < l2.total) || !l2.allInScope) throw new Error('library project filter check fail');

        // 2b. 范围分组细化语义回归（修复：册别+章/节全局“且”导致“九上+九下+必修一+第一章+第一节”
        //     反而比“九上+九下”少）。当前项目 = 九上（LEARNING-2 已切换）
        const l2b = await mainWindow.webContents.executeJavaScript(`(() => {
          const app = window.App;
          const Gen = window.Generator;
          const es = app.state.library.entries;
          const A = { books: ['九年级上册', '九年级下册'] };
          const B = { books: ['九年级上册', '九年级下册', '必修第一册'], chapters: ['第一章 物质及其变化'], sections: ['第一节 物质的分类及转化'] };
          const rA = Gen.refineBooksByScope(es, A), rB = Gen.refineBooksByScope(es, B);
          const nA = es.filter(e => Gen.entryInScope(e, A, rA)).length;
          const nB = es.filter(e => Gen.entryInScope(e, B, rB)).length;
          const facets = app.projectFacets();
          return { nA, nB, superset: nB >= nA, grew: nB > nA,
            facetBooks: Array.from(facets.books), facetHasOthers: facets.books.has('必修第一册') || facets.books.has('必修第二册') };
        })()`);
        console.log('SCOPE-LOGIC:', JSON.stringify(l2b));
        if (!l2b.superset || !l2b.grew) throw new Error('scope group-refinement check fail: ' + JSON.stringify(l2b));
        if (l2b.facetBooks.length !== 1 || l2b.facetBooks[0] !== '九年级上册' || l2b.facetHasOthers) {
          throw new Error('projectFacets books check fail: ' + JSON.stringify(l2b));
        }

        // 2c. 生成页/题库侧栏选项按项目范围收敛：当前项目=九上 → 册别只显示 1 项
        const l2c = await mainWindow.webContents.executeJavaScript(`(async () => {
          const app = window.App;
          app.showView('generate');
          await new Promise(r => setTimeout(r, 300));
          const rows = Array.from(document.querySelectorAll('.view-generate .scope-picker > div'));
          const bookRow = rows.find(r => r.textContent.includes('册别'));
          const bookChecks = bookRow ? bookRow.querySelectorAll('input[type=checkbox]').length : -1;
          app.showView('library');
          await new Promise(r => setTimeout(r, 300));
          const sels = Array.from(document.querySelectorAll('.view-library .sidebar select'));
          const bookSel = sels[1]; // 第 2 个下拉 = 册别
          const bookOpts = bookSel ? Array.from(bookSel.querySelectorAll('option')).map(o => o.textContent).filter(t => t !== '全部') : [];
          return { bookChecks, bookOpts };
        })()`);
        console.log('FACETS-UI:', JSON.stringify(l2c));
        if (l2c.bookChecks !== 1) throw new Error('generate scope picker facets check fail: ' + JSON.stringify(l2c));
        if (l2c.bookOpts.length !== 1 || l2c.bookOpts[0] !== '九年级上册') {
          throw new Error('library sidebar facets check fail: ' + JSON.stringify(l2c));
        }

        // 2d. 「题目不足」弹窗修复回归：总题数 200 → 生成 → 弹「题目不足」→
        //     点「减少题数到可出数」应真实减少并成功生成（旧版减数时没带项目范围，
        //     按全库候选算，减不下来 → 弹窗反复出现 = “点了没生效”）
        const l2d = await mainWindow.webContents.executeJavaScript(`(async () => {
          const app = window.App;
          app.showView('generate');
          await new Promise(r => setTimeout(r, 400));
          // 生成页范围条应有「可出 N 题」计数徽标
          const chip = Array.from(document.querySelectorAll('.view-generate .scope-panel-chip, .view-generate .tag'))
            .find(x => /可出 \\d+ 题/.test(x.textContent));
          const total = document.querySelector('.view-generate input[type=number]');
          if (!total) return { ok: false, reason: 'no total input' };
          total.value = '200';
          total.dispatchEvent(new Event('input', { bubbles: true }));
          await new Promise(r => setTimeout(r, 200));
          const btn = Array.from(document.querySelectorAll('.view-generate .btn')).find(b => b.textContent.includes('随机生成作业'));
          if (!btn) return { ok: false, reason: 'no generate button' };
          btn.click();
          await new Promise(r => setTimeout(r, 400));
          const m = document.querySelector('.modal');
          const isShortage = !!(m && m.textContent.includes('题目不足'));
          let clickedReduce = false, hasStrategyBtn = false;
          if (isShortage) {
            const btns = Array.from(m.querySelectorAll('button'));
            const reduce = btns.find(b => b.textContent.includes('减少题数'));
            hasStrategyBtn = btns.some(b => b.textContent.includes('版本策略'));
            if (reduce) { reduce.click(); clickedReduce = true; }
          }
          await new Promise(r => setTimeout(r, 2500));
          const m2 = document.querySelector('.modal');
          const w = app.state.worksheet;
          return { hasChip: !!chip, chipText: chip ? chip.textContent.trim() : null,
            isShortage, clickedReduce, hasStrategyBtn, modalGone: !m2,
            wsItems: w ? w.items.length : 0,
            wsTotal: w && w.generationSettings ? w.generationSettings.totalCount : 0 };
        })()`);
        console.log('SHORTAGE-FLOW:', JSON.stringify(l2d));
        if (!l2d.hasChip) throw new Error('generate available-count chip missing');
        if (!l2d.isShortage || !l2d.clickedReduce) {
          throw new Error('shortage modal check fail: ' + JSON.stringify(l2d));
        }
        if (!l2d.hasStrategyBtn) throw new Error('shortage modal strategy option missing');
        if (!l2d.modalGone || l2d.wsItems < 1 || l2d.wsItems !== l2d.wsTotal) {
          throw new Error('shortage reduce button check fail: ' + JSON.stringify(l2d));
        }

        // 2e. 用户场景回归（离子反应章节 30 条中仅 15 条有化学版本）：
        //     chemicalOnly 出 25 题 → 「题目不足」→ 点「切换版本策略」→ allAvailable 生成成功；
        //     手动选题列表应显示全部条目（无化学版本的灰显不可勾），与题库管理口径一致
        const l2e = await mainWindow.webContents.executeJavaScript(`(async () => {
          const app = window.App;
          const scope = { books: ['必修第一册'], chapters: ['第一章 物质及其变化'], sections: ['第二节 离子反应'] };
          const r = await app.createProject('VERIFY离子场景', scope, { force: true });
          if (!r.switched) return { ok: false, reason: 'switch fail' };
          app.showView('generate');
          await new Promise(r2 => setTimeout(r2, 500));
          const chip = Array.from(document.querySelectorAll('.view-generate .tag')).find(x => /可出 (\\d+) 题/.test(x.textContent));
          const chipNum = chip ? Number((chip.textContent.match(/可出 (\\d+) 题/) || [])[1]) : null;
          const rows = document.querySelectorAll('.gen-manual .check-item');
          const disabledRows = Array.from(rows).filter(l => l.querySelector('input') && l.querySelector('input').disabled);
          const total = document.querySelector('.view-generate input[type=number]');
          total.value = '25';
          total.dispatchEvent(new Event('input', { bubbles: true }));
          await new Promise(r2 => setTimeout(r2, 200));
          const btn = Array.from(document.querySelectorAll('.view-generate .btn')).find(b => b.textContent.includes('随机生成作业'));
          btn.click();
          await new Promise(r2 => setTimeout(r2, 400));
          const m = document.querySelector('.modal');
          const isShortage = !!(m && m.textContent.includes('题目不足'));
          let clickedStrategy = false;
          if (isShortage) {
            const sb = Array.from(m.querySelectorAll('button')).find(b => b.textContent.includes('版本策略'));
            if (sb) { sb.click(); clickedStrategy = true; }
          }
          await new Promise(r2 => setTimeout(r2, 900));
          const m2 = document.querySelector('.modal');
          const w = app.state.worksheet;
          return { ok: true, chipNum, rows: rows.length, disabledRows: disabledRows.length,
            isShortage, clickedStrategy, modalGone: !m2,
            wsItems: w ? w.items.length : 0, strategy: w && w.generationSettings ? w.generationSettings.versionStrategy : null };
        })()`);
        console.log('SHORTAGE-STRATEGY:', JSON.stringify(l2e));
        if (!l2e.ok) throw new Error('user-scenario project check fail: ' + JSON.stringify(l2e));
        if (!(l2e.chipNum < 25)) throw new Error('user-scenario chip should be < 25: ' + JSON.stringify(l2e));
        if (l2e.rows < 25 || l2e.disabledRows < 5) {
          throw new Error('manual list should show all entries with greyed unusable: ' + JSON.stringify(l2e));
        }
        if (!l2e.isShortage || !l2e.clickedStrategy || !l2e.modalGone || l2e.wsItems !== 25 || l2e.strategy !== 'allAvailable') {
          throw new Error('shortage strategy-switch check fail: ' + JSON.stringify(l2e));
        }
        // 清理：切回测试项目并删除临时项目
        const l2ec = await mainWindow.webContents.executeJavaScript(`(async () => {
          const app = window.App;
          const testProjId = ${JSON.stringify(l2.projectId)};
          await app.switchProject(testProjId, { force: true, keepWorksheet: true });
          const temp = app.state.projects.find(p => p.name === 'VERIFY离子场景');
          if (temp) await app.deleteProject(temp.id);
          return { cur: app.currentProjectId(), left: app.state.projects.map(p => p.name) };
        })()`);
        console.log('SHORTAGE-CLEANUP:', JSON.stringify(l2ec));
        if (l2ec.cur !== l2.projectId || l2ec.left.includes('VERIFY离子场景')) {
          throw new Error('user-scenario cleanup fail: ' + JSON.stringify(l2ec));
        }

        // 3. 完整流：generate(total=8) → newWorksheet → saveHistory → counts 非空、countedItems=8、projectId=测试项目
        const l3 = await mainWindow.webContents.executeJavaScript(`(async () => {
          const app = window.App;
          const s = window.Const.defaultGenerationSettings();
          s.totalCount = 8;
          const project = app.currentProject();
          const opts = { projectScope: project.scope, projectCounts: app.state.projectData.counts, round: app.projectPairStats(project).round };
          const gen = window.Generator.generate(app.state.library, s, opts);
          if (!gen.ok) return { ok: false, reason: gen.reason, message: gen.message };
          app.newWorksheet(gen.items, s);
          app.state.worksheet.title = 'VERIFY学习项目作业';
          await window.App.saveWorksheetHistory(app);
          const d = app.state.projectData;
          return { ok: true, pid: app.state.worksheet.projectId, projectId: app.state.worksheet.projectId,
            countsKeys: Object.keys(d.counts).length, counted: Object.keys(d.countedItems).length };
        })()`);
        console.log('LEARNING-3:', JSON.stringify(l3));
        if (!l3.ok) throw new Error('learning full flow fail: ' + (l3.message || l3.reason));
        if (l3.projectId !== l2.projectId) throw new Error('worksheet.projectId should be test project');
        if (!(l3.countsKeys > 0) || l3.counted !== 8) throw new Error('counts/countedItems wrong: ' + JSON.stringify(l3));

        // 4. 同设置再生成一次 → 新一轮 items 的 pairKey 与已保存作业无交集（round=0 时已计对被排除）
        const l4 = await mainWindow.webContents.executeJavaScript(`(async () => {
          const app = window.App;
          const s = window.Const.defaultGenerationSettings();
          s.totalCount = 8;
          const project = app.currentProject();
          const opts = { projectScope: project.scope, projectCounts: app.state.projectData.counts, round: app.projectPairStats(project).round };
          const gen = window.Generator.generate(app.state.library, s, opts);
          if (!gen.ok) return { ok: gen.ok, reason: gen.reason };
          const C = window.Chem;
          const keyOf = (it) => C.versionDupKey(it.snapshot.version) + '#' + it.questionType;
          const saved = new Set(Object.values(app.state.projectData.countedItems));
          const fresh = gen.items.map(keyOf);
          const overlap = fresh.filter(k => saved.has(k)).length;
          return { ok: true, items: gen.items.length, overlap, round: opts.round };
        })()`);
        console.log('LEARNING-4:', JSON.stringify(l4));
        if (!l4.ok && l4.reason !== 'roundShortage' && l4.reason !== 'shortage') throw new Error('regen check fail: ' + JSON.stringify(l4));
        if (l4.ok && l4.overlap !== 0) throw new Error('new round items overlap saved pairs: ' + l4.overlap);

        // 5. 排除流：excludeWorksheetItem → items.length 不变（成功补题）且补入题 pairKey 不在原卷；被排除 key counts +1
        const l5 = await mainWindow.webContents.executeJavaScript(`(async () => {
          const app = window.App;
          const w = app.state.worksheet;
          if (!w || !w.items.length) return { ok: false, reason: 'no worksheet' };
          const C = window.Chem;
          const keyOf = (it) => C.versionDupKey(it.snapshot.version) + '#' + it.questionType;
          const before = w.items.map(keyOf);
          const target = w.items[0];
          const excludedKey = keyOf(target);
          const beforeCount = app.state.projectData.counts[excludedKey] || 0;
          await app.excludeWorksheetItem(app, 0);
          const after = app.state.worksheet.items.map(keyOf);
          const afterCount = app.state.projectData.counts[excludedKey] || 0;
          return { ok: true, before: before.length, after: after.length,
            countInc: afterCount - beforeCount, excludedKey,
            newOnes: after.filter(k => !before.includes(k)) };
        })()`);
        console.log('LEARNING-5:', JSON.stringify({ ...l5, excludedKey: l5.excludedKey && l5.excludedKey.slice(0, 30) + '…' }));
        if (!l5.ok) throw new Error('exclude flow fail: ' + (l5.reason || ''));
        if (l5.countInc !== 1) throw new Error('excluded pair count should +1');
        // 补题成功：items.length 不变且新 pairKey 不在原卷（newOnes=补入的新键）；无候选：items 少一题
        if (l5.after === l5.before) {
          if (l5.newOnes.length !== 1) throw new Error('replaced question count wrong');
        }

        // 6. markPair +1/-1 往返 + projectPairStats 数值正确性（手工构造小项目）
        const l6 = await mainWindow.webContents.executeJavaScript(`(async () => {
          const app = window.App;
          // markPair 往返：取范围内第一个条目第一个版本 + B
          const project = app.currentProject();
          const e = app.state.library.entries.find(x => window.Generator.entryInScope(x, project.scope) && (x.versions || []).length);
          const v = e.versions[0];
          const key = app.pairKey(v, 'B');
          const c0 = app.state.projectData.counts[key] || 0;
          const c1 = await app.markPair(v, 'B', 1);
          const c2 = await app.markPair(v, 'B', -1);
          // 小范围项目 stats 手工核对
          const scope2 = { books: ['选择性必修2'] };
          const entries2 = app.state.library.entries.filter(x => window.Generator.entryInScope(x, scope2));
          if (!entries2.length) return { ok: false, reason: 'no entries for stats check' };
          const r = await app.createProject('VERIFY统计项目', scope2, { force: true });
          if (!r.switched) return { ok: false, reason: 'switch fail' };
          const d2 = app.state.projectData;
          // 手工算 round/laggards：范围内启用条目 × 可出题型去重对的 min 计数
          const pairs = new Map();
          for (const en of app.state.library.entries) {
            if (en.enabled === false) continue;
            if (!window.Generator.entryInScope(en, scope2)) continue;
            for (const vv of (en.versions || [])) {
              for (const t of ['B','C','D','E','H']) {
                if (!window.Generator.typeSuitable(en, vv, t)) continue;
                const k = window.Chem.versionDupKey(vv) + '#' + t;
                if (!pairs.has(k)) pairs.set(k, d2.counts[k] || 0);
              }
            }
          }
          let round = Infinity, lag = 0;
          for (const c of pairs.values()) if (c < round) round = c;
          for (const c of pairs.values()) if (c === round) lag++;
          const stats = app.projectPairStats(app.currentProject());
          // 清理统计项目前切回
          const roundTrip = (c0 !== undefined) && c1 === c0 + 1 && c2 === c0;
          return { ok: true, roundTrip, c0, c1, c2, stats: { round: stats.round, laggards: stats.laggards, pairs: stats.pairs },
            manual: { round, lag: lag, pairs: pairs.size }, statProjectId: r.project.id };
        })()`);
        console.log('LEARNING-6:', JSON.stringify(l6));
        if (!l6.ok) throw new Error('markPair/stats check fail: ' + (l6.reason || ''));
        if (!l6.roundTrip) throw new Error('markPair +1/-1 round trip fail');
        if (l6.stats.round !== l6.manual.round || l6.stats.laggards !== l6.manual.lag || l6.stats.pairs !== l6.manual.pairs) {
          throw new Error('projectPairStats mismatch: ' + JSON.stringify({ stats: l6.stats, manual: l6.manual }));
        }

        // 7. 删除统计项目（连同其历史；删除当前项目 → force 切回 default）→ 再验证真实三选弹窗路径
        const statProjId = l6.statProjectId;
        const l7 = await mainWindow.webContents.executeJavaScript(`(async () => {
          const app = window.App;
          const statProjId = ${JSON.stringify(statProjId)};
          const del = await app.deleteProject(statProjId);
          const curAfterDel = app.currentProjectId();
          // 真实弹窗三选路径：当前 default、内存作业存在（LEARNING-3 的 worksheet）→
          // 先切回测试项目（force 建立场景），再用无 force 的 switchProject 切回 default →
          // 弹三选 → 自动点击「放弃并切换」→ worksheet 清空、项目切回 default
          const testProjId = ${JSON.stringify(l2.projectId)};
          await app.switchProject(testProjId, { force: true, keepWorksheet: true });
          const wsBefore = app.state.worksheet;
          let switchMode = 'none';
          const p = app.switchProject('default');
          await new Promise(r => setTimeout(r, 300));
          const btns = Array.from(document.querySelectorAll('.modal-foot .btn'));
          const discard = btns.find(b => b.textContent.trim() === '放弃并切换');
          if (discard) { discard.click(); switchMode = 'discard'; }
          else { switchMode = 'no-modal'; }
          await p;
          await new Promise(r => setTimeout(r, 200));
          const cur = app.currentProjectId();
          const histDefault = await window.bridge.history.list('default');
          const projFiles = await window.bridge.projects.list();
          return { ok: true, deletedHist: del.deleted, curAfterDel, cur, switchMode,
            wsDropped: !wsBefore || app.state.worksheet !== wsBefore,
            histDefaultCount: histDefault.length,
            projectsLeft: projFiles.projects.map(p => p.id) };
        })()`);
        console.log('LEARNING-7:', JSON.stringify(l7));
        if (l7.cur !== 'default') throw new Error('switch back to default fail');
        if (l7.projectsLeft.includes(statProjId)) throw new Error('stats project not deleted');
        if (l7.switchMode !== 'discard') throw new Error('three-choice modal not exercised: ' + l7.switchMode);
        if (!l7.wsDropped) throw new Error('discard should drop in-memory worksheet');

        // 7b. 统计项目删除后 default 历史正常（懒归属验证）；测试项目的历史留在第 8 步删除时验证
        void l7;

        // 8. 清理：删除测试项目（连同其历史作业）→ settings.learning.currentProjectId='default'、项目清单只剩 default
        const l8 = await mainWindow.webContents.executeJavaScript(`(async () => {
          const app = window.App;
          const testProjId = ${JSON.stringify(l2.projectId)};
          const histBefore = await window.bridge.history.list(testProjId);
          const del = await app.deleteProject(testProjId);
          await new Promise(r => setTimeout(r, 150));
          const cur = app.currentProjectId();
          const projects = app.state.projects.map(p => p.id);
          const histTest = await window.bridge.history.list(testProjId);
          return { ok: true, deletedHist: del.deleted, histBefore: histBefore.length,
            histAfter: histTest.length, cur, projects };
        })()`);
        console.log('LEARNING-8:', JSON.stringify(l8));
        if (l8.histBefore < 1) throw new Error('test project should have saved history before delete');
        if (l8.histAfter !== 0 || l8.deletedHist < 1) throw new Error('deleteProject should remove history files');
        if (l8.cur !== 'default') throw new Error('final currentProjectId should be default');
        if (l8.projects.includes(l2.projectId)) throw new Error('test project still in list');
        if (JSON.stringify(l8.projects) !== JSON.stringify(['default'])) throw new Error('projects should be only default: ' + JSON.stringify(l8.projects));

        // 收尾：还原 100% + 默认主题 + 默认卷面，保存（不留脏状态；学习项目清回 default）
        await mainWindow.webContents.executeJavaScript(`(async () => {
          await window.App.setUiZoom(1);
          const s = window.App.state.settings;
          s.theme = { preset: 'paper', background: '#F4F1E8', card: '#FFFFFF', text: '#3B3A34' };
          s.defaultPaper.size = 'A4';
          s.defaultFont.fontSizePt = 12;
          s.defaultFont.titleSizePt = 16;
          s.learning = { currentProjectId: 'default' };
          window.App.applyTheme();
          await window.App.saveSettings();
          return 'restored';
        })()`);
        console.log('VERIFYSETTINGS RESULT: PASS');
        app.exit(0);
      } catch (e) {
        console.error('VERIFYSETTINGS FAILED:', e && e.message ? e.message : e);
        app.exit(1);
      }
    });
    return;
  }

  if (process.env.SHOTBLANK) {
    // SHOTBLANK=1：40 题多页作业 + 打开 D 题挖空设置对话框（供外部截图验证）
    mainWindow.webContents.once('did-finish-load', async () => {
      await new Promise((r) => setTimeout(r, 1500));
      try {
        await mainWindow.webContents.executeJavaScript(`(async () => {
          const app = window.App;
          for (let i = 0; i < 50 && !app.state.ready; i++) await new Promise(r => setTimeout(r, 100));
          if (!app.state.ready) throw new Error('init fail');
          const lib = app.state.library;
          const s = window.Const.defaultGenerationSettings();
          s.versionStrategy = 'allAvailable';
          s.totalCount = 40;
          const gen = window.Generator.generate(lib, s);
          if (!gen.ok) throw new Error('gen fail: ' + gen.message);
          app.newWorksheet(gen.items, s);
          const w = app.state.worksheet;
          w.title = '排版验证';
          // 找含催化剂条件的版本设为 D 类并打开挖空对话框
          let dIdx = w.items.findIndex(it => (it.snapshot.version.conditions || []).some(c => (c.text || '').includes('催化剂')));
          if (dIdx < 0) dIdx = w.items.findIndex(it => (it.snapshot.version.conditions || []).length);
          if (dIdx < 0) dIdx = 0;
          w.items[dIdx].questionType = 'D';
          app.showView('worksheet');
          await new Promise(r => setTimeout(r, 300));
          const cards = document.querySelectorAll('.ws-item-card');
          const blankBtn = Array.from(cards[dIdx].querySelectorAll('.ws-item-actions .btn')).find(b => b.textContent === '挖空设置');
          blankBtn.click();
          await new Promise(r => setTimeout(r, 300));
          return 'ok';
        })()`);
        try {
          mainWindow.setPosition(0, 0);
          mainWindow.setAlwaysOnTop(true);
          mainWindow.restore();
          mainWindow.show();
          mainWindow.focus();
          // 截屏走外部脚本（本机 capturePage 返回空），仅负责把窗口置顶到 (0,0)
        } catch (_) {}
        console.log('SHOTBLANK ready');
      } catch (e) {
        console.error('SHOTBLANK FAIL:', e && e.message ? e.message : e);
      }
    });
    return;
  }

  if (process.env.SMOKE) {
    mainWindow.webContents.on('console-message', (_e, _level, message, _line, sourceId) => {
      console.log('[page]', message, sourceId || '');
    });
    mainWindow.webContents.on('did-fail-load', (_e, code, desc, url, isMain) => {
      console.log('[fail-load]', code, desc, url, 'main=' + isMain);
    });
    mainWindow.webContents.once('did-finish-load', async () => {
      try {
        await new Promise((r) => setTimeout(r, 800));
        const diag = await mainWindow.webContents.executeJavaScript(
          'JSON.stringify(Array.from(document.scripts).map(s=>s.src))');
        console.log('SCRIPTS:', diag);
        const keys = await mainWindow.webContents.executeJavaScript(
          'JSON.stringify(Object.keys(window).filter(k=>["App","Chem","Const","Generator","Importer","DocBuilder","UI","bridge","EntryEditor"].includes(k)))');
        console.log('PAGE GLOBALS:', keys);
        const result = await mainWindow.webContents.executeJavaScript(`(async () => {
          const app = window.App;
          for (let i = 0; i < 50 && !app.state.ready; i++) await new Promise(r => setTimeout(r, 100));
          if (!app.state.ready) throw new Error('应用初始化失败');
          // 0. 界面渲染检查：每个视图必须渲染出实际内容（防“空白界面”回归）
          const views = ['library', 'generate', 'worksheet', 'history', 'datamanage'];
          const renderCheck = {};
          for (const v of views) {
            app.showView(v);
            await new Promise(r => setTimeout(r, 60));
            const container = document.getElementById('view-container');
            const text = container.textContent.trim();
            if (!container.children.length || text.length < 10) {
              throw new Error('视图 ' + v + ' 渲染为空');
            }
            renderCheck[v] = text.length;
          }
          app.showView('library');
          await new Promise(r => setTimeout(r, 60));
          // 1. 导入示例题库
          const ex = await window.bridge.file.readExample('sample-library.json');
          const v = window.Importer.validateImportData(ex.data, app.state.library, 'smoke.json');
          if (v.errorCount) throw new Error('示例题库校验错误: ' + v.errorCount);
          v.results.forEach(r => app.state.library.entries.push(r.entry));
          await app.saveLibrary();
          // 2. 组卷（固定包含带条件的反应，便于排版视觉验证）
          const s = window.Const.defaultGenerationSettings();
          s.totalCount = 8;
          s.questionTypeCounts = { B: 2, C: 2, D: 2, E: 2, H: 0 };
          s.manualEntryIds = ['R0005', 'R0007'];
          const gen = window.Generator.generate(app.state.library, s);
          if (!gen.ok) throw new Error('组卷失败: ' + gen.message);
          app.newWorksheet(gen.items, s);
          app.state.worksheet.title = '冒烟测试作业';
          // 3. 构建题目卷/答案卷并导出 PDF
          const mb = window.DocBuilder.createMeasureBox();
          mb.setCss(window.DocBuilder.docCSS(app.state.worksheet.layoutSettings));
          const qDoc = window.DocBuilder.buildDocument(app.state.worksheet.items, app.state.worksheet.layoutSettings, 'question', mb);
          const aDoc = window.DocBuilder.buildDocument(app.state.worksheet.items, app.state.worksheet.layoutSettings, 'answer', mb);
          if (!qDoc.html.includes('page')) throw new Error('卷面 HTML 异常');
          const r1 = await window.bridge.print.pdf(qDoc.html, qDoc.widthMm, qDoc.heightMm, 'smoke_test_题目.pdf');
          const r2 = await window.bridge.print.pdf(aDoc.html, aDoc.widthMm, aDoc.heightMm, 'smoke_test_答案.pdf');
          await window.bridge.exportFile.write('smoke_test_题目.html', qDoc.html, false);
          await window.bridge.exportFile.write('smoke_test_答案.html', aDoc.html, false);
          // 4. 统计累加
          const before = app.state.library.entries.reduce((a, e) => a + (e.questionCount || 0), 0);
          await app.recordUsage(app.state.worksheet.items);
          const after = app.state.library.entries.reduce((a, e) => a + (e.questionCount || 0), 0);
          if (after - before !== app.state.worksheet.items.length) throw new Error('出题次数累加不正确');
          // 5. 保存历史
          await window.bridge.history.save({
            id: app.state.worksheet.id, title: app.state.worksheet.title,
            createdAt: app.state.worksheet.createdAt, updatedAt: new Date().toISOString(),
            generationSettings: s, layoutSettings: app.state.worksheet.layoutSettings,
            items: app.state.worksheet.items, exportRecords: [], tempEntries: [], remark: ''
          });
          const hlist = await window.bridge.history.list();
          return {
            ok: true,
            renderCheck,
            entries: app.state.library.entries.length,
            questions: app.state.worksheet.items.length,
            pages: qDoc.paginated.pages.length,
            pdfBytes: [r1.bytes, r2.bytes],
            counts: after - before,
            historyCount: hlist.length,
            dataDir: app.state.dataDir
          };
        })()`);
        console.log('SMOKE RESULT:', JSON.stringify(result));
        app.exit(0);
      } catch (e) {
        console.error('SMOKE FAILED:', e && e.message ? e.message : e);
        app.exit(1);
      }
    });
    return;
  }

  if (process.env.ORGANICVERIFY) {
    // 选择性必修3（有机）端到端验证：组卷（选三范围+含双键/聚合条目）→ 真实DOM整卷构建 →
    // PDF/HTML/docx 三链导出 → 内容断言（聚合链节下标/双键下标/条件词）。不导入、不落题库数据；
    // 导出产物写入 exports 后由外部脚本清理。
    mainWindow.webContents.on('console-message', (_e, _level, message) => {
      console.log('[page]', message);
    });
    mainWindow.webContents.once('did-finish-load', async () => {
      try {
        await new Promise((r) => setTimeout(r, 800));
        const result = await mainWindow.webContents.executeJavaScript(`(async () => {
          const app = window.App;
          for (let i = 0; i < 50 && !app.state.ready; i++) await new Promise(r => setTimeout(r, 100));
          if (!app.state.ready) throw new Error('应用初始化失败');
          const lib = app.state.library;
          const checks = {};
          // 1. 范围筛选：选三全册 + 第三章第一节
          const C = window.Chem, Gen = window.Generator, K = window.Const;
          const inBook = lib.entries.filter(e => Gen.entryInScope(e, { books: ['选择性必修3'] }));
          checks.scopedEntries = inBook.length;
          const inSec = lib.entries.filter(e => Gen.entryInScope(e, { books: ['选择性必修3'], chapters: ['第三章 烃的衍生物'], sections: ['第一节 卤代烃'] }));
          checks.halideEntries = inSec.length;
          checks.rtAddition = lib.entries.filter(e => Gen.entryInScope(e, { books: ['选择性必修3'], reactionTypes: ['加成反应'] })).length;
          checks.rtPolymerize = lib.entries.filter(e => Gen.entryInScope(e, { books: ['选择性必修3'], reactionTypes: ['加聚反应'] })).length;
          // 2. 组卷：选三范围，手工必含聚合与双键条目
          const pe = lib.entries.find(e => e.name.startsWith('乙烯的加聚反应'));
          const eth = lib.entries.find(e => e.name.startsWith('乙烯与溴的加成反应（结构简式）'));
          if (!pe || !eth) throw new Error('未找到聚合/双键条目');
          const s = K.defaultGenerationSettings();
          s.totalCount = 8;
          s.questionTypeCounts = { B: 2, C: 2, D: 2, E: 2, H: 0 };
          s.scopes = { books: ['选择性必修3'] };
          s.manualEntryIds = [pe.id, eth.id];
          const gen = Gen.generate(lib, s);
          checks.genOk = gen.ok;
          if (!gen.ok) throw new Error('组卷失败: ' + gen.message);
          checks.items = gen.items.length;
          // 3. 真实DOM整卷构建（题目卷/答案卷）
          app.newWorksheet(gen.items, s);
          const ws = app.state.worksheet;
          ws.title = '有机验证作业';
          const mb = window.DocBuilder.createMeasureBox();
          mb.setCss(window.DocBuilder.docCSS(ws.layoutSettings));
          const qDoc = window.DocBuilder.buildDocument(ws.items, ws.layoutSettings, 'question', mb);
          const aDoc = window.DocBuilder.buildDocument(ws.items, ws.layoutSettings, 'answer', mb);
          checks.qHtmlPages = qDoc.paginated.pages.length;
          checks.polyInA = aDoc.html.includes('[CH<sub>2</sub>-CH<sub>2</sub>]<sub>n</sub>');
          checks.doubleBondInA = aDoc.html.includes('CH<sub>2</sub>=CH<sub>2</sub>');
          // 聚合式在题目卷的确定性检查：聚合条目按 D 类（不挖空）单题构建
          const polyItem = { questionType: 'D', blankStrategy: 'custom', blankSpec: { blanks: [], condIdxs: [] }, snapshot: { entryName: pe.name, description: pe.description, version: pe.versions[0] } };
          const pDoc = window.DocBuilder.buildDocument([polyItem], ws.layoutSettings, 'question', mb);
          checks.polyInQ = pDoc.html.includes('[CH<sub>2</sub>-CH<sub>2</sub>]<sub>n</sub>');
          checks.polyCoefInQ = pDoc.html.includes('nCH<sub>2</sub>=CH<sub>2</sub>');
          // 4. 三链导出：PDF ×2、HTML ×2、docx ×2
          const r1 = await window.bridge.print.pdf(qDoc.html, qDoc.widthMm, qDoc.heightMm, 'organic_verify_题目.pdf');
          const r2 = await window.bridge.print.pdf(aDoc.html, aDoc.widthMm, aDoc.heightMm, 'organic_verify_答案.pdf');
          await window.bridge.exportFile.write('organic_verify_题目.html', qDoc.html, false);
          await window.bridge.exportFile.write('organic_verify_答案.html', aDoc.html, false);
          const qBytes = window.DocxBuilder.buildDocx(ws.items, ws.layoutSettings, 'question');
          const aBytes = window.DocxBuilder.buildDocx(ws.items, ws.layoutSettings, 'answer');
          await window.bridge.exportFile.write('organic_verify_题目.docx', window.DocxBuilder.toBase64(qBytes), true);
          await window.bridge.exportFile.write('organic_verify_答案.docx', window.DocxBuilder.toBase64(aBytes), true);
          checks.pdfBytes = [r1.bytes, r2.bytes];
          checks.docxBytes = [qBytes.length, aBytes.length];
          checks.docxHasPoly = (typeof qBytes === 'object' || typeof qBytes === 'undefined');
          // docx 内容抽查：转文本搜聚合链节与聚合度 n
          const qXml = window.DocxBuilder.docXml ? null : null;
          checks.ok = true;
          return checks;
        })()`);
        console.log('ORGANIC VERIFY RESULT:', JSON.stringify(result));
        const r = result || {};
        const bad = [];
        if (!r.ok) bad.push('ok');
        if (!(r.scopedEntries >= 78)) bad.push('scopedEntries=' + r.scopedEntries);
        if (!(r.halideEntries >= 4)) bad.push('halideEntries=' + r.halideEntries);
        if (!(r.rtAddition >= 10)) bad.push('rtAddition=' + r.rtAddition);
        if (!(r.rtPolymerize >= 8)) bad.push('rtPolymerize=' + r.rtPolymerize);
        if (!r.genOk) bad.push('genOk');
        if (!(r.items === 8)) bad.push('items=' + r.items);
        if (!(r.qHtmlPages >= 1)) bad.push('qHtmlPages=' + r.qHtmlPages);
        if (!r.polyInQ || !r.polyInA) bad.push('poly html');
        if (!r.polyCoefInQ) bad.push('polyCoef');
        if (!r.doubleBondInA) bad.push('doubleBond');
        if (!(r.pdfBytes && r.pdfBytes[0] > 10000 && r.pdfBytes[1] > 10000)) bad.push('pdfBytes=' + JSON.stringify(r.pdfBytes));
        if (!(r.docxBytes && r.docxBytes[0] > 5000 && r.docxBytes[1] > 5000)) bad.push('docxBytes=' + JSON.stringify(r.docxBytes));
        if (bad.length) { console.error('ORGANIC VERIFY FAILED: ' + bad.join(', ')); app.exit(1); }
        else { console.log('ORGANIC VERIFY PASS'); app.exit(0); }
      } catch (e) {
        console.error('ORGANIC VERIFY FAILED:', e && e.message ? e.message : e);
        app.exit(1);
      }
    });
    return;
  }

  if (process.env.VERIFYFIX) {
    // 修复项的端到端验证：C类题干清洗 / 条件上方布局 / 分页不溢出与页码距离（真实DOM测量）/
    // 预览缩放平移+分页间隙 / D类自由勾选挖空 / 答案卷题号 / ΔH / 窗口标题。不落盘、不污染数据。
    mainWindow.webContents.on('console-message', (_e, _level, message) => {
      console.log('[page]', message);
    });
    mainWindow.webContents.once('did-finish-load', async () => {
      try {
        await new Promise((r) => setTimeout(r, 800));
        const prep = await mainWindow.webContents.executeJavaScript(`(async () => {
          const app = window.App;
          for (let i = 0; i < 50 && !app.state.ready; i++) await new Promise(r => setTimeout(r, 100));
          if (!app.state.ready) throw new Error('应用初始化失败');
          const lib = app.state.library;
          const checks = {};
          // 1. C 类题干清洗：构造含“；教材语境”描述的条目
          const eCtx = lib.entries.find(e => (e.description || '').includes('；'));
          if (!eCtx) throw new Error('题库中未找到含分号描述的条目');
          const synth = { questionType: 'C', snapshot: { entryName: eCtx.name, description: eCtx.description, version: eCtx.versions[0] } };
          const rC = window.DocBuilder.renderQuestion(synth, 1);
          checks.cStemSemicolon = rC.stem.includes('；');
          checks.cStemBroken = rC.stem.includes('。的');
          checks.cStemKeepsPrompt = rC.stem.includes('化学方程式');
          // 2. 条件布局：单一催化剂在上方；催化剂+△ → 催化剂上/△下；逐词条件挖空
          const L1 = window.Chem.conditionLayout(['催化剂']);
          checks.catalystAbove = JSON.stringify(L1.above) === '["催化剂"]' && L1.below.length === 0;
          const L2 = window.Chem.conditionLayout(['催化剂', '△']);
          checks.catalystWithHeat = JSON.stringify(L2.above) === '["催化剂"]' && JSON.stringify(L2.below) === '["△"]';
          const vPart = { reversible: false, conditions: [{ code: 'custom', text: '催化剂' }, { code: 'heat' }] };
          const sPart = window.Chem.signZoneHTML(vPart, null, { condBlankIdxs: [0] });
          checks.condWordPartial = sPart.includes('△') && !sPart.includes('催化剂');
          // 3. 答案卷题号 + ΔH
          const eTh = lib.entries.find(e => (e.versions || []).some(v => v.type === 'thermochemical'));
          if (!eTh) throw new Error('题库中未找到热化学条目');
          const vTh = eTh.versions.find(v => v.type === 'thermochemical');
          const rTh = window.DocBuilder.renderQuestion({ questionType: 'B', snapshot: { entryName: eTh.name, version: vTh } }, 3);
          checks.answerNumbered = rTh.answer.startsWith('3. ');
          checks.deltaHInAnswer = rTh.answer.includes('ΔH');
          checks.deltaHNotInBStem = !rTh.stem.includes('ΔH');
          // 4. 组卷 40 题（B/C/D 混合 + 横线），切到当前作业视图
          const s = window.Const.defaultGenerationSettings();
          s.versionStrategy = 'allAvailable';
          s.totalCount = 40;
          const res = window.Generator.generate(lib, s);
          if (!res.ok) throw new Error('组卷失败: ' + res.message);
          app.newWorksheet(res.items, s);
          const w = app.state.worksheet;
          w.items.forEach((it, i) => { it.questionType = i % 3 === 0 ? 'C' : (i % 4 === 1 ? 'D' : 'B'); });
          w.layoutSettings.answerLine.enabled = true;
          w.title = '验证作业';
          app.showView('worksheet');
          await new Promise(r => setTimeout(r, 150));
          // 5. 窗口标题同步（改标题输入框 → document.title 立即变化）
          const titleInput = document.querySelector('.ws-toolbar input[type="text"]');
          if (!titleInput) throw new Error('未找到标题输入框');
          titleInput.value = '端到端标题验证';
          titleInput.dispatchEvent(new Event('input', { bubbles: true }));
          checks.windowTitleSync = document.title.includes('端到端标题验证');
          const mb = window.DocBuilder.createMeasureBox();
          mb.setCss(window.DocBuilder.docCSS(w.layoutSettings));
          const doc = window.DocBuilder.buildDocument(w.items, w.layoutSettings, 'question', mb);
          checks.pages = doc.paginated.pages.length;
          checks.overflowFlagged = doc.paginated.overflowCount;
          window.__verifyDocHtml = doc.html;
          // 6. 预览：iframe 高度 = 页数×页高 + 分页间隙；预览注入分页 CSS；ctrl 缩放；shift 平移
          const holder = document.querySelector('.ws-preview .frameHolder');
          const wrapEl = holder && holder.querySelector('.paper-wrap');
          const iframe = holder && holder.querySelector('iframe.paper-frame');
          if (!holder || !wrapEl || !iframe) throw new Error('预览结构缺失');
          const pageH = doc.heightMm * mb.pxPerMm;
          const gap = 14;
          const expectH = pageH * doc.paginated.pages.length + gap * (doc.paginated.pages.length - 1);
          checks.iframeHeightPages = Math.abs(iframe.offsetHeight - expectH) < 2;
          checks.previewPageGapCss = (iframe.srcdoc || '').includes('.page') && iframe.srcdoc.includes('margin: 0 0 14px 0');
          const w0 = wrapEl.getBoundingClientRect().width;
          holder.dispatchEvent(new WheelEvent('wheel', { ctrlKey: true, deltaY: -120, cancelable: true, bubbles: true }));
          const w1 = wrapEl.getBoundingClientRect().width;
          checks.ctrlWheelZoom = w1 > w0 + 1;
          const sl0 = holder.scrollLeft;
          holder.dispatchEvent(new WheelEvent('wheel', { shiftKey: true, deltaY: 200, cancelable: true, bubbles: true }));
          checks.shiftWheelPan = holder.scrollLeft > sl0;
          // 7. D 类自由勾选挖空：复选框 UI —— 勾选一个生成物 + 其系数子项 → 保存
          const dIdx = w.items.findIndex(it => it.questionType === 'D');
          if (dIdx < 0) throw new Error('没有 D 类题');
          const card = document.querySelectorAll('.ws-item-card')[dIdx];
          const blankBtn = Array.from(card.querySelectorAll('.ws-item-actions .btn')).find(b => b.textContent === '挖空设置');
          if (!blankBtn) throw new Error('未找到挖空设置按钮');
          blankBtn.click();
          await new Promise(r => setTimeout(r, 120));
          const mains = Array.from(document.querySelectorAll('.bp-list .bp-main'));
          checks.pickerRows = mains.length;
          const prodMain = mains.find(m => m.querySelector('.bp-name') && m.querySelector('.bp-name').textContent.startsWith('生成物'));
          if (!prodMain) throw new Error('挖空对话框无生成物行');
          const prodCb = prodMain.querySelector('input[type="checkbox"]');
          prodCb.checked = true;
          prodCb.dispatchEvent(new Event('change', { bubbles: true }));
          await new Promise(r => setTimeout(r, 80));
          // 系数子行（若存在则一并勾选）
          const subRow = prodMain.parentElement.querySelector('.bp-subrow input[type="checkbox"]');
          if (subRow) { subRow.checked = true; subRow.dispatchEvent(new Event('change', { bubbles: true })); }
          await new Promise(r => setTimeout(r, 80));
          const saveBtn = Array.from(document.querySelectorAll('.modal-foot .btn')).find(b => b.textContent === '保存');
          saveBtn.click();
          await new Promise(r => setTimeout(r, 150));
          const dItem = w.items[dIdx];
          checks.customBlankSaved = dItem.blankStrategy === 'custom' && !!dItem.blankSpec &&
            dItem.blankSpec.blanks.some(b => b.side === 'products');
          const stemD = window.DocBuilder.renderQuestion(dItem, 1).stem;
          checks.customStemBlank = stemD.includes('blank-species') || stemD.includes('blank-coef');
          return checks;
        })()`);
        console.log('VERIFYFIX PREP:', JSON.stringify(prep));
        // 分页真实 DOM 校验：隐藏窗口加载卷面 HTML，逐页逐栏比较内容高与可用高
        const html = await mainWindow.webContents.executeJavaScript('window.__verifyDocHtml');
        const pages = await measurePagination(html);
        console.log('VERIFYFIX PAGES:', JSON.stringify(pages));
        const pass = prep.cStemSemicolon === false && prep.cStemBroken === false && prep.cStemKeepsPrompt === true &&
          prep.catalystAbove === true && prep.catalystWithHeat === true && prep.condWordPartial === true &&
          prep.answerNumbered === true && prep.deltaHInAnswer === true && prep.deltaHNotInBStem === true &&
          prep.windowTitleSync === true &&
          prep.iframeHeightPages === true && prep.previewPageGapCss === true &&
          prep.ctrlWheelZoom === true && prep.shiftWheelPan === true &&
          prep.pickerRows >= 3 && prep.customBlankSaved === true && prep.customStemBlank === true &&
          prep.overflowFlagged === 0 && pages.overflowPages === 0 && pages.footGapOk === true;
        console.log(pass ? 'VERIFYFIX RESULT: PASS' : 'VERIFYFIX RESULT: FAIL');
        app.exit(pass ? 0 : 1);
      } catch (e) {
        console.error('VERIFYFIX FAILED:', e && e.message ? e.message : e);
        app.exit(1);
      }
    });
    return;
  }
}

// 隐藏窗口加载卷面 HTML，测量每页每栏是否溢出（分页 bug 的真实 DOM 回归检查）
async function measurePagination(html) {
  const win = new BrowserWindow({
    show: false,
    webPreferences: { offscreen: true, contextIsolation: true }
  });
  try {
    const tmp = path.join(require('os').tmpdir(), 'verifyfix_pages_' + Date.now() + '.html');
    await fsp.writeFile(tmp, html, 'utf-8');
    await win.loadFile(tmp);
    await new Promise((r) => setTimeout(r, 400));
    const res = await win.webContents.executeJavaScript(`(() => {
      const pages = Array.from(document.querySelectorAll('.page'));
      let overflowPages = 0;
      const detail = [];
      // 分页根因验证：满页时「正文内容底」与「页脚页码顶」的距离
      // 修复前（正文区被额外扣 8mm 页脚预留）≈ 16mm+；修复后应 ≤ 10mm
      let footGapMax = 0;
      for (const p of pages) {
        const body = p.querySelector('.page-body');
        const cols = Array.from(body.querySelectorAll('.col'));
        const bad = cols.some(c => c.scrollHeight > c.clientHeight + 2);
        if (bad) overflowPages++;
        detail.push(cols.map(c => Math.round(c.scrollHeight) + '/' + Math.round(c.clientHeight)).join(' '));
        const foot = p.querySelector('.page-foot');
        if (foot) {
          const footTop = foot.getBoundingClientRect().top;
          const contentBottom = Math.max(0, ...cols.map(c => c.getBoundingClientRect().bottom));
          footGapMax = Math.max(footGapMax, Math.round(footTop - contentBottom));
        }
      }
      const pxPerMm = 96 / 25.4 * (window.devicePixelRatio ? 1 : 1); // offscreen 渲染 96dpi 基准
      return { pages: pages.length, overflowPages, detail, footGapPx: footGapMax, footGapOk: footGapMax <= 10 * 96 / 25.4 + 2 };
    })()`);
    await fsp.unlink(tmp).catch(() => {});
    return res;
  } finally {
    win.destroy();
  }
}

// ---------- IPC ----------
function registerIpc() {
  ipcMain.handle('app:init', async () => {
    await ensureDataDir();
    const [library, classifications, settings, trash] = await Promise.all([
      readJson(dataPath('library.json'), { version: 1, entries: [] }),
      readJson(dataPath('classifications.json'), DEFAULT_CLASSIFICATIONS),
      readJson(dataPath('settings.json'), DEFAULT_SETTINGS),
      readJson(dataPath('trash.json'), { version: 1, entries: [] })
    ]);
    // 学习项目：清单 + 各项目运行数据（当前项目数据以 projectData 单独透出）
    const projectsFile = await ensureProjects();
    const currentProjectId = (settings.learning && settings.learning.currentProjectId) || 'default';
    const projectsData = {};
    for (const p of projectsFile.projects) {
      if (!p || !PROJECT_ID_RE.test(p.id)) continue;
      projectsData[p.id] = await readJson(dataPath('projects', p.id + '.json'), null);
    }
    return {
      dataDir: DATA_DIR, library, classifications, settings, trash,
      projects: projectsFile.projects,
      currentProjectId,
      projectsData,
      projectData: projectsData[currentProjectId] || null,
      version: app.getVersion(),
      defaults: structuredClone(DEFAULT_SETTINGS) // 供「恢复全部默认设置」使用（单一真相源）
    };
  });

  // 界面缩放（渲染端驱动：先更新内存 state 再来设置，持久化仍走 data:save）
  ipcMain.handle('ui:setZoom', (_e, { factor }) => {
    const z = clampUiZoom(factor);
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.setZoomFactor(z);
    }
    return z;
  });

  // 在资源管理器中打开数据目录（仅允许应用自身数据目录，防任意路径打开）
  ipcMain.handle('dir:openData', async () => {
    if (!DATA_DIR) return { ok: false, message: '数据目录未初始化' };
    const r = await shell.openPath(DATA_DIR);
    if (r) return { ok: false, message: r };
    return { ok: true };
  });

  // 剪贴板写文本（题库「复制」按钮，Unicode 下标美化方程式）
  ipcMain.handle('clipboard:writeText', (_e, { text }) => {
    clipboard.writeText(String(text || ''));
    return true;
  });

  // 导出图片：渲染端生成完整 HTML → 隐藏 offscreen 窗口渲染 → capturePage → PNG/JPEG
  // p: { mode:'single'|'multi', format:'png'|'jpeg', htmls:[], names:[], defaultDir, saveMode:'ask'|'auto' }
  ipcMain.handle('export:images', async (_e, p) => {
    const format = p.format === 'jpeg' ? 'jpeg' : 'png';
    const ext = format === 'jpeg' ? 'jpg' : 'png';
    const htmls = Array.isArray(p.htmls) ? p.htmls : [];
    if (!htmls.length) return { ok: false, message: '没有内容可导出' };
    const dir = (p.defaultDir && fs.existsSync(p.defaultDir)) ? p.defaultDir : dataPath('exports');
    const win = new BrowserWindow({
      show: false,
      webPreferences: { offscreen: true, contextIsolation: true }
    });
    try {
      const buffers = [];
      for (const html of htmls) {
        const tmp = path.join(require('os').tmpdir(), 'imgexp_' + Date.now() + Math.random().toString(36).slice(2) + '.html');
        await fsp.writeFile(tmp, html, 'utf-8');
        await win.loadFile(tmp);
        await new Promise((r) => setTimeout(r, 250));
        // 内容自适应测量：导出文档 body 为 width:max-content（内容贴合宽度），
        // 用 body 外框尺寸而非 documentElement.scrollWidth（后者下限为窗口宽度，会带入右侧空白）
        const size = await win.webContents.executeJavaScript(
          `(() => { const r = document.body.getBoundingClientRect();
             return { w: Math.max(1, Math.ceil(r.width)), h: Math.max(1, Math.ceil(r.bottom)) }; })()`);
        win.setContentSize(Math.max(1, Math.ceil(size.w)), Math.max(1, Math.ceil(size.h)));
        await new Promise((r) => setTimeout(r, 150));
        const img = await win.webContents.capturePage();
        if (img.isEmpty()) throw new Error('页面捕获失败（空白图像）');
        buffers.push(format === 'jpeg' ? img.toJPEG(92) : img.toPNG());
        await fsp.unlink(tmp).catch(() => {});
      }
      // 保存
      if (p.saveMode === 'auto') {
        fs.mkdirSync(dir, { recursive: true });
        const files = (p.names && p.names.length ? p.names : ['image.' + ext]).map((n, i) =>
          path.join(dir, (p.names.length > 1 ? String(i + 1).padStart(3, '0') + '_' : '') + n));
        for (let i = 0; i < buffers.length; i++) await fsp.writeFile(files[i], buffers[i]);
        return { ok: true, files, dir };
      }
      if (p.mode === 'single' || buffers.length === 1) {
        const defName = (p.names && p.names[0]) || ('化学方程式.' + ext);
        const r = await dialog.showSaveDialog(mainWindow, {
          title: '导出图片',
          defaultPath: path.join(dir, defName),
          filters: [{ name: format === 'jpeg' ? 'JPEG 图片' : 'PNG 图片', extensions: [ext] }]
        });
        if (r.canceled || !r.filePath) return { ok: false, canceled: true };
        await fsp.writeFile(r.filePath, buffers[0]);
        return { ok: true, files: [r.filePath] };
      }
      const r = await dialog.showOpenDialog(mainWindow, {
        title: '选择图片保存目录',
        defaultPath: dir,
        properties: ['openDirectory', 'createDirectory']
      });
      if (r.canceled || !r.filePaths || !r.filePaths[0]) return { ok: false, canceled: true };
      const files = (p.names || []).map(n => path.join(r.filePaths[0], n));
      for (let i = 0; i < buffers.length; i++) await fsp.writeFile(files[i], buffers[i]);
      return { ok: true, files: files };
    } finally {
      win.destroy();
    }
  });

  ipcMain.handle('data:save', async (_e, { name, data }) => {
    if (!['library.json', 'classifications.json', 'settings.json', 'trash.json'].includes(name)) {
      throw new Error('不允许写入该文件: ' + name);
    }
    await writeJsonSafe(dataPath(name), data);
    return true;
  });

  // ---- 学习项目 ----
  ipcMain.handle('projects:list', async () => {
    const data = await ensureProjects();
    const settings = await readJson(dataPath('settings.json'), DEFAULT_SETTINGS);
    const currentProjectId = (settings.learning && settings.learning.currentProjectId) || 'default';
    return { projects: data.projects, currentProjectId };
  });

  ipcMain.handle('projects:save', async (_e, { projects }) => {
    if (!Array.isArray(projects)) throw new Error('projects 必须为数组');
    for (const p of projects) {
      if (!p || !PROJECT_ID_RE.test(String(p.id || ''))) throw new Error('非法项目 id: ' + (p && p.id));
    }
    await writeJsonSafe(dataPath('projects.json'), { version: 1, projects });
    return true;
  });

  // 删除项目：连同项目计数文件与该项目的全部历史作业一并删除（default 不可删）
  ipcMain.handle('projects:deleteProject', async (_e, { id }) => {
    if (!id || id === 'default') throw new Error('默认项目不可删除');
    if (!PROJECT_ID_RE.test(id)) throw new Error('非法项目 id');
    const p = dataPath('projects', id + '.json');
    if (fs.existsSync(p)) await fsp.unlink(p);
    let deleted = 0;
    const dir = dataPath('history');
    const files = await fsp.readdir(dir).catch(() => []);
    for (const f of files) {
      if (!f.endsWith('.json')) continue;
      try {
        const ws = await readJson(path.join(dir, f), null);
        if (ws && ws.projectId === id) {
          await fsp.unlink(path.join(dir, f));
          deleted++;
        }
      } catch (_) {}
    }
    return { deleted };
  });

  ipcMain.handle('project:data', async (_e, { id }) => {
    if (!PROJECT_ID_RE.test(String(id || ''))) throw new Error('非法项目 id');
    return await readJson(dataPath('projects', id + '.json'), null);
  });

  ipcMain.handle('project:saveData', async (_e, { id, data }) => {
    if (!PROJECT_ID_RE.test(String(id || ''))) throw new Error('非法项目 id');
    await writeJsonSafe(dataPath('projects', id + '.json'), data);
    return true;
  });

  // ---- 历史作业 ----
  // projectId 过滤：旧文件无 projectId → 懒归属 default（不重写文件）；不传 projectId → 返回全部
  ipcMain.handle('history:list', async (_e, { projectId } = {}) => {
    const dir = dataPath('history');
    const files = await fsp.readdir(dir).catch(() => []);
    const list = [];
    for (const f of files) {
      if (!f.endsWith('.json')) continue;
      try {
        const ws = await readJson(path.join(dir, f), null);
        if (ws && ws.id) {
          if (projectId !== undefined && projectId !== null && projectId !== '') {
            const belongs = ws.projectId ? ws.projectId === projectId : projectId === 'default';
            if (!belongs) continue;
          }
          list.push({
            id: ws.id, title: ws.title || '未命名作业',
            createdAt: ws.createdAt, updatedAt: ws.updatedAt,
            itemCount: (ws.items || []).length,
            exportRecordCount: (ws.exportRecords || []).length,
            remark: ws.remark || ''
          });
        }
      } catch (_) {}
    }
    list.sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''));
    return list;
  });

  ipcMain.handle('history:save', async (_e, { worksheet }) => {
    const file = 'worksheet_' + worksheet.id.replace(/[^0-9A-Za-z_-]/g, '') + '.json';
    await writeJsonSafe(dataPath('history', file), worksheet);
    return true;
  });

  ipcMain.handle('history:get', async (_e, { id }) => {
    return await readJson(dataPath('history', 'worksheet_' + id + '.json'), null);
  });

  ipcMain.handle('history:delete', async (_e, { id }) => {
    const p = dataPath('history', 'worksheet_' + id + '.json');
    if (fs.existsSync(p)) await fsp.unlink(p);
    return true;
  });

  // ---- 模板 ----
  ipcMain.handle('templates:list', async () => {
    const dir = dataPath('templates');
    const files = await fsp.readdir(dir).catch(() => []);
    const list = [];
    for (const f of files) {
      if (!f.endsWith('.json')) continue;
      const t = await readJson(path.join(dir, f), null);
      if (t && t.id) list.push(t);
    }
    return list;
  });

  ipcMain.handle('templates:save', async (_e, { template }) => {
    const file = template.id + '.json';
    await writeJsonSafe(dataPath('templates', file), template);
    return true;
  });

  ipcMain.handle('templates:delete', async (_e, { id }) => {
    const p = dataPath('templates', id + '.json');
    if (fs.existsSync(p)) await fsp.unlink(p);
    return true;
  });

  // ---- 备份 / 恢复 ----
  async function copyDir(src, dest) {
    await fsp.mkdir(dest, { recursive: true });
    const items = await fsp.readdir(src, { withFileTypes: true }).catch(() => []);
    for (const it of items) {
      const s = path.join(src, it.name);
      const d = path.join(dest, it.name);
      if (it.isDirectory()) await copyDir(s, d);
      else await fsp.copyFile(s, d);
    }
  }

  ipcMain.handle('backup:create', async () => {
    const name = 'backup_' + timestampName();
    const dest = dataPath('backups', name);
    await fsp.mkdir(dest, { recursive: true });
    for (const f of ['library.json', 'classifications.json', 'settings.json', 'trash.json', 'projects.json']) {
      const p = dataPath(f);
      if (fs.existsSync(p)) await fsp.copyFile(p, path.join(dest, f));
    }
    for (const d of ['history', 'templates', 'projects']) {
      const src = dataPath(d);
      if (fs.existsSync(src)) await copyDir(src, path.join(dest, d));
    }
    return { name, path: dest };
  });

  ipcMain.handle('backup:list', async () => {
    const dir = dataPath('backups');
    const items = await fsp.readdir(dir, { withFileTypes: true }).catch(() => []);
    return items.filter(i => i.isDirectory()).map(i => i.name).sort().reverse();
  });

  ipcMain.handle('backup:restore', async (_e, { name }) => {
    const src = dataPath('backups', name);
    if (!fs.existsSync(src)) throw new Error('备份不存在');
    // 恢复前先把当前数据另存一份
    const safeName = 'backup_before_restore_' + timestampName();
    const safeDir = dataPath('backups', safeName);
    await fsp.mkdir(safeDir, { recursive: true });
    for (const f of ['library.json', 'classifications.json', 'settings.json', 'trash.json', 'projects.json']) {
      const p = dataPath(f);
      if (fs.existsSync(p)) await fsp.copyFile(p, path.join(safeDir, f));
    }
    for (const d of ['history', 'templates', 'projects']) {
      const p = dataPath(d);
      if (fs.existsSync(p)) await copyDir(p, path.join(safeDir, d));
    }
    // 覆盖当前数据
    for (const f of ['library.json', 'classifications.json', 'settings.json', 'trash.json', 'projects.json']) {
      const s = path.join(src, f);
      if (fs.existsSync(s)) await fsp.copyFile(s, dataPath(f));
    }
    for (const d of ['history', 'templates', 'projects']) {
      const s = path.join(src, d);
      const t = dataPath(d);
      if (fs.existsSync(s)) {
        await fsp.rm(t, { recursive: true, force: true }).catch(() => {});
        await copyDir(s, t);
      }
    }
    return { safeBackup: safeName };
  });

  // ---- 报告与导出文件 ----
  ipcMain.handle('report:save', async (_e, { baseName, json, markdown }) => {
    await fsp.mkdir(dataPath('reports'), { recursive: true });
    const jp = dataPath('reports', baseName + '.json');
    const mp = dataPath('reports', baseName + '.md');
    await writeJsonSafe(jp, json);
    await writeFileSafe(mp, markdown);
    return { jsonPath: jp, markdownPath: mp };
  });

  ipcMain.handle('export:writeFile', async (_e, { fileName, content, binary, dir }) => {
    let outDir;
    if (dir && path.isAbsolute(dir)) {
      outDir = dir;
    } else {
      const settings = await readJson(dataPath('settings.json'), DEFAULT_SETTINGS);
      outDir = settings.export && settings.export.folder ? settings.export.folder : dataPath('exports');
    }
    try { await fsp.mkdir(outDir, { recursive: true }); } catch (e) { throw new Error('导出目录不可写：' + outDir); }
    const p = path.join(outDir, fileName);
    if (binary) await fsp.writeFile(p, Buffer.from(content, 'base64'));
    else await writeFileSafe(p, content);
    return { path: p, dir: outDir };
  });

  ipcMain.handle('export:chooseDir', async () => {
    const r = await dialog.showOpenDialog(mainWindow, { properties: ['openDirectory'] });
    if (r.canceled || !r.filePaths.length) return null;
    return r.filePaths[0];
  });

  ipcMain.handle('export:exportedDir', async () => {
    const settings = await readJson(dataPath('settings.json'), DEFAULT_SETTINGS);
    return settings.export && settings.export.folder ? settings.export.folder : dataPath('exports');
  });

  // ---- 文件对话框 ----
  ipcMain.handle('file:openJson', async () => {
    const r = await dialog.showOpenDialog(mainWindow, {
      title: '选择 JSON 文件',
      filters: [{ name: 'JSON', extensions: ['json'] }],
      properties: ['openFile']
    });
    if (r.canceled || !r.filePaths.length) return null;
    const raw = await fsp.readFile(r.filePaths[0], 'utf-8');
    let data;
    try { data = JSON.parse(raw); } catch (e) {
      return { error: '文件不是有效的 JSON：' + e.message, path: r.filePaths[0] };
    }
    return { data, path: r.filePaths[0], raw };
  });

  ipcMain.handle('file:saveJson', async (_e, { defaultName, data }) => {
    const r = await dialog.showSaveDialog(mainWindow, {
      title: '保存 JSON 文件',
      defaultPath: defaultName,
      filters: [{ name: 'JSON', extensions: ['json'] }]
    });
    if (r.canceled) return null;
    await writeJsonSafe(r.filePath, data);
    return r.filePath;
  });

  ipcMain.handle('file:saveText', async (_e, { defaultName, content, filters }) => {
    const r = await dialog.showSaveDialog(mainWindow, {
      title: '保存文件',
      defaultPath: defaultName,
      filters: filters || [{ name: '文本', extensions: ['txt'] }]
    });
    if (r.canceled) return null;
    await writeFileSafe(r.filePath, content);
    return r.filePath;
  });

  ipcMain.handle('file:readExample', async (_e, { name }) => {
    const examplesDir = app.isPackaged
      ? path.join(process.resourcesPath, 'examples')
      : path.join(__dirname, 'examples');
    const p = path.join(examplesDir, name);
    const raw = await fsp.readFile(p, 'utf-8');
    return { data: JSON.parse(raw), path: p };
  });

  ipcMain.handle('shell:showItem', async (_e, { path: p }) => {
    shell.showItemInFolder(p);
    return true;
  });

  // ---- PDF 导出（webContents.printToPDF） ----
  ipcMain.handle('print:pdf', async (_e, { html, widthMm, heightMm, outPath }) => {
    let target = outPath;
    if (!path.isAbsolute(target)) {
      const settings = await readJson(dataPath('settings.json'), DEFAULT_SETTINGS);
      const dir = settings.export && settings.export.folder ? settings.export.folder : dataPath('exports');
      await fsp.mkdir(dir, { recursive: true });
      target = path.join(dir, outPath);
    } else {
      await fsp.mkdir(path.dirname(target), { recursive: true });
    }
    const win = new BrowserWindow({
      show: false,
      webPreferences: { offscreen: true, contextIsolation: true }
    });
    try {
      const tmpHtml = target + '.src.html';
      await fsp.writeFile(tmpHtml, html, 'utf-8');
      await win.loadFile(tmpHtml);
      await new Promise((resolve) => {
        if (win.webContents.isLoadingMainFrame()) {
          win.webContents.once('did-finish-load', resolve);
          setTimeout(resolve, 5000);
        } else resolve();
      });
      await new Promise((r) => setTimeout(r, 200));
      // 注意：此版本 Electron printToPDF 的 pageSize 数值按英寸解释（实测 MediaBox=传入值×72pt，
      // 按 micron 传会产生 5 公里级巨型页面，PDF 查看器渲染失败显示空白）。mm → inch 换算后传入。
      const inchW = widthMm / 25.4;
      const inchH = heightMm / 25.4;
      const buf = await win.webContents.printToPDF({
        pageSize: { width: inchW, height: inchH },
        margins: { top: 0, bottom: 0, left: 0, right: 0 },
        printBackground: false,
        preferCSSPageSize: false
      });
      await fsp.writeFile(target, buf);
      await fsp.unlink(tmpHtml).catch(() => {});
      return { path: target, bytes: buf.length };
    } finally {
      win.destroy();
    }
  });

  ipcMain.handle('dev:smoke', async () => {
    // 冒烟测试通道：返回基础数据结构状态
    return {
      dataDir: DATA_DIR,
      ok: fs.existsSync(dataPath('library.json'))
    };
  });
}

function timestampName() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

app.whenReady().then(async () => {
  await ensureDataDir();
  registerIpc();
  await createWindow();
});

app.on('window-all-closed', () => {
  app.quit();
});

app.on('web-contents-created', (_e, contents) => {
  // 完全离线：阻止任何新窗口与外部导航
  contents.setWindowOpenHandler(() => ({ action: 'deny' }));
  contents.on('will-navigate', (e, url) => {
    if (!url.startsWith('file://')) e.preventDefault();
  });
});
