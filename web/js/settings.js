/**
 * Settings management for Composio and other configurations
 */
import { getComposioSettings, setComposioApiKey, deleteComposioApiKey } from './api.js';
import { showToast } from './ui.js';
import { state } from './state.js';

/**
 * Open Composio settings modal
 */
export async function openComposioSettings() {
    const modal = document.getElementById('composioSettingsModal');
    const input = document.getElementById('composioApiKeyInput');
    const deleteBtn = document.getElementById('deleteComposioKeyBtn');
    const statusBanner = document.getElementById('composioStatusBanner');
    const statusText = document.getElementById('composioStatusText');
    
    // Reset input
    input.value = '';
    statusBanner.style.display = 'none';
    
    // Load current status
    try {
        const data = await getComposioSettings();
        if (data.configured) {
            // Show status that key is already set
            statusBanner.style.display = 'block';
            statusBanner.style.backgroundColor = 'var(--success-light, #d1f4e0)';
            statusBanner.style.color = 'var(--success-dark, #0d5c2c)';
            statusText.textContent = '✓ Composio API key is configured';
            deleteBtn.style.display = 'inline-block';
        } else {
            deleteBtn.style.display = 'none';
        }
    } catch (error) {
        console.error('Failed to load Composio status', error);
    }
    
    // Show modal
    modal.classList.add('active');
}

/**
 * Close Composio settings modal
 */
export function closeComposioSettings() {
    const modal = document.getElementById('composioSettingsModal');
    modal.classList.remove('active');
}

/**
 * Save Composio API key
 */
export async function saveComposioKey() {
    const input = document.getElementById('composioApiKeyInput');
    const apiKey = input.value.trim();
    const saveBtn = document.getElementById('saveComposioKeyBtn');
    
    if (!apiKey) {
        showToast('Please enter an API key', 'error');
        return;
    }
    
    // Disable button while saving
    saveBtn.disabled = true;
    saveBtn.textContent = 'Saving...';
    
    try {
        await setComposioApiKey(apiKey);
        state.composioConfigured = true;
        
        // Dispatch event for components that need to react
        window.dispatchEvent(new CustomEvent('composioStatusUpdated', { 
            detail: { configured: true }
        }));
        
        showToast('Composio API key saved successfully', 'success');
        closeComposioSettings();
    } catch (error) {
        console.error('Failed to save Composio API key', error);
        showToast(error.message || 'Failed to save API key', 'error');
    } finally {
        saveBtn.disabled = false;
        saveBtn.textContent = 'Save';
    }
}

/**
 * Delete Composio API key
 */
export async function deleteComposioKey() {
    if (!confirm('Are you sure you want to delete your Composio API key? This will disable OAuth integrations for MCP servers.')) {
        return;
    }
    
    const deleteBtn = document.getElementById('deleteComposioKeyBtn');
    deleteBtn.disabled = true;
    deleteBtn.textContent = 'Deleting...';
    
    try {
        await deleteComposioApiKey();
        state.composioConfigured = false;
        
        // Dispatch event for components that need to react
        window.dispatchEvent(new CustomEvent('composioStatusUpdated', { 
            detail: { configured: false }
        }));
        
        showToast('Composio API key deleted', 'success');
        closeComposioSettings();
    } catch (error) {
        console.error('Failed to delete Composio API key', error);
        showToast(error.message || 'Failed to delete API key', 'error');
    } finally {
        deleteBtn.disabled = false;
        deleteBtn.textContent = 'Delete Key';
    }
}

// Expose functions to window for inline onclick handlers
window.openComposioSettings = openComposioSettings;
window.closeComposioSettings = closeComposioSettings;
window.saveComposioKey = saveComposioKey;
window.deleteComposioKey = deleteComposioKey;


