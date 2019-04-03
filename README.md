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

```html
<streaming-include src="data.inc"></streaming-include>
```

A custom element.

It fetches the `src`, clears the content of the element, pipes the response through `TextDecoderStream`, `DOMParserStream`, `DOMParserBlocker`, then adds resulting elements (as with `DOMWritable`) to itself.

When `src` changes, any current stream is cancelled, and the above process starts again.

### Questions

What if the `src` response is `!ok`? What if it fails?

With `src`, when does the loading start? What if the element is disconnected and reconnected (I kinda hate what iframe does here).

TODO. I haven't thought too hard about this yet.

### Implementation notes

TODO. I haven't thought too hard about this yet. The intent is that it can be easily created using the low-level parts.

## Use-cases met/missed

TODO. I want to measure this proposal against the use-cases identified in the [research](research.md).
