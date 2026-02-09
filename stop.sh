#!/bin/bash

# ============================================
# Stop Script
# ============================================

echo "Stopping undercoverAI services..."

# Stop backend server
if [ -f logs/server.pid ]; then
    SERVER_PID=$(cat logs/server.pid)
    if ps -p $SERVER_PID > /dev/null 2>&1; then
        kill $SERVER_PID
        echo "Backend server stopped (PID: $SERVER_PID)"
    else
        echo "Backend server not running"
    fi
    rm logs/server.pid
fi

# Stop frontend
if [ -f logs/client.pid ]; then
    CLIENT_PID=$(cat logs/client.pid)
    if ps -p $CLIENT_PID > /dev/null 2>&1; then
        kill $CLIENT_PID
        echo "Frontend stopped (PID: $CLIENT_PID)"
    else
        echo "Frontend not running"
    fi
    rm logs/client.pid
fi

# Fallback: force kill any remaining processes
pkill -f "node.*server/src/index" || true
pkill -f "vite" || true

echo "All services stopped"