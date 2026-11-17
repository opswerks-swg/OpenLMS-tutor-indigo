/**
 * Browse by Provider / Browse by Topic (/provider, /topics): the search box filters the cards
 * already on the page by name (case and accent insensitive). Without JavaScript every card stays
 * visible and the box does nothing.
 */
(function () {
  'use strict';

  function normalize(text) {
    return String(text || '')
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .trim();
  }

  /** Indexes of the names that contain the query; an empty query matches all. */
  function matchingIndexes(names, query) {
    var needle = normalize(query);
    var result = [];
    names.forEach(function (name, index) {
      if (!needle || normalize(name).indexOf(needle) !== -1) {
        result.push(index);
      }
    });
    return result;
  }

  function init() {
    var input = document.querySelector('[data-lw-browse-filter]');
    if (!input) { return; }
    var items = Array.prototype.slice.call(document.querySelectorAll('[data-lw-browse-name]'));
    var names = items.map(function (item) { return item.getAttribute('data-lw-browse-name'); });
    var status = document.querySelector('[data-lw-browse-no-match]');

    var grid = document.getElementById('lw-browse-grid');

    input.addEventListener('input', function () {
      var visible = matchingIndexes(names, input.value);
      var filtered = normalize(input.value).length > 0;
      var showNoMatch = filtered && visible.length === 0;

      items.forEach(function (item, index) {
        item.hidden = visible.indexOf(index) === -1;
      });

      if (status) {
        status.hidden = !showNoMatch;
      }
      if (grid) {
        grid.hidden = showNoMatch;
      }
    });
  }

  if (window.__LW_TEST__) {
    window.__LW_TEST__.browseFilter = { normalize: normalize, matchingIndexes: matchingIndexes };
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
}());
