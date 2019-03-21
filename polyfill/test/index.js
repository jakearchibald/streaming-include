import '../../node_modules/mocha/mocha.js';
import '../../node_modules/chai/chai.js';

import { DOMParserStream, DOMWritable } from '../index.js'

mocha.setup('tdd');

const { assert } = chai;

let globalUniqueCounter = 0;

function getUniqueName() {
  return 'unique' + globalUniqueCounter++;
}

function createElementWritable(el) {
  const transform = new DOMParserStream();
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
  test('Images do not load until connected', async () => {
    const transform = new DOMParserStream();
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
      const transform = new DOMParserStream();
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
        const transform = new DOMParserStream();

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

mocha.run();
