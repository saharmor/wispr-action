"""Command parser using Claude's tool calling to route commands."""

from typing import Dict, Optional, Any
from llm_client import get_claude_client
from command_manager import get_command_manager


def parse_command(transcript_text: str) -> Dict[str, Any]:
    """
    Parse a voice command transcript using Claude's tool calling.
    
    This function sends the transcript to Claude with all enabled commands
    as tool definitions. Claude determines which command is being invoked
    and extracts the parameter values.
    
    Args:
        transcript_text: The transcribed voice command text
        
    Returns:
        Dictionary with:
            - success: bool - Whether parsing succeeded
            - command_id: str - ID of matched command (if any)
            - command_name: str - Name of matched command (if any)
            - parameters: dict - Extracted parameters (if any)
            - error: str - Error message (if failed)
            - response_text: str - Claude's text response (if no tool match)
    """
    try:
        # Get Claude client and command manager
        client = get_claude_client()
        manager = get_command_manager()
        
        # Get all enabled commands as tools
        tools = manager.get_claude_tools()
        
        if not tools:
            return {
                "success": False,
                "error": "No enabled commands available",
                "command_id": None,
                "parameters": {}
            }
        
        # System prompt for Claude
        system_prompt = (
            "You are a voice command router. The user will speak a command, "
            "and you must determine which tool to use and extract the relevant parameters. "
            "Choose the most appropriate tool based on the user's intent. "
            "\n\nIMPORTANT: For optional parameters (not in the 'required' list), "
            "ONLY provide them if the user explicitly mentions a specific value. "
            "Do NOT infer, guess, or provide default values for optional parameters. "
            "If the user says 'all' or doesn't specify an optional parameter, omit it entirely. "
            "\n\nIf no tool matches, respond with a brief explanation."
        )
        
        # Call Claude with tools
        response = client.call_with_tools(
            user_message=transcript_text,
            tools=tools,
            system_prompt=system_prompt
        )
        
        if not response["success"]:
            return {
                "success": False,
                "error": response.get("error", "Unknown error"),
                "command_id": None,
                "parameters": {}
            }
        
        # Check if a tool was used
        if response["tool_use"]:
            tool_use = response["tool_use"]
            command_id = tool_use["name"]
            # Ensure parameters is a dictionary
            parameters = tool_use.get("input") or {}
            if not isinstance(parameters, dict):
                parameters = {}
            
            # Get command details
            command = manager.get_command(command_id)
            
            if not command:
                return {
                    "success": False,
                    "error": f"Command not found: {command_id}",
                    "command_id": command_id,
                    "parameters": parameters
                }
            
            return {
                "success": True,
                "command_id": command_id,
                "command_name": command.get("name", "Unknown"),
                "parameters": parameters,
                "error": None
            }
        
        # No tool was used - command not matched
        return {
            "success": False,
            "error": "No matching command found",
            "command_id": None,
            "parameters": {},
            "response_text": response.get("text", "")
        }
        
    except Exception as e:
        return {
            "success": False,
            "error": f"Parsing error: {str(e)}",
            "command_id": None,
            "parameters": {}
        }


def test_parse(transcript_text: str, verbose: bool = True) -> Dict[str, Any]:
    """
    Test command parsing with optional verbose output.
    
    Args:
        transcript_text: The text to parse
        verbose: Whether to print detailed output
        
    Returns:
        Parse result dictionary
    """
    result = parse_command(transcript_text)
    
    if verbose:
        print("\n" + "="*60)
        print(f"📝 Parsing: {transcript_text}")
        print("="*60)
        
        if result["success"]:
            print(f"✅ Matched: {result['command_name']} (ID: {result['command_id']})")
            print(f"📦 Parameters:")
            for key, value in result["parameters"].items():
                print(f"   • {key}: {value}")
        else:
            print(f"❌ Error: {result['error']}")
            if result.get("response_text"):
                print(f"💬 Claude says: {result['response_text']}")
        
        print("="*60 + "\n")
    
    return result

