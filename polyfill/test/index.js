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

function parseHTMLTest(name, html) {
  test(name, async () => {
    const targetInnerHTML = document.createElement('div');
    const targetOneChunkStream = document.createElement('div');
    const targetMultiChunkStream = document.createElement('div');

    targetInnerHTML.innerHTML = html;

    {
      const writer = createElementWritable(targetOneChunkStream).getWriter();
      await writer.write(html);
      writer.close();
    }

    {
      const writer = createElementWritable(targetMultiChunkStream).getWriter();
      for (const char of html) {
        await writer.write(char);
      }
      writer.close();
    }

    assert.isTrue(targetInnerHTML.isEqualNode(targetOneChunkStream), 'targetOneChunkStream');
    assert.isTrue(targetInnerHTML.isEqualNode(targetMultiChunkStream), 'targetMultiChunkStream');
  });
}

suite('Tricky tests', () => {
  // These are from https://github.com/html5lib/html5lib-tests/blob/master/tree-construction/tricky01.dat
  parseHTMLTest('1', '<b><p>Bold </b> Not bold</p>Also not bold.');
  parseHTMLTest('2', `<font color=red><i>Italic and Red<p>Italic and Red </font> Just italic.</p> Italic only.</i> Plain
<p>I should not be red. <font color=red>Red. <i>Italic and red.</p>
<p>Italic and red. </i> Red.</font> I should not be red.</p>
<b>Bold <i>Bold and italic</b> Only Italic </i> Plain`);
  parseHTMLTest('3', `<dl>
<dt><b>Boo
<dd>Goo?
</dl>`);
  parseHTMLTest('4', `<label><a><div>Hello<div>World</div></a></label>`);
  parseHTMLTest('5', `<table><center> <font>a</center> <img> <tr><td> </td> </tr> </table>`);
  parseHTMLTest('6', `<table><tr><p><a><p>You should see this text.`);
  parseHTMLTest('7', `<TABLE>
<TR>
<CENTER><CENTER><TD></TD></TR><TR>
<FONT>
<TABLE><tr></tr></TABLE>
</P>
<a></font><font></a>`);
  parseHTMLTest('8', `<b><nobr><div>This text is in a div inside a nobr</nobr>More text that should not be in the nobr, i.e., the
nobr should have closed the div inside it implicitly. </b><pre>A pre tag outside everything else.</pre>`);
});

mocha.run();
