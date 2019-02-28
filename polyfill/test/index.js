import '../../node_modules/mocha/mocha.js';
import '../../node_modules/chai/chai.js';

import { DOMParserStream } from '../index.js'

mocha.setup('tdd');

const { assert: {
} } = chai;

suite('Basic tests', () => {
  test('Test', async () => {
    const transform = new DOMParserStream();
    window.writer = transform.writable.getWriter();

    const reader = transform.readable.getReader();

    while (true) {
      const { done, value } = await reader.read();
      if (done) return;
      console.log('From readable', value);
    }
  });
});

mocha.run();
