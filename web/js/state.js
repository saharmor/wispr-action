/**
 * Global application state management
 */
export const state = {
    commands: [],
    currentCommand: null,
    isEditing: false,
    monitorStatus: null,
    lastParseResult: null,
    currentView: 'commands', // 'commands' or 'history'
    executionHistory: [],
    historyOffset: 0,
    historyPollInterval: null // Store interval ID for cleanup
};

// API Base URL
export const API_BASE = window.location.origin;

