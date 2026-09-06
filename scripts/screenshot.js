/* 截图验证脚本：启动应用并对各视图截图保存到 build/ */
const { app, BrowserWindow } = require('electron');
const path = require('path');
const fs = require('fs');

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    width: 1440, height: 920, show: true, useContentSize: true,
    webPreferences: { preload: path.join(__dirname, '..', 'preload.js'), contextIsolation: true }
  });
  await win.loadFile(path.join(__dirname, '..', 'src', 'index.html'));
  await new Promise((r) => setTimeout(r, 2000));
  fs.mkdirSync(path.join(__dirname, '..', 'build'), { recursive: true });
  for (const view of ['library', 'generate', 'worksheet', 'history', 'datamanage', 'settings']) {
    await win.webContents.executeJavaScript('window.App && window.App.showView && window.App.showView("' + view + '")');
    await new Promise((r) => setTimeout(r, 800));
    const img = await win.webContents.capturePage();
    fs.writeFileSync(path.join(__dirname, '..', 'build', 'preview_' + view + '.png'), img.toPNG());
    console.log('saved preview_' + view + '.png');
  }
  app.exit(0);
});
