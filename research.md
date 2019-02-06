This document explores APIs that offer(ed)/proposed some way to dynamically load content into an app.

# Write to innerHTML

This pattern is common pattern we're looking to avoid. Roughly:

```js
const response = await fetch('…');
const html = await response.text();
el.innerHTML = html;
```

This pattern is used in libraries like [PJAX](https://github.com/defunkt/jquery-pjax), which is used across GitHub.

This creates situations where loading a page in a new tab (which uses the browser's default streaming parser) is faster than a JavaScript navigation ([video](https://www.youtube.com/watch?v=4zG0AZRZD6Q)).

# h-include

A [library](http://mnot.github.io/hinclude/).

```xml
<hx:include src="/other/document/here.html">…loading…</hx:include>
```

By default, all includes in the document are fetched in parallel, and none are displayed until all have downloaded. This is configurable.

The element's contents are shown until the content is replaced with the include target.

# include-fragment

A [custom element](https://github.com/github/include-fragment-element).

Doesn't stream. Loaded content *replaces* the `<include-fragment>` element.

# streaming-element

A [custom element](https://github.com/whatwg/streams/blob/streaming-element/demos/tags/streaming-element.js) based on the [streaming-html experiment](https://github.com/jakearchibald/streaming-html).

This is the only solution I'm aware of that supports streaming.

Fetched content is document-written to an iframe (in a closed shadow root), and elements that appear in the iframe are placed into the light DOM.

Since the iframe is in the shadow DOM, I'm unsure how it reacts if the element is disconnected.

I'm not sure what happens if there's a `<base>` element in the output. But I'm also not sure what I think *should* happen.

Since the elements are created in an iframe, they'll have a prototype from the iframe. I think this means custom elements won't be upgraded.

Top-level script elements might be executing in the iframe rather than the document. Also Firefox doesn't execute the scripts in the parent document, which I believe is per spec.

It might be easier to load the document in an iframe that prevents additional requests and prevents script. Then, script outside the iframe could use mutation observers to watch the document load & then create identically named elements in the parent page. But then the implementation would have to recreate the behaviour of parser-inserted elements (when they differ from script-inserted elements).

# Seamless iframes

```html
<iframe src="…" seamless></iframe>
```

Part of the HTML spec, but [removed in 2016](https://github.com/whatwg/html/commit/1490eba4dba5ab476f0981443a86c01acae01311) due to lack of interest and complications to style computation.

Seamless iframes differed from regular iframes in roughly these ways:

* The height of the iframe would be dictated by the content of the framed document.
* Navigations would target the parent document rather than the iframe.
* Styles that target the iframe would apply to the framed document's document element.

But in terms of streaming content and events, they behave the same as regular iframes. Notably, they'll render in parallel.

# Client side include for HTML

Not a real feature, but a [feature request](https://github.com/whatwg/html/issues/2791).

```html
<include src="header.html"></include>
```

Although there are a lot of folks who want this, there's a lot of disagreement around how it should behave. Such as:

* Should `<include>` be replaced by the content it loads, or should loaded content go within?
* Should content go into include's shadow DOM? I don't see the benefit of this, but it's mentioned by a few folks.
* Should images & such be loaded relative to the parent document url, or the include url? I can't see how "include url" would work, but a lot of folks are wanting something like that.
* Should loading include content block the rendering of subsequent content?
* What would happen if the included content ended `<!--`? Some folks seems to want it to act exactly like SSI.
