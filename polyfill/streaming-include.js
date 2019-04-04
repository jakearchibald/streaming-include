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
  /** @type {AbortController | undefined} */
  _abortController;
  /** @type {Promise<void>} */
  _parsed = Promise.resolve();
  /** @type {(() => void)} */
  // @ts-ignore - This value is set in the promise constructor
  _connectedResolve;
  /** @type {Promise<void>} */
  _connected = new Promise(resolve => { this._connectedResolve = resolve; })

  /**
   * @this {HTMLStreamingIncludeElement}
   * @returns {void}
   */
  _initLoad = function startLoad() {
    if (this._abortController) this._abortController.abort();
    this.innerHTML = '';

    if (!this.hasAttribute('src')) {
      this._parsed = Promise.resolve();
      return;
    }

    // Catch invalid URLs:
    try {
      new URL(this.src);
    } catch (err) {
      this._parsed = Promise.reject(new TypeError());
      return;
    }

    const { signal } = this._abortController = new AbortController();
    const abortReject = new Promise((_, reject) => {
      signal.addEventListener('abort', () => reject(new DOMException('', 'AbortError')));
    });

    this._parsed = Promise.race([
      abortReject,
      (async () => {
        // This microtask not only waits for the element to be connected, but if it's already
        // connected it allows for multiple attribute/property changes to be rolled into one fetch.
        await this._connected;
        if (signal.aborted) return;

        const includeCredentials = this.crossOrigin === 'use-credentials';
        const response = await fetch(this.src, {
          signal,
          credentials: includeCredentials ? 'include' : 'same-origin'
        });

        const body = /** @type {ReadableStream<Uint8Array>} */(response.body);

        await body
          // @ts-ignore - Type checker doesn't know about TextDecoderStream.
          .pipeThrough(new TextDecoderStream())
          .pipeThrough(new HTMLParserStream())
          // @ts-ignore - Type checker doesn't know about the signal option.
          .pipeTo(new DOMWritable(this), { signal });
      })(),
    ]);
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
    if (newVal === null) {
      this.removeAttribute('crossorigin');
      return;
    }
    this.setAttribute('crossorigin', newVal);
  }

  /**
   * A promise that resolves once the response has been fully read and elements created. Rejects if
   * the fetch errors.
   *
   * @returns {Promise<void>}
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
    this._connectedResolve();
  }

  disconnectedCallback() {
    this._connected = new Promise(resolve => { this._connectedResolve = resolve; })
  }

  /**
   * @param {'src' | 'crossorigin'} name
   * @param {string | null} oldValue
   * @param {string | null} newValue
   */
  async attributeChangedCallback(name, oldValue, newValue) {
    if (name === 'src') {
      // Like <img>, any change to src triggers a load, even if the value is the same.
      this._initLoad();
      return;
    }

    if (name === 'crossorigin') {
      // Like <img>, crossorigin must change computed value to trigger a load.
      if (crossOriginAttrToProp(oldValue) !== crossOriginAttrToProp(newValue)) {
        this._initLoad();
      }
      return;
    }
  }
}

customElements.define('streaming-include', HTMLStreamingIncludeElement);
