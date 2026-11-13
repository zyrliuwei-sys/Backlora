/**
 * Run with page.evaluate(captureBadgeEmbed, { buttonText }).
 * Captures only the official Copy button's outgoing text. It never reads or
 * writes the system clipboard and does not change browser permissions.
 * Keep this function self-contained: browser tools serialize it into the page.
 */
export async function captureBadgeEmbed({ buttonText, timeoutMs = 1500 } = {}) {
  const normalize = (text) => String(text ?? '').replace(/\s+/g, ' ').trim();
  const label = normalize(buttonText);
  if (!label || !/copy|复制/i.test(label) || !/embed|badge|code|徽章|代码/i.test(label))
    throw new Error('Choose an observed badge-code Copy button');
  const buttons = [...document.querySelectorAll('button')].filter(
    (button) =>
      !button.disabled &&
      button.getClientRects().length > 0 &&
      normalize(button.innerText || button.textContent) === label
  );
  if (buttons.length !== 1)
    throw new Error('Expected one visible, enabled badge Copy button');
  const button = buttons[0];
  const originalType = button.getAttribute('type');
  if (button.form && originalType !== null && button.type !== 'button')
    throw new Error('Refusing to activate a form submit/reset button');
  const result = (html) => {
    if (typeof html !== 'string' || html.length > 20_000 || !/<a\s/i.test(html))
      throw new Error('Copy button did not provide badge HTML');
    return { html, source_url: location.href, method: 'official_copy_payload' };
  };
  const embedded = button.getAttribute('data-clipboard-text');
  if (embedded) return result(embedded);

  const clipboard = navigator.clipboard;
  if (!clipboard || typeof clipboard.writeText !== 'function')
    throw new Error('Copy capture unavailable; inspect the official code field');
  const descriptor = Object.getOwnPropertyDescriptor(clipboard, 'writeText');
  let timer;
  let captured = false;
  let deliver;
  const pending = new Promise((resolve, reject) => {
    deliver = resolve;
    timer = setTimeout(
      () => reject(new Error('Copy button produced no text; no clipboard access was attempted')),
      Math.max(100, Math.min(Number(timeoutMs) || 1500, 3000))
    );
  });
  // Attach a rejection handler before dispatching a possibly throwing handler.
  pending.catch(() => {});
  const capture = (text) => {
    if (!captured) {
      captured = true;
      deliver(text);
    }
    return Promise.resolve();
  };
  let installed = false;
  let typeChanged = false;
  const form = button.form;
  // Some directory templates omit type="button" on their Copy controls.
  // Suppress both default and programmatic form submission during capture.
  const preventSubmit = (event) => {
    if (event.target === form) {
      event.preventDefault();
      event.stopImmediatePropagation();
    }
  };
  try {
    Object.defineProperty(clipboard, 'writeText', {
      configurable: true,
      writable: true,
      value: capture,
    });
    installed = true;
    if (form) {
      button.setAttribute('type', 'button');
      typeChanged = true;
      document.addEventListener('submit', preventSubmit, true);
    }
    button.click();
    return result(await pending);
  } finally {
    clearTimeout(timer);
    if (form) document.removeEventListener('submit', preventSubmit, true);
    if (typeChanged) {
      if (originalType === null) button.removeAttribute('type');
      else button.setAttribute('type', originalType);
    }
    if (installed) {
      if (descriptor) Object.defineProperty(clipboard, 'writeText', descriptor);
      else delete clipboard.writeText;
    }
  }
}
