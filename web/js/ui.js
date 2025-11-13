/**
 * UI utilities: modals, toasts, validation
 */

// ===== Modal System =====
let modalResolve = null;
let modalCloseTimer = null;
let modalKeydownHandler = null;

function setupModalHandlers(overlay, isConfirm = false) {
    const handleClose = () => isConfirm ? resolveModal(false) : closeModal();
    
    // Close on overlay click
    overlay.onclick = (e) => {
        if (e.target === overlay) handleClose();
    };
    
    // Close on Escape key
    modalKeydownHandler = (e) => {
        if (e.key === 'Escape') handleClose();
    };
    document.addEventListener('keydown', modalKeydownHandler);
}

function cleanupModalHandlers() {
    if (modalCloseTimer) {
        clearTimeout(modalCloseTimer);
        modalCloseTimer = null;
    }
    if (modalKeydownHandler) {
        document.removeEventListener('keydown', modalKeydownHandler);
        modalKeydownHandler = null;
    }
}

function displayModal(message, title, type, footerHtml) {
    const overlay = document.getElementById('modalOverlay');
    const icon = document.getElementById('modalIcon');
    const titleEl = document.getElementById('modalTitle');
    const messageEl = document.getElementById('modalMessage');
    const footer = document.getElementById('modalFooter');
    
    cleanupModalHandlers();
    
    // Set content
    titleEl.textContent = title;
    messageEl.textContent = message;
    icon.className = `modal-icon ${type}`;
    footer.innerHTML = footerHtml;
    
    // Show modal
    overlay.classList.remove('closing');
    overlay.classList.add('active');
    
    return overlay;
}

export function showModal(message, title = 'Notification', type = 'info') {
    const footerHtml = '<button class="btn btn-primary" onclick="window.closeModal()">OK</button>';
    const overlay = displayModal(message, title, type, footerHtml);
    setupModalHandlers(overlay, false);
}

export function showConfirm(message, title = 'Confirm', type = 'confirm') {
    return new Promise((resolve) => {
        modalResolve = resolve;
        
        const footerHtml = `
            <button class="btn btn-secondary" onclick="window.resolveModal(false)">Cancel</button>
            <button class="btn btn-primary" onclick="window.resolveModal(true)">Confirm</button>
        `;
        
        const overlay = displayModal(message, title, type, footerHtml);
        setupModalHandlers(overlay, true);
    });
}

export function closeModal() {
    const overlay = document.getElementById('modalOverlay');
    overlay.classList.add('closing');
    
    cleanupModalHandlers();
    
    modalCloseTimer = setTimeout(() => {
        overlay.classList.remove('active', 'closing');
        overlay.onclick = null;
        modalCloseTimer = null;
    }, 200);
}

function resolveModal(result) {
    if (modalResolve) {
        modalResolve(result);
        modalResolve = null;
    }
    closeModal();
}

// Expose to window for onclick handlers
window.closeModal = closeModal;
window.resolveModal = resolveModal;

// ===== Toast Notification System =====
export function showToast(message, type = 'info', duration = 4000) {
    const container = document.getElementById('toastContainer');
    
    // Create toast element
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    
    // Icon based on type
    const icons = {
        success: '✓',
        error: '✕',
        warning: '⚠',
        info: 'ℹ'
    };
    
    toast.innerHTML = `
        <span class="toast-icon">${icons[type] || icons.info}</span>
        <span class="toast-message">${escapeHtml(message)}</span>
        <button class="toast-close" onclick="window.hideToast(this.parentElement)">&times;</button>
    `;
    
    container.appendChild(toast);
    
    // Auto-hide after duration
    if (duration > 0) {
        setTimeout(() => {
            hideToast(toast);
        }, duration);
    }
    
    return toast;
}

export function hideToast(toastElement) {
    if (!toastElement) return;
    
    toastElement.classList.add('hiding');
    
    setTimeout(() => {
        if (toastElement.parentElement) {
            toastElement.parentElement.removeChild(toastElement);
        }
    }, 300); // Match animation duration
}

// Expose to window for onclick handlers
window.hideToast = hideToast;

// ===== Validation Utilities =====
export const PATH_FIELD_MAP = {
    'script_path': 'scriptPath',
    'python_interpreter': 'pythonInterpreter',
    'env_file': 'envFile',
    'working_directory': 'workingDirectory'
};

export function setFieldValidationError(fieldId, message) {
    const field = document.getElementById(fieldId);
    if (!field) return;
    
    field.classList.add('validation-error');
    const formGroup = field.closest('.form-group');
    
    if (formGroup) {
        let errorMsg = formGroup.querySelector('.validation-error-message');
        if (!errorMsg) {
            errorMsg = document.createElement('small');
            errorMsg.className = 'validation-error-message';
            errorMsg.style.color = '#ef4444';
            errorMsg.style.display = 'block';
            errorMsg.style.marginTop = '4px';
            formGroup.appendChild(errorMsg);
        }
        errorMsg.textContent = message;
    }
}

export function clearFieldValidationError(fieldId) {
    const field = document.getElementById(fieldId);
    if (!field) return;
    
    field.classList.remove('validation-error');
    const formGroup = field.closest('.form-group');
    if (formGroup) {
        const errorMsg = formGroup.querySelector('.validation-error-message');
        if (errorMsg) errorMsg.remove();
    }
}

export function highlightInvalidPaths(validationResults) {
    clearPathHighlights();
    
    for (const [key, result] of Object.entries(validationResults)) {
        if (!result.valid && PATH_FIELD_MAP[key]) {
            setFieldValidationError(PATH_FIELD_MAP[key], result.message);
        }
    }
}

export function clearPathHighlights() {
    Object.values(PATH_FIELD_MAP).forEach(clearFieldValidationError);
}

// ===== Utility Functions =====
export function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

