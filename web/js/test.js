/**
 * Test panel functionality
 */
import { state } from './state.js';
import { apiCall } from './api.js';
import { showModal, showConfirm, showToast, escapeHtml } from './ui.js';
import { focusHistorySection, loadExecutionHistory } from './history.js';
import { renderParameters } from './components.js';

/**
 * Test parse a phrase
 */
export async function testParse() {
    const text = document.getElementById('testPhrase').value.trim();
    
    if (!text) {
        showModal('Please enter a test phrase', 'Input Required', 'warning');
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

/**
 * Display test result
 */
function displayTestResult(result) {
    const resultDiv = document.getElementById('testResult');
    const contentDiv = document.getElementById('testResultContent');
    const executeBtn = document.getElementById('testExecuteBtn');
    
    resultDiv.style.display = 'block';
    
    if (result.success) {
        resultDiv.className = 'test-result success';
        
        const paramsHtml = renderParameters(result.parameters, 'normal');
        
        const html = `
            <div><strong>Matched Command:</strong> ${escapeHtml(result.command_name)}</div>
            <div class="param-display">
                <strong>Parameters:</strong>
                ${paramsHtml}
            </div>
        `;
        
        contentDiv.innerHTML = html;
        executeBtn.style.display = 'inline-block';
    } else {
        resultDiv.className = 'test-result error';
        contentDiv.innerHTML = `
            <div><strong>No Match</strong></div>
            <div>${escapeHtml(result.error || 'Could not match any command')}</div>
        `;
        executeBtn.style.display = 'none';
    }
}

/**
 * Execute the tested command
 */
export async function testExecute() {
    if (!state.lastParseResult || !state.lastParseResult.success) {
        showModal('No valid command to execute', 'Cannot Execute', 'warning');
        return;
    }
    
    const confirmed = await showConfirm(
        'Execute this command?',
        'Execute Command',
        'confirm'
    );
    
    if (!confirmed) {
        return;
    }
    
    try {
        // Get command's default timeout
        const command = state.commands.find(cmd => cmd.id === state.lastParseResult.command_id);
        const commandTimeout = command && command.timeout ? command.timeout : null;
        
        const requestBody = {
            command_id: state.lastParseResult.command_id,
            parameters: state.lastParseResult.parameters
        };
        
        // Use command's timeout if specified
        if (commandTimeout && commandTimeout > 0) {
            requestBody.timeout = commandTimeout;
        }
        
        // Pass original transcript for read-aloud feature
        const testPhrase = document.getElementById('testPhrase')?.value.trim();
        if (testPhrase) {
            requestBody.original_transcript = testPhrase;
        }
        
        const data = await apiCall('/api/commands/execute', {
            method: 'POST',
            body: JSON.stringify(requestBody)
        });
        
        // Check if this is an async script command
        const isAsyncScript = command && command.action && command.action.type === 'script';
        
        if (data.result.success) {
            if (isAsyncScript) {
                // For async scripts, show a toast and switch to history view
                showToast('Command launched! Check History tab for status', 'success', 4000);
                focusHistorySection();
            } else {
                // For sync commands (HTTP), show modal with result
                showModal(
                    data.result.output || 'No output',
                    'Execution Successful',
                    'success'
                );
            }
            loadExecutionHistory(0);
        } else {
            showModal(
                data.result.error || 'Command execution failed',
                'Execution Failed',
                'error'
            );
        }
    } catch (error) {
        // Show error in a modal that stays open (unless it's a connection error)
        console.error('Test execute failed:', error);
        if (!error.isConnectionError) {
            showModal(
                error.message || 'Failed to execute command',
                'Execution Error',
                'error'
            );
        }
    }
}

