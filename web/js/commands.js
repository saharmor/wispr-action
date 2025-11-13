/**
 * Command list and CRUD operations
 */
import { state } from './state.js';
import { apiCall } from './api.js';
import { showToast, showConfirm, escapeHtml } from './ui.js';
import { showCommandEditor } from './editor.js';

/**
 * Load commands from the server
 */
export async function loadCommands() {
    try {
        const data = await apiCall('/api/commands');
        state.commands = data.commands || [];
        renderCommandList();
    } catch (error) {
        // Only log if it's not a connection error (modal already shown)
        if (!error.isConnectionError) {
            console.error('Failed to load commands:', error);
        }
    }
}

/**
 * Render the command list UI
 */
export function renderCommandList() {
    const emptyState = document.getElementById('emptyState');
    const tableContainer = document.getElementById('commandTableContainer');
    const tableBody = document.getElementById('commandTableBody');
    const commandCount = document.getElementById('commandCount');
    
    commandCount.textContent = `${state.commands.length} command${state.commands.length !== 1 ? 's' : ''}`;
    
    if (state.commands.length === 0) {
        emptyState.style.display = 'block';
        tableContainer.style.display = 'none';
        return;
    }
    
    emptyState.style.display = 'none';
    tableContainer.style.display = 'block';
    
    tableBody.innerHTML = state.commands.map(cmd => {
        const isDefaultCommand = cmd.id === 'default_welcome';
        const hintHtml = isDefaultCommand ? 
            '<div class="command-hint">💡 Dictate anywhere "Command run default command" to run your first command</div>' : '';
        
        // Format example phrases
        let examplesHtml = '';
        if (cmd.example_phrases && cmd.example_phrases.length > 0) {
            examplesHtml = cmd.example_phrases
                .slice(0, 2) // Show first 2 examples
                .map(ex => `<div class="example-phrase">"${escapeHtml(ex)}"</div>`)
                .join('');
            if (cmd.example_phrases.length > 2) {
                examplesHtml += `<div class="example-more">+${cmd.example_phrases.length - 2} more</div>`;
            }
        } else {
            examplesHtml = '<span class="text-muted">No examples</span>';
        }
        
        return `
            <tr>
                <td>
                    <div class="command-name">${escapeHtml(cmd.name)}</div>
                </td>
                <td>
                    <div class="command-description">${escapeHtml(cmd.description || '')}</div>
                    ${hintHtml}
                </td>
                <td>
                    <div class="command-examples">${examplesHtml}</div>
                </td>
                <td>
                    <div class="toggle-switch ${cmd.enabled ? 'active' : ''}" 
                         onclick="window.toggleCommand('${cmd.id}')">
                    </div>
                </td>
                <td>
                    <div class="action-buttons">
                        <button class="action-button" onclick="window.editCommand('${cmd.id}')">Edit</button>
                        <button class="action-button" onclick="window.deleteCommand('${cmd.id}')">Delete</button>
                    </div>
                </td>
            </tr>
        `;
    }).join('');
}

/**
 * Edit a command
 */
export function editCommand(commandId) {
    showCommandEditor(commandId);
}

/**
 * Delete a command
 */
export async function deleteCommand(commandId) {
    const command = state.commands.find(cmd => cmd.id === commandId);
    if (!command) return;
    
    const confirmed = await showConfirm(
        `Are you sure you want to delete "${command.name}"?`,
        'Delete Command',
        'warning'
    );
    
    if (!confirmed) {
        return;
    }
    
    try {
        await apiCall(`/api/commands/${commandId}`, {
            method: 'DELETE'
        });
        showToast('Command deleted successfully', 'success');
        loadCommands();
    } catch (error) {
        console.error('Failed to delete command:', error);
        showToast(error.message || 'Failed to delete command', 'error');
    }
}

/**
 * Toggle command enabled/disabled
 */
export async function toggleCommand(commandId) {
    try {
        const response = await apiCall(`/api/commands/${commandId}/toggle`, {
            method: 'PATCH'
        });
        const status = response.enabled ? 'enabled' : 'disabled';
        showToast(`Command ${status}`, 'info', 2000);
        loadCommands();
    } catch (error) {
        console.error('Failed to toggle command:', error);
        showToast(error.message || 'Failed to toggle command', 'error');
    }
}

// Expose to window for onclick handlers
window.editCommand = editCommand;
window.deleteCommand = deleteCommand;
window.toggleCommand = toggleCommand;
window.showCommandEditor = () => showCommandEditor();

