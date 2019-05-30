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
 * @param {string} url
 * @param {Element} target
 */
export default async function noStreamsSolution(url, target) {
  /** @type {CloneMap<Node>} */
  const cloneMap = new WeakMap();
  /** @type {Parameters<typeof HTMLParserStream['prototype']['_flushNode']> | undefined} */
  let bufferedEntry;
  const doc = document.implementation.createHTMLDocument();
  doc.write('<!DOCTYPE html><body>');
  const root = doc.body;
  /** @type {Node[]} */
  const roots = [root];
  const cloneStartPoint = document.createElement('template').content;

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

  /**
   * @this {HTMLParserStream}
   * @param {Node} node
   * @param {Node | null} parent
   * @param {Node | null} nextSibling
   */
  function flushNode(node, parent, nextSibling) {
    let isNewTemplate = false;

    if (!cloneMap.has(node)) {
      const clone = cloneNode(node);
      cloneStartPoint.append(clone);
      cloneMap.set(node, clone);

      if (clone instanceof HTMLTemplateElement) {
        isNewTemplate = true;
        cloneMap.set(/** @type {HTMLTemplateElement} */ (node).content, clone.content);
      }
    }

    enqueueChunk(
      new ParserChunk(
        /** @type {Node} */ (cloneMap.get(node)),
        !parent || parent === root ? null : /** @type {Node} */ (cloneMap.get(parent)),
        !nextSibling ? null : /** @type {Node} */ (cloneMap.get(nextSibling))
      )
    );

    if (isNewTemplate) handleAddedTemplate(/** @type {HTMLTemplateElement} */ (node));
  }

  /**
   * @this {HTMLParserStream}
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
      // @ts-ignore
      bufferedEntry = [node, parent, nextSibling];
      return;
    }
    flushNode(node, parent, nextSibling);
  }

  /**
   * @this {HTMLParserStream}
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

  /**
   * @param {ParserChunk} chunk
   */
  function enqueueChunk({ node, nextSibling, parent }) {
    (parent || target).insertBefore(node, nextSibling);
  }

  // TODO: transform
  // TODO: flush

  doc.write('<!DOCTYPE html><body>');
  observer.observe(root, { subtree: true, childList: true });

  const response = await fetch(url);
  const decoder = new TextDecoder();
  const reader = response.body.getReader();

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    doc.write(decoder.decode(value, { stream: true }));
  }

  if (bufferedEntry) flushNode(...bufferedEntry);
  doc.close();
}
