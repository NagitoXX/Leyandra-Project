// LEYENDA - Image upload, preview and caption generation

document.addEventListener('DOMContentLoaded', () => {
    const fileInput = document.getElementById('image-input');
    const browseButton = document.getElementById('browse-button');
    const dropZone = document.getElementById('drop-zone');
    const uploadContent = document.getElementById('upload-content');
    const imagePreview = document.getElementById('image-preview');
    const previewImage = document.getElementById('preview-image');
    const fileName = document.getElementById('file-name');
    const fileSize = document.getElementById('file-size');
    const removeButton = document.getElementById('remove-image-button');
    const fileError = document.getElementById('file-error');
    const captionActions = document.getElementById('caption-actions');
    const generateButton = document.getElementById('generate-caption-button');
    const captionResult = document.getElementById('caption-result');
    const captionText = document.getElementById('caption-text');

    // Cambia esta URL cuando el backend corra en otra máquina.
    const API_BASE_URL = 'http://127.0.0.1:8000';

    const allowedTypes = ['image/jpeg', 'image/png'];
    const allowedExtensions = ['jpg', 'jpeg', 'png'];
    let currentImageUrl = null;
    let currentFile = null;

    if (
        !fileInput || !browseButton || !dropZone || !uploadContent ||
        !imagePreview || !previewImage || !fileName || !fileSize ||
        !removeButton || !fileError || !captionActions ||
        !generateButton || !captionResult || !captionText
    ) {
        console.error('Leyenda: one or more upload elements were not found in index.html.');
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
        return allowedTypes.includes(file.type) || allowedExtensions.includes(extension);
    }

    function displayImage(file) {
        clearError();

        if (!file) return;

        if (!isSupportedImage(file)) {
            showError('Unsupported file format. Please choose a JPG, JPEG or PNG image.');
            return;
        }

        if (currentImageUrl) {
            URL.revokeObjectURL(currentImageUrl);
        }

        currentImageUrl = URL.createObjectURL(file);
        currentFile = file;
        previewImage.src = currentImageUrl;
        previewImage.alt = `Preview of ${file.name}`;
        fileName.textContent = file.name;
        fileSize.textContent = formatFileSize(file.size);

        uploadContent.hidden = true;
        imagePreview.hidden = false;
        captionActions.hidden = false;
        captionResult.hidden = true;
        captionText.textContent = '';
    }

    function resetUpload() {
        if (currentImageUrl) {
            URL.revokeObjectURL(currentImageUrl);
            currentImageUrl = null;
        }

        currentFile = null;
        fileInput.value = '';
        previewImage.removeAttribute('src');
        previewImage.alt = 'Selected image preview';
        fileName.textContent = 'Image name';
        fileSize.textContent = '0 KB';

        imagePreview.hidden = true;
        uploadContent.hidden = false;
        captionActions.hidden = true;
        captionResult.hidden = true;
        captionText.textContent = '';
        clearError();
        dropZone.classList.remove('drag-over');
    }

    async function requestCaption() {
        if (!currentFile || generateButton.disabled) return;

        generateButton.disabled = true;
        generateButton.textContent = 'Generating...';
        captionResult.hidden = true;
        captionText.textContent = '';

        try {
            const formData = new FormData();
            formData.append('image', currentFile);

            const response = await fetch(`${API_BASE_URL}/caption`, {
                method: 'POST',
                body: formData,
            });

            if (!response.ok) {
                let detail = `The server responded with status ${response.status}`;
                try {
                    const errorData = await response.json();
                    if (errorData && errorData.detail) {
                        detail = errorData.detail;
                    }
                } catch (parseError) {
                    // La respuesta de error no era JSON; se usa el mensaje por defecto.
                }
                throw new Error(detail);
            }

            const data = await response.json();
            captionText.textContent = data.caption || 'No caption was generated.';
            captionResult.hidden = false;
        } catch (error) {
            console.error('Leyenda: the caption request failed.', error);
            captionText.textContent = error.message === 'Failed to fetch'
                ? 'Could not reach the backend. Make sure uvicorn is running.'
                : `Error: ${error.message}`;
            captionResult.hidden = false;
        } finally {
            generateButton.disabled = false;
            generateButton.textContent = 'Generate caption';
        }
    }

    browseButton.addEventListener('click', () => {
        fileInput.click();
    });

    fileInput.addEventListener('change', (event) => {
        const file = event.target.files[0];
        displayImage(file);
    });

    removeButton.addEventListener('click', resetUpload);

    generateButton.addEventListener('click', requestCaption);

    ['dragenter', 'dragover'].forEach((eventName) => {
        dropZone.addEventListener(eventName, (event) => {
            event.preventDefault();
            event.stopPropagation();
            dropZone.classList.add('drag-over');
        });
    });

    ['dragleave', 'dragend'].forEach((eventName) => {
        dropZone.addEventListener(eventName, (event) => {
            event.preventDefault();
            event.stopPropagation();

            if (!dropZone.contains(event.relatedTarget)) {
                dropZone.classList.remove('drag-over');
            }
        });
    });

    dropZone.addEventListener('drop', (event) => {
        event.preventDefault();
        event.stopPropagation();
        dropZone.classList.remove('drag-over');

        const file = event.dataTransfer.files[0];
        if (!file) return;

        displayImage(file);
        fileInput.value = '';
    });

    window.addEventListener('beforeunload', () => {
        if (currentImageUrl) {
            URL.revokeObjectURL(currentImageUrl);
        }
    });
});