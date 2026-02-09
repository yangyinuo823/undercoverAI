#!/bin/bash

# ============================================
# Status Check Script
# ============================================

echo "=========================================="
echo "Service Status"
echo "=========================================="
echo ""

# Check backend status
if [ -f logs/server.pid ]; then
    SERVER_PID=$(cat logs/server.pid)
    if ps -p $SERVER_PID > /dev/null 2>&1; then
        echo "[RUNNING] Backend server (PID: $SERVER_PID)"
    else
        echo "[STOPPED] Backend server (stale PID)"
    fi
else
    echo "[STOPPED] Backend server"
fi

# Check frontend status
if [ -f logs/client.pid ]; then
    CLIENT_PID=$(cat logs/client.pid)
    if ps -p $CLIENT_PID > /dev/null 2>&1; then
        echo "[RUNNING] Frontend (PID: $CLIENT_PID)"
    else
        echo "[STOPPED] Frontend (stale PID)"
    fi
else
    echo "[STOPPED] Frontend"
fi

echo ""
echo "=========================================="
echo "Recent Logs"
echo "=========================================="
echo ""

# Show backend logs
echo "--- Backend (last 10 lines) ---"
if [ -f logs/server.log ]; then
    tail -n 10 logs/server.log
else
    echo "No logs available"
fi

echo ""

# Show frontend logs
echo "--- Frontend (last 10 lines) ---"
if [ -f logs/client.log ]; then
    tail -n 10 logs/client.log
else
    echo "No logs available"
fi

echo ""
echo "=========================================="