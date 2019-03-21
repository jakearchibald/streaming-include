{
  const scriptURL = new URL(document.currentScript.src);
  self[scriptURL.searchParams.get('prop')] = true;
}
