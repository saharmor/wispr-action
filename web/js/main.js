/**
 * Main entry point - initializes the application
 */
import { loadCommands } from './commands.js';
import { loadMonitorStatus, toggleMonitor } from './monitor.js';
import { showCommandEditor, setupEditorFieldListeners } from './editor.js';
import { testParse, testExecute } from './test.js';

/**
 * Setup event listeners
 */
function setupEventListeners() {
    // Header buttons
    document.getElementById('newCommandBtn').addEventListener('click', () => showCommandEditor());
    document.getElementById('toggleMonitorBtn').addEventListener('click', toggleMonitor);
    
    // Test panel
    document.getElementById('testParseBtn').addEventListener('click', testParse);
    document.getElementById('testExecuteBtn').addEventListener('click', testExecute);
    
    // Close editor when clicking outside the panel (on the overlay)
    const editorOverlay = document.getElementById('editorOverlay');
    if (editorOverlay) {
        editorOverlay.addEventListener('click', (event) => {
            if (event.target === editorOverlay) {
                window.closeCommandEditor();
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
    console.log('🚀 Wispr Action initializing...');
    
    // Load initial data
    loadCommands();
    loadMonitorStatus();
    
    // Setup UI
    setupEventListeners();
    
    // Refresh monitor status every 5 seconds
    setInterval(loadMonitorStatus, 5000);
    
    console.log('✅ Wispr Action initialized');
});

