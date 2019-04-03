/**
 * @template {{}} T
 * @typedef {WeakMap<T, T>} CloneMap
 */

class ParserChunk {
  /**
   * @param node {Node}
   * @param parent {Node | null}
   * @param nextSibling {Node | null}
   */
  constructor(node, parent, nextSibling) {
    this.node = node;
    this.parent = parent;
    this.nextSibling = nextSibling;
  }
}

/**
 * @param {Node} node
 * @returns {Node}
 */
function cloneNode(node) {
  if (node.nodeName !== 'SCRIPT') return node.cloneNode();
  // Take a manual path for scripts, to avoid copying the "already started" flag
  // https://html.spec.whatwg.org/multipage/scripting.html#script-processing-model
  const originalScript = /** @type {HTMLScriptElement} */(/** @type {unknown} */(node));
  const script = document.createElementNS(
    /** @type {string} */ (originalScript.namespaceURI), originalScript.localName,
  );
  //const attributes = Array.from(originalScript.attributes);
  for (const attribute of originalScript.attributes) {
    script.attributes.setNamedItemNS(/** @type {Attr} */(attribute.cloneNode()));
  }

  return script;
}

/**
 * @extends {TransformStream<string, ParserChunk>}
 */
export class HTMLParserStream extends TransformStream {
  /** @type {CloneMap<Node>} */
  _cloneMap = new WeakMap();
  /** @type {Parameters<typeof HTMLParserStream['prototype']['_flushNode']> | undefined} */
  _bufferedEntry;
  _doc = document.implementation.createHTMLDocument();
  _root = this._doc.body;
  /** @type {Node[]} */
  _roots = [this._root];
  _cloneStartPoint = document.createElement('template').content;

  _observer = new MutationObserver((entries) => {
    /** @type {Set<Node>} */
    const removedNodes = new Set();

    for (const entry of entries) {
      for (const node of entry.removedNodes) {
        // Nodes are removed during parse errors, but will reappear later. They may be inserted
        // into a node that isn't currently in the document, so it won't reappear in addedNodes,
        // so we need to cater for that.
        removedNodes.add(node);
      }
      for (const node of entry.addedNodes) {
        removedNodes.delete(node);
        this._handleAddedNode(node, entry.target, entry.nextSibling);
      }
    }

    while (removedNodes.size) {
      for (const node of removedNodes) {
        // I don't think there's a case where removed nodes simply disappear, but just in case:
        if (!this._roots.some(root => root.contains(node))) {
          removedNodes.delete(node);
          continue;
        }

        // If we haven't added the parent or next sibling yet, leave it until a later iteration.
        if (
          removedNodes.has(/** @type {Node} */(node.parentNode)) ||
          (node.nextSibling && removedNodes.has(node.nextSibling))
        ) continue;

        this._handleAddedNode(node, node.parentNode, node.nextSibling);
        removedNodes.delete(node);
      }
    }
  });

  /**
   * @param {Node} node
   * @param {Node | null} parent
   * @param {Node | null} nextSibling
   */
  _flushNode(node, parent, nextSibling) {
    let isNewTemplate = false;

    if (!this._cloneMap.has(node)) {
      const clone = cloneNode(node);
      this._cloneStartPoint.append(clone);
      this._cloneMap.set(node, clone);

      if (clone instanceof HTMLTemplateElement) {
        isNewTemplate = true;
        this._cloneMap.set(/** @type {HTMLTemplateElement} */ (node).content, clone.content);
      }
    }

    this._controller.enqueue(
      new ParserChunk(
        /** @type {Node} */ (this._cloneMap.get(node)),
        !parent || parent === this._root ? null : /** @type {Node} */ (this._cloneMap.get(parent)),
        !nextSibling ? null : /** @type {Node} */ (this._cloneMap.get(nextSibling))
      )
    );

    if (isNewTemplate) this._handleAddedTemplate(/** @type {HTMLTemplateElement} */ (node));
  }

  /**
   * @param {Node} node
   * @param {Node | null} parent
   * @param {Node | null} nextSibling
   */
  _handleAddedNode(node, parent, nextSibling) {
    // Text nodes are buffered until the next node comes along. This means we know the text is
    // complete by the time we yield it, and we don't need to add more text to it.
    if (this._bufferedEntry) {
      this._flushNode(...this._bufferedEntry);
      this._bufferedEntry = undefined;
    }
    if (node.nodeType === 3) {
      this._bufferedEntry = [node, parent, nextSibling];
      return;
    }
    this._flushNode(node, parent, nextSibling);
  }

  /**
   * @param {HTMLTemplateElement} template
   */
  _handleAddedTemplate(template) {
    const nodeIttr = this._doc.createNodeIterator(template.content);
    let node;

    while (node = nodeIttr.nextNode()) {
      this._handleAddedNode(node, node.parentNode, null);
    }

    this._roots.push(template.content);
    this._observer.observe(template.content, { subtree: true, childList: true });
  }


  constructor() {
    super({
      start: (c) => { controller = c; },
      transform: (chunk) => { this._doc.write(chunk); },
      flush: () => {
        if (this._bufferedEntry) this._flushNode(...this._bufferedEntry);
        this._doc.close();
      }
    });

    /** @type {TransformStreamDefaultController<ParserChunk>} */
    var controller;
    // @ts-ignore
    this._controller = controller;

    this._doc.write('<!DOCTYPE html><body>');
    this._observer.observe(this._root, { subtree: true, childList: true });
  }
}

/**
 * @extends {WritableStream<ParserChunk>}
 */
export class DOMWritable extends WritableStream {
  /**
   * @param {Element} target
   */
  constructor(target) {
    super({
      write({ node, nextSibling, parent }) {
        (parent || target).insertBefore(node, nextSibling);
      }
    });
  }
}
