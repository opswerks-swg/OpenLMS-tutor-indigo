/**
 * Tests for the public certificate page's "Download PDF" (ow-certificate-download.js).
 *
 * Run from the theme repo root, no dependencies:
 *   node tests/js/ow-certificate-download.test.js
 *
 * Covers the PDF builder, the file name, the object-fit sizing and the click flow (html2canvas
 * and the DOM are stubbed); the captured image itself is checked in the browser.
 */
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const SOURCE = path.join(
  __dirname, '..', '..', 'tutorindigo', 'templates', 'indigo', 'lms', 'static', 'js', 'ow-certificate-download.js'
);

const asText = (bytes) => Buffer.from(bytes).toString('latin1');

function fakeElement(attributes) {
  const listeners = {};
  return {
    attributes: Object.assign({}, attributes),
    textContent: '',
    disabled: false,
    children: {},
    getAttribute(name) { return name in this.attributes ? this.attributes[name] : null; },
    setAttribute(name, value) { this.attributes[name] = String(value); },
    addEventListener(type, listener) { listeners[type] = listener; },
    querySelector(selector) { return this.children[selector] || null; },
    querySelectorAll() { return []; },
    fire(type) { return listeners[type](); },
  };
}

/** Load the script against a fake page; returns the test hooks and the page stubs. */
function load({ html2canvas, withButton = true, amdDefine = null } = {}) {
  const label = fakeElement();
  label.textContent = 'Download PDF';
  const button = fakeElement({
    'data-course-name': 'Kubernetes: Basics & Beyond!',
    'data-html2canvas-src': '/static/js/vendor/html2canvas.min.js',
    'data-default': 'Download PDF',
    'data-busy': 'Preparing PDF…',
    'data-done': 'Certificate downloaded',
  });
  button.children['.ow-cert-btn__label'] = label;
  const status = fakeElement();
  const cert = fakeElement();
  const saved = [];
  const calls = { print: 0, html2canvas: [], scripts: [] };

  const window = {
    __LW_TEST__: {},
    innerWidth: 390,
    setTimeout: (fn) => fn(),
    print() { calls.print += 1; },
  };
  if (amdDefine) {
    window.define = amdDefine;
  }
  const document = {
    readyState: 'complete',
    fonts: { ready: Promise.resolve() },
    head: {
      // Emulates the html2canvas UMD build: with an AMD define() it registers a module and
      // leaves window.html2canvas unset, otherwise it sets the global.
      appendChild(script) {
        calls.scripts.push(script.src);
        if (!html2canvas) {
          script.onerror();
          return;
        }
        const factory = () => (node, options) => {
          calls.html2canvas.push({ node, options });
          return html2canvas(node, options);
        };
        if (typeof window.define === 'function' && window.define.amd) {
          window.define(factory);
        } else {
          window.html2canvas = factory();
        }
        script.onload();
      },
    },
    body: { appendChild() {}, removeChild() {} },
    getElementById(id) {
      if (id === 'ow-cert-download') { return withButton ? button : null; }
      if (id === 'ow-cert-status') { return status; }
      return null;
    },
    querySelector(selector) { return selector === '.ow-cert' ? cert : null; },
    createElement(tag) {
      if (tag === 'a') {
        return { click() { saved.push({ filename: this.download, href: this.href }); } };
      }
      return { tag };
    },
    addEventListener() {},
  };
  const URL = { createObjectURL: () => 'blob:certificate', revokeObjectURL() {} };
  const context = vm.createContext({
    window, document, URL, Blob, Promise, Uint8Array, atob, console: { error() {} },
  });
  vm.runInContext(fs.readFileSync(SOURCE, 'utf8'), context);
  return { hooks: window.__LW_TEST__.certificateDownload, window, button, label, status, cert, saved, calls };
}

const tests = [];
const test = (name, fn) => tests.push([name, fn]);

test('buildImagePdf: one page sized to the image ratio, JPEG embedded as-is', () => {
  const { hooks } = load();
  const jpeg = Uint8Array.from(Buffer.from('FAKEJPEG', 'latin1'));
  const pdf = asText(hooks.buildImagePdf(jpeg, 2246, 1588));

  assert.ok(pdf.startsWith('%PDF-1.4'));
  assert.ok(pdf.includes('/MediaBox [0 0 842 595.32]'), 'A4 landscape ratio');
  assert.ok(pdf.includes('/Width 2246 /Height 1588'));
  assert.ok(pdf.includes('/Filter /DCTDecode /Length 8 >>\nstream\nFAKEJPEG\nendstream'));
  assert.ok(pdf.trimEnd().endsWith('%%EOF'));
});

test('buildImagePdf: cross-reference offsets point at each object', () => {
  const { hooks } = load();
  const pdf = asText(hooks.buildImagePdf(Uint8Array.from([1, 2, 3]), 100, 50));

  const startxref = Number(pdf.match(/startxref\n(\d+)/)[1]);
  assert.strictEqual(pdf.slice(startxref, startxref + 4), 'xref');
  const offsets = [...pdf.slice(startxref).matchAll(/(\d{10}) 00000 n/g)].map((m) => Number(m[1]));
  assert.strictEqual(offsets.length, 5);
  offsets.forEach((offset, index) => {
    assert.strictEqual(pdf.slice(offset, offset + 8), `${index + 1} 0 obj\n`);
  });
});

