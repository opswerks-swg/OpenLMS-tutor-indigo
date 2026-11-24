/**
 * Public certificate page (certificates/valid.html): "Download PDF" saves the certificate as a
 * one-page PDF file, the same way the profile MFE does (frontend-app-profile
 * src/profile/certificates/download.js), instead of opening the browser's print dialog.
 *
 *  1. html2canvas (vendor/html2canvas.min.js, loaded on the first click) captures .ow-cert.
 *     The capture uses a fixed-width copy, so the file is the same on a phone and a desktop:
 *     the certificate's type is sized in container query units (cqw).
 *  2. The JPEG is wrapped in a minimal single-page PDF (no PDF library needed).
 *
 * html2canvas does not draw border-image, so the copy gets a gradient strip over the
 * certificate's top border. It also ignores object-fit, so signatures are resized to the box
 * object-fit: contain would show.
 *
 * If anything fails (script blocked, cross-origin image tainting the canvas, ...), it falls back
 * to the print dialog, which keeps its own A4 print stylesheet.
 *
 * Rendered by Tutor's Jinja pass: keep Jinja delimiters out of this file.
 */
(function () {
  'use strict';

  // PDF page width in points (A4 landscape); the height follows the certificate's ratio.
  var PDF_PAGE_WIDTH_PT = 842;
  // Width of the captured copy in CSS pixels (297mm at 96 dpi), rendered at 2x.
  var CAPTURE_WIDTH_PX = 1123;
  var CAPTURE_SCALE = 2;
  var JPEG_QUALITY = 0.92;
  var BAR_GRADIENT = 'linear-gradient(90deg, #c8e843 0%, #0fb981 100%)';

  // PDF syntax is ASCII (plus a few 8-bit marker bytes), one byte per character.
  function latin1Bytes(text) {
    var bytes = new Uint8Array(text.length);
    for (var i = 0; i < text.length; i += 1) {
      bytes[i] = text.charCodeAt(i) & 0xff;
    }
    return bytes;
  }

  function dataUrlToBytes(dataUrl) {
    var binary = atob(dataUrl.slice(dataUrl.indexOf(',') + 1));
    var bytes = new Uint8Array(binary.length);
    for (var i = 0; i < binary.length; i += 1) {
      bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
  }

  /**
   * Minimal single-page PDF whose page is filled by one JPEG image (DCTDecode, so the JPEG
   * bytes are embedded as-is). Same output as the profile MFE's buildImagePdf.
   */
  function buildImagePdf(jpegBytes, imageWidth, imageHeight, pageWidth) {
    var width = pageWidth || PDF_PAGE_WIDTH_PT;
    var pageHeight = Math.round(((width * imageHeight) / imageWidth) * 100) / 100;
    var content = 'q ' + width + ' 0 0 ' + pageHeight + ' 0 0 cm /Im0 Do Q';

    var chunks = [];
    var offsets = [];
    var length = 0;
    function push(part) {
      var bytes = typeof part === 'string' ? latin1Bytes(part) : part;
      chunks.push(bytes);
      length += bytes.length;
    }
    function object(id, body) {
      offsets[id] = length;
      push(id + ' 0 obj\n' + body + '\nendobj\n');
    }

    push('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n');
    object(1, '<< /Type /Catalog /Pages 2 0 R >>');
    object(2, '<< /Type /Pages /Kids [3 0 R] /Count 1 >>');
    object(3, '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ' + width + ' ' + pageHeight + '] '
      + '/Resources << /XObject << /Im0 4 0 R >> >> /Contents 5 0 R >>');
    offsets[4] = length;
    push('4 0 obj\n<< /Type /XObject /Subtype /Image /Width ' + imageWidth + ' /Height ' + imageHeight
      + ' /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ' + jpegBytes.length
      + ' >>\nstream\n');
    push(jpegBytes);
    push('\nendstream\nendobj\n');
    object(5, '<< /Length ' + content.length + ' >>\nstream\n' + content + '\nendstream');

    var xrefOffset = length;
    var xref = 'xref\n0 6\n0000000000 65535 f \n';
    for (var id = 1; id <= 5; id += 1) {
      xref += String(offsets[id]).padStart(10, '0') + ' 00000 n \n';
    }
    push(xref + 'trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n' + xrefOffset + '\n%%EOF\n');

    var pdf = new Uint8Array(length);
    var position = 0;
    chunks.forEach(function (bytes) {
      pdf.set(bytes, position);
      position += bytes.length;
    });
    return pdf;
  }

  // "<course-name>-certificate.pdf", same as the profile MFE's download.
  function certificateFilename(courseName) {
    var base = (courseName || 'certificate')
      .replace(/[^\w\s-]/g, '')
      .trim()
      .replace(/\s+/g, '-')
      .toLowerCase() || 'certificate';
    return base + '-certificate.pdf';
  }

  /**
   * Size of an image drawn with object-fit: contain inside a box: the image keeps its ratio and
   * fits the box. Returns null when the image already fills the box (or has no size yet).
   */
  function containSize(boxWidth, boxHeight, naturalWidth, naturalHeight) {
    if (!boxWidth || !boxHeight || !naturalWidth || !naturalHeight) {
      return null;
    }
    var scale = Math.min(boxWidth / naturalWidth, boxHeight / naturalHeight);
    var width = naturalWidth * scale;
    var height = naturalHeight * scale;
    if (Math.abs(width - boxWidth) < 0.5 && Math.abs(height - boxHeight) < 0.5) {
      return null;
    }
    return { width: width, height: height };
  }

  var html2canvasPromise = null;
  /**
   * Load the html2canvas UMD build as the window.html2canvas global. Legacy LMS pages load
   * RequireJS, and with an AMD define() present the UMD registers an anonymous module instead
   * of the global (and RequireJS reports a mismatched define), so define is hidden while it runs.
   */
  function loadHtml2canvas(src) {
    if (typeof window.html2canvas === 'function') {
      return Promise.resolve(window.html2canvas);
    }
    if (!html2canvasPromise) {
      html2canvasPromise = new Promise(function (resolve, reject) {
        var savedDefine = window.define;
        var script = document.createElement('script');
        function restoreDefine() {
          window.define = savedDefine;
        }
        script.src = src;
        script.async = true;
        script.onload = function () {
          restoreDefine();
          if (typeof window.html2canvas === 'function') {
            resolve(window.html2canvas);
          } else {
            html2canvasPromise = null;
            reject(new Error('html2canvas loaded from ' + src + ' but window.html2canvas is missing'));
          }
        };
        script.onerror = function () {
          restoreDefine();
          html2canvasPromise = null;
          reject(new Error('Could not load ' + src));
        };
        window.define = undefined;
        document.head.appendChild(script);
      });
    }
    return html2canvasPromise;
  }

  function waitForImages(node) {
    var images = Array.prototype.slice.call(node.querySelectorAll('img'));
    return Promise.all(images.map(function (img) {
      if (img.complete) {
        return Promise.resolve();
      }
      return new Promise(function (resolve) {
        img.addEventListener('load', resolve, { once: true });
        img.addEventListener('error', resolve, { once: true });
      });
    }));
  }

  // Adjust html2canvas's copy of the page; the page itself is not touched.
  function prepareCopy(clonedDocument) {
    var cert = clonedDocument.querySelector('.ow-cert');
    if (!cert) {
      return;
    }
    var view = clonedDocument.defaultView;

    cert.style.width = CAPTURE_WIDTH_PX + 'px';
    cert.style.maxWidth = 'none';
    cert.style.boxShadow = 'none';

    // The gradient top bar is a border-image, which html2canvas skips: paint it over the border.
    var barHeight = view.getComputedStyle(cert).borderTopWidth;
    var bar = clonedDocument.createElement('div');
    bar.setAttribute('aria-hidden', 'true');
    bar.style.cssText = 'position:absolute;left:0;right:0;z-index:1;'
      + 'top:-' + barHeight + ';height:' + barHeight + ';background-image:' + BAR_GRADIENT + ';';
    cert.appendChild(bar);

    // object-fit: contain, which html2canvas ignores: shrink the image to the fitted size and
    // keep it centred in the box it had.
    Array.prototype.forEach.call(cert.querySelectorAll('.ow-cert__signature'), function (img) {
      var box = img.getBoundingClientRect();
      var size = containSize(box.width, box.height, img.naturalWidth, img.naturalHeight);
      if (!size) {
        return;
      }
      var style = view.getComputedStyle(img);
      var extraHeight = (box.height - size.height) / 2;
      img.style.width = size.width + 'px';
      img.style.maxWidth = 'none';
      img.style.height = size.height + 'px';
      img.style.marginTop = (parseFloat(style.marginTop) + extraHeight) + 'px';
      img.style.marginBottom = (parseFloat(style.marginBottom) + extraHeight) + 'px';
    });
  }

  function saveBlob(blob, filename) {
    var url = URL.createObjectURL(blob);
    var link = document.createElement('a');
    link.download = filename;
    link.href = url;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    window.setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
  }

  function downloadCertificate(cert, filename, html2canvasSrc) {
    var fontsReady = document.fonts && document.fonts.ready ? document.fonts.ready : Promise.resolve();
    return Promise.all([loadHtml2canvas(html2canvasSrc), fontsReady, waitForImages(cert)])
      .then(function (loaded) {
        var html2canvas = loaded[0];
        return html2canvas(cert, {
          scale: CAPTURE_SCALE,
          useCORS: true,
          backgroundColor: '#ffffff',
          logging: false,
          windowWidth: Math.max(window.innerWidth, CAPTURE_WIDTH_PX + 200),
          onclone: prepareCopy,
        });
      })
      .then(function (canvas) {
        var jpeg = dataUrlToBytes(canvas.toDataURL('image/jpeg', JPEG_QUALITY));
        var pdf = buildImagePdf(jpeg, canvas.width, canvas.height);
        saveBlob(new Blob([pdf], { type: 'application/pdf' }), filename);
      });
  }

  function init() {
    var button = document.getElementById('ow-cert-download');
    var cert = document.querySelector('.ow-cert');
    if (!button || !cert) {
      return;
    }
    var label = button.querySelector('.ow-cert-btn__label');
    var status = document.getElementById('ow-cert-status');

    function announce(message) {
      if (!status || !message) {
        return;
      }
      status.textContent = '';
      window.setTimeout(function () { status.textContent = message; }, 50);
    }

    function setBusy(isBusy) {
      button.disabled = isBusy;
      button.setAttribute('aria-busy', isBusy ? 'true' : 'false');
      if (label) {
        label.textContent = button.getAttribute(isBusy ? 'data-busy' : 'data-default') || label.textContent;
      }
    }

    button.addEventListener('click', function () {
      if (button.disabled) {
        return;
      }
      setBusy(true);
      announce(button.getAttribute('data-busy'));
      downloadCertificate(
        cert,
        certificateFilename(button.getAttribute('data-course-name')),
        button.getAttribute('data-html2canvas-src')
      )
        .then(function () {
          announce(button.getAttribute('data-done'));
        })
        .catch(function (error) {
          // eslint-disable-next-line no-console
          console.error('Certificate PDF download failed; opening the print dialog instead.', error);
          window.print();
        })
        .then(function () {
          setBusy(false);
        });
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  // Pure helpers for tests/js/ow-certificate-download.test.js.
  if (window.__LW_TEST__) {
    window.__LW_TEST__.certificateDownload = {
      buildImagePdf: buildImagePdf,
      certificateFilename: certificateFilename,
      containSize: containSize,
      PDF_PAGE_WIDTH_PT: PDF_PAGE_WIDTH_PT,
    };
  }
}());
