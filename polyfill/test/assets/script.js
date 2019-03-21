const scriptURL = new URL(document.currentScript.href);
self[scriptURL.searchParams.get('prop')] = true;
