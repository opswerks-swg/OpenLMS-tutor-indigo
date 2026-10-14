/**
 * /courses: fills the learner-specific parts of .lw-course-card the same way the learner
 * dashboard CourseCard does (src/utils/dueDate.js resolveDueInfo, CourseCardMeta/hooks.js):
 *
 *  - GET /api/openlms/course-completion/      enrolled courses + completion %
 *  - GET /api/course_assignments/v1/card-info/ provider, content type, duration, assignment due
 *
 * Enrolled + started  -> "In Progress" bar + Resume
 * Enrolled, 0%        -> Enroll and Start (learner dashboard BeginCourseButton label)
 * Not enrolled        -> View Course (about page), no progress
 *
 * lw-courses-tabs.js calls window.lwCourseCardsEnhance after each render.
 * Anonymous users get 401s and keep the catalog card.
 */
(function () {
  'use strict';

  var DUE_SOON_WINDOW_DAYS = 7;
  var MS_PER_DAY = 1000 * 60 * 60 * 24;
  var COMPLETION_URL = '/api/openlms/course-completion/';
  var CARD_INFO_URL = '/api/course_assignments/v1/card-info/';

  var gettext = window.gettext || function (s) { return s; };
  var ngettext = window.ngettext || function (s, p, n) { return n === 1 ? s : p; };
  var interpolate = function (fmt, values) {
    return fmt.replace(/%\((\w+)\)s/g, function (match, key) { return values[key]; });
  };

  function getJson(url) {
    return fetch(url, { credentials: 'same-origin', headers: { Accept: 'application/json' } })
      .then(function (response) { return response.ok ? response.json() : null; })
      .catch(function () { return null; });
  }

  // One request per page: every active enrollment with its completion %.
  var completionPromise = null;
  function getCompletionById() {
    if (!completionPromise) {
      completionPromise = getJson(COMPLETION_URL).then(function (rows) {
        var byId = {};
        (Array.isArray(rows) ? rows : []).forEach(function (row) {
          byId[row.courseId] = row;
        });
        return byId;
      });
    }
    return completionPromise;
  }

  // Card info is cached per course id as a promise, so a card rendered while its request
  // is still in flight waits for it. Only ids not requested yet are fetched.
  var cardInfoRequests = {};
  function loadCardInfo(courseIds) {
    var missing = courseIds.filter(function (id) { return !(id in cardInfoRequests); });
    if (missing.length) {
      var query = missing.map(function (id) { return 'course_id=' + encodeURIComponent(id); }).join('&');
      var request = getJson(CARD_INFO_URL + '?' + query).then(function (data) {
        var byId = {};
        ((data && data.results) || []).forEach(function (info) { byId[info.course_id] = info; });
        return byId;
      });
      missing.forEach(function (id) {
        cardInfoRequests[id] = request.then(function (byId) { return byId[id] || null; });
      });
    }
    return Promise.all(courseIds.map(function (id) { return cardInfoRequests[id]; }))
      .then(function (infos) {
        var cardInfoById = {};
        courseIds.forEach(function (id, index) { cardInfoById[id] = infos[index]; });
        return cardInfoById;
      });
  }

  // Calendar day, as the learner dashboard parseDateOnly reads due and end dates.
  function parseDateOnly(value) {
    if (!value) { return null; }
    var parts = String(value).split('T')[0].split('-').map(Number);
    if (parts.length !== 3 || parts.some(isNaN)) { return new Date(value); }
    return new Date(parts[0], parts[1] - 1, parts[2]);
  }

  function daysUntil(date, now) {
    return Math.ceil((date.getTime() - now) / MS_PER_DAY);
  }

  function formatShortDate(date) {
    var lang = document.documentElement.lang || undefined;
    return date.toLocaleDateString(lang, { month: 'short', day: 'numeric', year: 'numeric' });
  }

  function toIsoDay(date) {
    var pad = function (n) { return (n < 10 ? '0' : '') + n; };
    return date.getFullYear() + '-' + pad(date.getMonth() + 1) + '-' + pad(date.getDate());
  }

  /**
   * Port of resolveDueInfo: assignment due date first, then the course end date
   * (enrolled learners only), otherwise none. Finished courses are never overdue.
   */
  function resolveDueInfo(courseEnd, cardInfo, completion, now) {
    var enrolled = completion !== undefined;
    var finished = enrolled && completion.completion >= 100;
    var dueDate;
    var days;
    var isOverdue;

    if (cardInfo && cardInfo.due_date) {
      dueDate = parseDateOnly(cardInfo.due_date);
      days = daysUntil(dueDate, now);
      // The API owns overdue for assignments (it already excludes status=completed).
      isOverdue = Boolean(cardInfo.is_overdue);
      var isCompleted = cardInfo.status === 'completed' || finished;
      return {
        dueDate: dueDate,
        isOverdue: isOverdue,
        // Server and browser can disagree on "today" near midnight; never "0 days overdue".
        daysOverdue: isOverdue ? Math.max(1, -days) : 0,
        isDueSoon: !isOverdue && !isCompleted && days >= 0 && days <= DUE_SOON_WINDOW_DAYS,
      };
    }

    if (enrolled && courseEnd) {
      dueDate = parseDateOnly(courseEnd);
      days = daysUntil(dueDate, now);
      isOverdue = days < 0 && !finished;
      return {
        dueDate: dueDate,
        isOverdue: isOverdue,
        daysOverdue: isOverdue ? -days : 0,
        isDueSoon: !finished && days >= 0 && days <= DUE_SOON_WINDOW_DAYS,
      };
    }

    return { dueDate: null, isOverdue: false, daysOverdue: 0, isDueSoon: false };
  }

  function formatHours(hours) {
    var value = Number(hours);
    if (hours === null || hours === undefined || isNaN(value)) { return null; }
    var rounded = Math.round(value * 10) / 10;
    return rounded % 1 === 0 ? rounded.toFixed(0) : String(rounded);
  }

  /**
   * Fills element with a translated string whose %(due_date)s placeholder becomes a
   * <time> element. Built with DOM nodes, not innerHTML, so translations can't inject markup.
   */
  function renderWithDueDate(element, template, values, date, dateText) {
    var placeholder = '%(due_date)s';
    var text = interpolate(template, Object.assign({}, values, { due_date: placeholder }));
    var time = document.createElement('time');
    time.setAttribute('datetime', toIsoDay(date));
    time.textContent = dateText;

    element.textContent = '';
    text.split(placeholder).forEach(function (part, index) {
      if (index > 0) { element.appendChild(time.cloneNode(true)); }
      element.appendChild(document.createTextNode(part));
    });
  }

  function field(card, name) {
    return card.querySelector('[data-lw="' + name + '"]');
  }

  function show(element, visible) {
    if (element) { element.hidden = !visible; }
  }

  function renderCard(card, completionById, cardInfoById, now) {
    var courseId = card.getAttribute('data-course-id');
    var completion = completionById[courseId];
    var cardInfo = cardInfoById[courseId];

    if (cardInfo) {
      if (cardInfo.provider_display_name) {
        field(card, 'provider').textContent = interpolate(
          gettext('By %(provider_name)s'), { provider_name: cardInfo.provider_display_name }
        );
      }
      var contentType = field(card, 'content-type');
      if (cardInfo.content_type_display) {
        contentType.textContent = cardInfo.content_type_display;
      }
      show(contentType, Boolean(cardInfo.content_type_display));
      var hours = formatHours(cardInfo.estimated_duration_hours);
      if (hours) {
        field(card, 'duration').textContent = interpolate(gettext('%(hours)s hours'), { hours: hours });
      }
      show(field(card, 'duration-chip'), Boolean(hours));
    }

    var due = resolveDueInfo(card.getAttribute('data-course-end'), cardInfo, completion, now);
    var dueText = due.dueDate ? formatShortDate(due.dueDate) : null;

    var badge = field(card, 'badge');
    badge.className = 'lw-course-card__badge';
    if (due.isOverdue || due.isDueSoon) {
      badge.textContent = due.isOverdue ? gettext('Overdue') : gettext('Due Soon');
      badge.classList.add(due.isOverdue ? 'lw-course-card__badge--overdue' : 'lw-course-card__badge--due-soon');
    }
    show(badge, due.isOverdue || due.isDueSoon);

    // Due chip until overdue, then the orange status line replaces it.
    if (dueText) {
      renderWithDueDate(field(card, 'due-text'), gettext('Due: %(due_date)s'), {}, due.dueDate, dueText);
      renderWithDueDate(
        field(card, 'overdue'),
        ngettext(
          'Due %(due_date)s · %(days)s day overdue',
          'Due %(due_date)s · %(days)s days overdue',
          due.daysOverdue
        ),
        { days: due.daysOverdue },
        due.dueDate,
        dueText
      );
    }
    show(field(card, 'due'), Boolean(dueText) && !due.isOverdue);
    show(field(card, 'overdue'), Boolean(dueText) && due.isOverdue);

    // Progress + CTA, as CourseCardProgress / CourseCardActions
    var hasStarted = Boolean(completion) && completion.completion > 0;
    if (hasStarted) {
      var percent = Math.max(0, Math.min(100, Math.round(completion.completion)));
      field(card, 'progress-value').textContent = percent + '%';
      field(card, 'progress-bar').style.width = percent + '%';
      field(card, 'progress-track').setAttribute('aria-valuenow', String(percent));
    }
    show(field(card, 'progress'), hasStarted);

    if (completion) {
      field(card, 'cta').setAttribute('href', '/courses/' + encodeURIComponent(courseId) + '/courseware');
      field(card, 'cta-label').textContent = hasStarted ? gettext('Resume') : gettext('Enroll and Start');
    }
    show(field(card, 'cta-icon'), hasStarted);
  }

  function enhance(root) {
    var cards = Array.prototype.filter.call(
      root.querySelectorAll('.lw-course-card[data-course-id]'),
      function (card) { return !card.hasAttribute('data-lw-ready'); }
    );
    if (!cards.length) { return; }
    cards.forEach(function (card) { card.setAttribute('data-lw-ready', ''); });

    var ids = cards.map(function (card) { return card.getAttribute('data-course-id'); });
    Promise.all([getCompletionById(), loadCardInfo(ids)]).then(function (results) {
      var now = Date.now();
      cards.forEach(function (card) { renderCard(card, results[0], results[1], now); });
    });
  }

  // Exposed for lw-courses-tabs.js after it injects card markup.
  window.lwCourseCardsEnhance = enhance;
}());
