/* js/image-fallback.js — graceful fallback for broken images.
 * The herb-encyclopedia images (/310519663508836609/.../herb-*.jpg) currently 404.
 * Rather than show broken-image icons, swap any failed <img> for an on-brand
 * botanical placeholder so the page still feels finished. Safe + self-contained.
 */
(function () {
  'use strict';
  var PLACEHOLDER = 'data:image/svg+xml;utf8,' + encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" width="400" height="400" viewBox="0 0 400 400">' +
    '<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">' +
    '<stop offset="0" stop-color="#2a1a4a"/><stop offset="1" stop-color="#0f0b18"/></linearGradient></defs>' +
    '<rect width="400" height="400" fill="url(#g)"/>' +
    '<circle cx="200" cy="170" r="78" fill="none" stroke="#c9a84c" stroke-opacity="0.5" stroke-width="2"/>' +
    '<text x="200" y="186" font-size="64" text-anchor="middle" fill="#c9a84c" fill-opacity="0.7" font-family="Georgia,serif">&#10022;</text>' +
    '<text x="200" y="290" font-size="20" text-anchor="middle" fill="#8a7a65" font-family="Georgia,serif">Amber&#39;s Alchemy</text>' +
    '<text x="200" y="316" font-size="14" text-anchor="middle" fill="#6f6457" font-family="Georgia,serif">botanical illustration</text>' +
    '</svg>'
  );
  function fix(img) {
    if (!img || img.dataset.aaFallback) return;
    img.dataset.aaFallback = '1';
    img.src = PLACEHOLDER;
    img.style.objectFit = 'cover';
  }
  // Catch load failures as they happen (capture phase — error events don't bubble).
  document.addEventListener('error', function (e) {
    var t = e.target;
    if (t && t.tagName === 'IMG') fix(t);
  }, true);
  // Catch images that already failed before this script ran, and any added later.
  function sweep(root) {
    (root || document).querySelectorAll('img').forEach(function (img) {
      if (img.complete && img.naturalWidth === 0 && img.src) fix(img);
    });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', function () { sweep(); });
  else sweep();
  // Re-sweep periodically for dynamically rendered herb cards.
  var n = 0, iv = setInterval(function () { sweep(); if (++n > 10) clearInterval(iv); }, 800);
})();
