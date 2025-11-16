/**
 * Shared UI components and formatters
 */
import { escapeHtml } from './ui.js';

/**
 * Format ISO timestamp to human-readable format
 */
export function formatTimestamp(isoString) {
    const date = new Date(isoString);
    const now = new Date();
    
    // Reset hours to compare just the date part
    const dateOnly = new Date(date.getFullYear(), date.getMonth(), date.getDate());
    const todayOnly = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const yesterdayOnly = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
    
    const timeOptions = {
        hour: 'numeric',
        minute: '2-digit',
        hour12: true
    };
    const timeString = date.toLocaleString('en-US', timeOptions);
    
    if (dateOnly.getTime() === todayOnly.getTime()) {
        return `Today, ${timeString}`;
    } else if (dateOnly.getTime() === yesterdayOnly.getTime()) {
        return `Yesterday, ${timeString}`;
    } else {
        const fullOptions = {
            year: 'numeric',
            month: 'short',
            day: 'numeric',
            hour: 'numeric',
            minute: '2-digit',
            hour12: true
        };
        return date.toLocaleString('en-US', fullOptions);
    }
}

/**
 * Generate status badge HTML
 * @param {string} status - 'running', 'success', 'error', or 'failed'
 * @param {boolean} success - Whether the operation succeeded (optional, used with status)
 * @returns {string} HTML for status badge
 */
export function renderStatusBadge(status, success = null) {
    let statusClass, statusText;
    
    if (status === 'running') {
        statusClass = 'status-running';
        statusText = 'Running';
    } else if (success === true || status === 'success') {
        statusClass = 'status-success';
        statusText = 'Success';
    } else if (success === false || status === 'error' || status === 'failed') {
        statusClass = 'status-error';
        statusText = 'Failed';
    } else {
        // Default to info/neutral
        statusClass = 'status-info';
        statusText = status || 'Unknown';
    }
    
    return `<span class="status-badge ${statusClass}">${statusText}</span>`;
}

/**
 * Render parameters as HTML
 * @param {Object} parameters - Key-value pairs of parameters
 * @param {string} size - 'normal' or 'small' for different styling
 * @returns {string} HTML for parameter display
 */
export function renderParameters(parameters, size = 'normal') {
    if (!parameters || Object.keys(parameters).length === 0) {
        return '<span class="text-muted">No parameters</span>';
    }
    
    const itemClass = size === 'small' ? 'param-item-small' : 'param-item';
    const keyClass = size === 'small' ? 'param-key-small' : 'param-key';
    const valueClass = size === 'small' ? 'param-value-small' : 'param-value';
    
    return Object.entries(parameters)
        .map(([key, value]) => `
            <div class="${itemClass}">
                <span class="${keyClass}">${escapeHtml(key)}:</span>
                <span class="${valueClass}">${escapeHtml(String(value))}</span>
            </div>
        `)
        .join('');
}

/**
 * Format duration in seconds to human-readable string
 * @param {number|string} duration - Duration in seconds
 * @param {boolean} showUnits - Whether to show 's' suffix
 * @returns {string} Formatted duration
 */
export function formatDuration(duration, showUnits = true) {
    const durationVal = typeof duration === 'number' 
        ? duration 
        : parseFloat(duration || '0');
    
    if (isNaN(durationVal)) {
        return showUnits ? '0.00s' : '0.00';
    }
    
    // If duration is more than 60 minutes (3600 seconds), show hours, minutes, and seconds
    if (durationVal >= 3600) {
        const hours = Math.floor(durationVal / 3600);
        const minutes = Math.floor((durationVal % 3600) / 60);
        const seconds = Math.floor(durationVal % 60);
        
        const parts = [];
        if (hours > 0) parts.push(`${hours}h`);
        if (minutes > 0) parts.push(`${minutes}m`);
        if (seconds > 0 || parts.length === 0) parts.push(`${seconds}s`);
        
        return parts.join(' ');
    }
    
    // If duration is more than 60 seconds, show minutes and seconds
    if (durationVal >= 60) {
        const minutes = Math.floor(durationVal / 60);
        const seconds = Math.floor(durationVal % 60);
        
        const parts = [];
        if (minutes > 0) parts.push(`${minutes}m`);
        if (seconds > 0 || parts.length === 0) parts.push(`${seconds}s`);
        
        return parts.join(' ');
    }
    
    // For durations less than 60 seconds, show with decimal places
    const formatted = durationVal.toFixed(2);
    return showUnits ? `${formatted}s` : formatted;
}

/**
 * Render output/error block with proper styling
 * @param {Object} result - Execution result object
 * @returns {string} HTML for output display
 */
export function renderOutput(result) {
    if (result.status === 'running') {
        // Show launch message if available, otherwise generic "Executing..."
        if (result.output) {
            return `<div class="running-indicator"><span class="spinner"></span> ${escapeHtml(result.output)}</div>`;
        } else {
            return '<div class="running-indicator"><span class="spinner"></span> Executing...</div>';
        }
    } else if (result.success && result.output) {
        return `<pre class="output-block">${escapeHtml(result.output)}</pre>`;
    } else if (!result.success && result.error) {
        return `<pre class="output-block error-output">${escapeHtml(result.error)}</pre>`;
    } else {
        return '<span class="text-muted">No output</span>';
    }
}

/**
 * Render duration display (handles running state)
 * @param {Object} result - Execution result object
 * @returns {string} HTML for duration display
 */
export function renderDuration(result) {
    if (result.status === 'running') {
        return '<span class="duration text-muted">…</span>';
    }
    
    const durationText = formatDuration(result.duration);
    return `<span class="duration">${durationText}</span>`;
}

