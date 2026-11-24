#!/bin/bash
# DecaTone Docker Uninstallation Script
set -e

echo "===================================================="
echo " ⚠️  DecaTone Telephone Switch Uninstaller"
echo "===================================================="

read -r -p "Are you sure you want to stop DecaTone and remove containers? (y/N): " CONFIRM
if [[ "$CONFIRM" =~ ^[Yy]$ ]]; then
    read -r -p "Do you also want to permanently delete persistent data volumes (database, voicemails, branding)? (y/N): " PURGE
    if [[ "$PURGE" =~ ^[Yy]$ ]]; then
        if docker compose version &> /dev/null; then
            docker compose down -v
        else
            docker-compose down -v
        fi
        echo "DecaTone containers and persistent data volumes removed."
    else
        if docker compose version &> /dev/null; then
            docker compose down
        else
            docker-compose down
        fi
        echo "DecaTone containers stopped (persistent volumes preserved)."
    fi
    echo "Uninstallation complete."
else
    echo "Cancelled."
fi
