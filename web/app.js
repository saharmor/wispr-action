// State Management
const state = {
    commands: [],
    currentCommand: null,
    isEditing: false,
    monitorStatus: null,
    lastParseResult: null
};

// API Base URL
const API_BASE = window.location.origin;

// Initialize
document.addEventListener('DOMContentLoaded', () => {
    loadCommands();
    loadMonitorStatus();
    setupEventListeners();
    
    // Refresh monitor status every 5 seconds
    setInterval(loadMonitorStatus, 5000);
});

// Event Listeners
function setupEventListeners() {
    document.getElementById('newCommandBtn').addEventListener('click', () => showCommandEditor());
    document.getElementById('toggleMonitorBtn').addEventListener('click', toggleMonitor);
    document.getElementById('testParseBtn').addEventListener('click', testParse);
    document.getElementById('testExecuteBtn').addEventListener('click', testExecute);
}

// API Functions
async function apiCall(endpoint, options = {}) {
    try {
        const response = await fetch(`${API_BASE}${endpoint}`, {
            ...options,
            headers: {
                'Content-Type': 'application/json',
                ...options.headers
            }
        });
        
        const data = await response.json();
        
        if (!response.ok) {
            throw new Error(data.error || 'Request failed');
        }
        
        return data;
    } catch (error) {
        console.error('API Error:', error);
        alert(`Error: ${error.message}`);
        throw error;
    }
}

// Load Commands
async function loadCommands() {
    try {
        const data = await apiCall('/api/commands');
        state.commands = data.commands || [];
        renderCommandList();
    } catch (error) {
        console.error('Failed to load commands:', error);
    }
}

// Render Command List
function renderCommandList() {
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
        const paramCount = cmd.parameters?.length || 0;
        const actionType = cmd.action?.type || 'unknown';
        const actionIcon = actionType === 'script' ? '📜' : '🌐';
        
        return `
            <tr>
                <td>
                    <div class="command-name">${escapeHtml(cmd.name)}</div>
                </td>
                <td>
                    <div class="command-description">${escapeHtml(cmd.description || '')}</div>
                </td>
                <td>
                    <span class="badge badge-params">${paramCount} param${paramCount !== 1 ? 's' : ''}</span>
                </td>
                <td>
                    <span class="badge badge-action">${actionIcon} ${actionType}</span>
                </td>
                <td>
                    <div class="toggle-switch ${cmd.enabled ? 'active' : ''}" 
                         onclick="toggleCommand('${cmd.id}')">
                    </div>
                </td>
                <td>
                    <div class="action-buttons">
                        <button class="action-button" onclick="editCommand('${cmd.id}')">Edit</button>
                        <button class="action-button" onclick="deleteCommand('${cmd.id}')">Delete</button>
                    </div>
                </td>
            </tr>
        `;
    }).join('');
}

// Show Command Editor
function showCommandEditor(commandId = null) {
    const overlay = document.getElementById('editorOverlay');
    const title = document.getElementById('editorTitle');
    
    if (commandId) {
        state.currentCommand = state.commands.find(cmd => cmd.id === commandId);
        state.isEditing = true;
        title.textContent = 'Edit Command';
        populateEditor(state.currentCommand);
    } else {
        state.currentCommand = null;
        state.isEditing = false;
        title.textContent = 'New Command';
        resetEditor();
    }
    
    overlay.classList.add('active');
}

// Close Command Editor
function closeCommandEditor() {
    const overlay = document.getElementById('editorOverlay');
    overlay.classList.remove('active');
    resetEditor();
}

// Reset Editor
function resetEditor() {
    document.getElementById('cmdName').value = '';
    document.getElementById('cmdDescription').value = '';
    
    // Reset examples
    const examplesContainer = document.getElementById('examplesContainer');
    examplesContainer.innerHTML = `
        <div class="example-row">
            <input type="text" class="example-input" placeholder="e.g., 'run emails for sahar@gmail.com'">
            <button class="btn-icon" onclick="removeExample(this)">−</button>
        </div>
    `;
    
    // Reset parameters
    const paramsBody = document.getElementById('paramsTableBody');
    paramsBody.innerHTML = `
        <tr class="param-row">
            <td><input type="text" class="param-name" placeholder="email"></td>
            <td>
                <select class="param-type">
                    <option value="string">string</option>
                    <option value="number">number</option>
                    <option value="email">email</option>
                    <option value="url">url</option>
                    <option value="boolean">boolean</option>
                </select>
            </td>
            <td><input type="checkbox" class="param-required"></td>
            <td><input type="text" class="param-description" placeholder="The email address"></td>
            <td><button class="btn-icon" onclick="removeParam(this)">−</button></td>
        </tr>
    `;
    
    // Reset action
    document.querySelector('input[name="actionType"][value="script"]').checked = true;
    toggleActionType();
    document.getElementById('scriptPath').value = '';
    document.getElementById('argsTemplate').value = '';
    document.getElementById('httpUrl').value = '';
    document.getElementById('httpMethod').value = 'POST';
    document.getElementById('httpBody').value = '';
    
    // Reset headers
    const headersContainer = document.getElementById('headersContainer');
    headersContainer.innerHTML = `
        <div class="header-row">
            <input type="text" class="header-key" placeholder="Content-Type">
            <input type="text" class="header-value" placeholder="application/json">
            <button class="btn-icon" onclick="removeHeader(this)">−</button>
        </div>
    `;
}

