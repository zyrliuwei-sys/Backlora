import assert from 'node:assert/strict';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';

import { captureBadgeEmbed } from '../public/agent/badge-embed.mjs';

const html =
  '<a href="https://directory.example/" data-verify="exact"><img src="https://directory.example/dark.svg" alt="Official Badge"></a>';
function fixture({
  own = false,
  click,
  attribute = null,
  ...buttonOverrides
} = {}) {
  let reads = 0,
    writes = 0,
    clicks = 0;
  const original = () => {
    writes++;
    throw new Error('Native clipboard write forbidden');
  };
  const clipboard = Object.create({ writeText: original });
  Object.defineProperty(clipboard, 'readText', {
    get() {
      reads++;
      throw new Error('Clipboard read forbidden');
    },
  });
  if (own)
    Object.defineProperty(clipboard, 'writeText', {
      value: original,
      configurable: true,
    });
  const before = Object.getOwnPropertyDescriptor(clipboard, 'writeText');
  const attributes = new Map([['type', buttonOverrides.type ?? 'button']]);
  if (buttonOverrides.implicitType) attributes.delete('type');
  if (attribute) attributes.set('data-clipboard-text', attribute);
  const listeners = new Set();
  const button = {
    disabled: false,
    type: 'button',
    form: null,
    innerText: 'Copy Dark Embed',
    getClientRects: () => [1],
    getAttribute: (name) => attributes.get(name) ?? null,
    setAttribute: (name, value) => {
      attributes.set(name, value);
      if (name === 'type') button.type = value;
    },
    removeAttribute: (name) => {
      attributes.delete(name);
      if (name === 'type') button.type = 'submit';
    },
    click() {
      clicks++;
      return click
        ? click(clipboard, button, listeners)
        : clipboard.writeText(html);
    },
    ...buttonOverrides,
  };
  const buttons = [button];
  const run = runInNewContext(`(${captureBadgeEmbed.toString()})`, {
    document: {
      querySelectorAll: () => buttons,
      addEventListener: (_type, listener) => listeners.add(listener),
      removeEventListener: (_type, listener) => listeners.delete(listener),
    },
    navigator: { clipboard },
    location: { href: 'https://directory.example/submit' },
    setTimeout,
    clearTimeout,
  });
  return {
    run,
    buttons,
    clipboard,
    verify(expectedClicks = 1) {
      assert.equal(reads, 0);
      assert.equal(writes, 0);
      assert.equal(clicks, expectedClicks);
      assert.equal(listeners.size, 0);
      assert.deepEqual(
        Object.getOwnPropertyDescriptor(clipboard, 'writeText'),
        before
      );
      assert.equal(clipboard.writeText, original);
    },
  };
}
for (const own of [false, true]) {
  test(`captures exact official HTML and restores ${own ? 'own' : 'inherited'} clipboard method`, async () => {
    const f = fixture({ own });
    const result = await f.run({ buttonText: 'Copy Dark Embed' });
    assert.equal(result.html, html);
    assert.equal(result.source_url, 'https://directory.example/submit');
    f.verify();
  });
}
test('asynchronous copy handler is captured without clipboard access', async () => {
  const f = fixture({ click: (c) => setTimeout(() => c.writeText(html), 10) });
  assert.equal((await f.run({ buttonText: 'Copy Dark Embed' })).html, html);
  f.verify();
});
test('implicit submit Copy button cannot submit and original type is restored', async () => {
  const form = {};
  const f = fixture({
    form,
    type: 'submit',
    implicitType: true,
    click: (clipboard, button, listeners) => {
      assert.equal(button.type, 'button');
      let prevented = false,
        stopped = false;
      for (const listener of listeners)
        listener({
          target: form,
          preventDefault() {
            prevented = true;
          },
          stopImmediatePropagation() {
            stopped = true;
          },
        });
      assert.equal(prevented, true);
      assert.equal(stopped, true);
      return clipboard.writeText(html);
    },
  });
  assert.equal((await f.run({ buttonText: 'Copy Dark Embed' })).html, html);
  assert.equal(f.buttons[0].type, 'submit');
  assert.equal(f.buttons[0].getAttribute('type'), null);
  f.verify();
});
test('implicit button type and form protection are restored on timeout', async () => {
  const f = fixture({
    form: {},
    type: 'submit',
    implicitType: true,
    click: () => {},
  });
  await assert.rejects(
    f.run({ buttonText: 'Copy Dark Embed', timeoutMs: 100 }),
    /no text/
  );
  assert.equal(f.buttons[0].type, 'submit');
  assert.equal(f.buttons[0].getAttribute('type'), null);
  f.verify();
});
test('data attribute provides exact code without clicking', async () => {
  const f = fixture({ attribute: html });
  assert.equal((await f.run({ buttonText: 'Copy Dark Embed' })).html, html);
  f.verify(0);
});
test('timeout restores method without reading clipboard', async () => {
  const f = fixture({ click: () => {} });
  await assert.rejects(
    f.run({ buttonText: 'Copy Dark Embed', timeoutMs: 100 }),
    /no text/
  );
  f.verify();
});
test('throwing handler restores method', async () => {
  const f = fixture({
    click: () => {
      throw new Error('copy failed');
    },
  });
  await assert.rejects(f.run({ buttonText: 'Copy Dark Embed' }), /copy failed/);
  f.verify();
});
test('unavailable hook fails without clicking', async () => {
  const f = fixture();
  Object.preventExtensions(f.clipboard);
  await assert.rejects(f.run({ buttonText: 'Copy Dark Embed' }));
  f.verify(0);
});
test('ambiguous, hidden, disabled and submission buttons are not clicked', async () => {
  for (const overrides of [
    { form: {}, type: 'submit' },
    { disabled: true },
    { getClientRects: () => [] },
  ]) {
    const f = fixture(overrides);
    await assert.rejects(f.run({ buttonText: 'Copy Dark Embed' }));
    f.verify(0);
  }
  const f = fixture();
  f.buttons.push(f.buttons[0]);
  await assert.rejects(f.run({ buttonText: 'Copy Dark Embed' }), /one visible/);
  f.verify(0);
});
test('non-badge or oversized output is rejected and method restored', async () => {
  for (const text of ['not badge HTML', '<a ' + 'x'.repeat(20_001)]) {
    const f = fixture({ click: (c) => c.writeText(text) });
    await assert.rejects(
      f.run({ buttonText: 'Copy Dark Embed' }),
      /badge HTML/
    );
    f.verify();
  }
});
test('arbitrary buttons cannot be targeted', async () => {
  const f = fixture({ innerText: 'Submit for Free' });
  await assert.rejects(
    f.run({ buttonText: 'Submit for Free' }),
    /observed badge/
  );
  f.verify(0);
});
