const { contextBridge, ipcRenderer } = require('electron');

const api = {
  init: () => ipcRenderer.invoke('app:init'),
  saveData: (name, data) => ipcRenderer.invoke('data:save', { name, data }),
  ui: {
    setZoom: (factor) => ipcRenderer.invoke('ui:setZoom', { factor })
  },
  dir: {
    openData: () => ipcRenderer.invoke('dir:openData')
  },
  clipboard: {
    writeText: (text) => ipcRenderer.invoke('clipboard:writeText', { text })
  },
  exportImages: (opts) => ipcRenderer.invoke('export:images', opts),

  history: {
    list: (projectId) => ipcRenderer.invoke('history:list', { projectId }),
    save: (worksheet) => ipcRenderer.invoke('history:save', { worksheet }),
    get: (id) => ipcRenderer.invoke('history:get', { id }),
    delete: (id) => ipcRenderer.invoke('history:delete', { id })
  },

  // 学习项目：清单/新建/改名/改范围/删除
  projects: {
    list: () => ipcRenderer.invoke('projects:list'),
    save: (projects) => ipcRenderer.invoke('projects:save', { projects }),
    deleteProject: (id) => ipcRenderer.invoke('projects:deleteProject', { id })
  },

  // 学习项目运行数据（counts / countedItems / lastGenSettings）
  project: {
    data: (id) => ipcRenderer.invoke('project:data', { id }),
    saveData: (id, data) => ipcRenderer.invoke('project:saveData', { id, data })
  },

  templates: {
    list: () => ipcRenderer.invoke('templates:list'),
    save: (template) => ipcRenderer.invoke('templates:save', { template }),
    delete: (id) => ipcRenderer.invoke('templates:delete', { id })
  },

  backup: {
    create: () => ipcRenderer.invoke('backup:create'),
    list: () => ipcRenderer.invoke('backup:list'),
    restore: (name) => ipcRenderer.invoke('backup:restore', { name })
  },

  report: {
    save: (baseName, json, markdown) => ipcRenderer.invoke('report:save', { baseName, json, markdown })
  },

  exportFile: {
    write: (fileName, content, binary, dir) => ipcRenderer.invoke('export:writeFile', { fileName, content, binary, dir }),
    chooseDir: () => ipcRenderer.invoke('export:chooseDir'),
    exportedDir: () => ipcRenderer.invoke('export:exportedDir')
  },

  file: {
    openJson: () => ipcRenderer.invoke('file:openJson'),
    saveJson: (defaultName, data) => ipcRenderer.invoke('file:saveJson', { defaultName, data }),
    saveText: (defaultName, content, filters) => ipcRenderer.invoke('file:saveText', { defaultName, content, filters }),
    readExample: (name) => ipcRenderer.invoke('file:readExample', { name }),
    showInFolder: (p) => ipcRenderer.invoke('shell:showItem', { path: p })
  },

  print: {
    pdf: (html, widthMm, heightMm, outPath) => ipcRenderer.invoke('print:pdf', { html, widthMm, heightMm, outPath })
  },

  smoke: () => ipcRenderer.invoke('dev:smoke')
};

contextBridge.exposeInMainWorld('bridge', api);
