#!/bin/bash
# Wispr Action Quick Start Script

echo "╔══════════════════════════════════════════════════════════════╗"
echo "║              🎙️  Wispr Action - Quick Start  🎙️             ║"
echo "╚══════════════════════════════════════════════════════════════╝"
echo ""

# Check if Python is available
if ! command -v python3 &> /dev/null; then
    echo "❌ Python 3 is not installed. Please install Python 3.8 or higher."
    exit 1
fi

echo "✅ Python 3 found: $(python3 --version)"

# Check if venv exists
if [ ! -d "venv" ]; then
    echo ""
    echo "📦 Creating virtual environment..."
    python3 -m venv venv
    if [ $? -ne 0 ]; then
        echo "❌ Failed to create virtual environment"
        exit 1
    fi
    echo "✅ Virtual environment created"
fi

# Activate virtual environment
echo ""
echo "🔧 Activating virtual environment..."
source venv/bin/activate

# Install/upgrade dependencies
echo ""
echo "📥 Installing dependencies..."
pip install -q --upgrade pip
pip install -q -r requirements.txt
if [ $? -ne 0 ]; then
    echo "❌ Failed to install dependencies"
    exit 1
fi
echo "✅ Dependencies installed"

# Check if .env exists
if [ ! -f ".env" ]; then
    echo ""
    echo "⚠️  No .env file found"
    
    if [ -f "env.example" ]; then
        echo "📝 Creating .env from template..."
        cp env.example .env
        echo "✅ .env file created"
        echo ""
        echo "🔑 IMPORTANT: Edit .env and add your ANTHROPIC_API_KEY"
        echo "   Get your API key from: https://console.anthropic.com/"
        echo ""
        read -p "Press Enter after you've added your API key to .env..."
    else
        echo "❌ env.example not found. Please create a .env file manually."
        exit 1
    fi
fi

# Run test setup
echo ""
echo "🧪 Running setup tests..."
python test_setup.py
if [ $? -ne 0 ]; then
    echo ""
    echo "⚠️  Some tests failed. Please fix the issues above before starting."
    exit 1
fi

# Ask if user wants to start now
echo ""
read -p "🚀 Start Wispr Action now? (y/n) " -n 1 -r
echo ""

if [[ $REPLY =~ ^[Yy]$ ]]; then
    echo ""
    echo "🎉 Starting Wispr Action..."
    echo ""
    python main.py
else
    echo ""
    echo "✅ Setup complete! To start later, run:"
    echo "   source venv/bin/activate"
    echo "   python main.py"
fi

