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
     * @param {Node | null} parent
     * @param {Node | null} nextSibling
     * @returns {ParserChunk}
     */
    function getChunkForNode(node, parent, nextSibling) {
      if (!cloneMap.has(node)) {
        const clone = node.cloneNode();
        cloneStartPoint.append(clone);
        cloneMap.set(node, clone);
      }

      return new ParserChunk(
        /** @type {Node} */ (cloneMap.get(node)),
        !parent || parent === root ? null : /** @type {Node} */ (cloneMap.get(parent)),
        !nextSibling ? null : /** @type {Node} */ (cloneMap.get(nextSibling))
      );
    }

    /**
     * @param {Text} node
     * @param {string} oldText
     * @param {Node | null} parent
     * @param {Node | null} nextSibling
     * @returns {ParserChunk}
     */
    function getChunkForTextChange(node, oldText, parent, nextSibling) {
      const additionalText = new Text(node.data.slice(oldText.length));
      cloneStartPoint.append(additionalText);

      return new ParserChunk(
        additionalText,
        !parent || parent === root ? null : /** @type {Node} */ (cloneMap.get(parent)),
        !nextSibling ? null : /** @type {Node} */ (cloneMap.get(nextSibling))
      );
    }

    new MutationObserver((entries) => {
      for (const entry of entries) {
        console.log('node', entry.addedNodes[0], 'parent', entry.target, 'removed', entry.removedNodes[0], 'nextSib', entry.nextSibling);
        for (const node of entry.addedNodes) controller.enqueue(getChunkForNode(node, entry.target, entry.nextSibling));
        if (entry.type == 'characterData') {
          controller.enqueue(
            getChunkForTextChange(/** @type {Text} */ (entry.target), /** @type {string} */ (entry.oldValue), entry.target, entry.nextSibling)
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
        console.log('parsed', root);
      }
    });
  }
}