// Populate Editor
function populateEditor(command) {
    document.getElementById('cmdName').value = command.name;
    document.getElementById('cmdDescription').value = command.description || '';
    
    // Populate examples
    const examplesContainer = document.getElementById('examplesContainer');
    if (command.example_phrases && command.example_phrases.length > 0) {
        examplesContainer.innerHTML = command.example_phrases.map(ex => `
            <div class="example-row">
                <input type="text" class="example-input" value="${escapeHtml(ex)}">
                <button class="btn-icon" onclick="removeExample(this)">−</button>
            </div>
        `).join('');
    }
    
    // Populate parameters
    const paramsBody = document.getElementById('paramsTableBody');
    if (command.parameters && command.parameters.length > 0) {
        paramsBody.innerHTML = command.parameters.map(param => `
            <tr class="param-row">
                <td><input type="text" class="param-name" value="${escapeHtml(param.name)}"></td>
                <td>
                    <select class="param-type">
                        <option value="string" ${param.type === 'string' ? 'selected' : ''}>string</option>
                        <option value="number" ${param.type === 'number' ? 'selected' : ''}>number</option>
                        <option value="email" ${param.type === 'email' ? 'selected' : ''}>email</option>
                        <option value="url" ${param.type === 'url' ? 'selected' : ''}>url</option>
                        <option value="boolean" ${param.type === 'boolean' ? 'selected' : ''}>boolean</option>
                    </select>
                </td>
                <td><input type="checkbox" class="param-required" ${param.required ? 'checked' : ''}></td>
                <td><input type="text" class="param-description" value="${escapeHtml(param.description || '')}"></td>
                <td><button class="btn-icon" onclick="removeParam(this)">−</button></td>
            </tr>
        `).join('');
    }
    
    // Populate action
    const actionType = command.action.type;
    document.querySelector(`input[name="actionType"][value="${actionType}"]`).checked = true;
    toggleActionType();
    
    if (actionType === 'script') {
        document.getElementById('scriptPath').value = command.action.script_path || '';
        document.getElementById('argsTemplate').value = command.action.args_template || '';
    } else if (actionType === 'http') {
        document.getElementById('httpUrl').value = command.action.url || '';
        document.getElementById('httpMethod').value = command.action.method || 'POST';
        document.getElementById('httpBody').value = command.action.body_template || '';
        
        // Populate headers
        if (command.action.headers && command.action.headers.length > 0) {
            const headersContainer = document.getElementById('headersContainer');
            headersContainer.innerHTML = command.action.headers.map(header => `
                <div class="header-row">
                    <input type="text" class="header-key" value="${escapeHtml(header.key)}">
                    <input type="text" class="header-value" value="${escapeHtml(header.value)}">
                    <button class="btn-icon" onclick="removeHeader(this)">−</button>
                </div>
            `).join('');
        }
    }
}

// Save Command
async function saveCommand() {
    try {
        const commandData = extractCommandData();
        
        if (state.isEditing && state.currentCommand) {
            // Update
            await apiCall(`/api/commands/${state.currentCommand.id}`, {
                method: 'PUT',
                body: JSON.stringify(commandData)
            });
        } else {
            // Create
            await apiCall('/api/commands', {
                method: 'POST',
                body: JSON.stringify(commandData)
            });
        }
        
        closeCommandEditor();
        loadCommands();
    } catch (error) {
        console.error('Failed to save command:', error);
    }
}

