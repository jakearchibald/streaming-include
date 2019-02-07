# Streaming HTML parser and include

This repo is exploring the idea of a [built-in module](https://github.com/tc39/ecma262/issues/395) that makes it easier to stream HTML content into a page.

## The problem

Single page apps tend to follow this pattern on navigation:

1. Fetch all the content.
1. Display all the content.

The lack of streaming in this solution can result in an experience [much slower than a server-rendered navigation](https://www.youtube.com/watch?v=4zG0AZRZD6Q).

This repo aims to explore solutions that allow SPAs to stream content into the document.

## Current solutions & feature requests

Most current solutions buffer content, but there are some hacky ways around it. These are covered in a [research document](research.md).

## Low-level solution

The aim is to create an API that generates elements from an HTML stream. Because the input can result in multiple elements being output, a transform stream feels like a good choice:

```js
const response = await fetch(url);
const domStream = response.body
  .pipeThrough(new TextDecoderStream())
  .pipeThrough(new DOMParserStream({ context, contextNS }));
```

* `context` (optional) - An element is created with this local name, in a document without a browsing context (like a template), in the HTML namespace. The default is `"body"`.
* `contextNS` (optional) - The namespace of the context. HTML by default.

```js
for await (const { node, parent, before } of domStream) {
  (parent || document.body).insertBefore(node, before);
}
```

* `node` - The newly created node.
* `parent` - The node it should be inserted into. Might be null.
* `before` - The node it should be inserted before. Might be null.

The nodes will not have parents. It's up to the developer to add them wherever they want, or discard them.

In addition, there will be a:

```js
const throttledDOMStream = domStream.passThrough(new DOMParserBlocker());
```

This will apply the parser-blocking rules of scripts & stylesheets. Namely:

* If a script-blocking stylesheet is seen, it will hold-back any `<script>` until the stylesheet has loaded. However, it may continue to adopt nodes & buffer them (this will allow images to load).
* If a parser-blocking script is encountered, it will wait until that script has executed before adopting further nodes.

Because styles and scripts need to be connected to load/execute, you'll end up with a blocked stream if you aren't adding elements to the DOM.

### Questions

Is `{ node, parent, before }` enough to express some of the more complicated error handling in HTML?

Is `context`/`contextNS` enough? Or does the parser need to know about ancestor elements? `createContextualFragment` uses a `Range` for this.

Do we care about XML parsing?

Do we want something even lower level that describes nodes using simple structured-clonable objects? Then, it could be used in a worker.

### Implementation notes

Turns out you can `document.write` to a document created with `document.implementation.createHTMLDocument()`. This gives us access to the streaming parser.

The writing would start `"<template>"` followed by whatever is needed to set up the `context`. This means the incoming HTML could break out of the context/template using closing tags. We'd need to find a way to prevent this.

Scripts parsed into different documents [shouldn't execute](https://html.spec.whatwg.org/multipage/parsing.html#scripts-that-modify-the-page-as-it-is-being-parsed), although they do in Chrome. In this case, we'd want all scripts to execute when they're added to the document. Maybe this could be done by recreating the script element with the same content & attributes in the current document.

## High-level solution

```html
<streaming-include></streaming-include>
```

A custom element.

It has a `writable` property which is a writable stream. It accepts the objects yielded by `DOMParserStream`, and appends the nodes to their parent, or appends them to the streaming include element.

When the writable receives the first item, the streaming include is emptied.

It has a `reset()` method that aborts any current writing, and sets `writable` to a new stream.

It can have a `src`. Setting the src locks the writable, fetches the url, pipes the stream through `TextDecoderStream`, `DOMParserStream`, and `DOMParserBlocker`, and pipes it to the writable.

### Questions

What if the `src` response is `!ok`? What if it fails?

TODO. I haven't thought too hard about this yet.

### Implementation notes

TODO. I haven't thought too hard about this yet. The intent is that it can be easily created using the low-level parts.

## Use-cases met/missed

TODO. I want to measure this proposal against the use-cases identified in the [research](research.md).
