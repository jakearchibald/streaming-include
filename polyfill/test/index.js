import '../../node_modules/mocha/mocha.js';
import '../../node_modules/chai/chai.js';

import { HTMLParserStream, DOMWritable } from '../index.js'
import HTMLStreamingIncludeElement from '../streaming-include.js';

mocha.setup('tdd');

const { assert } = chai;

let globalUniqueCounter = 0;

function getUniqueName() {
  return 'unique' + globalUniqueCounter++;
}

function createElementWritable(el) {
  const transform = new HTMLParserStream();
  transform.readable.pipeTo(new DOMWritable(el));
  return transform.writable;
}

function monitorStream(callback) {
  return new TransformStream({
    transform(chunk, controller) {
      callback(chunk);
      controller.enqueue(chunk);
    }
  });
}

function wait(ms = 0) {
  return new Promise(r => setTimeout(r, ms));
}

/**
 * @param {() => Promise<void>} callback
 */
async function assertNoNetworkActivity(callback) {
  performance.clearResourceTimings();
  await callback();
  assert.strictEqual(
    performance.getEntriesByType('resource').length,
    0,
    'No network activity'
  );
}

async function assertURLRequested(url, callback) {
  url = new URL(url, location).href;
  performance.clearResourceTimings();
  await callback();
  const entries = /** @type {PerformanceResourceTiming[]} */(performance.getEntriesByType('resource'));
  assert.isTrue(entries.some(entry => entry.name === url));
}

const smallContent1 = document.createElement('div');
smallContent1.innerHTML = '<strong>hello</strong> <em>world</em>\n';
const smallContent2 = document.createElement('div');
smallContent2.innerHTML = '<em>foo</em> <strong>bar</strong>\n';

/**
 * @param {HTMLStreamingIncludeElement} el
 */
function assertElContentEqual(el1, el2) {
  assert.strictEqual(el1.childNodes.length, el2.childNodes.length);

  for (const [i, node] of [...el1.childNodes].entries()) {
    assert.isTrue(node.isEqualNode(el2.childNodes[i]));
  }
}

function parseHTMLTest(html) {
  let name = html;
  if (name.length > 80) name = name.slice(0, 80) + '…';

  test(name, async () => {
    const targetInnerHTML = document.createElement('div');
    const targetOneChunkStream = document.createElement('div');
    const targetMultiChunkStream = document.createElement('div');

    targetInnerHTML.innerHTML = html;

    {
      const writer = createElementWritable(targetOneChunkStream).getWriter();
      writer.write(html);
      await writer.close();
    }

    {
      const writer = createElementWritable(targetMultiChunkStream).getWriter();
      for (const char of html) {
        writer.write(char);
      }
      await writer.close();
    }

    assert.isTrue(targetInnerHTML.isEqualNode(targetOneChunkStream), 'targetOneChunkStream');
    // Comparing innerHTML as it handles <template>
    assert.strictEqual(
      targetInnerHTML.innerHTML, targetOneChunkStream.innerHTML,
      'targetOneChunkStream innerHTML',
    );
    assert.isTrue(targetInnerHTML.isEqualNode(targetMultiChunkStream), 'targetMultiChunkStream');
    assert.strictEqual(
      targetInnerHTML.innerHTML, targetMultiChunkStream.innerHTML,
      'targetMultiChunkStream innerHTML',
    );
  });
}

suite('Templates', () => {
  parseHTMLTest('Hello <template>world</template>');
  parseHTMLTest('Hello <template>everyone in the</template> <template>world</template>');
  parseHTMLTest('Hello <template>everyone in the <template>world</template>, ok?</template>');
});

suite('Escaping the root', () => {
  parseHTMLTest('hello </template> world');
  parseHTMLTest('hello </body> world');
  parseHTMLTest('hello </html> world');
  parseHTMLTest('hello <p> everyone in the </html> world');
});

