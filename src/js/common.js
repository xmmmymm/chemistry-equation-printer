/* 通用 UI 工具：DOM、弹窗、toast */
(function () {
  'use strict';

  function el(tag, attrs, ...children) {
    const node = document.createElement(tag);
    if (attrs) {
      for (const [k, v] of Object.entries(attrs)) {
        if (k === 'class') node.className = v;
        else if (k === 'style' && typeof v === 'object') Object.assign(node.style, v);
        else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2), v);
        else if (k === 'dataset') Object.assign(node.dataset, v);
        else if (v !== undefined && v !== null) node.setAttribute(k, v);
      }
    }
    for (const c of children.flat(Infinity)) {
      if (c === null || c === undefined || c === false) continue;
      node.append(c.nodeType ? c : document.createTextNode(String(c)));
    }
    return node;
  }

  function toast(message, type, duration) {
    type = type || 'info';
    const box = el('div', { class: 'toast ' + type }, message);
    document.getElementById('toast-container').appendChild(box);
    setTimeout(() => {
      box.style.transition = 'opacity .3s';
      box.style.opacity = '0';
      setTimeout(() => box.remove(), 320);
    }, duration || (type === 'error' ? 5200 : 3000));
  }

  const toastOk = (m) => toast(m, 'success');
  const toastErr = (m) => toast(m, 'error', 6000);
  const toastWarn = (m) => toast(m, 'warning', 4500);
  const toastInfo = (m) => toast(m, 'info');

  /**
   * 通用弹窗。返回控制器 { close, body, foot }。
   * opts: { title, width, body(Node|html string), buttons:[{text, class, value}], onClose }
   */
  function modal(opts) {
    const root = document.getElementById('modal-root');
    const bodyWrap = el('div', { class: 'modal-body' });
    if (typeof opts.body === 'string') bodyWrap.innerHTML = opts.body;
    else if (opts.body) bodyWrap.appendChild(opts.body);

    const footWrap = el('div', { class: 'modal-foot' });
    const mask = el('div', { class: 'modal-mask' },
      el('div', { class: 'modal', style: { width: (opts.width || 640) + 'px' } },
        el('div', { class: 'modal-head' },
          el('span', {}, opts.title || ''),
          el('button', { class: 'modal-close', onclick: () => close(null) }, '×')),
        bodyWrap,
        footWrap));

    function close(value) {
      mask.remove();
      if (opts.onClose) opts.onClose(value);
    }
    (opts.buttons || []).forEach(b => {
      footWrap.appendChild(el('button', {
        class: 'btn ' + (b.class || 'secondary'),
        onclick: () => { b.onClick ? b.onClick(close) : close(b.value); }
      }, b.text));
    });

    mask.addEventListener('mousedown', (e) => { if (e.target === mask && opts.dismissable !== false) close(null); });
    root.appendChild(mask);
    return { close, body: bodyWrap, foot: footWrap, mask };
  }

  function confirmDialog(title, message, danger) {
    return new Promise((resolve) => {
      modal({
        title,
        width: 460,
        body: el('div', {}, message),
        buttons: [
          { text: '取消', value: false },
          { text: '确定', class: danger ? 'danger' : '', value: true }
        ],
        onClose: resolve
      });
    });
  }

  // 输入弹窗
  function promptDialog(title, label, defaultValue) {
    return new Promise((resolve) => {
      const input = el('input', { type: 'text', style: { width: '100%' }, value: defaultValue || '' });
      modal({
        title,
        width: 440,
        body: el('div', { style: { display: 'flex', 'flex-direction': 'column', gap: '8px' } },
          el('label', { class: 'field' }, el('span', {}, label), input)),
        buttons: [
          { text: '取消', value: null },
          { text: '确定', class: '', onClick: (close) => close(input.value.trim() || null) }
        ],
        onClose: resolve
      });
      setTimeout(() => input.focus(), 50);
    });
  }

  window.UI = { el, toast, toastOk, toastErr, toastWarn, toastInfo, modal, confirmDialog, promptDialog };
})();
