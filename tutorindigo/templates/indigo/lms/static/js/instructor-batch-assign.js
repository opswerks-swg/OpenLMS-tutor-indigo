/**
 * Instructor dashboard > Membership > Batch Enrollment also assigns the course (OpenLMS
 * course_assignments batch_enrollment.py): learners show under Assigned with this due date.
 *
 * Adds a required "Due date" field, blocks Enroll without a valid one (today or later), and posts
 * it as `due_date` with the stock enroll request (membership.js). The server rejects an Enroll
 * without one too (BatchEnrollmentDueDateMiddleware). Unenroll needs no date (it removes the
 * assignment). No-op on every other page.
 */
(function () {
  'use strict';

  var ENDPOINT = 'students_update_enrollment';
  var FIELD_ID = 'lw-batch-due-date';
  var gettext = window.gettext || function (s) { return s; };

  function todayIso() {
    var now = new Date();
    var month = String(now.getMonth() + 1).padStart(2, '0');
    var day = String(now.getDate()).padStart(2, '0');
    return now.getFullYear() + '-' + month + '-' + day;
  }

  function isValidDue(value) {
    return /^\d{4}-\d{2}-\d{2}$/.test(value) && value >= todayIso();
  }

  function buildField() {
    var wrapper = document.createElement('div');
    wrapper.className = 'lw-batch-due-date';
    wrapper.style.margin = '12px 0';

    var label = document.createElement('label');
    label.htmlFor = FIELD_ID;
    label.style.display = 'block';
    label.style.fontWeight = '600';
    label.textContent = gettext('Due date (required)');

    var input = document.createElement('input');
    input.type = 'date';
    input.id = FIELD_ID;
    input.name = 'due_date';
    input.required = true;
    input.min = todayIso();
    input.setAttribute('aria-describedby', FIELD_ID + '-help ' + FIELD_ID + '-error');

    var help = document.createElement('p');
    help.id = FIELD_ID + '-help';
    help.style.margin = '4px 0 0';
    help.textContent = gettext(
      'Enrolled learners are assigned this course with this due date. It shows in their Assigned courses.'
    );

    var error = document.createElement('p');
    error.id = FIELD_ID + '-error';
    error.setAttribute('role', 'alert');
    error.style.margin = '4px 0 0';
    error.style.color = '#b91c1c';
    error.hidden = true;
    error.textContent = gettext('Enter a due date of today or later to enroll.');

    input.addEventListener('input', function () { error.hidden = true; });

    wrapper.appendChild(label);
    wrapper.appendChild(input);
    wrapper.appendChild(help);
    wrapper.appendChild(error);
    return { wrapper: wrapper, input: input, error: error };
  }

  function init() {
    var section = document.querySelector('.batch-enrollment');
    if (!section || document.getElementById(FIELD_ID)) {
      return;
    }
    var field = buildField();
    var textarea = section.querySelector('textarea');
    if (textarea && textarea.parentNode) {
      textarea.parentNode.insertBefore(field.wrapper, textarea.nextSibling);
    } else {
      section.insertBefore(field.wrapper, section.querySelector('.enrollment-button') || null);
    }

    // Capture phase on the document runs before membership.js's click handler on the button.
    document.addEventListener('click', function (event) {
      var button = event.target.closest && event.target.closest('.batch-enrollment .enrollment-button');
      if (!button || button.getAttribute('data-action') !== 'enroll') {
        return;
      }
      if (!isValidDue(field.input.value)) {
        event.preventDefault();
        event.stopPropagation();
        field.error.hidden = false;
        field.input.focus();
      }
    }, true);

    // Add the due date to the stock enroll request.
    var jq = window.jQuery;
    if (jq && jq.ajaxPrefilter) {
      jq.ajaxPrefilter(function (options) {
        if (typeof options.url !== 'string' || options.url.indexOf(ENDPOINT) === -1) {
          return;
        }
        if (typeof options.data !== 'string' || !/(^|&)action=enroll(&|$)/.test(options.data)) {
          return;
        }
        options.data += '&due_date=' + encodeURIComponent(field.input.value);
      });
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
}());
