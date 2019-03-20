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
 * @extends {TransformStream<string, ParserChunk>}
 */
export class DOMParserStream extends TransformStream {
  constructor() {
    /** @type {CloneMap<Node>} */
    const cloneMap = new WeakMap();
    /** @type {Parameters<typeof flushNode> | undefined} */
    let bufferedEntry;
    const doc = document.implementation.createHTMLDocument();
    const cloneStartPoint = document.createElement('template').content;
    doc.write('<!DOCTYPE html><body>');
    const root = doc.body;
    /** @type {Node[]} */
    const roots = [root];

    /** @type {TransformStreamDefaultController<ParserChunk>} */
    let controller;

    /**
     * @param {Node} node
     * @param {Node | null} parent
     * @param {Node | null} nextSibling
     */
    function flushNode(node, parent, nextSibling) {
      let isNewTemplate = false;

      if (!cloneMap.has(node)) {
        const clone = node.cloneNode();
        cloneStartPoint.append(clone);
        cloneMap.set(node, clone);

        if (clone instanceof HTMLTemplateElement) {
          isNewTemplate = true;
          cloneMap.set(/** @type {HTMLTemplateElement} */ (node).content, clone.content);
        }
      }

      controller.enqueue(
        new ParserChunk(
          /** @type {Node} */ (cloneMap.get(node)),
          !parent || parent === root ? null : /** @type {Node} */ (cloneMap.get(parent)),
          !nextSibling ? null : /** @type {Node} */ (cloneMap.get(nextSibling))
        )
      );

      if (isNewTemplate) handleAddedTemplate(/** @type {HTMLTemplateElement} */ (node));
    }

    /**
     * @param {Node} node
     * @param {Node | null} parent
     * @param {Node | null} nextSibling
     */
    function handleAddedNode(node, parent, nextSibling) {
      // Text nodes are buffered until the next node comes along. This means we know the text is
      // complete by the time we yield it, and we don't need to add more text to it.
      if (bufferedEntry) {
        flushNode(...bufferedEntry);
        bufferedEntry = undefined;
      }
      if (node.nodeType === 3) {
        bufferedEntry = [node, parent, nextSibling];
        return;
      }
      flushNode(node, parent, nextSibling);
    }

    /**
     * @param {HTMLTemplateElement} template
     */
    function handleAddedTemplate(template) {
      const nodeIttr = doc.createNodeIterator(template.content);
      let node;

      while (node = nodeIttr.nextNode()) {
        handleAddedNode(node, node.parentNode, null);
      }

      roots.push(template.content);
      observer.observe(template.content, { subtree: true, childList: true });
    }

    const observer = new MutationObserver((entries) => {
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
          handleAddedNode(node, entry.target, entry.nextSibling);
        }
      }

      while (removedNodes.size) {
        for (const node of removedNodes) {
          // I don't think there's a case where removed nodes simply disappear, but just in case:
          if (!roots.some(root => root.contains(node))) {
            removedNodes.delete(node);
            continue;
          }

          // If we haven't added the parent or next sibling yet, leave it until a later iteration.
          if (
            removedNodes.has(/** @type {Node} */(node.parentNode)) ||
            (node.nextSibling && removedNodes.has(node.nextSibling))
          ) continue;

          handleAddedNode(node, node.parentNode, node.nextSibling);
          removedNodes.delete(node);
        }
      }
    });

    observer.observe(root, { subtree: true, childList: true });

    super({
      start(c) { controller = c; },
      transform(chunk) { doc.write(chunk); },
      flush() {
        if (bufferedEntry) flushNode(...bufferedEntry);
        doc.close();
      }
    });
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
