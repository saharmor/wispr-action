/**
 * Main entry point - initializes the application
 */
import { loadCommands } from './commands.js';
import { loadMonitorStatus, toggleMonitor } from './monitor.js';
import { showCommandEditor, setupEditorFieldListeners, closeEditor, showEditor } from './editor.js';
import { testParse, testExecute } from './test.js';
import { loadMcpServers } from './mcp.js';
import { loadExecutionHistory, startHistoryPolling } from './history.js';

/**
 * Setup event listeners
 */
function setupEventListeners() {
    // Header buttons
    document.getElementById('newCommandBtn').addEventListener('click', () => showCommandEditor());
    document.getElementById('toggleMonitorBtn').addEventListener('click', toggleMonitor);
    document.getElementById('addMcpHeaderBtn').addEventListener('click', () => showEditor('mcp', null));
    
    // Test panel
    document.getElementById('testParseBtn').addEventListener('click', testParse);
    document.getElementById('testExecuteBtn').addEventListener('click', testExecute);
    
    // Close editor when clicking outside the panel (on the overlay)
    const editorOverlay = document.getElementById('editorOverlay');
    if (editorOverlay) {
        editorOverlay.addEventListener('click', (event) => {
            if (event.target === editorOverlay) {
                closeEditor();
            }
        });
    }
    
    // Setup field validation listeners
    setupEditorFieldListeners();
}

/**
 * Initialize the application
 */
document.addEventListener('DOMContentLoaded', () => {
    // Load initial data
    loadCommands();
    loadMonitorStatus();
    loadMcpServers();
    
    // Setup UI
    setupEventListeners();
    
    // Refresh monitor status every 5 seconds
    setInterval(loadMonitorStatus, 5000);
    
    // Load history on startup and start polling (since it's now always visible)
    loadExecutionHistory(0);
    startHistoryPolling();
});

