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

export class DOMParserStream extends TransformStream {
  constructor() {
    /** @type {CloneMap<Node>} */
    const cloneMap = new WeakMap();
    const doc = document.implementation.createHTMLDocument();
    const cloneStartPoint = document.createElement('template').content;
    doc.write('<template>');

    const root = /** @type {HTMLTemplateElement} */ (doc.querySelector('template')).content;

    /** @type {TransformStreamDefaultController<ParserChunk>} */
    let controller;

    /**
     * @param {Node} node
     */
    function getRelatedClones(node) {
      const clone = /** @type {Node} */ (cloneMap.get(node));
      const parent = node.parentNode === root ? null : /** @type {(Node)} */(cloneMap.get(/** @type {(Node & ParentNode)} */(node.parentNode)));
      const nextSibling = node.nextSibling && /** @type {Node} */ (cloneMap.get(node.nextSibling));

      return { clone, parent, nextSibling };
    }

    /**
     * @param {Node} node
     * @returns {ParserChunk}
     */
    function getChunkForNode(node) {
      if (!cloneMap.has(node)) {
        const clone = node.cloneNode();
        cloneStartPoint.append(clone);
        cloneMap.set(node, clone);
      }

      const { clone, parent, nextSibling } = getRelatedClones(node);
      return new ParserChunk(clone, parent, nextSibling);
    }

    /**
     * @param {Text} node
     * @param {string} oldText
     * @returns {ParserChunk}
     */
    function getChunkForTextChange(node, oldText) {
      const additionalText = new Text(node.data.slice(oldText.length));
      const { parent, nextSibling } = getRelatedClones(node);

      cloneStartPoint.append(additionalText);
      return new ParserChunk(additionalText, parent, nextSibling);
    }

    new MutationObserver((entries) => {
      for (const entry of entries) {
        console.log(entry);
        for (const node of entry.addedNodes) controller.enqueue(getChunkForNode(node));
        if (entry.type == 'characterData') {
          controller.enqueue(
            getChunkForTextChange(/** @type {Text} */ (entry.target), /** @type {string} */ (entry.oldValue))
          );
        }
      }
    }).observe(root, {
      subtree: true,
      childList: true,
      characterData: true,
      characterDataOldValue: true,
    });

    super({
      start(c) { controller = c; },
      transform(chunk) {
        doc.write(chunk);
      },
      flush() {
        doc.close();
      }
    });
  }
}
