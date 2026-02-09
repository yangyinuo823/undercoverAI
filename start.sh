#!/bin/bash

# ============================================
# Configuration
# ============================================
# Set your Gemini API key here
GEMINI_API_KEY=""

# ============================================
# Deployment Script
# ============================================

set -e

echo "Starting undercoverAI deployment..."

# Validate API key
if [ -z "$GEMINI_API_KEY" ]; then
    echo "ERROR: GEMINI_API_KEY is not set."
    echo "Please edit this script and set your API key at the top."
    exit 1
fi

# 1. Detect server public IP
echo "Detecting server IP..."
SERVER_IP=$(curl -s ifconfig.me || curl -s ip.sb || curl -s api.ipify.org)

if [ -z "$SERVER_IP" ]; then
    echo "ERROR: Failed to detect server IP. Please check your internet connection."
    exit 1
fi

echo "Server IP detected: $SERVER_IP"

# 2. Create/update root .env file for frontend
echo "Creating frontend .env file..."
cat > .env << EOF
VITE_SOCKET_URL=http://$SERVER_IP:3001
EOF

echo "Frontend .env created"

# 3. Create/update server/.env file for backend
echo "Creating backend .env file..."
cat > server/.env << EOF
CORS_ORIGIN=http://$SERVER_IP:3000
GEMINI_API_KEY=$GEMINI_API_KEY
EOF

echo "Backend .env created"

# 4. Install dependencies if needed
if [ ! -d "node_modules" ]; then
    echo "Installing frontend dependencies..."
    npm install
fi

if [ ! -d "server/node_modules" ]; then
    echo "Installing backend dependencies..."
    cd server && npm install && cd ..
fi

# 5. Stop old processes if running
echo "Stopping old processes..."
pkill -f "node.*server/src/index" || true
pkill -f "vite" || true
sleep 2

# 6. Create logs directory
mkdir -p logs

# 7. Start backend server
echo "Starting backend server..."
cd server
nohup npm run dev > ../logs/server.log 2>&1 &
SERVER_PID=$!
cd ..

# Wait for backend to start
sleep 3

# 8. Start frontend
echo "Starting frontend..."
nohup npm run dev > logs/client.log 2>&1 &
CLIENT_PID=$!

# Wait for frontend to start
sleep 3

# 9. Save PIDs
echo $SERVER_PID > logs/server.pid
echo $CLIENT_PID > logs/client.pid

echo ""
echo "=========================================="
echo "Deployment complete!"
echo "=========================================="
echo ""
echo "Process Information:"
echo "  Backend PID: $SERVER_PID"
echo "  Frontend PID: $CLIENT_PID"
echo ""
echo "Access your app at:"
echo "  http://$SERVER_IP:3000"
echo ""
echo "View logs:"
echo "  Backend:  tail -f logs/server.log"
echo "  Frontend: tail -f logs/client.log"
echo ""
echo "To stop services, run: ./stop.sh"
echo "=========================================="