// Extract Command Data from Editor
function extractCommandData() {
    const name = document.getElementById('cmdName').value.trim();
    const description = document.getElementById('cmdDescription').value.trim();
    
    if (!name || !description) {
        throw new Error('Name and description are required');
    }
    
    // Extract examples
    const exampleInputs = document.querySelectorAll('.example-input');
    const example_phrases = Array.from(exampleInputs)
        .map(input => input.value.trim())
        .filter(val => val);
    
    // Extract parameters
    const paramRows = document.querySelectorAll('.param-row');
    const parameters = Array.from(paramRows)
        .map(row => {
            const name = row.querySelector('.param-name').value.trim();
            if (!name) return null;
            
            return {
                name,
                type: row.querySelector('.param-type').value,
                required: row.querySelector('.param-required').checked,
                description: row.querySelector('.param-description').value.trim()
            };
        })
        .filter(param => param !== null);
    
    // Extract action
    const actionType = document.querySelector('input[name="actionType"]:checked').value;
    let action = { type: actionType };
    
    if (actionType === 'script') {
        const scriptPath = document.getElementById('scriptPath').value.trim();
        if (!scriptPath) {
            throw new Error('Script path is required');
        }
        action.script_path = scriptPath;
        action.args_template = document.getElementById('argsTemplate').value.trim();
    } else if (actionType === 'http') {
        const url = document.getElementById('httpUrl').value.trim();
        if (!url) {
            throw new Error('URL is required');
        }
        action.url = url;
        action.method = document.getElementById('httpMethod').value;
        action.body_template = document.getElementById('httpBody').value.trim();
        
        // Extract headers
        const headerRows = document.querySelectorAll('.header-row');
        action.headers = Array.from(headerRows)
            .map(row => {
                const key = row.querySelector('.header-key').value.trim();
                const value = row.querySelector('.header-value').value.trim();
                if (!key) return null;
                return { key, value };
            })
            .filter(header => header !== null);
    }
    
    return {
        name,
        description,
        example_phrases,
        parameters,
        action,
        enabled: state.isEditing ? state.currentCommand.enabled : true
    };
}

// Edit Command
function editCommand(commandId) {
    showCommandEditor(commandId);
}

// Delete Command
async function deleteCommand(commandId) {
    const command = state.commands.find(cmd => cmd.id === commandId);
    if (!command) return;
    
    if (!confirm(`Are you sure you want to delete "${command.name}"?`)) {
        return;
    }
    
    try {
        await apiCall(`/api/commands/${commandId}`, {
            method: 'DELETE'
        });
        loadCommands();
    } catch (error) {
        console.error('Failed to delete command:', error);
    }
}

// Toggle Command
async function toggleCommand(commandId) {
    try {
        await apiCall(`/api/commands/${commandId}/toggle`, {
            method: 'PATCH'
        });
        loadCommands();
    } catch (error) {
        console.error('Failed to toggle command:', error);
    }
}

// Add Example
function addExample() {
    const container = document.getElementById('examplesContainer');
    const row = document.createElement('div');
    row.className = 'example-row';
    row.innerHTML = `
        <input type="text" class="example-input" placeholder="e.g., 'run emails for sahar@gmail.com'">
        <button class="btn-icon" onclick="removeExample(this)">−</button>
    `;
    container.appendChild(row);
}

// Remove Example
function removeExample(button) {
    const container = document.getElementById('examplesContainer');
    if (container.children.length > 1) {
        button.parentElement.remove();
    }
}

// Add Parameter
function addParam() {
    const tbody = document.getElementById('paramsTableBody');
    const row = document.createElement('tr');
    row.className = 'param-row';
    row.innerHTML = `
        <td><input type="text" class="param-name" placeholder="param_name"></td>
        <td>
            <select class="param-type">
                <option value="string">string</option>
                <option value="number">number</option>
                <option value="email">email</option>
                <option value="url">url</option>
                <option value="boolean">boolean</option>
            </select>
        </td>
        <td><input type="checkbox" class="param-required"></td>
        <td><input type="text" class="param-description" placeholder="Description"></td>
        <td><button class="btn-icon" onclick="removeParam(this)">−</button></td>
    `;
    tbody.appendChild(row);
}

// Remove Parameter
function removeParam(button) {
    const tbody = document.getElementById('paramsTableBody');
    if (tbody.children.length > 1) {
        button.closest('tr').remove();
    }
}

// Add Header
function addHeader() {
    const container = document.getElementById('headersContainer');
    const row = document.createElement('div');
    row.className = 'header-row';
    row.innerHTML = `
        <input type="text" class="header-key" placeholder="Header-Name">
        <input type="text" class="header-value" placeholder="Header-Value">
        <button class="btn-icon" onclick="removeHeader(this)">−</button>
    `;
    container.appendChild(row);
}

// Remove Header
function removeHeader(button) {
    const container = document.getElementById('headersContainer');
    if (container.children.length > 1) {
        button.parentElement.remove();
    }
}

// Toggle Action Type
function toggleActionType() {
    const actionType = document.querySelector('input[name="actionType"]:checked').value;
    const scriptAction = document.getElementById('scriptAction');
    const httpAction = document.getElementById('httpAction');
    
    if (actionType === 'script') {
        scriptAction.style.display = 'block';
        httpAction.style.display = 'none';
    } else {
        scriptAction.style.display = 'none';
        httpAction.style.display = 'block';
    }
    
    // Update help text with available parameters
    updateParameterHints();
}

