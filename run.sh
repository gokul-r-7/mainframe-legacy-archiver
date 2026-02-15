#!/usr/bin/env bash
# ──────────────────────────────────────────────────────────────────────────────
# run.sh — Start the Data Archival Platform locally
# ──────────────────────────────────────────────────────────────────────────────
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

echo -e "${CYAN}"
echo "╔═══════════════════════════════════════════════════════════╗"
echo "║          Data Archival & Analytics Platform               ║"
echo "║                   Local Development                       ║"
echo "╚═══════════════════════════════════════════════════════════╝"
echo -e "${NC}"

# ── Check dependencies ───────────────────────────────────────────────────────
check_dependency() {
    if ! command -v "$1" &> /dev/null; then
        echo -e "${RED}Error: $1 is not installed. Please install it first.${NC}"
        exit 1
    fi
}

check_dependency node
check_dependency npm

# ── Option parsing ───────────────────────────────────────────────────────────
USE_DOCKER=false
while [[ $# -gt 0 ]]; do
    case $1 in
        --docker) USE_DOCKER=true; shift ;;
        --help)
            echo "Usage: ./run.sh [OPTIONS]"
            echo ""
            echo "Options:"
            echo "  --docker    Run with Docker Compose (includes LocalStack)"
            echo "  --help      Show this help message"
            exit 0 ;;
        *) echo -e "${RED}Unknown option: $1${NC}"; exit 1 ;;
    esac
done

if [ "$USE_DOCKER" = true ]; then
    check_dependency docker
    echo -e "${YELLOW}Starting services with Docker Compose...${NC}"
    docker compose up --build -d
    echo ""
    echo -e "${GREEN}Services started!${NC}"
    echo -e "  Frontend:   ${CYAN}http://localhost:3000${NC}"
    echo -e "  LocalStack: ${CYAN}http://localhost:4566${NC}"
    echo ""
    echo -e "To stop: ${YELLOW}docker compose down${NC}"
    exit 0
fi

# ── Start Frontend Dev Server ────────────────────────────────────────────────
echo -e "${YELLOW}Installing frontend dependencies...${NC}"
cd front_end

if [ ! -d "node_modules" ]; then
    npm install --legacy-peer-deps
fi

echo ""
echo -e "${GREEN}Starting frontend development server...${NC}"
echo -e "  Frontend: ${CYAN}http://localhost:5173${NC}"
echo ""
echo -e "${YELLOW}Note: For full backend functionality, deploy to AWS or use --docker flag for LocalStack.${NC}"
echo -e "Press Ctrl+C to stop."
echo ""

npm run dev
