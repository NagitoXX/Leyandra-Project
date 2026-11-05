document.addEventListener('DOMContentLoaded', () => {
    const $ = id => document.getElementById(id);
    const fileInput = $('image-input');
    const browseButton = $('browse-button');
    const dropZone = $('drop-zone');
    const uploadContent = $('upload-content');
    const imagePreview = $('image-preview');
    const fileError = $('file-error');
    const actions = $('upload-actions');
    const processButton = $('process-button');
    const clearButton = $('clear-button');
    const denoiseSwitch = $('denoise-switch');
    const denoiseHelp = $('denoise-help');
    const backendStatus = $('backend-status');
    const resultsSection = $('results-section');
    const resultsGrid = $('results-grid');
    const progress = $('progress');
    const progressBar = $('progress-bar');
    const summary = $('summary');
    const downloadButton = $('download-button');
    const serverInfo = $('server-info');

    // Where the backend is answered. First choice: /api on the server of this page (serve.py passes the
    // requests on to the backend, so other people only need the address of the website). Otherwise the
    // backend directly, on port 8000 of the same machine (or localhost when the page is opened as a file).
    const API_CANDIDATES = [
        ...(window.location.protocol.startsWith('http') ? [`${window.location.origin}/api`] : []),
        `http://${window.location.hostname || 'localhost'}:8000`
    ];
    let API_BASE = API_CANDIDATES[0];
    const allowedTypes = ['image/jpeg', 'image/png'];
    const allowedExtensions = ['jpg', 'jpeg', 'png'];
    const MAX_IMAGES = 10;
    const MAX_BYTES = 10 * 1024 * 1024;      // same limit as the backend
    const TIMEOUT_MS = 60000;                // the models run on the CPU: a few seconds per image at most
    const NOISE_THRESHOLD = 0.04;            // same value as the backend, only used for the explanation text

    const DENOISE_HELP = {
        auto: 'Auto: only noisy photos go through the U-Net. On a clean photo it removes details and the caption gets worse.',
        always: 'Always: every photo goes through the U-Net before the caption, even a clean one.'
    };

    // One item per image: { id, file, url, status: waiting | processing | done | error, result, error, seconds, view }
    let items = [];
    let busy = false;
    let denoise = 'auto';
    let nextId = 1;

    if (!fileInput || !browseButton || !dropZone || !uploadContent || !imagePreview || !fileError) {
        console.error('Leyenda: upload elements not found.');
        return;
    }
    if (serverInfo) serverInfo.textContent = `Server: ${API_BASE}`;

    // ---------- Small helpers ----------

    function element(tag, className, text) {
        // Text, never HTML: file names and captions cannot break the page
        const node = document.createElement(tag);
        if (className) node.className = className;
        if (text !== undefined) node.textContent = text;
        return node;
    }

    function button(className, text, onClick, label) {
        const node = element('button', className, text);
        node.type = 'button';
        if (label) node.setAttribute('aria-label', label);
        node.addEventListener('click', onClick);
        return node;
    }

    function showError(message) {
        fileError.textContent = message;
        fileError.hidden = false;
    }

    function clearError() {
        fileError.textContent = '';
        fileError.hidden = true;
    }

    function formatFileSize(bytes) {
        if (bytes < 1024) return `${bytes} B`;
        if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
        return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
    }

    const percent = value => `${Math.round(value * 100)} %`;

    function isSupportedImage(file) {
        const extension = file.name.split('.').pop().toLowerCase();
        // Some systems give no MIME type to dropped files: the extension is enough in that case
        return (file.type === '' || allowedTypes.includes(file.type)) && allowedExtensions.includes(extension);
    }

    // Explains why the photo was denoised or not
    function noiseText(sigma, denoised) {
        const s = `σ = ${sigma.toFixed(3)}`;
        if (!denoised) return `Clean photo (${s}): captioned as it is, not denoised.`;
        if (sigma > NOISE_THRESHOLD) return `Noisy photo (${s}): denoised by the U-Net before the caption.`;
        return `Denoised on request (${s}): the photo was already clean.`;
    }

    // ---------- Backend status ----------

    async function checkBackend() {
        for (const base of API_CANDIDATES) {
            try {
                const response = await fetch(`${base}/health`, { cache: 'no-store' });
                if (!response.ok) continue;
                const body = await response.json();
                if (body.status !== 'ok') continue;
                API_BASE = base;
                if (serverInfo) serverInfo.textContent = `Server: ${API_BASE}`;
                backendStatus.textContent = 'Models ready';
                backendStatus.className = 'backend-status online';
                return true;
            } catch { /* not this one, try the next */ }
        }
        backendStatus.textContent = 'Backend not reachable. On the computer that runs the demo, start it with: ' +
                                    'python -m uvicorn main:app --host 0.0.0.0 --port 8000';
        backendStatus.className = 'backend-status offline';
        return false;
    }

    // ---------- Choosing the images ----------

    function addImages(files) {
        if (busy) return;
        clearError();
        const incoming = Array.from(files);
        const room = MAX_IMAGES - items.length;

        if (room <= 0) {
            showError(`${MAX_IMAGES} images at a time at most. Remove some before adding new ones.`);
            return;
        }
        if (incoming.some(file => !isSupportedImage(file))) {
            showError('Invalid file format. Please upload PNG, JPG or JPEG images only.');
            return;
        }
        const tooBig = incoming.find(file => file.size > MAX_BYTES);
        if (tooBig) {
            showError(`${tooBig.name} is too big (${formatFileSize(tooBig.size)}). The limit is 10 MB per image.`);
            return;
        }
        if (incoming.length > room) {
            showError(`Only the first ${room} image(s) were added (${MAX_IMAGES} at a time at most).`);
        }

        incoming.slice(0, room).forEach(file => {
            items.push({ id: nextId++, file, url: URL.createObjectURL(file), status: 'waiting', view: 'denoised' });
        });
        render();
    }

    function removeItem(id) {
        if (busy) return;
        const item = items.find(it => it.id === id);
        if (item) URL.revokeObjectURL(item.url);
        items = items.filter(it => it.id !== id);
        clearError();
        render();
    }

    function resetAll() {
        if (busy) return;
        items.forEach(it => URL.revokeObjectURL(it.url));
        items = [];
        fileInput.value = '';
        clearError();
        render();
    }

    // ---------- Sending the images to the backend ----------

    async function captionImage(file, force) {
        const formData = new FormData();
        formData.append('file', file);
        // force: the user says it is a photo, so the backend captions it even if the classifier disagrees
        const query = `denoise=${denoise}${force ? '&force=true' : ''}`;

        // The request is cancelled if the server takes too long
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
        let response;
        try {
            response = await fetch(`${API_BASE}/caption?${query}`, {
                method: 'POST', body: formData, signal: controller.signal
            });
        } catch {
            if (controller.signal.aborted) throw new Error('The server took too long to answer. Try again.');
            throw Object.assign(new Error(`Cannot reach the server at ${API_BASE}. Is the backend running?`), { network: true });
        } finally {
            clearTimeout(timer);
        }

        if (!response.ok) {
            // The backend explains its errors (image too big, not an image) in "detail"
            let message = `Server error (${response.status}).`;
            try {
                const body = await response.json();
                if (typeof body.detail === 'string') message = body.detail;
            } catch { /* no JSON in the answer */ }
            throw new Error(message);
        }
        return response.json();
    }

    // Sends the images one after the other: each card is filled as soon as its result arrives
    async function processItems(queue) {
        if (busy || queue.length === 0) return;
        clearError();
        if (!(await checkBackend())) {
            showError('The backend is not reachable, so the images cannot be processed. See the message at the top.');
            return;
        }

        busy = true;
        let done = 0;
        setProgress(0, queue.length);
        resultsSection.hidden = false;
        render();
        resultsSection.scrollIntoView({ behavior: 'smooth', block: 'start' });

        for (let i = 0; i < queue.length; i++) {
            const item = queue[i];
            Object.assign(item, { status: 'processing', error: undefined, result: undefined, view: 'denoised' });
            render();
            const start = performance.now();
            try {
                item.result = await captionImage(item.file, item.force);
                item.status = 'done';
                item.seconds = (performance.now() - start) / 1000;
            } catch (error) {
                item.status = 'error';
                item.error = error.message;
                if (error.network) {
                    // Server unreachable: the next images would fail the same way
                    showError(error.message);
                    queue.slice(i + 1).forEach(rest => { rest.status = 'waiting'; });
                    checkBackend();
                    break;
                }
            }
            done = i + 1;
            setProgress(done, queue.length);
            render();
        }

        busy = false;
        render();
    }

    function setProgress(done, total) {
        progressBar.style.width = `${(100 * done) / Math.max(1, total)}%`;
        progress.textContent = done < total ? `Processing ${done + 1} / ${total}…` : `${total} / ${total} images processed.`;
    }

    // ---------- CSV export ----------

    function downloadCsv() {
        const rows = [['file', 'is_photo', 'photo_probability', 'noise_level', 'denoised', 'caption', 'alternatives', 'seconds']];
        items.filter(it => it.status === 'done').forEach(it => {
            const r = it.result;
            rows.push([it.file.name, r.is_photo, r.photo_probability.toFixed(3),
                       r.noise_level === null ? '' : r.noise_level.toFixed(4), r.denoised,
                       r.caption || '', (r.alternatives || []).join(' | '), it.seconds.toFixed(2)]);
        });
        const quote = value => `"${String(value).replace(/"/g, '""')}"`;
        const csv = rows.map(row => row.map(quote).join(',')).join('\r\n');
        const link = element('a');
        link.href = URL.createObjectURL(new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' }));
        link.download = 'leyenda_results.csv';
        link.click();
        setTimeout(() => URL.revokeObjectURL(link.href), 1000);
    }

    // ---------- Rendering ----------

    function render() {
        renderPreview();
        renderControls();
        renderResults();
    }

    function renderPreview() {
        imagePreview.innerHTML = '';
        const empty = items.length === 0;
        imagePreview.hidden = empty;
        uploadContent.hidden = !empty;
        actions.hidden = empty;
        if (empty) return;

        imagePreview.appendChild(element('p', 'image-counter', `${items.length} / ${MAX_IMAGES} images selected`));
        const grid = element('div', 'image-preview-grid');
        items.forEach(item => {
            const card = element('div', 'preview-card');
            const img = element('img');
            img.src = item.url;
            img.alt = `Preview of ${item.file.name}`;

            const info = element('div', 'preview-information');
            const details = element('div', 'preview-file-info');
            details.append(element('strong', '', item.file.name), element('span', '', formatFileSize(item.file.size)));
            const remove = button('remove-image-button', '×', () => removeItem(item.id), `Remove ${item.file.name}`);
            remove.disabled = busy;
            info.append(details, remove);
            card.append(img, info);
            grid.appendChild(card);
        });

        // The "add more" card is the last card of the grid
        const addMore = button('add-more-card', '', () => fileInput.click());
        addMore.append(element('span', 'add-more-icon', '+'), element('span', '', 'Add more images'));
        addMore.disabled = busy || items.length >= MAX_IMAGES;
        grid.appendChild(addMore);
        imagePreview.appendChild(grid);
    }

    function renderControls() {
        const toProcess = items.filter(it => it.status === 'waiting' || it.status === 'error');
        processButton.disabled = busy || toProcess.length === 0;
        processButton.textContent = busy
            ? 'Processing…'
            : toProcess.length > 0
                ? `Caption ${toProcess.length} image${toProcess.length > 1 ? 's' : ''}`
                : 'All images are done';
        clearButton.disabled = busy;

        denoiseSwitch.querySelectorAll('button').forEach(b => {
            b.classList.toggle('active', b.dataset.value === denoise);
            b.disabled = busy;
        });
        denoiseHelp.textContent = DENOISE_HELP[denoise];

        // Summary of the finished images
        const done = items.filter(it => it.status === 'done');
        const photos = done.filter(it => it.result.is_photo).length;
        const errors = items.filter(it => it.status === 'error').length;
        summary.hidden = busy || done.length + errors === 0;
        summary.textContent = `${photos} photo${photos === 1 ? '' : 's'} captioned · ${done.length - photos} set aside` +
                              (errors > 0 ? ` · ${errors} error${errors > 1 ? 's' : ''}` : '');
        downloadButton.hidden = busy || done.length === 0;
        progressBar.parentElement.hidden = !busy;
        progress.hidden = !busy && done.length + errors === 0;
    }

    function renderResults() {
        const shown = items.filter(it => it.status !== 'waiting');
        resultsSection.hidden = shown.length === 0;
        resultsGrid.innerHTML = '';
        shown.forEach(item => resultsGrid.appendChild(resultCard(item)));
    }

    function resultCard(item) {
        const r = item.result;
        const card = element('article', 'result-card');

        // Picture: the denoised photo if there is one and it is selected, otherwise the original
        const imageBox = element('div', 'result-image');
        const picture = element('img');
        const showDenoised = item.status === 'done' && r.denoised_image && item.view === 'denoised';
        picture.src = showDenoised ? `data:image/jpeg;base64,${r.denoised_image}` : item.url;
        picture.alt = item.file.name;
        imageBox.appendChild(picture);

        // Small label on the picture
        let chip = ['chip waiting', 'Waiting'];
        if (item.status === 'processing') chip = ['chip processing', 'Processing…'];
        if (item.status === 'error') chip = ['chip error', 'Error'];
        if (item.status === 'done') {
            if (r.forced) chip = ['chip forced', `Photo (your choice) · model: ${percent(r.photo_probability)}`];
            else chip = r.is_photo ? ['chip photo', `Photo · ${percent(r.photo_probability)}`]
                                   : ['chip other', `Not a photo · ${percent(1 - r.photo_probability)}`];
        }
        imageBox.appendChild(element('span', chip[0], chip[1]));
        if (item.status === 'processing') {
            const overlay = element('div', 'overlay');
            overlay.appendChild(element('div', 'spinner'));
            imageBox.appendChild(overlay);
        }
        card.appendChild(imageBox);

        const body = element('div', 'result-info');
        const head = element('div', 'result-head');
        head.appendChild(element('strong', 'result-name', item.file.name));
        if (item.status === 'done') head.appendChild(element('span', 'result-time', `${item.seconds.toFixed(1)} s`));
        body.appendChild(head);

        if (item.status === 'processing') {
            body.appendChild(element('p', 'result-note', 'Photo check, noise, caption…'));
            card.classList.add('pending');
        }

        if (item.status === 'error') {
            card.classList.add('failed');
            const row = element('div', 'result-row');
            row.appendChild(element('p', 'result-error', item.error));
            if (!busy) row.appendChild(button('small-button', 'Retry', () => processItems([item])));
            body.appendChild(row);
        }

        if (item.status === 'done' && !r.is_photo) {
            card.classList.add('not-photo');
            body.appendChild(element('p', 'result-note', 'Set aside: only photos are denoised and captioned.'));
            // The classifier can be wrong (for example on ID-style portraits): the user can override it
            if (!busy) {
                const row = element('div', 'result-row');
                row.append(element('span'), button('small-button', 'It’s a photo: caption it', () => {
                    item.force = true;
                    processItems([item]);
                }));
                body.appendChild(row);
            }
        }

        if (item.status === 'done' && r.is_photo) {
            card.classList.add('is-photo');
            body.appendChild(element('p', 'caption', `“${r.caption || '(no caption)'}”`));
            if (r.alternatives && r.alternatives.length > 0) {
                const list = element('ul', 'alternatives');
                r.alternatives.forEach(text => list.appendChild(element('li', '', text)));
                body.append(element('span', 'alternatives-title', 'Other suggestions'), list);
            }
            body.appendChild(element('p', 'result-note', noiseText(r.noise_level, r.denoised)));
            if (r.forced) {
                body.appendChild(element('p', 'result-note',
                    `The classifier saw ${percent(r.photo_probability)} of photo; captioned because you chose it.`));
            }

            const row = element('div', 'result-row');
            if (r.denoised_image) {
                // Original / denoised switch
                const toggle = element('div', 'segmented small');
                [['original', 'Original'], ['denoised', 'Denoised']].forEach(([value, label]) => {
                    const b = button(value === item.view ? 'active' : '', label, () => { item.view = value; renderResults(); });
                    toggle.appendChild(b);
                });
                row.appendChild(toggle);
            } else {
                row.appendChild(element('span'));
            }
            const tools = element('div', 'result-tools');
            const copy = button('small-button', 'Copy', async () => {
                try {
                    await navigator.clipboard.writeText(r.caption || '');
                    copy.textContent = 'Copied';
                } catch {
                    copy.textContent = 'Copy failed';   // the clipboard needs localhost or https
                }
                setTimeout(() => { copy.textContent = 'Copy'; }, 1500);
            });
            tools.appendChild(copy);
            if (!busy) tools.appendChild(button('small-button', '↻', () => processItems([item]), 'Run again'));
            row.appendChild(tools);
            body.appendChild(row);
        }

        card.appendChild(body);
        return card;
    }

    // ---------- Events ----------

    browseButton.addEventListener('click', () => fileInput.click());

    fileInput.addEventListener('change', event => {
        addImages(event.target.files);
        fileInput.value = '';                    // allows selecting the same file again later
    });

    clearButton.addEventListener('click', resetAll);
    processButton.addEventListener('click', () => processItems(items.filter(it => it.status === 'waiting' || it.status === 'error')));
    downloadButton.addEventListener('click', downloadCsv);

    denoiseSwitch.querySelectorAll('button').forEach(b => {
        b.addEventListener('click', () => {
            if (busy) return;
            denoise = b.dataset.value;
            renderControls();
        });
    });

    ['dragenter', 'dragover'].forEach(eventName => {
        dropZone.addEventListener(eventName, event => {
            event.preventDefault();
            event.stopPropagation();
            dropZone.classList.add('drag-over');
        });
    });

    ['dragleave', 'dragend'].forEach(eventName => {
        dropZone.addEventListener(eventName, event => {
            event.preventDefault();
            event.stopPropagation();
            if (!dropZone.contains(event.relatedTarget)) dropZone.classList.remove('drag-over');
        });
    });

    dropZone.addEventListener('drop', event => {
        event.preventDefault();
        event.stopPropagation();
        dropZone.classList.remove('drag-over');
        if (event.dataTransfer.files.length > 0) addImages(event.dataTransfer.files);
    });

    window.addEventListener('beforeunload', () => items.forEach(it => URL.revokeObjectURL(it.url)));

    render();
    checkBackend();
});