suite('Special elements', () => {
  setup(() => {
    for (const el of document.querySelectorAll('.test-stylesheet')) el.remove();
  });

  test('Images do not load until connected', async () => {
    const transform = new HTMLParserStream();
    const reader = transform.readable.getReader();
    const writer = transform.writable.getWriter();
    writer.write('<img src="assets/img.png">');
    writer.close();

    while (true) {
      const { done, value } = await reader.read();
      if (done) throw Error('Unexpected done');

      const img = /** @type {HTMLImageElement} */ (value.node);
      assert.instanceOf(img, HTMLImageElement);
      assert.isTrue(img.complete);
      assert.strictEqual(img.naturalHeight, 0);
      return;
    }
  });

  for (const charByChar of [false, true]) {
    test('Inline script' + (charByChar ? ' char by char' : ''), async () => {
      const writable = createElementWritable(document.body);
      const writer = writable.getWriter();
      const varName = getUniqueName();
      const content = `<script>${varName} = true;</script>`;
      if (charByChar) {
        for (const char of content) writer.write(char);
      } else {
        writer.write(content);
      }
      await writer.close();
      assert.isTrue(self[varName]);
    });
  }

  test('Inline script partial', async () => {
    const writable = createElementWritable(document.body);
    const writer = writable.getWriter();
    const varName = getUniqueName();
    await writer.write(`<script>${varName} = true;`);
    await new Promise(r => setTimeout(r, 0));
    assert.isUndefined(self[varName]);
    writer.write(`</script>`);
    await writer.close();
    assert.isTrue(self[varName]);
  });

  for (const charByChar of [false, true]) {
    test('Script attributes' + (charByChar ? ' char by char' : ''), async () => {
      const transform = new HTMLParserStream();
      const writer = transform.writable.getWriter();
      const className = getUniqueName();
      const dataValue = getUniqueName();
      const content = `<script class="${className}" data-val="${dataValue}"></script>`;
      if (charByChar) {
        for (const char of content) writer.write(char);
      } else {
        writer.write(content);
      }
      writer.close();

      const { value } = await transform.readable.getReader().read();
      const script = value.node;
      assert.instanceOf(script, HTMLScriptElement);
      assert.strictEqual(script.getAttribute('class'), className, 'class attribute');
      assert.strictEqual(script.getAttribute('data-val'), dataValue, 'data-val attribute');
    });
  }

  for (const charByChar of [false, true]) {
    test('External script' + (charByChar ? ' char by char' : ''), async () => {
      const varName = getUniqueName();

      const loadPromise = new Promise((resolve, reject) => {
        const transform = new HTMLParserStream();

        transform.readable.pipeThrough(monitorStream(chunk => {
          chunk.node.addEventListener('load', () => resolve());
          chunk.node.addEventListener('error', () => reject(Error('Script load error')));
        })).pipeTo(new DOMWritable(document.body));

        const writer = transform.writable.getWriter();
        const content = `<script src="assets/script.js?prop=${varName}"></script>`;
        if (charByChar) {
          for (const char of content) writer.write(char);
        } else {
          writer.write(content);
        }
      });

      await loadPromise;
      assert.isTrue(self[varName]);
    });
  }

  for (const charByChar of [false, true]) {
    test('Inline style' + (charByChar ? ' char by char' : ''), async () => {
      const writable = createElementWritable(document.body);
      const writer = writable.getWriter();
      const className = getUniqueName();
      const content = `<style>.${className} { background-color: rgb(0, 128, 0); }</style>`;
      if (charByChar) {
        for (const char of content) writer.write(char);
      } else {
        writer.write(content);
      }
      await writer.close();
      const div = document.createElement('div');
      div.classList.add(className);
      document.body.append(div);
      assert.strictEqual(getComputedStyle(div).backgroundColor, 'rgb(0, 128, 0)');
      div.remove();
    });
  }

  test('Inline style partial', async () => {
    const writable = createElementWritable(document.body);
    const writer = writable.getWriter();
    const className = getUniqueName();
    await writer.write(`<style>.${className} { background-color: rgb(0, 128, 0); }`);
    await new Promise(r => setTimeout(r, 0));
    const div = document.createElement('div');
    div.classList.add(className);
    document.body.append(div);
    assert.strictEqual(getComputedStyle(div).backgroundColor, 'rgba(0, 0, 0, 0)');
    writer.write(`</style>`);
    await writer.close();
    assert.strictEqual(getComputedStyle(div).backgroundColor, 'rgb(0, 128, 0)');
    div.remove();
  });

  for (const charByChar of [false, true]) {
    test('External style' + (charByChar ? ' char by char' : ''), async () => {
      const loadPromise = new Promise((resolve, reject) => {
        const transform = new HTMLParserStream();

        transform.readable.pipeThrough(monitorStream(chunk => {
          chunk.node.addEventListener('load', () => resolve());
          chunk.node.addEventListener('error', () => reject(Error('Style load error')));
        })).pipeTo(new DOMWritable(document.body));

        const writer = transform.writable.getWriter();
        const content = `<link class="test-stylesheet" rel="stylesheet" href="assets/style.css">`;

        if (charByChar) {
          for (const char of content) writer.write(char);
        } else {
          writer.write(content);
        }
      });

      await loadPromise;
      const div = document.createElement('div');
      div.classList.add('test-style');
      document.body.append(div);
      assert.strictEqual(getComputedStyle(div).backgroundColor, 'rgb(0, 128, 0)');
      div.remove();
    });
  }
});

