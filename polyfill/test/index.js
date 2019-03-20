import '../../node_modules/mocha/mocha.js';
import '../../node_modules/chai/chai.js';

import { DOMParserStream, DOMWritable } from '../index.js'

mocha.setup('tdd');

const { assert } = chai;

function createElementWritable(el) {
  const transform = new DOMParserStream();
  transform.readable.pipeTo(new DOMWritable(el));
  return transform.writable;
}

function parseHTMLTest(html) {
  let name = html;
  if (name.length > 80) {
    name = name.slice(0, 80) + '…';
  }
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

suite('Tricky tests', () => {
  // These are from https://github.com/html5lib/html5lib-tests/blob/master/tree-construction/tricky01.dat
  parseHTMLTest('<b><p>Bold </b> Not bold</p>Also not bold.');
  parseHTMLTest(`<font color=red><i>Italic and Red<p>Italic and Red </font> Just italic.</p> Italic only.</i> Plain
<p>I should not be red. <font color=red>Red. <i>Italic and red.</p>
<p>Italic and red. </i> Red.</font> I should not be red.</p>
<b>Bold <i>Bold and italic</b> Only Italic </i> Plain`);
  parseHTMLTest(`<dl>
<dt><b>Boo
<dd>Goo?
</dl>`);
  parseHTMLTest(`<label><a><div>Hello<div>World</div></a></label>`);
  parseHTMLTest(`<table><center> <font>a</center> <img> <tr><td> </td> </tr> </table>`);
  parseHTMLTest(`<table><tr><p><a><p>You should see this text.`);
  parseHTMLTest(`<TABLE>
<TR>
<CENTER><CENTER><TD></TD></TR><TR>
<FONT>
<TABLE><tr></tr></TABLE>
</P>
<a></font><font></a>`);
  parseHTMLTest(`<b><nobr><div>This text is in a div inside a nobr</nobr>More text that should not be in the nobr, i.e., the
nobr should have closed the div inside it implicitly. </b><pre>A pre tag outside everything else.</pre>`);
});

mocha.run();
