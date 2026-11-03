from pathlib import Path

js = """// LEYENDA - Image upload and preview

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

    const allowedTypes = ['image/jpeg', 'image/png'];
    const allowedExtensions = ['jpg', 'jpeg', 'png'];
    let currentImageUrl = null;

    if (
        !fileInput || !browseButton || !dropZone || !uploadContent ||
        !imagePreview || !previewImage || !fileName || !fileSize ||
        !removeButton || !fileError
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
            showError('Unsupported file format. Please choose a JPG, JPEG, PNG or WEBP image.');
            return;
        }

        if (currentImageUrl) {
            URL.revokeObjectURL(currentImageUrl);
        }

        currentImageUrl = URL.createObjectURL(file);
        previewImage.src = currentImageUrl;
        previewImage.alt = `Preview of ${file.name}`;
        fileName.textContent = file.name;
        fileSize.textContent = formatFileSize(file.size);

        uploadContent.hidden = true;
        imagePreview.hidden = false;
    }

    function resetUpload() {
        if (currentImageUrl) {
            URL.revokeObjectURL(currentImageUrl);
            currentImageUrl = null;
        }

        fileInput.value = '';
        previewImage.removeAttribute('src');
        previewImage.alt = 'Selected image preview';
        fileName.textContent = 'Image name';
        fileSize.textContent = '0 KB';

        imagePreview.hidden = true;
        uploadContent.hidden = false;
        clearError();
        dropZone.classList.remove('drag-over');
    }

    browseButton.addEventListener('click', () => {
        fileInput.click();
    });

    fileInput.addEventListener('change', (event) => {
        const file = event.target.files[0];
        displayImage(file);
    });

    removeButton.addEventListener('click', resetUpload);

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
"""

path = Path("/mnt/data/staticJ.js")
path.write_text(js, encoding="utf-8")
print(f"Arquivo criado: {path}")