// Update Parameter Hints
function updateParameterHints() {
    const paramRows = document.querySelectorAll('.param-row');
    const paramNames = Array.from(paramRows)
        .map(row => row.querySelector('.param-name').value.trim())
        .filter(name => name)
        .map(name => `{${name}}`)
        .join(', ');
    
    const helpText = paramNames ? `Available: ${paramNames}` : 'Add parameters above to use them here';
    
    document.getElementById('scriptHelpText').textContent = helpText;
    document.getElementById('httpHelpText').textContent = helpText;
}

// Monitor Status
async function loadMonitorStatus() {
    try {
        const data = await apiCall('/api/monitor/status');
        state.monitorStatus = data.status;
        updateMonitorUI();
    } catch (error) {
        console.error('Failed to load monitor status:', error);
    }
}

// Update Monitor UI
function updateMonitorUI() {
    const indicator = document.getElementById('statusIndicator');
    const statusText = document.getElementById('statusText');
    const toggleBtn = document.getElementById('toggleMonitorBtn');
    
    if (state.monitorStatus && state.monitorStatus.running) {
        indicator.classList.add('running');
        statusText.textContent = 'Running';
        toggleBtn.textContent = 'Stop Monitor';
        toggleBtn.className = 'btn btn-danger';
    } else {
        indicator.classList.remove('running');
        statusText.textContent = 'Stopped';
        toggleBtn.textContent = 'Start Monitor';
        toggleBtn.className = 'btn btn-primary';
    }
}

// Toggle Monitor
async function toggleMonitor() {
    try {
        if (state.monitorStatus && state.monitorStatus.running) {
            await apiCall('/api/monitor/stop', { method: 'POST' });
        } else {
            await apiCall('/api/monitor/start', { method: 'POST' });
        }
        setTimeout(loadMonitorStatus, 500);
    } catch (error) {
        console.error('Failed to toggle monitor:', error);
    }
}

// Test Parse
async function testParse() {
    const text = document.getElementById('testPhrase').value.trim();
    
    if (!text) {
        alert('Please enter a test phrase');
        return;
    }
    
    try {
        const data = await apiCall('/api/commands/test', {
            method: 'POST',
            body: JSON.stringify({ text })
        });
        
        state.lastParseResult = data.parse_result;
        displayTestResult(data.parse_result);
    } catch (error) {
        console.error('Test parse failed:', error);
    }
}

// Display Test Result
function displayTestResult(result) {
    const resultDiv = document.getElementById('testResult');
    const contentDiv = document.getElementById('testResultContent');
    const executeBtn = document.getElementById('testExecuteBtn');
    
    resultDiv.style.display = 'block';
    
    if (result.success) {
        resultDiv.className = 'test-result success';
        
        let html = `
            <div><strong>✅ Matched Command:</strong> ${escapeHtml(result.command_name)}</div>
            <div class="param-display">
                <strong>Parameters:</strong>
        `;
        
        if (result.parameters && Object.keys(result.parameters).length > 0) {
            for (const [key, value] of Object.entries(result.parameters)) {
                html += `
                    <div class="param-item">
                        <span class="param-key">${escapeHtml(key)}:</span>
                        <span class="param-value">${escapeHtml(String(value))}</span>
                    </div>
                `;
            }
        } else {
            html += '<div class="param-item">No parameters</div>';
        }
        
        html += '</div>';
        contentDiv.innerHTML = html;
        executeBtn.style.display = 'inline-block';
    } else {
        resultDiv.className = 'test-result error';
        contentDiv.innerHTML = `
            <div><strong>❌ No Match</strong></div>
            <div>${escapeHtml(result.error || 'Could not match any command')}</div>
        `;
        executeBtn.style.display = 'none';
    }
}

// Test Execute
async function testExecute() {
    if (!state.lastParseResult || !state.lastParseResult.success) {
        alert('No valid command to execute');
        return;
    }
    
    if (!confirm('Execute this command?')) {
        return;
    }
    
    try {
        const data = await apiCall('/api/commands/execute', {
            method: 'POST',
            body: JSON.stringify({
                command_id: state.lastParseResult.command_id,
                parameters: state.lastParseResult.parameters
            })
        });
        
        if (data.result.success) {
            alert(`✅ Execution successful!\n\n${data.result.output || 'No output'}`);
        } else {
            alert(`❌ Execution failed:\n\n${data.result.error}`);
        }
    } catch (error) {
        console.error('Test execute failed:', error);
    }
}

// Utility: Escape HTML
function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

