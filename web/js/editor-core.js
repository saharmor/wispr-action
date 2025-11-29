/**
 * Core editor coordination - manages editor panel visibility and mode switching
 */
import { state } from './state.js';
import { 
    resetCommandEditor, 
    populateCommandEditor, 
    setupCommandEditorListeners 
} from './command-editor.js';
import {
    resetMcpEditor,
    populateMcpEditor,
    setupMcpEditorListeners
} from './mcp-custom-editor.js';
import {
    activateMcpTab,
    resetCatalogView,
    renderCatalogStatus,
    loadCatalogEntries,
    setupCatalogEditorListeners
} from './mcp-catalog-editor.js';
import {
    activateComposioTab,
    deactivateComposioTab,
    resetComposioTab,
    setupComposioEditorListeners
} from './composio-editor.js';

let currentEditorMode = 'command'; // 'command' or 'mcp'
let currentMcpServerId = null;

/**
 * Show the unified editor panel
 */
export function showEditor(mode = 'command', itemId = null) {
    currentEditorMode = mode;
    const overlay = document.getElementById('editorOverlay');
    const title = document.getElementById('editorTitle');
    
    // Show/hide sections based on mode
    document.getElementById('commandSections').style.display = mode === 'command' ? 'block' : 'none';
    document.getElementById('mcpSections').style.display = mode === 'mcp' ? 'block' : 'none';
    document.getElementById('commandFooter').style.display = mode === 'command' ? 'flex' : 'none';
    document.getElementById('mcpFooter').style.display = mode === 'mcp' ? 'flex' : 'none';
    
    if (mode === 'command') {
        if (itemId) {
            state.currentCommand = state.commands.find(cmd => cmd.id === itemId);
            state.isEditing = true;
            title.textContent = 'Edit Command';
            populateCommandEditor(state.currentCommand);
        } else {
            state.currentCommand = null;
            state.isEditing = false;
            title.textContent = 'New Command';
            resetCommandEditor();
        }
    } else if (mode === 'mcp') {
        currentMcpServerId = itemId;
        state.currentMcpServer = itemId ? state.mcpServers.find(s => s.id === itemId) : null;
        const server = state.currentMcpServer;
        title.textContent = server ? `Edit ${server.name || server.id}` : 'Add MCP Client';
        const deleteBtn = document.getElementById('deleteMcpBtn');
        if (deleteBtn) deleteBtn.style.display = server ? 'inline-flex' : 'none';
        
        // Hide/show tabs based on editing vs creating
        const tabsEl = document.querySelector('.mcp-editor-tabs');
        if (tabsEl) {
            tabsEl.style.display = server ? 'none' : 'flex';
        }
        
        if (server) {
            // Editing existing connection - show form directly without tabs
            const catalogWrapper = document.getElementById('mcpCatalogWrapper');
            const customWrapper = document.getElementById('mcpCustomWrapper');
            const footer = document.getElementById('mcpFooter');
            if (catalogWrapper) catalogWrapper.style.display = 'none';
            if (customWrapper) customWrapper.style.display = 'block';
            if (footer) footer.style.display = 'flex';
            populateMcpEditor(server);
        } else {
            // Creating new connection - show tabs and start with Composio (recommended)
            resetMcpEditor();
            resetComposioTab();
            activateMcpTab('composio'); // Start with Composio as default
        }
    }
    
    // Ensure closing class is removed before opening
    overlay.classList.remove('closing');
    overlay.classList.add('active');
}

/**
 * Close the unified editor panel
 */
export function closeEditor() {
    const overlay = document.getElementById('editorOverlay');
    if (!overlay) return;
    
    // Stop refresh polling (catalog-specific)
    window.dispatchEvent(new CustomEvent('catalogEditorClosed'));
    
    // Trigger smooth closing animation (CSS handles animations)
    overlay.classList.add('closing');
    
    // After animation completes, hide and cleanup
    setTimeout(() => {
        overlay.classList.remove('active', 'closing');
        if (currentEditorMode === 'command') {
            resetCommandEditor();
        } else {
            resetMcpEditor();
        }
        currentMcpServerId = null;
        state.currentMcpServer = null;
    }, 300); // Match CSS animation duration
}

/**
 * Get current MCP server ID being edited
 */
export function getCurrentMcpServerId() {
    return currentMcpServerId;
}

/**
 * Get current editor mode
 */
export function getCurrentEditorMode() {
    return currentEditorMode;
}

/**
 * Legacy function for backward compatibility
 */
export function showCommandEditor(commandId = null) {
    showEditor('command', commandId);
}

/**
 * Legacy function for backward compatibility
 */
export function showMcpEditor(serverId = null) {
    showEditor('mcp', serverId);
}

/**
 * Legacy function for backward compatibility
 */
export function closeCommandEditor() {
    closeEditor();
}

/**
 * Legacy function for backward compatibility
 */
export function closeMcpEditor() {
    closeEditor();
}

/**
 * Setup all editor field listeners
 */
export function setupEditorFieldListeners() {
    setupCommandEditorListeners();
    setupMcpEditorListeners();
    setupCatalogEditorListeners();
    setupComposioEditorListeners();
}

// Expose to window for onclick handlers
window.closeEditor = closeEditor;
window.closeCommandEditor = closeCommandEditor;
window.closeMcpEditor = closeMcpEditor;

