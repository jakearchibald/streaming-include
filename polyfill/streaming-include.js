import { HTMLParserStream, DOMWritable } from './index.js';

const observedAttributes = Object.freeze(['src', 'crossorigin']);

/**
 * @param {string | null} attrVal
 * @returns {'use-credentials' | 'anonymous'}
 */
function crossOriginAttrToProp(attrVal) {
  // https://html.spec.whatwg.org/multipage/common-dom-interfaces.html#reflect
  if (attrVal && attrVal.toLowerCase() === 'use-credentials') return 'use-credentials';
  return 'anonymous';
}

export default class HTMLStreamingIncludeElement extends HTMLElement {
  static get observedAttributes() { return observedAttributes; }
  _parsed = Promise.resolve();
  _loadPending = false;
  /** @type {AbortController | undefined} */
  _abortController;

  /**
   * @this {HTMLStreamingIncludeElement}
   * @returns {void}
   */
  _startLoad = function startLoad() {
    this._loadPending = false;
    /** @type {string} */
    let url;

    try {
      url = new URL(this.src).href;
    } catch (err) {
      return;
    }

    if (this._abortController) this._abortController.abort();

    const includeCredentials = this.crossOrigin === 'use-credentials';
    const { signal } = this._abortController = new AbortController();

    this._parsed = fetch(url, {
      signal,
      credentials: includeCredentials ? 'include' : 'same-origin'
    }).then(async (response) => {
      // Clear current content
      this.innerHTML = '';
      const body = /** @type {ReadableStream<Uint8Array>} */(response.body);

      await body
        // @ts-ignore - Type checker doesn't know about TextDecoderStream.
        .pipeThrough(new TextDecoderStream())
        .pipeThrough(new HTMLParserStream())
        // @ts-ignore - Type checker doesn't know about the signal option.
        .pipeTo(new DOMWritable(this), { signal });
    });

    this.dispatchEvent(new Event('loadstart'));
  };

  /** @type {string} */
  get src() {
    // https://html.spec.whatwg.org/multipage/common-dom-interfaces.html#reflect
    const attr = this.getAttribute('src');
    if (attr === null) return '';
    try {
      const url = new URL(attr, location.href);
      return url.href;
    } catch (err) {
      return attr;
    }
  }

  set src(newVal) {
    this.setAttribute('src', newVal);
  }

  /** @type {'anonymous' | 'use-credentials'} */
  get crossOrigin() {
    return crossOriginAttrToProp(this.getAttribute('crossorigin'));
  }

  set crossOrigin(newVal) {
    this.setAttribute('src', newVal);
  }

  /**
   * A promise that resolves once the response has been fully read and elements created. Rejects if
   * the fetch errors.
   */
  get parsed() {
    return this._parsed;
  }

  /**
   * Abort the current fetch (if any)
   */
  abort() {
    if (this._abortController) this._abortController.abort();
  }

  connectedCallback() {
    if (this._loadPending) this._startLoad();
  }

  /**
   * @param {'src' | 'crossorigin'} name
   * @param {string | null} oldValue
   * @param {string | null} newValue
   */
  async attributeChangedCallback(name, oldValue, newValue) {
    if (this._loadPending) return;

    if (name === 'src') {
      // Like <img>, any change to src triggers a load, even if the value is the same.
      this._loadPending = true;
    } else if (name === 'crossorigin') {
      // Like <img>, crossorigin must change computed value to trigger a load.
      if (crossOriginAttrToProp(oldValue) !== crossOriginAttrToProp(newValue)) {
        this._loadPending = true;
      }
    }

    // Wait a microtask to collect multiple changes
    await undefined;
    if (this.isConnected) this._startLoad();
  }
}

customElements.define('streaming-include', HTMLStreamingIncludeElement);
