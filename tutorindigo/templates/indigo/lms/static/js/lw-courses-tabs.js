/**
 * Learning Library on /courses (Figma 662:236 — tabs, section, empty state).
 * Loads server-filtered collections from GET /api/openlms/library/ and renders .lw-course-card shells.
 */
(function () {
  'use strict';

  var LIBRARY_URL = '/api/openlms/library/';
  var VALID_TABS = ['continue', 'assigned', 'suggested', 'new', 'mylist'];

  var gettext = window.gettext || function (s) { return s; };
  var interpolate = window.interpolate || function (fmt, values) {
    return fmt.replace(/%\((\w+)\)s/g, function (match, key) { return values[key]; });
  };

  var EMPTY_CONFIG = {
    continue: {
      title: gettext('No ongoing courses.'),
      body: gettext('Browse available courses to find what interests you!'),
      showDiscoverCta: true,
    },
    assigned: {
      title: gettext('No assigned courses.'),
      body: gettext('When courses are assigned to you, they will appear here.'),
      showDiscoverCta: false,
    },
    suggested: {
      title: gettext('No suggested courses yet.'),
      body: gettext('Suggestions will appear based on your role and learning activity.'),
      showDiscoverCta: true,
    },
    new: {
      title: gettext('No new courses.'),
      body: gettext('There are no courses published in the last 30 days.'),
      showDiscoverCta: true,
    },
    mylist: {
      title: gettext('Your list is empty.'),
      body: gettext('Save courses from a card to find them here later.'),
      showDiscoverCta: true,
    },
  };

  var PAGE_SIZE = 20;

  var state = {
    tab: 'continue',
    page: 1,
    // Incremented per fetch; only the newest response may render (see fetchTab).
    requestId: 0,
  };

  var HTML_ESCAPES = {
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  };

  // Safe in text and in quoted attributes (cardHtml puts API fields in both).
  function escapeHtml(value) {
    return (value == null ? '' : String(value)).replace(/[&<>"']/g, function (ch) {
      return HTML_ESCAPES[ch];
    });
  }

  function getJson(url) {
    return fetch(url, { credentials: 'same-origin', headers: { Accept: 'application/json' } })
      .then(function (response) {
        if (!response.ok) {
          throw new Error('library_fetch_failed');
        }
        return response.json();
      });
  }

  function tabFromQuery() {
    var tab = new URLSearchParams(window.location.search).get('tab');
    return VALID_TABS.indexOf(tab) >= 0 ? tab : 'continue';
  }

  function setQueryTab(tab) {
    var params = new URLSearchParams(window.location.search);
    params.set('tab', tab);
    var query = params.toString();
    var nextUrl = window.location.pathname + (query ? '?' + query : '');
    window.history.replaceState({}, '', nextUrl);
  }

  function cardHtml(row) {
    var courseId = escapeHtml(row.courseId);
    var title = escapeHtml(row.title);
    var imageUrl = escapeHtml(row.imageUrl || '');
    var aboutUrl = escapeHtml(row.url || ('/courses/' + row.courseId + '/about'));
    var org = escapeHtml(row.org || '');
    var description = row.shortDescription ? '<p class="lw-course-card__description">' + escapeHtml(row.shortDescription) + '</p>' : '';
    var courseEnd = escapeHtml(row.courseEnd || '');
    var providerLabel = interpolate(gettext('By %(provider_name)s'), { provider_name: org }, true);

    return (
      '<article class="lw-course-card" aria-label="' + title + '"'
      + ' data-course-id="' + courseId + '" data-course-end="' + courseEnd + '">'
      + '<div class="lw-course-card__image">'
      + '<img src="' + imageUrl + '" alt="" loading="lazy"'
      + ' onerror="this.onerror=null;this.src=\'/theming/asset/images/no_course_image.png\';" />'
      + '<span class="lw-course-card__badge" data-lw="badge" hidden></span>'
      + '</div>'
      + '<div class="lw-course-card__body">'
      + '<div class="lw-course-card__meta">'
      + '<div class="lw-course-card__heading">'
      + '<div class="lw-course-card__title-row">'
      + '<h3 class="lw-course-card__title"><a href="' + aboutUrl + '">' + title + '</a></h3>'
      + '<span class="lw-course-card__rating" data-lw="rating" hidden>'
      + '<span class="lw-icon lw-icon--star" aria-hidden="true"></span>'
      + '<span aria-hidden="true" data-lw="rating-value"></span>'
      + '<span class="lw-sr-only" data-lw="rating-summary"></span>'
      + '</span>'
      + '</div>'
      + '<span class="lw-course-card__provider" data-lw="provider">' + providerLabel + '</span>'
      + '</div>'
      + description
      + '<div class="lw-course-card__chips">'
      + '<span class="lw-course-card__chip" data-lw="content-type" hidden></span>'
      + '<span class="lw-course-card__chip-plain" data-lw="duration-chip" hidden>'
      + '<span class="lw-icon lw-icon--clock" aria-hidden="true"></span>'
      + '<span data-lw="duration"></span>'
      + '</span>'
      + '<span class="lw-course-card__chip-plain" data-lw="due" hidden>'
      + '<span class="lw-icon lw-icon--hourglass" aria-hidden="true"></span>'
      + '<span data-lw="due-text"></span>'
      + '</span></div>'
      + '<p class="lw-course-card__status-line" data-lw="overdue" hidden></p>'
      + '</div>'
      + '<div class="lw-course-card__bottom">'
      + '<div class="lw-course-card__progress" data-lw="progress" hidden>'
      + '<div class="lw-course-card__progress-label">'
      + '<span>' + gettext('In Progress') + '</span>'
      + '<span class="lw-course-card__progress-value" data-lw="progress-value"></span>'
      + '</div>'
      + '<div class="lw-course-card__progress-track" role="progressbar" aria-label="' + gettext('Course progress') + '"'
      + ' aria-valuemin="0" aria-valuemax="100" data-lw="progress-track">'
      + '<div class="lw-course-card__progress-bar" data-lw="progress-bar"></div>'
      + '</div></div>'
      + '<div class="lw-course-card__actions">'
      + '<a class="lw-course-card__cta" href="' + aboutUrl + '" data-lw="cta">'
      + '<span class="lw-icon lw-icon--play" aria-hidden="true" data-lw="cta-icon" hidden></span>'
      + '<span data-lw="cta-label">' + gettext('View Course') + '</span>'
      + '</a>'
      // Actions menu (learner dashboard CourseCardMenu); lw-course-cards.js shows it to
      // signed-in learners, with "Rate this course" and "Unenroll" for enrolled ones only.
      + '<div class="lw-course-card__menu" data-lw="menu" hidden>'
      + '<button type="button" class="lw-course-card__menu-toggle" aria-haspopup="true" aria-expanded="false"'
      + ' aria-label="' + escapeHtml(gettext('Course actions dropdown')) + '" data-lw="menu-toggle">'
      + '<span class="lw-icon lw-icon--more" aria-hidden="true"></span>'
      + '</button>'
      + '<ul class="lw-course-card__menu-list" role="menu" data-lw="menu-list" hidden>'
      + '<li role="none"><button type="button" class="lw-course-card__menu-item" role="menuitem"'
      + ' data-lw-action="my-list" data-lw="my-list-item">' + escapeHtml(gettext('Add to my list')) + '</button></li>'
      + '<li role="none" data-lw="rate-item"><button type="button" class="lw-course-card__menu-item" role="menuitem" data-lw-action="rate">'
      + escapeHtml(gettext('Rate this course')) + '</button></li>'
      + '<li role="none" data-lw="unenroll-item"><button type="button" class="lw-course-card__menu-item" role="menuitem" data-lw-action="unenroll">'
      + escapeHtml(gettext('Unenroll')) + '</button></li>'
      + '<li role="none" data-lw="share-facebook-item" hidden><button type="button" class="lw-course-card__menu-item" role="menuitem"'
      + ' data-lw-action="share" data-lw-site="facebook">' + escapeHtml(gettext('Share to Facebook')) + '</button></li>'
      + '<li role="none" data-lw="share-twitter-item" hidden><button type="button" class="lw-course-card__menu-item" role="menuitem"'
      + ' data-lw-action="share" data-lw-site="twitter">' + escapeHtml(gettext('Share to Twitter')) + '</button></li>'
      + '</ul></div>'
      + '</div></div></div></article>'
    );
  }

  function renderList(rows) {
    var list = document.getElementById('lw-courses-listing');
    if (!list) { return; }
    list.innerHTML = rows.map(function (row) {
      return '<li class="courses-listing-item">' + cardHtml(row) + '</li>';
    }).join('');
  }

  function setActiveTab(tab) {
    var tabs = document.querySelectorAll('.lw-courses-tabs__tab');
    tabs.forEach(function (button) {
      var isActive = button.getAttribute('data-tab') === tab;
      button.classList.toggle('lw-courses-tabs__tab--active', isActive);
      button.setAttribute('aria-selected', isActive ? 'true' : 'false');
      // Roving tabindex: Tab enters the tablist on the active tab; arrows move between tabs.
      button.setAttribute('tabindex', isActive ? '0' : '-1');
    });
    var activeButton = document.querySelector('.lw-courses-tabs__tab[data-tab="' + tab + '"]');
    var heading = document.getElementById('lw-courses-section-title');
    if (activeButton && heading) {
      heading.textContent = activeButton.getAttribute('data-heading') || heading.textContent;
    }
  }

  function setMessage(text, visible) {
    var message = document.querySelector('[data-lw-library="message"]');
    if (!message) { return; }
    message.textContent = text || '';
    message.hidden = !visible;
  }

  function setEmptyState(tab, visible) {
    var holder = document.querySelector('.lw-courses-library');
    var block = document.querySelector('[data-lw-library="empty"]');
    if (!block) { return; }

    var config = EMPTY_CONFIG[tab] || EMPTY_CONFIG.continue;
    var titleEl = block.querySelector('[data-lw-empty="title"]');
    var bodyEl = block.querySelector('[data-lw-empty="body"]');
    var ctaEl = block.querySelector('[data-lw-empty="cta"]');

    if (titleEl) { titleEl.textContent = config.title; }
    if (bodyEl) { bodyEl.textContent = config.body; }
    if (ctaEl) {
      var discoverUrl = (holder && holder.getAttribute('data-discover-url')) || '/search';
      ctaEl.setAttribute('href', discoverUrl);
      ctaEl.hidden = !config.showDiscoverCta;
    }

    block.hidden = !visible;
    if (holder) {
      holder.classList.toggle('lw-courses-library--has-empty', visible);
    }
    var container = document.querySelector('.courses-container');
    if (container) {
      container.classList.toggle('lw-courses-container--empty', visible);
    }
    if (visible) {
      setMessage('', false);
    }
  }

  // Page numbers to render: all when few, else first/last + a window around the current page.
  function pageItems(current, total) {
    if (total <= 7) {
      var all = [];
      for (var n = 1; n <= total; n += 1) { all.push(n); }
      return all;
    }
    var items = [1];
    var start = Math.max(2, current - 1);
    var end = Math.min(total - 1, current + 1);
    if (start > 2) { items.push(null); }
    for (var i = start; i <= end; i += 1) { items.push(i); }
    if (end < total - 1) { items.push(null); }
    items.push(total);
    return items;
  }

  // Always shown when the tab has results (a lone "1" on single-page tabs, Figma pager).
  function renderPagination(data, shownCount) {
    var holder = document.querySelector('[data-lw-library="pagination"]');
    if (!holder) { return; }
    if (!data || !shownCount) {
      holder.hidden = true;
      return;
    }

    var page = Number(data.page) || state.page;
    var pageSize = Number(data.pageSize) || PAGE_SIZE;
    var count = Number(data.count);
    var totalPages = count > 0
      ? Math.max(1, Math.ceil(count / pageSize))
      : page + (data.next ? 1 : 0);
    if (!(count > 0)) { count = shownCount; }

    var summary = holder.querySelector('[data-lw-pagination="summary"]');
    if (summary) {
      summary.textContent = interpolate(
        gettext('Showing %(shown)s of %(total)s items'),
        { shown: shownCount, total: count },
        true
      );
    }

    var list = holder.querySelector('[data-lw-pagination="pages"]');
    if (list) {
      list.innerHTML = pageItems(page, totalPages).map(function (n) {
        if (n === null) {
          return '<li class="lw-courses-pagination__ellipsis" aria-hidden="true">&hellip;</li>';
        }
        var isCurrent = n === page;
        return '<li><button type="button" class="lw-courses-pagination__page'
          + (isCurrent ? ' lw-courses-pagination__page--active' : '') + '"'
          + ' data-page="' + n + '"'
          + ' aria-label="' + escapeHtml(interpolate(gettext('Page %(page)s'), { page: n }, true)) + '"'
          + (isCurrent ? ' aria-current="page"' : '')
          + '>' + n + '</button></li>';
      }).join('');
    }
    holder.hidden = false;
  }

  function setLoading(loading) {
    var holder = document.querySelector('.lw-courses-library');
    if (holder) {
      holder.classList.toggle('lw-courses-library--loading', loading);
    }
  }

  function enhanceCards() {
    var holder = document.querySelector('.lw-courses-library');
    if (holder && typeof window.lwCourseCardsEnhance === 'function') {
      window.lwCourseCardsEnhance(holder);
    }
  }

  // Resolves to true when this response was rendered, false when a newer request superseded it.
  function fetchTab(tab, page) {
    var requestId = ++state.requestId;
    var isCurrent = function () { return requestId === state.requestId; };
    setLoading(true);
    setMessage('', false);

    var url = LIBRARY_URL + '?tab=' + encodeURIComponent(tab)
      + '&page=' + encodeURIComponent(String(page))
      + '&page_size=' + PAGE_SIZE;

    return getJson(url).then(function (data) {
      if (!isCurrent()) { return false; }
      var results = Array.isArray(data.results) ? data.results : [];
      // The page emptied under us (e.g. its last My List course was removed): step back.
      if (!results.length && page > 1) { return fetchTab(tab, page - 1); }
      state.page = Number(data.page) || page;
      renderList(results);
      setEmptyState(tab, !results.length);
      renderPagination(data, results.length);
      enhanceCards();
      return true;
    }).catch(function () {
      if (!isCurrent()) { return false; }
      renderList([]);
      setEmptyState(tab, false);
      setMessage(gettext('Unable to load courses. Please try again.'), true);
      renderPagination(null, 0);
      return true;
    }).finally(function () {
      if (isCurrent()) { setLoading(false); }
    });
  }

  function selectTab(tab, options) {
    var opts = options || {};
    if (VALID_TABS.indexOf(tab) < 0) { tab = 'continue'; }
    state.tab = tab;
    state.page = 1;
    setActiveTab(tab);
    setQueryTab(tab);
    return fetchTab(tab, 1).then(function (rendered) {
      if (rendered && !opts.silentFocus && document.getElementById('lw-courses-panel')) {
        document.getElementById('lw-courses-panel').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      }
    });
  }

  function init() {
    var tablist = document.querySelector('.lw-courses-tabs');

    // lw-course-cards.js fires this after "Add to / Remove from my list"; keep the My List
    // tab in step with it (a removed course leaves the list, the pager recounts).
    document.addEventListener('lw:my-list-changed', function () {
      if (state.tab === 'mylist') { fetchTab('mylist', state.page); }
    });
    // After an unenroll, reload the open tab so the course leaves Continue Learning and the
    // cards' progress and buttons are redrawn from fresh enrollment data.
    document.addEventListener('lw:enrollment-changed', function () {
      fetchTab(state.tab, state.page).then(function (rendered) {
        // The card whose menu had focus was just replaced; keep focus in the section.
        var heading = document.getElementById('lw-courses-section-title');
        if (rendered && heading) { heading.focus(); }
      });
    });
    var list = document.getElementById('lw-courses-listing');
    if (!tablist || !list) { return; }

    // Default Continue empty state (Figma 662:236) until the library API responds.
    setEmptyState('continue', true);

    tablist.addEventListener('click', function (event) {
      var button = event.target.closest('.lw-courses-tabs__tab');
      if (!button || !tablist.contains(button)) { return; }
      var tab = button.getAttribute('data-tab');
      if (tab && tab !== state.tab) {
        selectTab(tab, { silentFocus: true });
      }
    });

    // Arrow/Home/End move focus between tabs; Enter/Space are native button clicks.
    tablist.addEventListener('keydown', function (event) {
      var tabs = Array.prototype.slice.call(tablist.querySelectorAll('.lw-courses-tabs__tab'));
      var index = tabs.indexOf(document.activeElement);
      if (index < 0) { return; }
      var nextIndex = index;
      if (event.key === 'ArrowRight') {
        nextIndex = (index + 1) % tabs.length;
      } else if (event.key === 'ArrowLeft') {
        nextIndex = (index - 1 + tabs.length) % tabs.length;
      } else if (event.key === 'Home') {
        nextIndex = 0;
      } else if (event.key === 'End') {
        nextIndex = tabs.length - 1;
      } else {
        return;
      }
      event.preventDefault();
      tabs[nextIndex].focus();
    });

    var pagination = document.querySelector('[data-lw-library="pagination"]');
    if (pagination) {
      pagination.addEventListener('click', function (event) {
        var button = event.target.closest('.lw-courses-pagination__page');
        if (!button || !pagination.contains(button)) { return; }
        var page = parseInt(button.getAttribute('data-page'), 10);
        if (!page || page === state.page) { return; }
        fetchTab(state.tab, page).then(function (rendered) {
          var panel = document.getElementById('lw-courses-panel');
          if (rendered && panel) { panel.scrollIntoView({ behavior: 'smooth', block: 'start' }); }
        });
      });
    }

    selectTab(tabFromQuery(), { silentFocus: true });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
}());
