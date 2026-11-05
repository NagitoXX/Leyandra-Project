document.addEventListener('DOMContentLoaded', () => {
    const fileInput = document.getElementById('image-input');
    const browseButton = document.getElementById('browse-button');
    const dropZone = document.getElementById('drop-zone');
    const uploadContent = document.getElementById('upload-content');
    const imagePreview = document.getElementById('image-preview');
    const removeButton = document.getElementById('remove-image-button');
    const fileError = document.getElementById('file-error');
    const processButton = document.getElementById('process-button');
    const resultsSection = document.getElementById('results-section');
    const resultsGrid = document.getElementById('results-grid');
    const API_URL = `http://${window.location.hostname}:8000/caption`;
    const allowedTypes = ['image/jpeg', 'image/png'];
    const allowedExtensions = ['jpg', 'jpeg', 'png'];
    const maxImages = 10;

    let selectedImages = [];

    if (
        !fileInput || !browseButton || !dropZone ||
        !uploadContent || !imagePreview || !fileError
    ) {
        console.error('Leyenda: upload elements not found.');
        return;
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

    function isSupportedImage(file) {
        const extension = file.name.split('.').pop().toLowerCase();

        return allowedTypes.includes(file.type) &&
               allowedExtensions.includes(extension);
    }

    function addImages(files) {
        clearError();

        const incomingFiles = Array.from(files);

        if (selectedImages.length + incomingFiles.length > maxImages) {
            showError(
                `You can upload a maximum of ${maxImages} images at a time. ` +
                `You currently have ${selectedImages.length} image(s) selected.`
            );
            return;
        }

        const invalidFiles = incomingFiles.filter(file => !isSupportedImage(file));

        if (invalidFiles.length > 0) {
            showError('Invalid file format. Please upload PNG, JPG or JPEG images only.');
            return;
        }

        incomingFiles.forEach(file => {
            selectedImages.push({
                file: file,
                url: URL.createObjectURL(file)
            });
        });

        renderImages();
    }

    function renderImages() {
        imagePreview.innerHTML = '';
        if (processButton) {
            processButton.hidden = selectedImages.length === 0;
        }
        if (selectedImages.length === 0) {
            imagePreview.hidden = true;
            uploadContent.hidden = false;
            return;
        }

        uploadContent.hidden = true;
        imagePreview.hidden = false;

        const counter = document.createElement('p');
        counter.className = 'image-counter';
        counter.textContent = `${selectedImages.length} / ${maxImages} images selected`;
        imagePreview.appendChild(counter);

        const grid = document.createElement('div');
        grid.className = 'image-preview-grid';

        selectedImages.forEach((image, index) => {
            const card = document.createElement('div');
            card.className = 'preview-card';

            const img = document.createElement('img');
            img.src = image.url;
            img.alt = `Preview of ${image.file.name}`;

            const info = document.createElement('div');
            info.className = 'preview-information';

            const details = document.createElement('div');
            details.className = 'preview-file-info';

            const name = document.createElement('strong');
            name.textContent = image.file.name;

            const size = document.createElement('span');
            size.textContent = formatFileSize(image.file.size);

            const remove = document.createElement('button');
            remove.type = 'button';
            remove.className = 'remove-image-button';
            remove.textContent = '×';
            remove.setAttribute('aria-label', `Remove ${image.file.name}`);

            remove.addEventListener('click', () => {
                URL.revokeObjectURL(selectedImages[index].url);
                selectedImages.splice(index, 1);
                clearError();
                renderImages();
            });

            details.append(name, size);
            info.append(details, remove);
            card.append(img, info);
            grid.appendChild(card);
        });

        imagePreview.appendChild(grid);

        const addMoreButton = document.createElement('button');
        addMoreButton.type = 'button';
        addMoreButton.className = 'add-more-card';

        const addMoreIcon = document.createElement('span');
        addMoreIcon.className = 'add-more-icon';
        addMoreIcon.textContent = '+';

        const addMoreText = document.createElement('span');
        addMoreText.textContent = 'Add more images';

        addMoreButton.append(addMoreIcon, addMoreText);

        addMoreButton.disabled = selectedImages.length >= maxImages;

        addMoreButton.addEventListener('click', () => {
            fileInput.click();
        });

grid.appendChild(addMoreButton);

        imagePreview.appendChild(addMoreButton);
    }

    function resetUpload() {
        selectedImages.forEach(image => URL.revokeObjectURL(image.url));
        selectedImages = [];
        fileInput.value = '';
        clearError();
        renderImages();
    }

    browseButton.addEventListener('click', () => {
        fileInput.click();
    });

    fileInput.addEventListener('change', event => {
        addImages(event.target.files);

        // Allows selecting the same file again later.
        fileInput.value = '';
    });

    if (removeButton) {
        removeButton.addEventListener('click', resetUpload);
    }

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

            if (!dropZone.contains(event.relatedTarget)) {
                dropZone.classList.remove('drag-over');
            }
        });
    });

    dropZone.addEventListener('drop', event => {
        event.preventDefault();
        event.stopPropagation();
        dropZone.classList.remove('drag-over');

        if (event.dataTransfer.files.length > 0) {
            addImages(event.dataTransfer.files);
        }
    });

    window.addEventListener('beforeunload', () => {
        selectedImages.forEach(image => URL.revokeObjectURL(image.url));
    });
    async function processImages() {
        processButton.disabled = true;
        resultsSection.hidden = false;
        resultsGrid.innerHTML = '';

        for (const image of selectedImages) {
            const card = document.createElement('div');
            card.className = 'result-card';
            card.textContent = `Processing ${image.file.name}...`;
            resultsGrid.appendChild(card);

            const formData = new FormData();
            formData.append('file', image.file);

            try {
                const response = await fetch(`${API_URL}?denoise=auto`, {
                    method: 'POST',
                    body: formData
                });
                if (!response.ok) throw new Error(`HTTP ${response.status}`);
                renderResult(card, image, await response.json());
            } catch (error) {
                card.textContent = `Error with ${image.file.name}: ${error.message}. Is the backend running?`;
            }
        }

        processButton.disabled = false;
    }

    function renderResult(card, image, result) {
        card.innerHTML = '';

        const img = document.createElement('img');
        img.src = result.denoised_image
            ? `data:image/jpeg;base64,${result.denoised_image}`
            : image.url;
        img.alt = `Result for ${image.file.name}`;

        const info = document.createElement('div');
        info.className = 'result-info';
        info.innerHTML =
            `<strong>${image.file.name}</strong>` +
            `<p>Photo: ${result.is_photo ? 'yes' : 'no'} (${(result.photo_probability * 100).toFixed(1)}%)</p>` +
            `<p>Noise: ${result.noise_level.toFixed(4)} — denoised: ${result.denoised ? 'yes' : 'no'}</p>` +
            `<p>Caption: ${result.caption ?? '—'}</p>` +
            `<p>Alternatives: ${(result.alternatives || []).join(' / ') || '—'}</p>`;

        card.append(img, info);
    }

    if (processButton) {
        processButton.addEventListener('click', processImages);
    }
});
