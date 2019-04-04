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
  _loadQueued = false;
  _loadOnConnect = false;
  /** @type {AbortController | undefined} */
  _abortController;

  /**
   * @this {HTMLStreamingIncludeElement}
   * @returns {Promise<void>}
   */
  _startLoad = async function startLoad() {
    if (this._loadQueued) return;
    this._loadQueued = true;
    this._loadOnConnect = false;

    // Wait for a microtask to pick up multiple attribute changes, and so 'loadstart' doesn't fire
    // synchronously
    await undefined;

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
    if (newVal === null) {
      this.removeAttribute('crossorigin');
      return;
    }
    this.setAttribute('crossorigin', newVal);
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
    if (this._loadOnConnect) this._startLoad();
  }

  /**
   * @param {'src' | 'crossorigin'} name
   * @param {string | null} oldValue
   * @param {string | null} newValue
   */
  async attributeChangedCallback(name, oldValue, newValue) {
    let shouldTriggerLoad = false;

    if (name === 'src') {
      // Like <img>, any change to src triggers a load, even if the value is the same.
      shouldTriggerLoad = true;
    } else if (name === 'crossorigin') {
      // Like <img>, crossorigin must change computed value to trigger a load.
      if (crossOriginAttrToProp(oldValue) !== crossOriginAttrToProp(newValue)) {
        shouldTriggerLoad = true;
      }
    }

    if (!shouldTriggerLoad) return;

    if (!this.isConnected) {
      this._loadOnConnect = true;
      return;
    }

    this._startLoad();
  }
}

customElements.define('streaming-include', HTMLStreamingIncludeElement);
