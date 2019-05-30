import '../../polyfill/streaming-include.js';
import noStreamsSolution from './no-streams-solution.js';

const content = document.querySelector('.content');
const fetchBtn = document.querySelector('.fetch');
const streamBtn = document.querySelector('.stream');
const noStreamBtn = document.querySelector('.no-stream');
const naiveBtn = document.querySelector('.naive');

const url = 'assets/content.html';

async function fetchContent() {
  content.innerHTML = '';
  const response = await fetch(url);
  content.innerHTML = await response.text();
}

function streamContent() {
  content.innerHTML = `<streaming-include src="${url}">`;
}

async function naiveStreamContent() {
  const responsePromise = fetch(url);
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

function noStreamContent() {
  noStreamsSolution(url, content);
}

fetchBtn.addEventListener('click', fetchContent);
streamBtn.addEventListener('click', streamContent);
naiveBtn.addEventListener('click', naiveStreamContent);
noStreamBtn.addEventListener('click', noStreamContent);

self.api = {
  fetchContent,
  streamContent,
  naiveStreamContent,
  noStreamContent,
  navigate() {
    location.href = 'navigate.html';
  }
};
