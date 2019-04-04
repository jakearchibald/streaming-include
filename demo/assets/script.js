import '../../polyfill/streaming-include.js';

const content = document.querySelector('.content');
const fetchBtn = document.querySelector('.fetch');
const streamBtn = document.querySelector('.stream');

async function fetchContent() {
  content.innerHTML = '';
  const response = await fetch('assets/content.html');
  content.innerHTML = await response.text();
}

function streamContent() {
  content.innerHTML = '<streaming-include src="assets/content.html">';
}

fetchBtn.addEventListener('click', fetchContent);
streamBtn.addEventListener('click', streamContent);

const url = new URL(location);

if (url.searchParams.has('fetch')) {
  fetchContent();
} else if (url.searchParams.has('stream')) {
  streamContent();
}