// These are from https://github.com/html5lib/html5lib-tests/blob/master/tree-construction/tricky01.dat
const trickyTests = [
  '<b><p>Bold </b> Not bold</p>Also not bold.',
  `<font color=red><i>Italic and Red<p>Italic and Red </font> Just italic.</p> Italic only.</i> Plain
<p>I should not be red. <font color=red>Red. <i>Italic and red.</p>
<p>Italic and red. </i> Red.</font> I should not be red.</p>
<b>Bold <i>Bold and italic</b> Only Italic </i> Plain`,
  `<dl>
<dt><b>Boo
<dd>Goo?
</dl>`,
  `<label><a><div>Hello<div>World</div></a></label>`,
  `<table><center> <font>a</center> <img> <tr><td> </td> </tr> </table>`,
  `<table><tr><p><a><p>You should see this text.`,
  `<TABLE>
<TR>
<CENTER><CENTER><TD></TD></TR><TR>
<FONT>
<TABLE><tr></tr></TABLE>
</P>
<a></font><font></a>`,
  `<b><nobr><div>This text is in a div inside a nobr</nobr>More text that should not be in the nobr, i.e., the
nobr should have closed the div inside it implicitly. </b><pre>A pre tag outside everything else.</pre>`,
];

suite('Tricky tests', () => {
  for (const trickyTest of trickyTests) {
    parseHTMLTest(trickyTest);
    // Also test within a template
    parseHTMLTest(`<template>${trickyTest}</template>`);
  }
});

