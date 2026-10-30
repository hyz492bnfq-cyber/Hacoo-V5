'use strict';

function productLinks(text = '') {
  return (String(text).match(/https?:\/\/[^\s<>"']+/giu) || [])
    .map(url => url.replace(/[),.!?]+$/g, ''))
    .filter(url => {
      try { const parsed = new URL(url); return parsed.protocol === 'https:' || parsed.protocol === 'http:'; } catch { return false; }
    });
}

function replaceProductLink(text, nextLink) {
  const source = String(text || '');
  const links = productLinks(source);
  if (!links.length) return source.trim() ? `${source}\n${nextLink}` : nextLink;
  return source.replace(links[0], nextLink);
}

module.exports = { productLinks, replaceProductLink };
