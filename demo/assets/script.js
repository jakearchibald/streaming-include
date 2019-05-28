import '../../polyfill/streaming-include.js';

const content = document.querySelector('.content');
const fetchBtn = document.querySelector('.fetch');
const streamBtn = document.querySelector('.stream');
const naiveBtn = document.querySelector('.naive');

async function fetchContent() {
  content.innerHTML = '';
  const response = await fetch('assets/content.html');
  content.innerHTML = await response.text();
}

function streamContent() {
  content.innerHTML = '<streaming-include src="assets/content.html">';
}

async function naiveStreamContent() {
  const responsePromise = fetch('assets/content.html');
  const doc = document.implementation.createHTMLDocument();
  doc.write('<fake-el>');
  content.append(doc.querySelector('fake-el'));
  const response = await responsePromise;
  const stream = response.body.pipeThrough(new TextDecoderStream());
  const reader = stream.getReader();

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    doc.write(value);
  }

  doc.write('</fake-el>');
  doc.close();
}

fetchBtn.addEventListener('click', fetchContent);
streamBtn.addEventListener('click', streamContent);
naiveBtn.addEventListener('click', naiveStreamContent);

const url = new URL(location);

if (url.searchParams.has('fetch')) {
  fetchContent();
} else if (url.searchParams.has('stream')) {
  streamContent();
}
