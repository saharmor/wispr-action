"""Claude API client for command parsing with tool calling."""

import anthropic
from typing import List, Dict, Optional, Any
from config import ANTHROPIC_API_KEY, LLM_MODEL


class ClaudeClient:
    """Wrapper for Anthropic Claude API with tool calling support."""
    
    def __init__(self, api_key: str = ANTHROPIC_API_KEY, model: str = LLM_MODEL, timeout_seconds: int = 30):
        if not api_key:
            raise ValueError("ANTHROPIC_API_KEY is required")
        
        # Configure client with a sane timeout to avoid hanging
        self.client = anthropic.Anthropic(api_key=api_key).with_options(timeout=timeout_seconds)
        self.model = model
    
    def call_with_tools(
        self,
        user_message: str,
        tools: List[Dict],
        system_prompt: Optional[str] = None,
        max_tokens: int = 1024
    ) -> Dict[str, Any]:
        """
        Call Claude API with tool definitions.
        
        Args:
            user_message: The user's message/transcript
            tools: List of tool definitions
            system_prompt: Optional system prompt
            max_tokens: Maximum tokens in response
            
        Returns:
            Response dictionary with:
                - success: bool
                - tool_use: Dict with name and input (if tool was called)
                - text: str (if text response)
                - error: str (if error occurred)
        """
        try:
            messages = [{"role": "user", "content": user_message}]
            
            # Build API call parameters
            params = {
                "model": self.model,
                "max_tokens": max_tokens,
                "messages": messages,
            }
            
            if system_prompt:
                params["system"] = system_prompt
            
            if tools:
                params["tools"] = tools
            
            # Make API call
            response = self.client.messages.create(**params)
            
            # Parse response
            return self._parse_response(response)
        except anthropic.RateLimitError as e:
            return {
                "success": False,
                "error": f"Rate limit exceeded: {str(e)}"
            }
        except anthropic.APIConnectionError as e:
            return {
                "success": False,
                "error": f"API connection error: {str(e)}"
            }
        except anthropic.BadRequestError as e:
            return {
                "success": False,
                "error": f"Bad request: {str(e)}"
            }
        except anthropic.APIError as e:
            return {
                "success": False,
                "error": f"API error: {str(e)}"
            }
        except Exception as e:
            return {
                "success": False,
                "error": f"Unexpected error: {str(e)}"
            }
    
    def _parse_response(self, response) -> Dict[str, Any]:
        """Parse Claude API response to extract tool use or text."""
        result = {
            "success": True,
            "tool_use": None,
            "text": None,
            "error": None
        }
        
        # Handle cases where content is missing or not iterable
        content = getattr(response, "content", None)
        if not content or not isinstance(content, list):
            result["success"] = False
            result["error"] = "Invalid API response format"
            return result
        
        # Look for tool_use blocks
        for block in content:
            # Be defensive about attribute presence
            block_type = getattr(block, "type", None)
            if block_type == "tool_use":
                result["tool_use"] = {
                    "id": getattr(block, "id", None),
                    "name": getattr(block, "name", None),
                    "input": getattr(block, "input", {}) or {}
                }
                # Return first tool use
                return result
            elif block_type == "text":
                result["text"] = getattr(block, "text", None)
        
        # If no tool was used, return text response
        if not result["tool_use"] and not result["text"]:
            result["success"] = False
            result["error"] = "No tool use or text in response"
        
        return result


# Global client instance
_client = None

def get_claude_client() -> ClaudeClient:
    """Get the global ClaudeClient instance."""
    global _client
    if _client is None:
        _client = ClaudeClient()
    return _client

