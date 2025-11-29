/**
 * Shared utilities for editor components
 */
import { escapeHtml } from './ui.js';

/**
 * Set value of an input element
 */
export function setValue(id, value) {
    const el = document.getElementById(id);
    if (el) el.value = value || '';
}

/**
 * Set checked state of a checkbox
 */
export function setChecked(id, checked) {
    const el = document.getElementById(id);
    if (el) el.checked = !!checked;
}

/**
 * Populate key-value rows in a container
 */
export function populateKeyValueRows(containerId, rows) {
    const container = document.getElementById(containerId);
    if (!container) return;
    container.innerHTML = '';
    if (!rows || !rows.length) {
        addKeyValueRow(containerId);
        return;
    }
    rows.forEach(row => addKeyValueRow(containerId, row.key, row.value));
}

/**
 * Add a key-value row to a container
 */
export function addKeyValueRow(containerId, key = '', value = '') {
    const container = document.getElementById(containerId);
    if (!container) return;
    const row = document.createElement('div');
    row.className = 'kv-row';
    row.innerHTML = `
        <input type="text" class="kv-key" placeholder="Key" value="${escapeHtml(key)}">
        <input type="text" class="kv-value" placeholder="Value or template" value="${escapeHtml(value)}">
        <button class="btn-icon" type="button">−</button>
    `;
    row.querySelector('button').addEventListener('click', () => row.remove());
    container.appendChild(row);
}

/**
 * Read key-value rows from a container
 */
export function readKeyValueRows(containerId) {
    const container = document.getElementById(containerId);
    if (!container) return [];
    return Array.from(container.querySelectorAll('.kv-row'))
        .map(row => {
            const key = row.querySelector('.kv-key').value.trim();
            const value = row.querySelector('.kv-value').value.trim();
            return key ? { key, value } : null;
        })
        .filter(Boolean);
}

/**
 * Populate container with items using a template function
 */
export function populateContainer(containerId, items, templateFn, rowClass) {
    const container = document.getElementById(containerId);
    if (items && items.length > 0) {
        container.innerHTML = items.map(item => 
            `<div class="${rowClass}">${templateFn(item)}</div>`
        ).join('');
    }
}

/**
 * Format options array to newline-separated string
 */
export function formatOptionsValue(options) {
    if (!Array.isArray(options) || options.length === 0) {
        return '';
    }
    return options
        .map(option => option === null || option === undefined ? '' : String(option))
        .join('\n');
}

/**
 * Get options from a parameter row
 */
export function getOptionsFromRow(row) {
    const textarea = row.querySelector('.param-options');
    if (!textarea) return [];
    return textarea.value
        .split('\n')
        .map(line => line.trim())
        .filter(Boolean)
        .map(value => {
            if (/^-?\d+$/.test(value)) {
                const parsed = Number(value);
                if (Number.isSafeInteger(parsed)) {
                    return parsed;
                }
            }
            return value;
        });
}

/**
 * Normalize catalog transport types
 */
export function normalizeCatalogTransport(value) {
    const map = {
        'streamable-http': 'http',
        streamable_http: 'http',
        http: 'http',
        sse: 'sse',
        stdio: 'stdio',
    };
    const normalized = (value || '').toLowerCase();
    return map[normalized] || 'http';
}

/**
 * Format transport label for display
 */
export function formatTransportLabel(value) {
    switch (value) {
        case 'sse':
            return 'SSE (Server-Sent Events)';
        case 'stdio':
            return 'StdIO (Local process)';
        default:
            return 'HTTP (Remote MCP)';
    }
}