suite('<streaming-include>', () => {
  test('Can be constructed', () => {
    const streamingInclude = new HTMLStreamingIncludeElement();
    assert.instanceOf(streamingInclude, HTMLElement);
    assert.strictEqual(streamingInclude.tagName, 'STREAMING-INCLUDE');
  });

  test('Can be upgraded', () => {
    const div = document.createElement('div');
    div.innerHTML = '<streaming-include></streaming-include>';
    const streamingInclude = div.firstElementChild;
    assert.instanceOf(streamingInclude, HTMLStreamingIncludeElement);
  });

  {
    const attrsToProps = [
      [undefined, ''],
      ['foo', new URL('foo', location).href],
      ['', new URL('', location).href],
      ['about:blank', 'about:blank'],
      ['https://example.com/', 'https://example.com/'],
      ['https://example.com', 'https://example.com/'],
      ['http://[1::2]:3:4', 'http://[1::2]:3:4'],
    ];

    for (const [attr, expectedProp] of attrsToProps) {
      test('src prop reflects ' + JSON.stringify(attr), () => {
        const streamingInclude = new HTMLStreamingIncludeElement();
        if (attr !== undefined) streamingInclude.setAttribute('src', attr);
        assert.strictEqual(streamingInclude.src, expectedProp);
      });
    }
  }

  {
    const propsToAttrs = [
      [null, 'null'],
      ['', ''],
      ['foo', 'foo'],
      ['about:blank', 'about:blank'],
      ['https://example.com', 'https://example.com'],
      ['http://[1::2]:3:4', 'http://[1::2]:3:4'],
    ];

    for (const [prop, expectedAttr] of propsToAttrs) {
      test('src prop sets attr - ' + JSON.stringify(prop), () => {
        const streamingInclude = new HTMLStreamingIncludeElement();
        streamingInclude.src = prop;
        assert.strictEqual(streamingInclude.getAttribute('src'), expectedAttr);
      });
    }
  }

  {
    const attrsToProps = [
      [undefined, 'anonymous'],
      ['', 'anonymous'],
      ['foo', 'anonymous'],
      ['anonymous', 'anonymous'],
      ['anonymouS', 'anonymous'],
      ['use-credentials', 'use-credentials'],
      ['use-credentialS', 'use-credentials'],
    ];

    for (const [attr, expectedProp] of attrsToProps) {
      test('crossOrigin prop reflects ' + JSON.stringify(attr), () => {
        const streamingInclude = new HTMLStreamingIncludeElement();
        if (attr !== undefined) streamingInclude.setAttribute('crossorigin', attr);
        assert.strictEqual(streamingInclude.crossOrigin, expectedProp);
      });
    }
  }

  {
    const propsToAttrs = [
      [null, null],
      ['', ''],
      ['foo', 'foo'],
      ['anonymous', 'anonymous'],
      ['anonymouS', 'anonymouS'],
      ['use-credentials', 'use-credentials'],
      ['use-credentiaLS', 'use-credentiaLS'],
    ];

    for (const [prop, expectedAttr] of propsToAttrs) {
      test('crossOrigin prop sets attr - ' + JSON.stringify(prop), () => {
        const streamingInclude = new HTMLStreamingIncludeElement();
        streamingInclude.crossOrigin = prop;
        assert.strictEqual(streamingInclude.getAttribute('crossorigin'), expectedAttr);
      });
    }
  }

  test('parsed initial value', async () => {
    const streamingInclude = new HTMLStreamingIncludeElement();
    assert.instanceOf(streamingInclude.parsed, Promise);
    assert.strictEqual(streamingInclude.parsed, streamingInclude.parsed);
    const val = await streamingInclude.parsed;
    assert.isUndefined(val);
  });

  test('parsed changes when src changes', async () => {
    const streamingInclude = new HTMLStreamingIncludeElement();
    const oldParsed = streamingInclude.parsed;
    streamingInclude.src = 'foo';
    assert.notStrictEqual(oldParsed, streamingInclude.parsed);
  });

  test('parsed changes to rejected promise when invalid URL given', async () => {
    const streamingInclude = new HTMLStreamingIncludeElement();
    streamingInclude.src = 'http://[1::2]:3:4';
    const err = await streamingInclude.parsed.catch(err => err);
    assert.instanceOf(err, TypeError);
  });

  test('Previous parsed promise aborts when new promise is created', async () => {
    const streamingInclude = new HTMLStreamingIncludeElement();
    streamingInclude.src = 'bar';
    const oldParsed = streamingInclude.parsed;
    streamingInclude.src = 'foo';
    const err = await oldParsed.catch(err => err);
    assert.instanceOf(err, DOMException);
    assert.strictEqual(err.name, 'AbortError');
  });

  test('parsed changes when crossorigin changes calculated value', async () => {
    const streamingInclude = new HTMLStreamingIncludeElement();
    const oldParsed = streamingInclude.parsed;
    streamingInclude.crossOrigin = 'anonymous';
    assert.strictEqual(oldParsed, streamingInclude.parsed);
    streamingInclude.crossOrigin = 'use-credentials';
    assert.notStrictEqual(oldParsed, streamingInclude.parsed);
  });

  test('Connecting without setting src does not load', async () => {
    await assertNoNetworkActivity(async () => {
      const streamingInclude = new HTMLStreamingIncludeElement();
      document.body.append(streamingInclude);
      await wait(0);
      streamingInclude.remove();
    });
  });

  test('Setting src after connected starts load', async () => {
    const streamingInclude = new HTMLStreamingIncludeElement();
    document.body.append(streamingInclude);
    streamingInclude.src = 'assets/small-content-1.html';
    await streamingInclude.parsed;
    assertElContentEqual(streamingInclude, smallContent1);
    streamingInclude.remove();
  });

  test('Setting src before connected starts load once connected', async () => {
    const streamingInclude = new HTMLStreamingIncludeElement();
    streamingInclude.src = 'assets/small-content-1.html';
    document.body.append(streamingInclude);
    await streamingInclude.parsed;
    assertElContentEqual(streamingInclude, smallContent1);
    streamingInclude.remove();
  });

  test('Content can load twice', async () => {
    const streamingInclude = new HTMLStreamingIncludeElement();
    streamingInclude.src = 'assets/small-content-1.html';
    document.body.append(streamingInclude);
    await streamingInclude.parsed;
    assertElContentEqual(streamingInclude, smallContent1);

    streamingInclude.src = 'assets/small-content-2.html';
    await streamingInclude.parsed;
    assertElContentEqual(streamingInclude, smallContent2);
    streamingInclude.remove();
  });

  test('Changing crossOrigin starts load', async () => {
    const streamingInclude = new HTMLStreamingIncludeElement();
    streamingInclude.src = 'assets/small-content-1.html';
    document.body.append(streamingInclude);
    await streamingInclude.parsed;

    await assertURLRequested('assets/small-content-1.html', async () => {
      streamingInclude.crossOrigin = 'use-credentials';
      await streamingInclude.parsed;
    });

    streamingInclude.remove();
  });

  test('Changing crossOrigin to same value does not start load', async () => {
    const streamingInclude = new HTMLStreamingIncludeElement();
    streamingInclude.src = 'assets/small-content-1.html';
    document.body.append(streamingInclude);
    await streamingInclude.parsed;

    await assertNoNetworkActivity(async () => {
      streamingInclude.crossOrigin = 'splurb';
      await streamingInclude.parsed;
    });

    streamingInclude.remove();
  });

  test('Changing crossOrigin when disconnected starts load on connect');
  test('Changing src starts load for a second time');
  test('Setting crossOrigin but not src does not start load');
  test('Adding & removing src before connection does not start load');
  test('Content streams');
  test('Response failure rejects parsed');
  test('Response body failure rejects parsed');
  test('Can be aborted');
  test('Network request aborted when aborted');
});

mocha.run();
