/*
 * 精确测量方程式排版：加载 build/eq-check.html，输出条件/符号墨迹相对位置。
 * 校验目标：条件墨迹与符号墨迹间距 ≈ 1-5px；条件不超出 eq-eq 盒（padding 足够）；
 * 加长符号时符号宽度 ≥ 条件宽度。
 * 用法：node_modules\.bin\electron scripts\measure-eq.js
 */
const { app, BrowserWindow } = require('electron');
const path = require('path');

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    width: 900, height: 1500, show: false,
    webPreferences: { contextIsolation: true }
  });
  await win.loadFile(path.join(__dirname, '..', 'build', 'eq-check.html'));
  await new Promise((r) => setTimeout(r, 400));
  const result = await win.webContents.executeJavaScript(`(() => {
    const out = [];
    const ink = (node) => {
      if (!node || !node.textContent.trim()) return null;
      const range = document.createRange();
      range.selectNodeContents(node);
      return range.getBoundingClientRect();
    };
    const measure = (sel, label) => {
      document.querySelectorAll(sel).forEach(eq => {
        const eqr = eq.getBoundingClientRect();
        const sign = eq.querySelector('.eq-sign');
        if (!sign) return;
        const sr = ink(sign) || sign.getBoundingClientRect();
        const row = {
          ctx: label,
          sign: (sign.textContent || '').trim().slice(0, 2),
          eqW: +eqr.width.toFixed(1),
          signW: +sr.width.toFixed(1),
          eqH: +eqr.height.toFixed(1)
        };
        const cond = eq.querySelector('.eq-cond');
        if (cond) {
          const cr = ink(cond);
          row.above = (cond.textContent || '').replace(/\\s+/g, '/');
          if (cr) {
            row.aboveInkBottom = +(cr.bottom - eqr.top).toFixed(2);
            row.aboveTopOver = +(eqr.top - cr.top).toFixed(2); // >0 表示超出盒顶
            row.gapAbove = +(sr.top - cr.bottom).toFixed(2);   // 条件墨迹底 → 符号墨迹顶
          }
        }
        const condB = eq.querySelector('.eq-cond-below');
        if (condB) {
          const br = ink(condB);
          row.below = (condB.textContent || '').replace(/\\s+/g, '/');
          if (br) {
            row.belowInkTop = +(br.top - eqr.top).toFixed(2);
            row.belowBotOver = +(br.bottom - eqr.bottom).toFixed(2); // >0 表示超出盒底
            row.gapBelow = +(br.top - sr.bottom).toFixed(2);         // 符号墨迹底 → 条件墨迹顶
          }
        }
        out.push(row);
      });
    };
    measure('.q .eq-eq', 'doc');
    measure('.approw .eq-eq', 'app');
    return out;
  })()`);
  for (const r of result) console.log(JSON.stringify(r));
  app.exit(0);
});