test('certificateFilename: same sanitizing as the profile MFE download', () => {
  const { hooks } = load();
  assert.strictEqual(hooks.certificateFilename('Kubernetes: Basics & Beyond!'), 'kubernetes-basics-beyond-certificate.pdf');
  assert.strictEqual(hooks.certificateFilename('  CS  Fundamentals '), 'cs-fundamentals-certificate.pdf');
  assert.strictEqual(hooks.certificateFilename(''), 'certificate-certificate.pdf');
  assert.strictEqual(hooks.certificateFilename('!!!'), 'certificate-certificate.pdf');
});

test('containSize: fits the image in its box, null when it already fills it', () => {
  const { hooks } = load();
  // A wide signature clamped by max-width: keeps the width, shrinks the height.
  assert.deepStrictEqual(JSON.parse(JSON.stringify(hooks.containSize(200, 65, 800, 100))), { width: 200, height: 25 });
  assert.strictEqual(hooks.containSize(260, 65, 400, 100), null);
  assert.strictEqual(hooks.containSize(0, 65, 400, 100), null);
  assert.strictEqual(hooks.containSize(200, 65, 0, 0), null);
});

test('click: captures the certificate at a fixed size and saves <course>-certificate.pdf', async () => {
  const canvas = { width: 2246, height: 1588, toDataURL: () => `data:image/jpeg;base64,${btoa('FAKEJPEG')}` };
  const page = load({ html2canvas: () => Promise.resolve(canvas) });

  const pending = page.button.fire('click');
  assert.strictEqual(page.button.disabled, true, 'disabled while generating');
  assert.strictEqual(page.label.textContent, 'Preparing PDF…');
  await pending;
  await new Promise((resolve) => setImmediate(resolve));

  assert.deepStrictEqual(page.calls.scripts, ['/static/js/vendor/html2canvas.min.js']);
  assert.strictEqual(page.calls.html2canvas.length, 1);
  const { node, options } = page.calls.html2canvas[0];
  assert.strictEqual(node, page.cert);
  assert.strictEqual(options.scale, 2);
  assert.strictEqual(options.useCORS, true);
  assert.strictEqual(typeof options.onclone, 'function');
  assert.ok(options.windowWidth >= 1123, 'desktop layout even on a phone');
  assert.deepStrictEqual(page.saved.map((s) => s.filename), ['kubernetes-basics-beyond-certificate.pdf']);
  assert.strictEqual(page.calls.print, 0);
  assert.strictEqual(page.button.disabled, false);
  assert.strictEqual(page.label.textContent, 'Download PDF');
  assert.strictEqual(page.status.textContent, 'Certificate downloaded');
});

test('click: still saves the PDF on pages with RequireJS (AMD define), and restores define', async () => {
  const canvas = { width: 2246, height: 1588, toDataURL: () => `data:image/jpeg;base64,${btoa('FAKEJPEG')}` };
  const amdModules = [];
  const define = (factory) => amdModules.push(factory);
  define.amd = {};
  const page = load({ html2canvas: () => Promise.resolve(canvas), amdDefine: define });

  page.button.fire('click');
  await new Promise((resolve) => setImmediate(resolve));

  assert.strictEqual(amdModules.length, 0, 'html2canvas did not register as an AMD module');
  assert.deepStrictEqual(page.saved.map((s) => s.filename), ['kubernetes-basics-beyond-certificate.pdf']);
  assert.strictEqual(page.calls.print, 0);
  assert.strictEqual(page.window.define, define, 'define restored');
});

test('click: falls back to the print dialog when html2canvas cannot load', async () => {
  const page = load({ html2canvas: null });

  page.button.fire('click');
  await new Promise((resolve) => setImmediate(resolve));

  assert.strictEqual(page.calls.print, 1);
  assert.strictEqual(page.saved.length, 0);
  assert.strictEqual(page.button.disabled, false);
});

test('click: falls back to the print dialog when the capture fails (e.g. tainted canvas)', async () => {
  const page = load({ html2canvas: () => Promise.reject(new Error('SecurityError')) });

  page.button.fire('click');
  await new Promise((resolve) => setImmediate(resolve));

  assert.strictEqual(page.calls.print, 1);
  assert.strictEqual(page.saved.length, 0);
});

test('no Download button (not the owner): loads without wiring anything', () => {
  assert.doesNotThrow(() => load({ withButton: false }));
});

test('source stays clear of Jinja delimiters (Tutor renders static files)', () => {
  const source = fs.readFileSync(SOURCE, 'utf8');
  ['{{', '{%', '{#'].forEach((delimiter) => assert.ok(!source.includes(delimiter), delimiter));
});

(async () => {
  let failed = 0;
  for (const [name, fn] of tests) {
    try {
      await fn();
      console.log(`ok - ${name}`);
    } catch (error) {
      failed += 1;
      console.log(`not ok - ${name}\n  ${error.stack}`);
    }
  }
  console.log(`\n${tests.length - failed}/${tests.length} passed`);
  process.exit(failed ? 1 : 0);
})();
