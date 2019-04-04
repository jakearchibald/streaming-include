# Streaming HTML parser and include

This repo is exploring the idea of a [built-in module](https://github.com/tc39/ecma262/issues/395) that makes it easier to stream HTML content into a page.

## The problem

Single page apps tend to follow this pattern on navigation:

1. Fetch all the content.
1. Display all the content.

The lack of streaming in this solution can result in an experience [much slower than a server-rendered navigation](https://www.youtube.com/watch?v=4zG0AZRZD6Q).

This repo aims to explore solutions that allow SPAs to stream content into the document.

## Current solutions & feature requests

Most current solutions buffer content, but there are some hacky ways around it. These are covered in the [research](research.md).

## Low-level solution

The aim is to create an API that generates elements from an HTML stream. Because the input can result in multiple elements being output, a transform stream feels like a good choice:

```js
const response = await fetch(url);
const domStream = response.body
  .pipeThrough(new TextDecoderStream())
  .pipeThrough(new HTMLParserStream());
```

The stream yields `ParserChunk`s:

```js
for await (const { node, parent, nextSibling } of domStream) {
  (parent || document.body).insertBefore(node, nextSibling);
}
```

* `node` - The newly created node.
* `parent` - The node it should be inserted into. Null for top-level elements.
* `nextSibling` - The node it should be inserted before. Null for elements that should be inserted as the last item of their parent.

**Note:** The stream yields every node including descendants, not just top-level nodes. This means:

* Once `HTMLParserStream` yields a node, it isn't going to add anything to it automatically.
* Developers can modify nodes before they're adopted. This means they can change image urls before they're requested, or filter script nodes before they're executed.

## Mid-level solution

```js
const writable = new DOMWritable(targetElement);
```

* `targetElement` - The element to insert nodes into.

This writable takes the output of `HTMLParserStream` and appends them into the `targetElement`.

```js
const bodyWritable = new DOMWritable(targetElement);
const response = await fetch(url);
const domStream = response.body
  .pipeThrough(new TextDecoderStream())
  .pipeThrough(new HTMLParserStream())
  .pipeTo(bodyWritable);
```

## High-level solution

A custom element.

```html
<streaming-include src="data.inc"></streaming-include>
```

It fetches the `src`, clears the content of the element, pipes the response through `TextDecoderStream`, `HTMLParserStream`, then adds resulting elements (as with `DOMWritable`) to itself.

Attributes:

* `src` - URL of the content. When `src` changes, any current stream is cancelled, and the above process starts again.
* `crossorigin` - "anonymous" by default. Can be set to "use-credentials".

Properties:

* `src` and `crossOrigin` reflect their attributes.
* `parsed` - A promise that resolves once the response has been fully read and elements created. Rejects if the fetch errors.

If `src` is set (even to the same value), or `crossorigin` is set to a new value, any current stream is cancelled, and the loading process starts again.

Methods:

* `abort()` - Abort any current fetch.

# Additional ideas

There could also be a `DOMParserBlocker`:

```js
const throttledDOMStream = domStream.passThrough(new DOMParserBlocker());
```

This will apply the parser-blocking rules of scripts & stylesheets. Namely:

* If a script-blocking stylesheet is passed through, it will hold-back any `<script>` until the stylesheet has loaded. However, it may continue to adopt nodes & buffer them (this will allow images to load).
* If a parser-blocking script is encountered, it will wait until that script has executed before adopting further nodes.

Because styles and scripts need to be connected to load/execute, you'll end up with a blocked stream if you aren't adding elements to a document with a browsing context.

It's currently unclear how to handle scripts with `defer`.

If we decide to do ths, `streaming-include` should use it.
