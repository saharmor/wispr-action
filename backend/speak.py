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
    parser.add_argument(
        "--sleep",
        type=int,
        required=False,
        help="Optional sleep period in seconds after speaking before saying 'finished talking'"
    )
    
    args = parser.parse_args()
    phrase = " ".join(args.phrase)
    
    speak(phrase)
    
    # If sleep period is specified, sleep and then say "finished talking"
    if args.sleep is not None:
        time.sleep(args.sleep)
        speak("finished talking")


if __name__ == "__main__":
    main()

