"""Module for extracting concise answers from execution results and speaking them."""

import subprocess
import json
import os
import tempfile
import requests
from typing import Dict, Any, Optional
from llm_client import get_claude_client
from config import TTS_PROVIDER, CARTESIA_API_KEY, CARTESIA_MODEL_ID, CARTESIA_VOICE_ID


def extract_concise_answer(original_command: str, execution_result: str) -> str:
    """
    Use Claude to extract a concise answer from the execution result.
    
    Args:
        original_command: The original user command/query
        execution_result: The result from executing the command
        
    Returns:
        A concise answer suitable for text-to-speech
    """
    client = get_claude_client()
    
    # Build the prompt for Claude
    user_message = f"""Original command: "{original_command}"

Execution result:
{execution_result}

Please extract the concise answer to the original command. Keep it brief and conversational, suitable for text-to-speech. 
Focus only on the key information that answers the user's query. If there's an error, explain it briefly.
Do not include any formatting, code blocks, or special characters - just plain text.
Also, if there are numbers involved, make sure you understand what they mean and read them accordingly."""

    system_prompt = (
        "You are a helpful assistant that extracts concise, speakable answers from command execution results. "
        "Keep responses very brief and conversational - suitable for reading out loud. "
        "Maximum 2-3 sentences unless absolutely necessary."
    )
    
    try:
        response = client.call_with_tools(
            user_message=user_message,
            tools=[],  # No tools needed, we just want text response
            system_prompt=system_prompt,
            max_tokens=300  # Keep responses concise
        )
        
        if response.get("success") and response.get("text"):
            return response["text"].strip()
        else:
            return "I couldn't extract a clear answer from the result."
    except Exception as e:
        print(f"Error extracting concise answer: {e}")
        return "I encountered an error while processing the result."


def speak_with_cartesia(text: str) -> bool:
    """
    Speak the given text using Cartesia AI TTS.
    
    Args:
        text: The text to speak
        
    Returns:
        True if successful, False otherwise
    """
    if not CARTESIA_API_KEY:
        print("Error: CARTESIA_API_KEY not configured")
        return False
    
    try:
        # Make request to Cartesia API
        url = "https://api.cartesia.ai/tts/bytes"
        headers = {
            "Cartesia-Version": "2024-06-10",
            "X-API-Key": CARTESIA_API_KEY,
            "Content-Type": "application/json"
        }
        data = {
            "transcript": text,
            "model_id": CARTESIA_MODEL_ID,
            "voice": {
                "mode": "id",
                "id": CARTESIA_VOICE_ID
            },
            "output_format": {
                "container": "wav",
                "encoding": "pcm_s16le",
                "sample_rate": 44100
            }
        }
        
        response = requests.post(url, headers=headers, json=data, timeout=30)
        
        if response.status_code != 200:
            print(f"Error: Cartesia API returned status {response.status_code}: {response.text}")
            return False
        
        # Save audio to temporary file
        with tempfile.NamedTemporaryFile(mode='wb', suffix='.wav', delete=False) as f:
            temp_file = f.name
            f.write(response.content)
        
        # Play audio using afplay (macOS audio player)
        try:
            subprocess.run(['afplay', temp_file], check=True, timeout=60)
            return True
        finally:
            # Clean up temporary file
            try:
                os.unlink(temp_file)
            except:
                pass
                
    except requests.Timeout:
        print("Error: Cartesia API request timed out")
        return False
    except requests.RequestException as e:
        print(f"Error: Cartesia API request failed: {e}")
        return False
    except subprocess.TimeoutExpired:
        print("Error: Audio playback timed out")
        return False
    except Exception as e:
        print(f"Error: Unexpected error in Cartesia TTS: {e}")
        return False


def speak_with_apple(text: str) -> bool:
    """
    Speak the given text using macOS built-in text-to-speech.
    
    Args:
        text: The text to speak
        
    Returns:
        True if successful, False otherwise
    """
    try:
        # Use native macOS 'say' command
        subprocess.run(['say', text], check=True, timeout=60)
        return True
    except subprocess.TimeoutExpired:
        print("Error: Text-to-speech timed out")
        return False
    except subprocess.CalledProcessError as e:
        print(f"Error: Failed to speak text: {e}")
        return False
    except FileNotFoundError:
        print("Error: 'say' command not found. This requires macOS.")
        return False
    except Exception as e:
        print(f"Error: Unexpected error in text-to-speech: {e}")
        return False


def speak_result(text: str) -> bool:
    """
    Speak the given text using the configured TTS provider.
    
    Args:
        text: The text to speak
        
    Returns:
        True if successful, False otherwise
    """
    if TTS_PROVIDER == "cartesia":
        print(f"[TTS] Using Cartesia AI (model: {CARTESIA_MODEL_ID})")
        return speak_with_cartesia(text)
    else:
        print("[TTS] Using Apple built-in TTS")
        return speak_with_apple(text)


def process_and_speak_result(
    original_command: str,
    execution_result: Dict[str, Any],
    command_name: str = "command"
) -> None:
    """
    Extract a concise answer from execution result and speak it out loud.
    
    Args:
        original_command: The original user command/query
        execution_result: The execution result dictionary
        command_name: Name of the command that was executed
    """
    # Build the result text from execution result
    result_text = ""
    
    if execution_result.get("success"):
        result_text = execution_result.get("output", "Command executed successfully.")
    else:
        error = execution_result.get("error", "Unknown error")
        output = execution_result.get("output", "")
        result_text = f"Error: {error}"
        if output:
            result_text += f"\nOutput: {output}"
    
    # Limit the result text to avoid overwhelming Claude
    max_length = 2000
    if len(result_text) > max_length:
        result_text = result_text[:max_length] + "... (truncated)"
    
    print(f"[Read Aloud] Extracting answer from result for command: {command_name}")
    
    # Extract concise answer
    concise_answer = extract_concise_answer(original_command, result_text)
    
    print(f"[Read Aloud] Speaking: {concise_answer}")
    
    # Speak the answer
    success = speak_result(concise_answer)
    
    if not success:
        print("[Read Aloud] Failed to speak the result")

