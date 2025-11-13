#!/usr/bin/env python3
"""
Simple script to speak a phrase out loud using macOS text-to-speech.
"""
import sys
import subprocess
import argparse
import time


def speak(phrase: str):
    """
    Speak the given phrase using macOS text-to-speech.
    
    Args:
        phrase: The text to speak out loud
    """
    try:
        # Use native macOS 'say' command to avoid quoting issues
        subprocess.run(['say', phrase], check=True)
    except subprocess.CalledProcessError as e:
        print(f"Error: Failed to speak phrase: {e}", file=sys.stderr)
        sys.exit(1)
    except FileNotFoundError:
        print("Error: 'say' command not found. This script requires macOS.", file=sys.stderr)
        sys.exit(1)


def main():
    parser = argparse.ArgumentParser(
        description="Speak a phrase out loud using macOS text-to-speech"
    )
    parser.add_argument(
        "phrase",
        type=str,
        nargs="+",
        help="The phrase to speak out loud"
    )
    
    args = parser.parse_args()
    phrase = " ".join(args.phrase)
    
    speak(phrase)


if __name__ == "__main__":
    main()

