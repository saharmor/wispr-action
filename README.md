<div align="center">

# 🎙️ Wispr Action

Transform your voice dictations into automated actions. Wispr Action monitors your Wispr Flow transcriptions and uses Claude AI to intelligently route commands and execute automated tasks.

<p align="center">
<a href="https://www.linkedin.com/in/sahar-mor/" target="_blank"><img src="https://img.shields.io/badge/LinkedIn-Connect-blue" alt="LinkedIn"></a>
<a href="https://x.com/theaievangelist" target="_blank"><img src="https://img.shields.io/twitter/follow/:theaievangelist" alt="X"></a>
<a href="http://aitidbits.ai/" target="_blank" style="display: inline-flex; align-items: center; text-decoration: none;"><img src="https://github.com/saharmor/saharmor.github.io/blob/main/images/ai%20tidbits%20logo.png?raw=true" alt="Stay updated on AI" width="20" height="20" style="margin-right: 5px;"> Stay updated on AI</a>
</p>

</div>

## Features

- **Intelligent Command Routing** - Claude AI automatically matches voice commands to configured actions
- **Flexible Actions** - Execute local scripts or trigger HTTP requests
- **Web Dashboard** - Intuitive UI for managing commands and testing
- **Real-time Monitoring** - Live status and execution logs
- **System Tray App** - Easy start/stop controls from your menu bar
- **Parameter Extraction** - AI-powered parameter parsing from natural language

## Quick Start

Wispr Action requires [Wispr Flow](https://www.wisprflow.com/) and an Anthropic Claude API key.

### Installation

1. Clone this repository and navigate to the directory:

```bash
git clone <repository-url>
cd wispr-action
```

2. Create a `.env` file from the provided template:

```bash
cp env.example .env
```

3. Edit `.env` and add your Anthropic API key:

```
ANTHROPIC_API_KEY=your_api_key_here
```

4. Run the quickstart script:

```bash
./quickstart.sh
```

The quickstart script will automatically set up your virtual environment, install dependencies, validate your configuration, and launch the application.

Once started, the web dashboard will open at http://localhost:9000, the system tray app will appear in your menu bar, and the monitor will begin watching for voice commands.

## Usage

### Getting Started with the Default Command

When you first set up Wispr Action, a default welcome command is automatically created to help you test the system. You can trigger it by saying:

- "Command, run default command"
- "Command, run the default command"
- "Command, execute default command"

This will make your computer say "Welcome to Wispr Action! Go ahead and create your first command." using AppleScript. It's a simple way to verify everything is working before creating your own commands.

### Managing Commands

Commands are managed through the web dashboard interface. Creating new commands is straightforward through the UI, where you can configure command names, descriptions, parameters, and actions (scripts or HTTP requests). All commands are automatically saved to `commands.json`, which Wispr Action uses to route and execute your voice commands.

### Example Commands

#### Script Command with Optional Parameters
```
Name: Process Emails
Description: Run email processing script for a given inbox
Parameters:
  - email (string, required): The inbox address
  - days (number, optional): Days back to process
Action: Run Script
  Path: ~/scripts/process_emails.py
  Args: --email={email} [--days={days}]
```

**Usage**: 
- "Command, run email processor for sahar@gmail.com" (uses default days)
- "Command, process emails for sahar@gmail.com from last 30 days" (specifies days)

**Note**: Wrap optional parameters in square brackets `[]` in your template. See [OPTIONAL_PARAMETERS.md](OPTIONAL_PARAMETERS.md) for details.

#### Script Command with Virtual Environment
For scripts that require a specific Python environment and environment variables:

```
Name: Refresh Submitted Events
Description: Refresh events using project's virtualenv and .env file
Parameters:
  - calendar_id (number, required): The calendar ID
Action: Run Script
  Path: ~/luma-automator/backend/scripts/refresh_submitted_events.py
  Args: {calendar_id}
  Python Interpreter: ~/luma-automator/backend/venv/bin/python
  Environment File: ~/luma-automator/backend/.env
  Working Directory: ~/luma-automator/backend
```

**Usage**: "Command, refresh submitted events for calendar 2"

**Note**: The optional fields allow you to:
- **Python Interpreter**: Use a specific Python from a virtualenv
- **Environment File**: Load environment variables from a .env file
- **Working Directory**: Set the directory to run the script from

**Tip**: Use the "Import from launch.json" button to automatically fill in these fields from your VS Code launch.json configuration.

#### HTTP Command
```
Name: Play Music
Description: Play music via Spotify API
Parameters:
  - query (string, required): Song or artist name
Action: Call HTTP
  Method: POST
  URL: http://localhost:3000/api/music/play
  Body: {"query": "{query}"}
```

**Usage**: "Command, play bohemian rhapsody"

### Starting the Monitor

1. Click **"Start Monitor"** in the dashboard or system tray
2. Speak commands with the activation word (default: "command")
3. The system will automatically parse and execute matching commands

### Testing Commands

Use the Test Panel in the dashboard:
1. Enter a test phrase
2. Click **"Parse Command"** to see how it's interpreted
3. Review extracted parameters
4. Click **"Execute"** to run the command

## Architecture

Wispr Action operates as an intelligent automation bridge between voice input and action execution:

1. The monitor component continuously polls the Wispr Flow database for new transcriptions (default: every 1-2 seconds)
2. When a transcript contains the activation word, the full text is sent to Claude AI along with all enabled commands as available "tools"
3. Claude analyzes the natural language input, determines which command matches best, and extracts any required parameters
4. The executor component runs the matched command with the extracted parameters, either executing a local script or making an HTTP request
5. Results are logged and displayed in real-time through the web dashboard and system logs

## Configuration

All configuration is managed through environment variables in the `.env` file:

```bash
# Required
ANTHROPIC_API_KEY=your_key_here

# Optional (with defaults shown)
WISPR_DB_PATH="~/Library/Application Support/Wispr Flow/flow.sqlite"
ACTIVATION_WORD=command
POLL_INTERVAL=1.5
WEB_PORT=9000
CONFIRM_MODE=false
LLM_MODEL=claude-haiku-4-5
```

**Configuration Options:**

- `ANTHROPIC_API_KEY` - Your Anthropic API key (required)
- `WISPR_DB_PATH` - Path to Wispr Flow database (quote paths with spaces)
- `ACTIVATION_WORD` - Word that triggers command processing
- `POLL_INTERVAL` - Database polling frequency in seconds
- `WEB_PORT` - Port for the web dashboard
- `CONFIRM_MODE` - Enable confirmation prompts before execution (useful for testing)
- `LLM_MODEL` - Claude model to use (supports all Anthropic models)

## License

MIT License - see LICENSE file for details
